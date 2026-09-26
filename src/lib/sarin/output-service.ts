/**
 * Sarin structured output: turns one cleanly validated Sarin import into an immutable
 * output version of plan options and plan pieces, using its declared stone type's
 * transformation (Blue/White plan groups, or the Pink 45-record layout).
 *
 * One transaction does everything, after locking the batch row (FOR UPDATE) so that
 * generations of one batch, and a validation claim racing one, run one at a time:
 *
 *   1. Re-reads the batch and its current validation attempt under the lock and refuses
 *      anything that is not VALIDATED by a COMPLETED attempt under the current validation
 *      profile with no blocking finding, against a mapping set that is still APPROVED.
 *      Advisories (non-blocking findings) do not stop generation; they are counted.
 *   2. Hashes the exact inputs. A version with the same inputs is the answer (reused).
 *   3. Plans every stone once to count, supersedes the current version, records the new
 *      one, then plans again and writes every option and piece. Planning is deterministic,
 *      and the written totals must equal the recorded ones.
 *
 * Any failure rolls the whole transaction back: there is never a partial output. The
 * database independently refuses content that does not reproduce its source rows or that
 * is written outside the generating transaction.
 *
 * Nothing here takes a value from the client: the request carries at most the validation
 * attempt the caller reviewed, as a precondition.
 *
 * Server-only.
 */

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { log } from "@/lib/api/log";
import type { ApiContext } from "@/lib/api/with-api";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { SARIN_OUTPUT_CONFIG, type SarinOutputConfig } from "@/lib/sarin/output-config";
import type { SarinStoneType } from "@/lib/sarin/domain";
import { SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";
import { transformFor } from "@/lib/sarin/transform";
import { planYield } from "@/lib/sarin/yield";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-service is server-only and must not be imported by client code.");
}

export const SARIN_OUTPUT_AUDIT = {
  generated: "SARIN_OUTPUT_GENERATED",
  reused: "SARIN_OUTPUT_REUSED",
  rejected: "SARIN_OUTPUT_REJECTED",
  failed: "SARIN_OUTPUT_FAILED",
} as const;

const ENTITY = "SarinImportBatch";
/** Pieces per insert statement. */
const PIECE_INSERT_CHUNK = 5000;

export interface SarinOutputActor {
  readonly userId: string;
  readonly scope: EffectiveScope;
  readonly audit: ApiContext<unknown>["audit"];
  readonly requestId: string;
}

export interface SarinOutputRequest {
  /** The validation attempt the caller reviewed. Generation is refused if it is no longer current. */
  readonly validationAttemptId?: string;
}

export interface SarinOutputOutcome {
  readonly reused: boolean;
  readonly versionId: string;
}

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: "country", lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

const inputsIncomplete = () =>
  new ApiError(422, "OUTPUT_INPUTS_INCOMPLETE", "The validated import does not have every value its structured output needs. Validate it again and review the findings.");

// ---------------------------------------------------------------------------------------
// Reading validated stones
// ---------------------------------------------------------------------------------------

interface PieceSource {
  readonly sourceRowId: string;
  readonly sourceRowNumber: number;
  readonly rawShape: string;
  readonly normalizedShape: string;
  readonly mappingRuleId: string;
  readonly estimatedWeight: Prisma.Decimal;
  readonly clarity: string;
  readonly color: string;
  readonly depthPct: Prisma.Decimal;
  readonly ratio: Prisma.Decimal;
  readonly length: Prisma.Decimal;
  readonly width: Prisma.Decimal;
  readonly depthMm: Prisma.Decimal;
}

interface ValidatedStone {
  readonly id: string;
  readonly roughWeight: Prisma.Decimal;
  readonly rows: PieceSource[];
}

/**
 * The batch's stones in file order, a page at a time, each with its rows in source order
 * and the shape its validation attempt resolved. Anything short of a complete, accepted,
 * interpreted row is refused rather than skipped: a stone is output whole or not at all.
 */
async function* validatedStones(tx: Prisma.TransactionClient, batchId: string, attemptNumber: number, pageSize: number): AsyncGenerator<ValidatedStone[]> {
  let after = 0;
  for (;;) {
    const blocks = await tx.sarinStoneBlock.findMany({
      where: { batchId, blockSequence: { gt: after } },
      orderBy: { blockSequence: "asc" },
      take: pageSize,
      select: { id: true, blockSequence: true, parseStatus: true, roughWeight: true, firstRowNumber: true, lastRowNumber: true, rowCount: true },
    });
    if (blocks.length === 0) return;
    after = blocks[blocks.length - 1].blockSequence;
    const range = { gte: blocks[0].firstRowNumber, lte: blocks[blocks.length - 1].lastRowNumber };
    const [rows, interpretations] = await Promise.all([
      tx.sarinSourceRow.findMany({
        where: { batchId, sourceRowNumber: range },
        orderBy: { sourceRowNumber: "asc" },
        select: { id: true, sourceRowNumber: true, outcome: true, shapeRaw: true, estimatedWeight: true, clarity: true, color: true, depthPct: true, ratio: true, length: true, width: true, depthMm: true },
      }),
      tx.sarinRowInterpretation.findMany({
        where: { batchId, validationAttempt: attemptNumber, sourceRowNumber: range },
        select: { sourceRowNumber: true, stoneBlockId: true, normalizedShape: true, mappingRuleId: true, mappingResult: true },
      }),
    ]);
    const interpretationOf = new Map(interpretations.map((i) => [i.sourceRowNumber, i]));
    let cursor = 0;
    const stones: ValidatedStone[] = [];
    for (const block of blocks) {
      if (block.parseStatus !== "PARSED" || block.roughWeight === null) throw inputsIncomplete();
      const pieces: PieceSource[] = [];
      for (; cursor < rows.length && rows[cursor].sourceRowNumber <= block.lastRowNumber; cursor++) {
        const r = rows[cursor];
        const it = interpretationOf.get(r.sourceRowNumber);
        // A row between blocks, or any gap in what validation proved, stops generation.
        if (r.sourceRowNumber < block.firstRowNumber || r.outcome !== "ACCEPTED" || !it || it.stoneBlockId !== block.id) throw inputsIncomplete();
        if ((it.mappingResult !== "MAPPED" && it.mappingResult !== "CONDITIONALLY_MAPPED") || it.normalizedShape === null || it.mappingRuleId === null) throw inputsIncomplete();
        if (r.shapeRaw === null || r.estimatedWeight === null || r.clarity === null || r.color === null || r.depthPct === null || r.ratio === null || r.length === null || r.width === null || r.depthMm === null) {
          throw inputsIncomplete();
        }
        pieces.push({
          sourceRowId: r.id, sourceRowNumber: r.sourceRowNumber, rawShape: r.shapeRaw, normalizedShape: it.normalizedShape, mappingRuleId: it.mappingRuleId,
          estimatedWeight: r.estimatedWeight, clarity: r.clarity, color: r.color, depthPct: r.depthPct, ratio: r.ratio, length: r.length, width: r.width, depthMm: r.depthMm,
        });
      }
      if (pieces.length !== block.rowCount) throw inputsIncomplete();
      stones.push({ id: block.id, roughWeight: block.roughWeight, rows: pieces });
    }
    if (cursor !== rows.length) throw inputsIncomplete();
    yield stones;
  }
}

// ---------------------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------------------

/** A lock wait that ran out: another generation or validation of this batch is running. */
function isLockTimeout(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (e.meta as { code?: string } | undefined)?.code === "55P03" || /55P03|lock timeout/i.test(e.message);
}

function inputsHashOf(inputs: Record<string, string | number>): string {
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

export async function generateSarinOutput(actor: SarinOutputActor, batchId: string, request: SarinOutputRequest = {}, config: SarinOutputConfig = SARIN_OUTPUT_CONFIG): Promise<SarinOutputOutcome> {
  const visible = await db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(actor.scope) }, select: { id: true } });
  if (!visible) throw notFound("Sarin import");

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${config.lockWaitMs}ms`}, true)`;
        await tx.$queryRaw`SELECT "id" FROM "SarinImportBatch" WHERE "id" = ${batchId} FOR UPDATE`;

        const batch = await tx.sarinImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { status: true, stoneType: true, validationAttempt: true, contractVersion: true, sourceFile: { select: { sha256: true } } },
        });
        const stoneType = batch.stoneType as SarinStoneType;
        const transform = transformFor(stoneType);
        if (batch.status === "NEEDS_REVIEW") {
          const blockingFindings = await tx.sarinValidationIssue.count({ where: { batchId, validationAttempt: batch.validationAttempt, blocking: true, status: { in: ["OPEN", "OVERRIDDEN"] } } });
          throw new ApiError(422, "BLOCKING_FINDINGS_OPEN", "This import has validation findings that block structured output. Review them first.", { blockingFindings });
        }
        if (batch.status !== "VALIDATED") throw conflict("IMPORT_NOT_VALIDATED", "Structured output can only be generated for a validated import.");

        const attempt = await tx.sarinValidationAttempt.findUnique({
          where: { batchId_attemptNumber: { batchId, attemptNumber: batch.validationAttempt } },
          select: { id: true, attemptNumber: true, status: true, result: true, shapeMappingSetId: true, validationProfileVersion: true, blockCount: true },
        });
        if (!attempt || attempt.status !== "COMPLETED" || attempt.result !== "VALIDATED") throw conflict("IMPORT_NOT_VALIDATED", "Structured output can only be generated for a validated import.");
        if (request.validationAttemptId !== undefined && request.validationAttemptId !== attempt.id) {
          throw conflict("VALIDATION_CHANGED", "This import was validated again after the validation you reviewed. Review the current validation and retry.");
        }
        if (attempt.validationProfileVersion !== SARIN_VALIDATION_PROFILE_VERSION) {
          throw conflict("VALIDATION_PROFILE_OUTDATED", "This import was validated under an earlier set of checks. Validate it again before generating output.");
        }
        const blockingFindings = await tx.sarinValidationIssue.count({ where: { batchId, validationAttempt: attempt.attemptNumber, blocking: true, status: { in: ["OPEN", "OVERRIDDEN"] } } });
        if (blockingFindings > 0) throw new ApiError(422, "BLOCKING_FINDINGS_OPEN", "This import has validation findings that block structured output. Review them first.", { blockingFindings });
        const set = await tx.sarinShapeMappingSet.findUnique({ where: { id: attempt.shapeMappingSetId }, select: { id: true, status: true, contentHash: true } });
        if (!set || set.status !== "APPROVED" || set.contentHash === null) {
          throw conflict("MAPPING_SET_NOT_APPROVED", "The mapping set this import was validated with is no longer approved. Validate it again with an approved set.");
        }

        // Key order is fixed here, so equal inputs always hash equally.
        const inputsHash = inputsHashOf({
          sourceFileSha256: batch.sourceFile.sha256,
          contractVersion: batch.contractVersion,
          stoneType,
          validationAttemptId: attempt.id,
          validationAttemptNumber: attempt.attemptNumber,
          validationProfileVersion: attempt.validationProfileVersion,
          shapeMappingSetId: set.id,
          shapeMappingSetContentHash: set.contentHash,
          transformProfileVersion: transform.version,
          transformProfileHash: transform.hash,
        });
        const existing = await tx.sarinOutputVersion.findUnique({ where: { batchId_inputsHash: { batchId, inputsHash } }, select: { id: true, versionNumber: true } });
        if (existing) {
          await actor.audit(tx, { action: SARIN_OUTPUT_AUDIT.reused, entity: ENTITY, entityId: batchId, after: { outputVersionId: existing.id, versionNumber: existing.versionNumber }, reason: "Sarin output requested for unchanged inputs; existing version returned" });
          return { reused: true, versionId: existing.id };
        }

        // Pass 1: the totals the version records.
        let stoneCount = 0;
        let optionCount = 0;
        let pieceCount = 0;
        for await (const stones of validatedStones(tx, batchId, attempt.attemptNumber, config.writeBatch)) {
          for (const stone of stones) {
            stoneCount++;
            optionCount += transform.plan(stone.rows).length;
            pieceCount += stone.rows.length;
          }
        }
        if (stoneCount === 0 || stoneCount !== attempt.blockCount) throw inputsIncomplete();

        const [current, latest] = await Promise.all([
          tx.sarinOutputVersion.findFirst({ where: { batchId, status: "GENERATED" }, select: { id: true } }),
          tx.sarinOutputVersion.aggregate({ where: { batchId }, _max: { versionNumber: true } }),
        ]);
        if (current) await tx.sarinOutputVersion.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
        const versionNumber = (latest._max.versionNumber ?? 0) + 1;
        const version = await tx.sarinOutputVersion.create({
          data: {
            batchId,
            validationAttemptId: attempt.id,
            shapeMappingSetId: set.id,
            validationProfileVersion: attempt.validationProfileVersion,
            transformProfileVersion: transform.version,
            transformProfileHash: transform.hash,
            versionNumber,
            inputsHash,
            stoneType,
            generatedByUserId: actor.userId,
            supersedesVersionId: current?.id ?? null,
            stoneCount,
            optionCount,
            pieceCount,
          },
          select: { id: true },
        });

        // Pass 2: the content. Output rows are numbered across the whole version.
        let outputRow = 0;
        const written = { stones: 0, options: 0, pieces: 0 };
        for await (const stones of validatedStones(tx, batchId, attempt.attemptNumber, config.writeBatch)) {
          const options: Prisma.SarinPlanOptionCreateManyInput[] = [];
          const pieces: Prisma.SarinPlanPieceCreateManyInput[] = [];
          for (const stone of stones) {
            written.stones++;
            transform.plan(stone.rows).forEach((option, index) => {
              const optionId = randomUUID();
              const planned = planYield(option.rows.map((r) => r.estimatedWeight), stone.roughWeight);
              options.push({
                id: optionId,
                outputVersionId: version.id,
                batchId,
                stoneBlockId: stone.id,
                optionSequence: index + 1,
                optionKind: option.kind,
                mainOrdinal: option.mainOrdinal,
                additionalGroupOrdinal: option.additionalGroupOrdinal,
                pairWeightDifference: option.pairWeightDifference,
                pieceCount: option.rows.length,
                totalEstimatedWeight: planned.numerator,
                yieldNumerator: planned.numerator,
                yieldDenominator: planned.denominator,
                yieldPercent: planned.percent,
                firstOutputRow: outputRow + 1,
                lastOutputRow: outputRow + option.rows.length,
              });
              option.rows.forEach((row, pieceIndex) => {
                outputRow++;
                pieces.push({ outputVersionId: version.id, planOptionId: optionId, pieceSequence: pieceIndex + 1, batchId, outputRowSequence: outputRow, ...row });
              });
            });
          }
          await tx.sarinPlanOption.createMany({ data: options });
          for (let i = 0; i < pieces.length; i += PIECE_INSERT_CHUNK) await tx.sarinPlanPiece.createMany({ data: pieces.slice(i, i + PIECE_INSERT_CHUNK) });
          written.options += options.length;
          written.pieces += pieces.length;
        }
        if (written.stones !== stoneCount || written.options !== optionCount || written.pieces !== pieceCount) {
          throw new Error("output content does not match the recorded totals");
        }

        const advisories = await tx.sarinValidationIssue.count({ where: { batchId, validationAttempt: attempt.attemptNumber, blocking: false, status: "OPEN" } });
        await actor.audit(tx, {
          action: SARIN_OUTPUT_AUDIT.generated,
          entity: ENTITY,
          entityId: batchId,
          after: { outputVersionId: version.id, versionNumber, validationAttempt: attempt.attemptNumber, mappingSetId: set.id, stoneType, transformProfile: transform.version, supersedes: current?.id ?? null, stoneCount, optionCount, pieceCount, advisories },
          reason: "Sarin structured output generated",
        });
        return { reused: false, versionId: version.id };
      },
      { timeout: config.transactionTimeoutMs, maxWait: 10_000 },
    );
  } catch (e) {
    // The transaction has rolled back; its audit rows went with it. The outcome is
    // recorded on its own so that refusals and failures still leave a trail.
    const refusal = e instanceof ApiError ? e : isLockTimeout(e) ? conflict("OUTPUT_GENERATION_IN_PROGRESS", "Another output generation or validation of this import is running. Retry shortly.") : null;
    if (refusal) {
      await recordOutcome(actor, batchId, SARIN_OUTPUT_AUDIT.rejected, "DENIED", { code: refusal.code });
      throw refusal;
    }
    // Logged by class only: a database error message can quote source data.
    log("error", "sarin.output.failed", { requestId: actor.requestId, userId: actor.userId, batchId, error: e instanceof Error ? e.name : "unknown" });
    await recordOutcome(actor, batchId, SARIN_OUTPUT_AUDIT.failed, "FAILED", { code: "OUTPUT_NOT_GENERATED" });
    throw new ApiError(500, "OUTPUT_NOT_GENERATED", "Structured output was not generated. No partial output was kept; retry the generation.");
  }
}

async function recordOutcome(actor: SarinOutputActor, batchId: string, action: string, outcome: "DENIED" | "FAILED", after: { code: string }) {
  try {
    await actor.audit(db, { action, entity: ENTITY, entityId: batchId, outcome, after, reason: outcome === "DENIED" ? "Sarin output generation refused" : "Sarin output generation did not complete; no partial output was kept" });
  } catch {
    log("error", "sarin.output.audit_failed", { requestId: actor.requestId, batchId });
  }
}
