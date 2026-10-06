import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { log } from "@/lib/api/log";
import type { ApiContext } from "@/lib/api/with-api";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import type { SarinPacketType } from "@/lib/sarin/domain";
import { REJECTION_FIELD_POSITION, SARIN_ISSUE_CATALOG, type SarinIssueCode } from "@/lib/sarin/issue-catalog";
import { isLabRegistered } from "@/lib/sarin/registry";
import { captureEffectiveSnapshot, MAPPING_MESSAGES } from "@/lib/sarin/mapping-service";
import { indexRules, resolveShape, type MappingRule } from "@/lib/sarin/shape-normalization";
import { parseSarinStoneName } from "@/lib/sarin/stone-name";
import { MAX_RULES_PER_SET, SARIN_VALIDATION_CONFIG, SOURCE_READ_PAGE, type SarinValidationConfig } from "@/lib/sarin/validation-config";
import { isBlueWhite, SARIN_MAIN_PLAN_LIMITS, SARIN_OUTPUT_REQUIRED_FIELDS, SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";
import { bestTwinWeightFinding, SARIN_PINK_BLOCK_ROWS, SARIN_PINK_CANDIDATE_FIELDS, SARIN_PINK_LAYOUT } from "@/lib/sarin/pink-structure";

if (typeof window !== "undefined") {
  throw new Error("sarin/validation-service is server-only and must not be imported by client code.");
}

export const SARIN_VALIDATION_AUDIT = {
  started: "SARIN_VALIDATION_STARTED",
  completed: "SARIN_VALIDATION_COMPLETED",
  failed: "SARIN_VALIDATION_FAILED",
  abandoned: "SARIN_VALIDATION_ABANDONED",
  revalidation: "SARIN_VALIDATION_PROFILE_REVALIDATION",
} as const;

const ENTITY = "SarinImportBatch";

export interface SarinValidationActor {
  readonly userId: string;
  readonly scope: EffectiveScope;
  readonly audit: ApiContext<unknown>["audit"];
  readonly requestId: string;
}

export interface SarinValidationClaim {
  readonly batchId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly claimToken: string;
  readonly fencingVersion: number;
  readonly shapeMappingSetId: string;
  readonly packetType: SarinPacketType;
  readonly labScope: string | null;
}

export class StaleClaimError extends Error {
  constructor() {
    super("The validation claim is no longer current.");
    this.name = "StaleClaimError";
  }
}

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: null, lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

export type ClaimOutcome =
  | { readonly kind: "CLAIMED"; readonly claim: SarinValidationClaim }
  | { readonly kind: "REUSED"; readonly attemptId: string };

export async function claimSarinValidation(actor: SarinValidationActor, batchId: string, config: SarinValidationConfig = SARIN_VALIDATION_CONFIG): Promise<ClaimOutcome> {
  return db.$transaction(async (tx) => {
    const batch = await tx.sarinImportBatch.findFirst({
      where: { id: batchId, ...scopeOf(actor.scope) },
      select: { id: true, status: true, packetType: true, labScope: true, validationAttempt: true, fencingVersion: true, claimToken: true, leaseExpiresAt: true, shapeMappingSetId: true },
    });
    if (!batch) throw notFound("Sarin import");
    if (batch.status === "ARCHIVED") throw conflict("IMPORT_ARCHIVED", "An archived import cannot be validated.");
    const set = await captureEffectiveSnapshot(tx);
    if (!set) throw conflict("MAPPINGS_NOT_CONFIGURED", MAPPING_MESSAGES.notConfigured);

    if ((batch.status === "VALIDATED" || batch.status === "NEEDS_REVIEW") && batch.shapeMappingSetId === set.id) {
      const last = await tx.sarinValidationAttempt.findUnique({
        where: { batchId_attemptNumber: { batchId, attemptNumber: batch.validationAttempt } },
        select: { id: true, status: true, shapeMappingSetId: true, validationProfileVersion: true },
      });
      if (last && last.status === "COMPLETED" && last.shapeMappingSetId === set.id && last.validationProfileVersion === SARIN_VALIDATION_PROFILE_VERSION) {
        return { kind: "REUSED", attemptId: last.id };
      }
    }

    let fromStatus = batch.status;
    if (batch.status === "VALIDATING") {
      if (batch.leaseExpiresAt && batch.leaseExpiresAt.getTime() > Date.now()) {
        throw conflict("VALIDATION_IN_PROGRESS", "This import is already being validated.");
      }
      const abandoned = await tx.sarinImportBatch.updateMany({
        where: { id: batchId, status: "VALIDATING", claimToken: batch.claimToken, fencingVersion: batch.fencingVersion },
        data: { status: "FAILED", failureCode: "VALIDATION_LEASE_EXPIRED", claimToken: null, claimedAt: null, leaseExpiresAt: null },
      });
      if (abandoned.count !== 1) throw conflict("VALIDATION_IN_PROGRESS", "This import is already being validated.");
      await tx.sarinValidationAttempt.updateMany({
        where: { batchId, attemptNumber: batch.validationAttempt, status: "RUNNING" },
        data: { status: "ABANDONED", failureCode: "VALIDATION_LEASE_EXPIRED" },
      });
      await actor.audit(tx, { action: SARIN_VALIDATION_AUDIT.abandoned, entity: ENTITY, entityId: batchId, outcome: "FAILED", after: { attempt: batch.validationAttempt, reason: "LEASE_EXPIRED" }, reason: "Expired validation claim reclaimed" });
      fromStatus = "FAILED";
    }

    const claimToken = randomUUID();
    const now = new Date();
    const claimed = await tx.sarinImportBatch.updateMany({
      where: { id: batchId, status: fromStatus, fencingVersion: batch.fencingVersion },
      data: {
        status: "VALIDATING",
        failureCode: null,
        validationAttempt: { increment: 1 },
        fencingVersion: { increment: 1 },
        claimToken,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + config.leaseMs),
        shapeMappingSetId: set.id,
      },
    });
    if (claimed.count !== 1) throw conflict("VALIDATION_IN_PROGRESS", "Another validation of this import started first.");

    const attemptNumber = batch.validationAttempt + 1;
    const fencingVersion = batch.fencingVersion + 1;
    const attempt = await tx.sarinValidationAttempt.create({
      data: { batchId, attemptNumber, shapeMappingSetId: set.id, startedByUserId: actor.userId, claimFencingVersion: fencingVersion, validationProfileVersion: SARIN_VALIDATION_PROFILE_VERSION },
      select: { id: true },
    });
    await actor.audit(tx, { action: SARIN_VALIDATION_AUDIT.started, entity: ENTITY, entityId: batchId, after: { attempt: attemptNumber, mappingSetId: set.id, mappingSetVersion: set.version, validationProfile: SARIN_VALIDATION_PROFILE_VERSION }, reason: "Sarin validation started" });
    const previous = await tx.sarinValidationAttempt.findFirst({ where: { batchId, status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true, validationProfileVersion: true } });
    if (previous && previous.validationProfileVersion !== SARIN_VALIDATION_PROFILE_VERSION) {
      await actor.audit(tx, {
        action: SARIN_VALIDATION_AUDIT.revalidation,
        entity: ENTITY,
        entityId: batchId,
        before: { attempt: previous.attemptNumber, validationProfile: previous.validationProfileVersion },
        after: { attempt: attemptNumber, validationProfile: SARIN_VALIDATION_PROFILE_VERSION },
        reason: "Sarin import revalidated under updated validation rules",
      });
    }
    return {
      kind: "CLAIMED",
      claim: { batchId, attemptId: attempt.id, attemptNumber, claimToken, fencingVersion, shapeMappingSetId: set.id, packetType: batch.packetType as SarinPacketType, labScope: batch.labScope },
    };
  });
}

interface RowLite {
  sourceRowNumber: number;
  id: string;
  outcome: string;
  rejectionCodes: string | null;
  stoneNameRaw: string | null;
  roughWeight: Prisma.Decimal | null;
  shapeRaw: string | null;
  ratio: Prisma.Decimal | null;
  estimatedWeight: Prisma.Decimal | null;
  clarity: string | null;
  color: string | null;
  depthPct: Prisma.Decimal | null;
  length: Prisma.Decimal | null;
  width: Prisma.Decimal | null;
  depthMm: Prisma.Decimal | null;
}

interface PendingIssue {
  code: SarinIssueCode;
  stoneBlockId: string | null;
  sourceRowId: string | null;
  fieldPosition: number | null;
  fieldName: string | null;
  parameters: Record<string, string | number | string[]> | null;
}

export interface SarinAttemptCounts {
  readonly blockCount: number;
  readonly parsedBlockCount: number;
  readonly quarantinedBlockCount: number;
  readonly interpretationCount: number;
  readonly issueCount: number;
  readonly blockingIssueCount: number;
}

const rejectionPrefix = (code: string) => code.replace(/_(BLANK|INVALID|OUT_OF_RANGE|PRECISION_EXCEEDED)$/, "");

export async function runSarinValidationAttempt(actor: SarinValidationActor, claim: SarinValidationClaim, config: SarinValidationConfig = SARIN_VALIDATION_CONFIG) {
  return db.$transaction(
    async (tx) => {
      const holds = async () => {
        const b = await tx.sarinImportBatch.findUnique({ where: { id: claim.batchId }, select: { status: true, claimToken: true, fencingVersion: true } });
        return !!b && b.status === "VALIDATING" && b.claimToken === claim.claimToken && b.fencingVersion === claim.fencingVersion;
      };
      if (!(await holds())) throw new StaleClaimError();

      await tx.sarinValidationIssue.updateMany({
        where: { batchId: claim.batchId, validationAttempt: { lt: claim.attemptNumber }, status: { in: ["OPEN", "OVERRIDDEN"] } },
        data: { status: "SUPERSEDED" },
      });

      const ruleCount = await tx.sarinShapeMappingRule.count({ where: { mappingSetId: claim.shapeMappingSetId } });
      if (ruleCount > MAX_RULES_PER_SET) throw new Error("mapping set too large");
      const rules: MappingRule[] = await tx.sarinShapeMappingRule.findMany({
        where: { mappingSetId: claim.shapeMappingSetId },
        select: { id: true, rawShapeKey: true, normalizedShape: true, conditionKind: true, ratioMin: true, ratioMax: true },
      });
      const index = indexRules(rules);

      const existing = await tx.sarinStoneBlock.findMany({
        where: { batchId: claim.batchId },
        orderBy: { blockSequence: "asc" },
        select: { id: true, blockSequence: true, stoneNameRaw: true, firstRowNumber: true, lastRowNumber: true },
      });

      const blocks: Prisma.SarinStoneBlockCreateManyInput[] = [];
      const interpretations: Prisma.SarinRowInterpretationCreateManyInput[] = [];
      const pendingIssues: PendingIssue[] = [];
      let ordinal = 0;
      let blockSeq = 0;
      const counts = { blockCount: 0, parsedBlockCount: 0, quarantinedBlockCount: 0, interpretationCount: 0, issueCount: 0, blockingIssueCount: 0 };

      const issue = (i: PendingIssue) => pendingIssues.push(i);

      const flush = async () => {
        if (blocks.length) await tx.sarinStoneBlock.createMany({ data: blocks.splice(0) });
        if (interpretations.length) await tx.sarinRowInterpretation.createMany({ data: interpretations.splice(0) });
        if (pendingIssues.length) {
          const data = pendingIssues.splice(0).map((i) => ({
            batchId: claim.batchId,
            stoneBlockId: i.stoneBlockId,
            sourceRowId: i.sourceRowId,
            validationAttempt: claim.attemptNumber,
            shapeMappingSetId: claim.shapeMappingSetId,
            code: i.code,
            severity: SARIN_ISSUE_CATALOG[i.code].severity,
            blocking: SARIN_ISSUE_CATALOG[i.code].severity === "BLOCKING",
            fieldPosition: i.fieldPosition,
            fieldName: i.fieldName,
            parametersJson: i.parameters ? JSON.stringify(i.parameters) : null,
            ordinal: ++ordinal,
          }));
          counts.issueCount += data.length;
          counts.blockingIssueCount += data.filter((d) => d.blocking).length;
          await tx.sarinValidationIssue.createMany({ data });
        }
      };

      if (claim.labScope !== null && !(await isLabRegistered(claim.labScope, tx))) issue({ code: "LAB_NOT_IN_REGISTRY", stoneBlockId: null, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: null });

      const quarantineIssues = (row: RowLite, stoneBlockId: string | null) => {
        for (const code of (row.rejectionCodes ?? "").split(",").filter(Boolean)) {
          const prefix = rejectionPrefix(code);
          const field = REJECTION_FIELD_POSITION[prefix] ?? null;
          const mapped: SarinIssueCode = prefix === "ROUGH_WEIGHT" ? "ROUGH_WEIGHT_INVALID" : prefix === "SHAPE" ? "SHAPE_MISSING" : "SOURCE_VALUE_QUARANTINED";
          issue({ code: mapped, stoneBlockId, sourceRowId: row.id, fieldPosition: field?.position ?? null, fieldName: field?.field ?? null, parameters: { reason: code } });
        }
      };

      const planStructureIssues = (row: RowLite, blockId: string, unusable: SarinIssueCode, noEstimate: SarinIssueCode, shapeResolved: boolean) => {
        if (row.outcome !== "ACCEPTED") {
          issue({ code: unusable, stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: null, fieldName: null, parameters: { reason: "SOURCE_ROW_NOT_ACCEPTED" } });
        }
        if (!shapeResolved) issue({ code: "NORMALIZED_SHAPE_MISSING", stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: 3, fieldName: "shape", parameters: null });
        if (row.estimatedWeight === null) {
          issue({ code: noEstimate, stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: 4, fieldName: "estimatedWeight", parameters: null });
        }
        if (row.outcome === "ACCEPTED") {
          for (const f of SARIN_OUTPUT_REQUIRED_FIELDS) {
            if (row[f.field] === null) issue({ code: "OUTPUT_FIELD_UNAVAILABLE", stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: f.position, fieldName: f.field, parameters: null });
          }
        }
      };

      const pinkPositionIssues = (rows: RowLite[], shapes: (string | null)[], blockId: string) => {
        const at = (position: number) => ({ row: rows[position - 1], shape: shapes[position - 1] });
        const raise = (code: SarinIssueCode, row: RowLite, parameters: PendingIssue["parameters"], field: { position: number; name: string } | null = { position: 3, name: "shape" }) =>
          issue({ code, stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: field?.position ?? null, fieldName: field?.name ?? null, parameters });
        for (const slot of SARIN_PINK_LAYOUT) {
          const [first, second] = slot.pieces;
          if (slot.code === "MK") {
            const p = at(first.position);
            if (p.shape !== null && p.shape !== first.shape) raise("PINK_MK_SHAPE_MISMATCH", p.row, { position: first.position, expectedShape: first.shape, shape: p.shape });
          } else if (slot.code === "SL") {
            const mk = at(first.position - 1);
            const primary = at(first.position);
            const differing = SARIN_PINK_CANDIDATE_FIELDS.filter((f) => {
              const a = f === "normalizedShape" ? mk.shape : mk.row[f];
              const b = f === "normalizedShape" ? primary.shape : primary.row[f];
              if (a === null || b === null) return false;
              return typeof a === "string" || typeof b === "string" ? a !== b : !a.equals(b);
            });
            if (differing.length) raise("PINK_SL_PRIMARY_MISMATCH", primary.row, { position: first.position, makeablePosition: first.position - 1, fields: [...differing] }, null);
            const remainder = at(second.position);
            if (remainder.shape !== null && remainder.shape !== "Round") raise("PINK_SL_REMAINDER_NOT_ROUND", remainder.row, { position: second.position, shape: remainder.shape });
          } else {
            for (const piece of slot.pieces) {
              const p = at(piece.position);
              if (p.shape !== null && p.shape !== piece.shape) {
                raise(slot.code === "BP" ? "PINK_BP_SHAPE_MISMATCH" : "PINK_BT_SHAPE_MISMATCH", p.row, { position: piece.position, expectedShape: piece.shape, shape: p.shape });
              }
            }
            const a = at(first.position).row.estimatedWeight;
            const b = at(second.position).row.estimatedWeight;
            if (slot.code === "BT" && a !== null && b !== null) {
              const difference = a.minus(b).abs();
              const finding = bestTwinWeightFinding(difference);
              if (finding) raise(finding, at(second.position).row, { firstPosition: first.position, secondPosition: second.position, firstWeight: a.toFixed(3), secondWeight: b.toFixed(3), difference: difference.toFixed(3) }, { position: 4, name: "estimatedWeight" });
            }
          }
        }
      };

      let current: { name: string; rows: RowLite[] } | null = null;

      const closeBlock = () => {
        if (!current) return;
        const { name, rows } = current;
        current = null;
        blockSeq++;
        const first = rows[0].sourceRowNumber;
        const last = rows[rows.length - 1].sourceRowNumber;
        const prior = existing[blockSeq - 1];
        if (existing.length && (!prior || prior.firstRowNumber !== first || prior.lastRowNumber !== last || prior.stoneNameRaw !== name)) {
          throw new Error("stored stone blocks do not match the source rows");
        }
        const blockId = prior?.id ?? randomUUID();

        const parsed = parseSarinStoneName(name, claim.packetType);
        const valid = rows.filter((r) => r.roughWeight !== null);
        const distinct = new Set(valid.map((r) => r.roughWeight!.toFixed(3)));
        const roughWeight = valid.length === rows.length && distinct.size === 1 ? valid[0].roughWeight!.toFixed(3) : null;

        if (!prior) {
          blocks.push({
            id: blockId,
            batchId: claim.batchId,
            blockSequence: blockSeq,
            stoneNameRaw: name,
            kapan: parsed.ok ? parsed.kapan : null,
            packet: parsed.ok ? parsed.packet : null,
            signer: parsed.ok ? parsed.signer : null,
            firstRowNumber: first,
            lastRowNumber: last,
            rowCount: rows.length,
            roughWeight,
            parseStatus: parsed.ok ? "PARSED" : "QUARANTINED",
            parsedAt: new Date(),
          });
        }
        counts.blockCount++;
        if (parsed.ok) counts.parsedBlockCount++;
        else counts.quarantinedBlockCount++;

        if (!parsed.ok) issue({ code: parsed.code, stoneBlockId: blockId, sourceRowId: null, fieldPosition: 1, fieldName: "stoneName", parameters: null });

        const mainLimit = isBlueWhite(claim.packetType) ? SARIN_MAIN_PLAN_LIMITS[claim.packetType] : null;
        if (mainLimit !== null && rows.length < mainLimit) {
          issue({ code: "STONE_BLOCK_SHORTER_THAN_MAIN_LIMIT", stoneBlockId: blockId, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: { rows: rows.length, requiredRows: mainLimit } });
        }
        const isPink = claim.packetType === "PINK";
        if (isPink && rows.length !== SARIN_PINK_BLOCK_ROWS) {
          issue({ code: "PINK_BLOCK_ROW_COUNT_INVALID", stoneBlockId: blockId, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: { rows: rows.length, requiredRows: SARIN_PINK_BLOCK_ROWS } });
        }
        const shapes: (string | null)[] = [];

        for (const [i, row] of rows.entries()) {
          quarantineIssues(row, blockId);
          if (distinct.size > 1 && row.roughWeight !== null) {
            issue({ code: "ROUGH_WEIGHT_INCONSISTENT", stoneBlockId: blockId, sourceRowId: row.id, fieldPosition: 2, fieldName: "roughWeight", parameters: { roughWeight: row.roughWeight.toFixed(3), distinctValues: distinct.size } });
          }
          const resolved = resolveShape(index, row.shapeRaw, row.ratio);
          const codes = row.rejectionCodes ?? "";
          const unmapped = "issue" in resolved && resolved.issue === "SHAPE_UNMAPPED";
          if ("issue" in resolved) {
            const alreadyReported = resolved.issue === "SHAPE_MISSING" || (resolved.issue === "MAPPING_RATIO_MISSING" && /(^|,)RATIO_/.test(codes));
            if (!alreadyReported) {
              issue({
                code: unmapped && !isPink ? "SHAPE_NOT_MAPPED" : resolved.issue,
                stoneBlockId: blockId,
                sourceRowId: row.id,
                fieldPosition: 3,
                fieldName: "shape",
                parameters: { rawShapeKey: (resolved.key ?? "").slice(0, 128), ...(row.ratio !== null ? { ratio: row.ratio.toFixed(3) } : {}) },
              });
            }
            interpretations.push({
              batchId: claim.batchId, attemptId: claim.attemptId, validationAttempt: claim.attemptNumber, sourceRowNumber: row.sourceRowNumber, stoneBlockId: blockId,
              shapeMappingSetId: claim.shapeMappingSetId, rawShapeKey: resolved.key, normalizedShape: null, mappingRuleId: null, mappingResult: resolved.result,
              metadataJson: JSON.stringify({ finding: resolved.issue }),
            });
          } else {
            interpretations.push({
              batchId: claim.batchId, attemptId: claim.attemptId, validationAttempt: claim.attemptNumber, sourceRowNumber: row.sourceRowNumber, stoneBlockId: blockId,
              shapeMappingSetId: claim.shapeMappingSetId, rawShapeKey: resolved.key, normalizedShape: resolved.rule.normalizedShape, mappingRuleId: resolved.rule.id,
              mappingResult: resolved.result, metadataJson: resolved.result === "CONDITIONALLY_MAPPED" && row.ratio !== null ? JSON.stringify({ ratio: row.ratio.toFixed(3) }) : null,
            });
          }
          counts.interpretationCount++;
          shapes.push("issue" in resolved ? null : resolved.rule.normalizedShape);
          if (mainLimit !== null) {
            const isMain = i + 1 <= mainLimit;
            planStructureIssues(row, blockId, isMain ? "MAIN_PLAN_ROW_UNUSABLE" : "ADDITIONAL_PLAN_ROW_UNUSABLE", isMain ? "ESTIMATED_WEIGHT_MISSING" : "GROUPING_INPUT_INVALID", !("issue" in resolved) || unmapped);
          } else if (isPink) {
            planStructureIssues(row, blockId, "PINK_PLAN_ROW_UNUSABLE", "ESTIMATED_WEIGHT_MISSING", !("issue" in resolved) || unmapped);
          }
        }
        if (isPink && rows.length === SARIN_PINK_BLOCK_ROWS) pinkPositionIssues(rows, shapes, blockId);
      };

      let after = 0;
      for (;;) {
        const page: RowLite[] = await tx.sarinSourceRow.findMany({
          where: { batchId: claim.batchId, sourceRowNumber: { gt: after } },
          orderBy: { sourceRowNumber: "asc" },
          take: SOURCE_READ_PAGE,
          select: {
            sourceRowNumber: true, id: true, outcome: true, rejectionCodes: true, stoneNameRaw: true, roughWeight: true, shapeRaw: true, ratio: true,
            estimatedWeight: true, clarity: true, color: true, depthPct: true, length: true, width: true, depthMm: true,
          },
        });
        if (page.length === 0) break;
        for (const row of page) {
          if (row.stoneNameRaw === null) {
            closeBlock();
            if (row.outcome === "REJECTED_STRUCTURE") {
              issue({ code: "SOURCE_ROW_STRUCTURALLY_REJECTED", stoneBlockId: null, sourceRowId: row.id, fieldPosition: null, fieldName: null, parameters: { reasons: (row.rejectionCodes ?? "").split(",").filter(Boolean) } });
            } else {
              quarantineIssues(row, null);
            }
          } else if (current && current.name === row.stoneNameRaw) {
            current.rows.push(row);
          } else {
            closeBlock();
            current = { name: row.stoneNameRaw, rows: [row] };
          }
          const rowBudget = config.writeBatch * 20;
          if (blocks.length >= config.writeBatch || interpretations.length >= rowBudget || pendingIssues.length >= rowBudget) await flush();
        }
        after = page[page.length - 1].sourceRowNumber;
      }
      closeBlock();
      if (existing.length && existing.length !== counts.blockCount) throw new Error("stored stone blocks do not match the source rows");
      await flush();

      const repeats = await tx.$queryRaw<{ id: string; firstSequence: number }[]>`
        SELECT b."id", f."firstSequence"
          FROM "SarinStoneBlock" b
          JOIN (SELECT "stoneNameRaw", min("blockSequence") AS "firstSequence"
                  FROM "SarinStoneBlock" WHERE "batchId" = ${claim.batchId}
                 GROUP BY "stoneNameRaw" HAVING count(*) > 1) f ON f."stoneNameRaw" = b."stoneNameRaw"
         WHERE b."batchId" = ${claim.batchId} AND b."blockSequence" > f."firstSequence"
         ORDER BY b."blockSequence"`;
      for (const r of repeats) {
        issue({ code: "STONE_NAME_REPEATED_NON_CONSECUTIVE", stoneBlockId: r.id, sourceRowId: null, fieldPosition: 1, fieldName: "stoneName", parameters: { firstBlockSequence: Number(r.firstSequence) } });
      }
      await flush();

      const result = counts.blockingIssueCount > 0 ? "NEEDS_REVIEW" : "VALIDATED";
      const finalized = await tx.sarinImportBatch.updateMany({
        where: { id: claim.batchId, status: "VALIDATING", claimToken: claim.claimToken, fencingVersion: claim.fencingVersion },
        data: { status: result, claimToken: null, claimedAt: null, leaseExpiresAt: null, blockCount: counts.blockCount, quarantinedBlockCount: counts.quarantinedBlockCount },
      });
      if (finalized.count !== 1) throw new StaleClaimError();
      const attempt = await tx.sarinValidationAttempt.updateMany({ where: { id: claim.attemptId, status: "RUNNING" }, data: { status: "COMPLETED", result, ...counts } });
      if (attempt.count !== 1) throw new StaleClaimError();
      await actor.audit(tx, { action: SARIN_VALIDATION_AUDIT.completed, entity: ENTITY, entityId: claim.batchId, after: { attempt: claim.attemptNumber, mappingSetId: claim.shapeMappingSetId, result, ...counts, advisoryCount: counts.issueCount - counts.blockingIssueCount }, reason: "Sarin validation completed" });
      return { result, counts };
    },
    { timeout: config.transactionTimeoutMs, maxWait: 10_000 },
  );
}

export async function failSarinValidationAttempt(actor: SarinValidationActor, claim: SarinValidationClaim, failureCode: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const released = await tx.sarinImportBatch.updateMany({
      where: { id: claim.batchId, status: "VALIDATING", claimToken: claim.claimToken, fencingVersion: claim.fencingVersion },
      data: { status: "FAILED", failureCode, claimToken: null, claimedAt: null, leaseExpiresAt: null },
    });
    if (released.count !== 1) return false;
    await tx.sarinValidationAttempt.updateMany({ where: { id: claim.attemptId, status: "RUNNING" }, data: { status: "FAILED", failureCode } });
    await actor.audit(tx, { action: SARIN_VALIDATION_AUDIT.failed, entity: ENTITY, entityId: claim.batchId, outcome: "FAILED", after: { attempt: claim.attemptNumber, failureCode }, reason: "Sarin validation did not complete; no partial result was kept" });
    return true;
  });
}

export async function validateSarinImport(actor: SarinValidationActor, batchId: string, config: SarinValidationConfig = SARIN_VALIDATION_CONFIG) {
  const claimed = await claimSarinValidation(actor, batchId, config);
  if (claimed.kind === "REUSED") return { reused: true, attemptId: claimed.attemptId };
  try {
    await runSarinValidationAttempt(actor, claimed.claim, config);
    return { reused: false, attemptId: claimed.claim.attemptId };
  } catch (e) {
    if (e instanceof StaleClaimError) throw conflict("VALIDATION_CLAIM_SUPERSEDED", "This validation was taken over by another run and did not complete.");
    log("error", "sarin.validation.failed", { requestId: actor.requestId, userId: actor.userId, batchId, error: e instanceof Error ? e.name : "unknown" });
    try {
      await failSarinValidationAttempt(actor, claimed.claim, "VALIDATION_PROCESSING_FAILED");
    } catch {
      log("error", "sarin.validation.fail_record_failed", { requestId: actor.requestId, batchId });
    }
    throw new ApiError(500, "VALIDATION_NOT_COMPLETED", "Validation did not complete. No partial result was kept; retry the validation.");
  }
}
