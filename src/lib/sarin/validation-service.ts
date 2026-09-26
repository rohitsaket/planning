/**
 * Sarin validation attempts: stone blocks, Stone Name identity, Rough Weight consistency
 * and shape resolution for one UPLOADED (or previously validated) batch, plus the plan
 * structure of its declared type: Blue/White (plan-structure.ts) or Pink (pink-structure.ts).
 *
 * Three short steps, each its own transaction:
 *
 *   1. Claim   — atomically moves the batch to VALIDATING with a new owner token, a higher
 *                fencing version and the next attempt number, bound to one APPROVED
 *                mapping set, and records the attempt RUNNING. A live claim cannot be
 *                taken; an expired one is first recorded as ABANDONED.
 *   2. Run     — computes and writes the attempt's blocks, row interpretations and
 *                findings, supersedes the previous attempt's open findings, and finalizes
 *                the batch and attempt. All of it is one transaction whose final writes
 *                are conditioned on the owner token and fence: a stale worker changes
 *                nothing, and a failure leaves no partial result behind.
 *   3. Fail    — only after a real processing failure: records FAILED, again only with the
 *                owning token.
 *
 * Findings are data-quality results, never failures: an attempt with findings completes as
 * NEEDS_REVIEW. The immutable source rows are read, never written.
 *
 * Server-only.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, conflict, notFound } from "@/lib/api/errors";
import { log } from "@/lib/api/log";
import type { ApiContext } from "@/lib/api/with-api";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import type { SarinStoneType } from "@/lib/sarin/domain";
import { REJECTION_FIELD_POSITION, SARIN_ISSUE_CATALOG, type SarinIssueCode } from "@/lib/sarin/issue-catalog";
import { isCountryRegistered, isLabRegistered } from "@/lib/sarin/registry";
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
  readonly stoneType: SarinStoneType;
  readonly country: string;
  readonly labScope: string | null;
}

/** The claim this worker holds is no longer the batch's current claim. */
export class StaleClaimError extends Error {
  constructor() {
    super("The validation claim is no longer current.");
    this.name = "StaleClaimError";
  }
}

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: "country", lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

// ---------------------------------------------------------------------------------------
// 1. Claim
// ---------------------------------------------------------------------------------------

export type ClaimOutcome =
  | { readonly kind: "CLAIMED"; readonly claim: SarinValidationClaim }
  | { readonly kind: "REUSED"; readonly attemptId: string };

export async function claimSarinValidation(actor: SarinValidationActor, batchId: string, mappingSetId: string, config: SarinValidationConfig = SARIN_VALIDATION_CONFIG): Promise<ClaimOutcome> {
  return db.$transaction(async (tx) => {
    const batch = await tx.sarinImportBatch.findFirst({
      where: { id: batchId, ...scopeOf(actor.scope) },
      select: { id: true, status: true, stoneType: true, country: true, labScope: true, validationAttempt: true, fencingVersion: true, claimToken: true, leaseExpiresAt: true, shapeMappingSetId: true },
    });
    if (!batch) throw notFound("Sarin import");
    const set = await tx.sarinShapeMappingSet.findUnique({ where: { id: mappingSetId }, select: { id: true, status: true, version: true } });
    if (!set) throw new ApiError(400, "UNKNOWN_MAPPING_SET", "The mapping set does not exist.");
    if (set.status !== "APPROVED") throw conflict("MAPPING_SET_NOT_APPROVED", "Only an approved mapping set can be used for validation.");
    if (batch.status === "ARCHIVED") throw conflict("IMPORT_ARCHIVED", "An archived import cannot be validated.");

    // Same source, same approved set, same validation contract, already completed: the
    // existing result is the answer. An attempt made under an older profile does not prove
    // that the current checks ran, so it is never reused.
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
      // The previous worker's lease has expired. Its attempt is recorded as abandoned, and
      // because only this exact claim is matched, a concurrent reclaimer cannot both win.
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
    return {
      kind: "CLAIMED",
      claim: { batchId, attemptId: attempt.id, attemptNumber, claimToken, fencingVersion, shapeMappingSetId: set.id, stoneType: batch.stoneType as SarinStoneType, country: batch.country, labScope: batch.labScope },
    };
  });
}

// ---------------------------------------------------------------------------------------
// 2. Run
// ---------------------------------------------------------------------------------------

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

      // Findings of earlier attempts stop being current; they stay as history.
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

      // Blocks derive only from the immutable rows and the declared type, so an earlier
      // attempt's blocks are reused; they are recomputed and must match exactly.
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
            // Advisories (WARNING) stay visible without blocking; only BLOCKING findings do.
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

      // The batch's declared scope must still be in the registries.
      if (!(await isCountryRegistered(claim.country, tx))) issue({ code: "COUNTRY_NOT_IN_REGISTRY", stoneBlockId: null, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: null });
      if (claim.labScope !== null && !(await isLabRegistered(claim.labScope, tx))) issue({ code: "LAB_NOT_IN_REGISTRY", stoneBlockId: null, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: null });

      const quarantineIssues = (row: RowLite, stoneBlockId: string | null) => {
        for (const code of (row.rejectionCodes ?? "").split(",").filter(Boolean)) {
          const prefix = rejectionPrefix(code);
          const field = REJECTION_FIELD_POSITION[prefix] ?? null;
          const mapped: SarinIssueCode = prefix === "ROUGH_WEIGHT" ? "ROUGH_WEIGHT_INVALID" : prefix === "SHAPE" ? "SHAPE_MISSING" : "SOURCE_VALUE_QUARANTINED";
          issue({ code: mapped, stoneBlockId, sourceRowId: row.id, fieldPosition: field?.position ?? null, fieldName: field?.field ?? null, parameters: { reason: code } });
        }
      };

      // Why a row cannot become a plan piece. Each consequence is its own finding, so a
      // reviewer sees what the plan would lack, not only what the source lacks.
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

      // The Pink 45-record positional contract. Only a stone with exactly 45 records has
      // positions at all; a shape a mapping could not resolve is already its own finding,
      // so positional shape checks only compare confirmed shapes.
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
              if (a === null || b === null) return false; // a missing value is its own finding
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
              if (finding) raise(finding, at(second.position).row, { firstPosition: first.position, secondPosition: second.position, difference: difference.toFixed(3) }, { position: 4, name: "estimatedWeight" });
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

        const parsed = parseSarinStoneName(name, claim.stoneType);
        // Rough Weight: every record must carry a valid value and all values must be equal.
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

        // Blue/White plan structure: the stone must reach its main-plan limit, and every row
        // must be able to become a plan piece. Rows are positional: nothing is sorted.
        const mainLimit = isBlueWhite(claim.stoneType) ? SARIN_MAIN_PLAN_LIMITS[claim.stoneType] : null;
        if (mainLimit !== null && rows.length < mainLimit) {
          issue({ code: "STONE_BLOCK_SHORTER_THAN_MAIN_LIMIT", stoneBlockId: blockId, sourceRowId: null, fieldPosition: null, fieldName: null, parameters: { rows: rows.length, requiredRows: mainLimit } });
        }
        const isPink = claim.stoneType === "PINK";
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
          if ("issue" in resolved) {
            // A missing shape or unreadable Ratio is already reported from the source row.
            const alreadyReported = resolved.issue === "SHAPE_MISSING" || (resolved.issue === "MAPPING_RATIO_MISSING" && /(^|,)RATIO_/.test(codes));
            if (!alreadyReported) {
              issue({
                code: resolved.issue,
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
            planStructureIssues(row, blockId, isMain ? "MAIN_PLAN_ROW_UNUSABLE" : "ADDITIONAL_PLAN_ROW_UNUSABLE", isMain ? "ESTIMATED_WEIGHT_MISSING" : "GROUPING_INPUT_INVALID", !("issue" in resolved));
          } else if (isPink) {
            planStructureIssues(row, blockId, "PINK_PLAN_ROW_UNUSABLE", "ESTIMATED_WEIGHT_MISSING", !("issue" in resolved));
          }
        }
        if (isPink && rows.length === SARIN_PINK_BLOCK_ROWS) pinkPositionIssues(rows, shapes, blockId);
      };

      // Stream the rows in file order. Nothing groups rows by name: a block is only ever a
      // run of adjacent records, and any record without a Stone Name ends the run.
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
          // Bounded memory: write whenever a buffer fills. Blocks are written before the
          // interpretations and findings that reference them.
          const rowBudget = config.writeBatch * 20;
          if (blocks.length >= config.writeBatch || interpretations.length >= rowBudget || pendingIssues.length >= rowBudget) await flush();
        }
        after = page[page.length - 1].sourceRowNumber;
      }
      closeBlock();
      if (existing.length && existing.length !== counts.blockCount) throw new Error("stored stone blocks do not match the source rows");
      await flush();

      // A Stone Name that reappears after other records is a separate block and a finding.
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
      // Finalization is conditioned on the claim: a worker that lost its claim writes nothing.
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

// ---------------------------------------------------------------------------------------
// 3. Fail
// ---------------------------------------------------------------------------------------

/** Records a real processing failure. Returns false, changing nothing, unless the claim is still this worker's. */
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

// ---------------------------------------------------------------------------------------
// Orchestration for POST /api/planning/sarin/imports/[batchId]/validate
// ---------------------------------------------------------------------------------------

export async function validateSarinImport(actor: SarinValidationActor, batchId: string, mappingSetId: string, config: SarinValidationConfig = SARIN_VALIDATION_CONFIG) {
  const claimed = await claimSarinValidation(actor, batchId, mappingSetId, config);
  if (claimed.kind === "REUSED") return { reused: true, attemptId: claimed.attemptId };
  try {
    await runSarinValidationAttempt(actor, claimed.claim, config);
    return { reused: false, attemptId: claimed.claim.attemptId };
  } catch (e) {
    if (e instanceof StaleClaimError) throw conflict("VALIDATION_CLAIM_SUPERSEDED", "This validation was taken over by another run and did not complete.");
    // Logged by class only: a database error message can quote source data.
    log("error", "sarin.validation.failed", { requestId: actor.requestId, userId: actor.userId, batchId, error: e instanceof Error ? e.name : "unknown" });
    try {
      await failSarinValidationAttempt(actor, claimed.claim, "VALIDATION_PROCESSING_FAILED");
    } catch {
      log("error", "sarin.validation.fail_record_failed", { requestId: actor.requestId, batchId });
    }
    throw new ApiError(500, "VALIDATION_NOT_COMPLETED", "Validation did not complete. No partial result was kept; retry the validation.");
  }
}
