/**
 * FANTASY SHADOW PROJECTION — raw rows to canonical candidates.
 *
 * Reads stored raw Fantasy rows, runs them through the classifier, the measurement
 * separator and the quantity/weight rules, and writes the result to the isolated
 * projection tables. It never writes to `LotMasterRecord` or `LotHistoryRecord`, never
 * reads them, and never returns a raw payload.
 *
 * Two modes exist. `DRY_RUN` computes everything and persists only the run summary, so
 * the shape of a projection can be inspected before anything is stored. `SHADOW`
 * additionally persists immutable candidates for reconciliation. There is no third mode:
 * a database CHECK constraint refuses `ACTIVE`, so shadow output cannot become
 * authoritative through an application bug. Promotion is separate, undesigned work.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  classifyFantasyRecord,
  type ClassificationProfile,
  type ClassificationResult,
} from "@/lib/fantasy/classification";
import { loadProfileForSourceState } from "@/lib/fantasy/classification-profile";
import {
  canonicalJson,
  decodeKeyedRecord,
  FANTASY_RAW_ENCODING_V2,
  type FantasyDecodedValue,
  type FantasyEncodedCell,
  sha256Hex,
  UNSUPPORTED_VALUE,
} from "@/lib/fantasy/raw-encoding";
import { decideProjectionEligibility, rowSkipReason } from "@/lib/fantasy/projection-provenance";
import {
  assertWorkloadCapacity,
  finalizeOwnedAttempt,
  issueOwnerToken,
  ProjectionRecoveryError,
  resolveProjectionWorkloadLimits,
  touchHeartbeatOwned,
  writeCandidatePageOwned,
  type OwnerToken,
  type ProjectionWorkloadLimits,
} from "@/lib/fantasy/projection-recovery";
import {
  measurementProvenanceSummary,
  resolveMeasurements,
  countsTowardConfirmedShortage,
  STRICT_ACTUAL_ONLY,
  type MeasurementSet,
} from "@/lib/fantasy/measurements";
import {
  assessStructureRisk,
  interpretQuantity,
  interpretWeight,
  measurementProfileFor,
  parseSourceNumeric,
  type MeasurementProfile,
} from "@/lib/fantasy/quantity-weight";
import {
  FANTASY_EFFECTIVE_SOURCE_STATES,
  type FantasyEffectiveSourceState,
} from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/projection is server-only and must not be imported by client code.");
}

/** Narrows a stored provenance string before it is used to select a profile. */
function isEffectiveSourceStateValue(value: string): value is FantasyEffectiveSourceState {
  return (FANTASY_EFFECTIVE_SOURCE_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * The only projection modes that exist.
 *
 * `ACTIVE` is deliberately absent from the type, the vocabulary and the database CHECK
 * constraint. Three independent refusals, because a single guard is one mistake away
 * from making unverified projections authoritative.
 */
export const PROJECTION_MODES = ["DRY_RUN", "SHADOW"] as const;
export type ProjectionMode = (typeof PROJECTION_MODES)[number];

export function isProjectionMode(value: unknown): value is ProjectionMode {
  return typeof value === "string" && (PROJECTION_MODES as readonly string[]).includes(value);
}

/** Recorded on every run so the UI never has to infer why nothing was promoted. */
export const ACTIVATION_BLOCKED_REASON = "ACTIVATION_NOT_IMPLEMENTED";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Identity policy version 1.
 *
 * Composed of the source company and the lot identifier, because a lot id is only known
 * to be unique within the company that issued it. The legacy `lotId` is preserved
 * separately and never dropped, so records identified the old way stay matchable.
 *
 * Bump this constant — never redefine the composition in place — if the client confirms
 * a different business identity, so old candidates remain interpretable.
 */
export const IDENTITY_POLICY_VERSION = 1;

const IDENTITY_SEPARATOR = "\u0001";

export interface IdentityInput {
  readonly companyId: unknown;
  readonly lotId: unknown;
}

export interface ProjectionIdentity {
  readonly key: string | null;
  readonly companyId: string | null;
  readonly lotId: string | null;
  readonly reason: "IDENTITY_LOT_ID_MISSING" | "IDENTITY_COMPANY_ID_MISSING" | null;
}

function identityPart(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Builds the deterministic identity key.
 *
 * A missing company id does not block identity — the feed may legitimately omit it —
 * but it is recorded, because an identity built without a company scope can collide
 * across companies and that is a fact a reviewer needs. A missing lot id leaves the key
 * null and quarantines the row: there is nothing to identify it by.
 */
export function buildProjectionIdentity(input: IdentityInput): ProjectionIdentity {
  const companyId = identityPart(input.companyId);
  const lotId = identityPart(input.lotId);

  if (lotId === null) {
    return { key: null, companyId, lotId: null, reason: "IDENTITY_LOT_ID_MISSING" };
  }

  return {
    key: `${companyId ?? ""}${IDENTITY_SEPARATOR}${lotId}`,
    companyId,
    lotId,
    reason: companyId === null ? "IDENTITY_COMPANY_ID_MISSING" : null,
  };
}

// ---------------------------------------------------------------------------
// Candidate assembly
// ---------------------------------------------------------------------------

export const CANDIDATE_STATES = ["PROJECTED", "REVIEW_REQUIRED", "QUARANTINED"] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/** Fixed codes explaining why a candidate needs review or was quarantined. */
export const PROJECTION_REASON_CODES = [
  "IDENTITY_LOT_ID_MISSING",
  "IDENTITY_COMPANY_ID_MISSING",
  "ROW_NOT_NORMALIZED",
  "ROW_DECODE_FAILED",
  "UNSUPPORTED_SOURCE_CELL",
  "CLASSIFICATION_BLOCKED",
  "CLASSIFICATION_NOT_CONFIGURED",
  "CLASSIFICATION_REVIEW_REQUIRED",
  "MEASUREMENT_ESTIMATED_VALUE_USED",
  "MEASUREMENT_ACTUAL_WEIGHT_MISSING",
  "QUANTITY_NOT_USABLE",
  "WEIGHT_NOT_USABLE",
  "STRUCTURE_REVIEW_REQUIRED",
] as const;
export type ProjectionReasonCode = (typeof PROJECTION_REASON_CODES)[number];

/** A decoded row keyed by contract key, with unsupported cells already flagged. */
type DecodedRecord = Readonly<Record<string, FantasyDecodedValue>>;

/**
 * Reads back a stored normalized record.
 *
 * Ingestion stores this as a bare map of contract key to type-tagged cell — not as the
 * positional/keyed row envelope used for the untouched source payload — so it is decoded
 * directly rather than through the row decoder. Only the current encoding version is
 * accepted: an older row is reported as unsupported rather than read under assumptions
 * about how its cells were written.
 */
export function decodeNormalizedRecord(json: string, encodingVersion: string): DecodedRecord | null {
  if (encodingVersion !== FANTASY_RAW_ENCODING_V2) return null;

  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  return decodeKeyedRecord(parsed as Readonly<Record<string, FantasyEncodedCell>>);
}

function text(value: FantasyDecodedValue | undefined): string | null {
  if (value === UNSUPPORTED_VALUE || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Parsed secondary weight, or null. Each is independent; none is derived from another. */
function decimalOrNull(value: FantasyDecodedValue | undefined): Prisma.Decimal | null {
  if (value === UNSUPPORTED_VALUE) return null;
  const parsed = parseSourceNumeric(value, { allowZero: false, maxDecimals: 4 });
  return parsed.state === "VALID" && parsed.value !== null ? new Prisma.Decimal(parsed.value) : null;
}

function rejectionCode(value: FantasyDecodedValue | undefined): string {
  if (value === UNSUPPORTED_VALUE) return "UNSUPPORTED_CELL";
  const parsed = parseSourceNumeric(value, { allowZero: false, maxDecimals: 4 });
  return parsed.state === "VALID" ? "VALID" : (parsed.reason ?? "MISSING");
}

export interface ProjectedCandidate {
  readonly sourceRowNumber: number;
  readonly sourceRowId: string | null;
  readonly sourceBatchId: string | null;
  readonly rowHash: string;
  readonly candidateState: CandidateState;
  readonly reasonCodes: readonly ProjectionReasonCode[];
  readonly data: Prisma.FantasyProjectionCandidateCreateManyInput;
}

export interface ProjectionContext {
  readonly runId: string;
  readonly batchId: string | null;
  readonly classificationProfile: ClassificationProfile | null;
  readonly measurementProfile: MeasurementProfile;
  readonly effectiveSourceState: FantasyEffectiveSourceState;
}

/**
 * Projects one decoded row into a candidate.
 *
 * Pure: it performs no database access, so it is directly testable and cannot partially
 * write. Every rule it applies lives in the shared modules rather than here — this
 * function's only job is to assemble their outputs into one immutable row.
 */
export function projectRow(
  record: DecodedRecord,
  row: { sourceRowNumber: number; id: string | null; rowHash: string },
  ctx: ProjectionContext,
): ProjectedCandidate {
  const reasons = new Set<ProjectionReasonCode>();

  const identity = buildProjectionIdentity({ companyId: record.companyId, lotId: record.lotId });
  if (identity.reason) reasons.add(identity.reason);

  const classification: ClassificationResult = classifyFantasyRecord(
    {
      rawStatus: record.lotStatusRaw === UNSUPPORTED_VALUE ? null : record.lotStatusRaw,
      rawHold: record.onHoldRaw === UNSUPPORTED_VALUE ? null : record.onHoldRaw,
      holdOrigin: "SOURCE_ROW",
      process: record.processName,
      currentDepartment: record.departmentAccountName,
      previousDepartment: record.previousDepartmentAccountName,
      structurallyValid: identity.key !== null,
      hasBlockingDataQuality: false,
      effectiveSourceState: ctx.effectiveSourceState,
    },
    ctx.classificationProfile,
  );

  if (classification.state === "NOT_CONFIGURED") reasons.add("CLASSIFICATION_NOT_CONFIGURED");
  else if (classification.state === "BLOCKED") reasons.add("CLASSIFICATION_BLOCKED");
  if (classification.reviewRequired) reasons.add("CLASSIFICATION_REVIEW_REQUIRED");

  const measurements: MeasurementSet = resolveMeasurements(
    {
      shapeRaw: record.shapeRaw,
      colorRaw: record.colorRaw,
      clarityRaw: record.clarityRaw,
      weightRaw: record.weightRaw,
      labNameRaw: record.labNameRaw,
      cutRaw: record.cutRaw,
      polishRaw: record.polishRaw,
      symmetryRaw: record.symmetryRaw,
      fluorescenceRaw: record.fluorescenceRaw,
      tableRaw: record.tableRaw,
      depthRaw: record.depthRaw,
      ratioRaw: record.ratioRaw,
      toneRaw: record.toneRaw,
      fancyColorRaw: record.fancyColorRaw,
      estimatedShapeId: record.estimatedShapeId,
      estimatedColorId: record.estimatedColorId,
      estimatedClarityId: record.estimatedClarityId,
      estimatedWeightRaw: record.estimatedWeightRaw,
    },
    ctx.measurementProfile,
    // Projection never promotes an estimate. The policy is fixed here rather than
    // configurable, so no caller can widen it by passing an option.
    STRICT_ACTUAL_ONLY,
  );

  if (measurements.containsEstimatedValues) reasons.add("MEASUREMENT_ESTIMATED_VALUE_USED");
  if (measurements.weight.actual.state !== "VALID") reasons.add("MEASUREMENT_ACTUAL_WEIGHT_MISSING");

  const quantity = interpretQuantity(record.quantityRaw, {
    semantics: ctx.measurementProfile.quantitySemantics,
    simulated: ctx.measurementProfile.simulated,
  });
  if (quantity.state !== "USABLE") reasons.add("QUANTITY_NOT_USABLE");

  const weight = interpretWeight(record.weightRaw, {
    unit: ctx.measurementProfile.weightUnit,
    simulated: ctx.measurementProfile.simulated,
  });
  if (weight.state !== "USABLE") reasons.add("WEIGHT_NOT_USABLE");

  const structure = assessStructureRisk({
    quantity,
    metalId: record.metalId,
    metalWeight: record.metalWeightRaw,
    metWeight: record.metWeightRaw,
    itemName: record.itemName,
    weight: record.weightRaw,
    totalDiamondWeight: record.totalDiamondWeightRaw,
  });
  if (structure.reviewRequired) reasons.add("STRUCTURE_REVIEW_REQUIRED");

  // Quarantine is reserved for a row that cannot be identified or classified at all.
  // Everything else that merits attention is projected and marked for review, so it
  // stays visible in reconciliation rather than disappearing.
  const quarantined =
    identity.key === null ||
    classification.state === "NOT_CONFIGURED" ||
    classification.state === "BLOCKED";

  const candidateState: CandidateState = quarantined
    ? "QUARANTINED"
    : reasons.size > 0
      ? "REVIEW_REQUIRED"
      : "PROJECTED";

  const secondaryWeightStates = {
    averageWeight: rejectionCode(record.averageWeightRaw),
    originalWeight: rejectionCode(record.originalWeightRaw),
    totalDiamondWeight: rejectionCode(record.totalDiamondWeightRaw),
    metalWeight: rejectionCode(record.metalWeightRaw),
    metWeight: rejectionCode(record.metWeightRaw),
  };

  // Carried verbatim so nothing is lost, under keys that say plainly they mean nothing
  // to this application yet.
  const unconfirmedDimensions = {
    UNCONFIRMED_size: text(record.sizeRaw),
    UNCONFIRMED_m1: text(record.m1Raw),
    UNCONFIRMED_m2: text(record.m2Raw),
    UNCONFIRMED_m3: text(record.m3Raw),
  };

  const reasonCodes = Array.from(reasons).sort();

  return {
    sourceRowNumber: row.sourceRowNumber,
    sourceRowId: row.id,
    sourceBatchId: ctx.batchId,
    rowHash: row.rowHash,
    candidateState,
    reasonCodes,
    data: {
      runId: ctx.runId,
      sourceBatchId: ctx.batchId,
      sourceRowId: row.id,
      sourceRowNumber: row.sourceRowNumber,
      rowHash: row.rowHash,

      // `Remark` is deliberately not projected: it is free-form operator text with no
      // confirmed business meaning, and carrying it forward would put uncontrolled
      // source prose into every downstream diagnostic and export.
      projectionIdentityKey: identity.key ?? `UNIDENTIFIED${IDENTITY_SEPARATOR}${row.rowHash}`,
      identityPolicyVersion: IDENTITY_POLICY_VERSION,
      sourceCompanyId: identity.companyId,
      legacyLotId: identity.lotId,
      lotName: text(record.lotName),
      certificateNumber: text(record.certificateNumber),
      certificateId: text(record.certificateId),
      documentId: text(record.documentId),
      documentDateRaw: text(record.documentDateRaw),
      allocationAccountId: text(record.allocationAccountId),
      allocationDateRaw: text(record.allocationDateRaw),
      processName: text(record.processName),
      departmentAccountName: text(record.departmentAccountName),
      previousDepartmentAccountName: text(record.previousDepartmentAccountName),

      lotStatusRaw: text(record.lotStatusRaw),
      onHoldRaw: text(record.onHoldRaw),

      holdState: classification.holdState,
      canonicalLifecycle: classification.lifecycle,
      inventoryClass: classification.inventoryClass,
      classificationAvailable: classification.available,
      classificationPlanningEligible: classification.planningEligible,
      classificationReviewRequired: classification.reviewRequired,
      classificationTerminal: classification.terminal,
      classificationReasons:
        classification.exclusionReasons.length > 0 ? classification.exclusionReasons.join(",") : null,
      classificationProfile: classification.profileCode,
      classificationProfileVersion: classification.profileVersion,
      classificationState: classification.state,

      actualShape: measurements.shape.actual,
      actualColor: measurements.color.actual,
      actualClarity: measurements.clarity.actual,
      actualLabName: measurements.actualOnly.labName,
      actualCut: measurements.actualOnly.cut,
      actualPolish: measurements.actualOnly.polish,
      actualSymmetry: measurements.actualOnly.symmetry,
      actualFluorescence: measurements.actualOnly.fluorescence,
      actualTable: measurements.actualOnly.tableValue,
      actualDepth: measurements.actualOnly.depth,
      actualRatio: measurements.actualOnly.ratio,
      actualTone: measurements.actualOnly.tone,
      actualFancyColor: measurements.actualOnly.fancyColor,
      actualWeight:
        measurements.weight.actual.state === "VALID" && measurements.weight.actual.value !== null
          ? new Prisma.Decimal(measurements.weight.actual.value)
          : null,
      actualWeightState: measurements.weight.actual.state,

      estimatedShapeId: measurements.shape.estimatedId,
      estimatedColorId: measurements.color.estimatedId,
      estimatedClarityId: measurements.clarity.estimatedId,
      estimatedShapeIdState: measurements.shape.estimatedIdState,
      estimatedColorIdState: measurements.color.estimatedIdState,
      estimatedClarityIdState: measurements.clarity.estimatedIdState,
      estimatedWeight:
        measurements.weight.estimated.state === "VALID" && measurements.weight.estimated.value !== null
          ? new Prisma.Decimal(measurements.weight.estimated.value)
          : null,
      estimatedWeightState: measurements.weight.estimated.state,
      weightDivergence:
        measurements.weight.divergence !== null ? new Prisma.Decimal(measurements.weight.divergence) : null,

      shapeProvenance: measurements.shape.provenance,
      colorProvenance: measurements.color.provenance,
      clarityProvenance: measurements.clarity.provenance,
      weightProvenance: measurements.weight.provenance,
      estimationMethod: measurements.weight.estimationMethod,
      containsEstimatedValues: measurements.containsEstimatedValues,
      eligibleForConfirmedShortage:
        countsTowardConfirmedShortage(measurements) && classification.available,

      quantityRawValue: quantity.rawValue !== null ? new Prisma.Decimal(quantity.rawValue) : null,
      quantityState: quantity.state,
      quantityPieces: quantity.pieces,
      quantitySemantics: quantity.semantics,
      weightUnit: weight.unit,
      weightUsableCarats: weight.carats !== null ? new Prisma.Decimal(weight.carats) : null,
      averageWeight: decimalOrNull(record.averageWeightRaw),
      originalWeight: decimalOrNull(record.originalWeightRaw),
      totalDiamondWeight: decimalOrNull(record.totalDiamondWeightRaw),
      metalWeight: decimalOrNull(record.metalWeightRaw),
      metWeight: decimalOrNull(record.metWeightRaw),
      secondaryWeightStatesJson: JSON.stringify(secondaryWeightStates),
      unconfirmedDimensionsJson: JSON.stringify(unconfirmedDimensions),

      metalId: text(record.metalId),
      metalColorRaw: text(record.metalColorRaw),
      itemName: text(record.itemName),
      structureReviewRequired: structure.reviewRequired,
      structureRiskCodes: structure.risks.length > 0 ? structure.risks.join(",") : null,

      candidateState,
      reviewReasonCodes: reasonCodes.length > 0 ? reasonCodes.join(",") : null,
    },
  };
}


// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

/**
 * Rows read and written per page.
 *
 * Pagination is keyset on `(batchId, sourceRowNumber)`, which is a real unique
 * constraint and exactly matches the ordering. An earlier version ordered by
 * `sourceRowNumber` while using `id` as the cursor: two different keys, so the cursor
 * row's position in the ordering was not guaranteed and rows could be skipped or
 * repeated at a page boundary.
 */
export const PROJECTION_PAGE_SIZE = 500;

export interface ProjectionRunOptions {
  readonly batchId: string;
  readonly mode: ProjectionMode;
  readonly requestedByUserId: string | null;
  /** Overrides the environment-resolved workload limits. Used by tests only. */
  readonly limits?: ProjectionWorkloadLimits;
}

export type ProjectionRunStatus = "COMPLETED" | "FAILED";

export interface ProjectionRunSummary {
  readonly runId: string;
  readonly mode: ProjectionMode;
  readonly status: ProjectionRunStatus;
  readonly fingerprint: string;
  /** 1 for a first attempt, higher for a retry of the same logical projection. */
  readonly attemptNumber: number;
  readonly effectiveSourceState: string;
  readonly rowsRead: number;
  readonly rowsEligible: number;
  readonly rowsSkippedQuarantined: number;
  readonly rowsSkippedRejected: number;
  readonly rowsSkippedNotNormalized: number;
  readonly rowsSkippedUndecodable: number;
  readonly candidatesProjected: number;
  readonly candidatesReviewRequired: number;
  readonly candidatesQuarantined: number;
  /** Counts per fixed reason code. Never a source value. */
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly activationBlockedReason: string;
  readonly persisted: boolean;
  /** True when an identical completed run already existed and was returned unchanged. */
  readonly idempotentReplay: boolean;
}

export class ProjectionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * Every input that can change what a run produces.
 *
 * If a field belongs here and is missing, two runs with different output collide on one
 * fingerprint and the second is wrongly replayed as the first. So this is deliberately
 * over-inclusive rather than minimal, and the batch's own content hash is included so
 * that identical metadata over different rows cannot collide.
 */
export interface ProjectionFingerprintInput {
  readonly batchId: string;
  readonly batchHash: string;
  readonly mode: ProjectionMode;
  readonly contractVersion: string;
  readonly encodingVersion: string | null;
  readonly effectiveSourceState: string;
  readonly classificationProfile: string | null;
  readonly classificationProfileVersion: number | null;
  readonly identityPolicyVersion: number;
  readonly measurementPolicy: string;
  readonly quantitySemantics: string;
  readonly weightUnit: string;
}

export const PROJECTION_FINGERPRINT_VERSION = 1;

/**
 * Deterministic fingerprint over the material inputs.
 *
 * Versioned, so that adding an input later produces different fingerprints rather than
 * silently making old runs replayable for work they did not do.
 */
export function projectionFingerprint(input: ProjectionFingerprintInput): string {
  const material = canonicalJson({
    v: PROJECTION_FINGERPRINT_VERSION,
    batchId: input.batchId,
    batchHash: input.batchHash,
    mode: input.mode,
    contractVersion: input.contractVersion,
    encodingVersion: input.encodingVersion,
    effectiveSourceState: input.effectiveSourceState,
    classificationProfile: input.classificationProfile,
    classificationProfileVersion: input.classificationProfileVersion,
    identityPolicyVersion: input.identityPolicyVersion,
    measurementPolicy: input.measurementPolicy,
    quantitySemantics: input.quantitySemantics,
    weightUnit: input.weightUnit,
  });
  return sha256Hex(material);
}

/** Two 32-bit keys for `pg_advisory_xact_lock`, derived from the fingerprint. */
function advisoryLockKeys(fingerprint: string): [number, number] {
  // A fixed namespace in the first key keeps projection locks from colliding with the
  // raw-ingestion locks, which use their own namespace.
  const PROJECTION_LOCK_NAMESPACE = 0x50524f4a; // "PROJ"
  const slice = Number.parseInt(fingerprint.slice(0, 8), 16);
  return [PROJECTION_LOCK_NAMESPACE | 0, slice | 0];
}

const MEASUREMENT_POLICY = "STRICT_ACTUAL_ONLY";

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Claiming an attempt
// ---------------------------------------------------------------------------

interface ClaimedAttempt {
  readonly runId: string;
  readonly attemptNumber: number;
  readonly ownerToken: OwnerToken;
  readonly version: number;
  readonly replayOf: ProjectionRunSummary | null;
}

const RUN_SUMMARY_SELECT = {
  id: true,
  mode: true,
  status: true,
  fingerprint: true,
  attemptNumber: true,
  effectiveSourceState: true,
  rowsRead: true,
  rowsEligible: true,
  rowsSkippedQuarantined: true,
  rowsSkippedRejected: true,
  rowsSkippedNotNormalized: true,
  rowsSkippedUndecodable: true,
  candidatesProjected: true,
  candidatesReviewRequired: true,
  candidatesQuarantined: true,
  diagnosticsJson: true,
  activationBlockedReason: true,
} as const;

type RunSummaryRow = {
  id: string;
  mode: string;
  status: string;
  fingerprint: string;
  attemptNumber: number;
  effectiveSourceState: string;
  rowsRead: number;
  rowsEligible: number;
  rowsSkippedQuarantined: number;
  rowsSkippedRejected: number;
  rowsSkippedNotNormalized: number;
  rowsSkippedUndecodable: number;
  candidatesProjected: number;
  candidatesReviewRequired: number;
  candidatesQuarantined: number;
  diagnosticsJson: string | null;
  activationBlockedReason: string;
};

function summaryFromRow(row: RunSummaryRow): ProjectionRunSummary {
  let reasonCounts: Record<string, number> = {};
  try {
    const parsed: unknown = row.diagnosticsJson ? JSON.parse(row.diagnosticsJson) : null;
    if (parsed && typeof parsed === "object" && "reasonCounts" in parsed) {
      reasonCounts = (parsed as { reasonCounts: Record<string, number> }).reasonCounts ?? {};
    }
  } catch {
    // Stored diagnostics that cannot be parsed are reported as absent rather than
    // failing a replay the caller is entitled to.
    reasonCounts = {};
  }

  return {
    runId: row.id,
    mode: row.mode as ProjectionMode,
    status: row.status === "COMPLETED" ? "COMPLETED" : "FAILED",
    fingerprint: row.fingerprint,
    attemptNumber: row.attemptNumber,
    effectiveSourceState: row.effectiveSourceState,
    rowsRead: row.rowsRead,
    rowsEligible: row.rowsEligible,
    rowsSkippedQuarantined: row.rowsSkippedQuarantined,
    rowsSkippedRejected: row.rowsSkippedRejected,
    rowsSkippedNotNormalized: row.rowsSkippedNotNormalized,
    rowsSkippedUndecodable: row.rowsSkippedUndecodable,
    candidatesProjected: row.candidatesProjected,
    candidatesReviewRequired: row.candidatesReviewRequired,
    candidatesQuarantined: row.candidatesQuarantined,
    reasonCounts,
    activationBlockedReason: row.activationBlockedReason,
    persisted: row.mode === "SHADOW",
    idempotentReplay: true,
  };
}

/**
 * Claims the right to run this projection as a numbered attempt.
 *
 * Under the fingerprint-scoped advisory lock, in this order:
 *
 *   1. A COMPLETED attempt exists  → return it as an idempotent replay. No new attempt,
 *      and crucially no workload slot: replaying performs no expensive work.
 *   2. A RUNNING attempt exists    → PROJECTION_ALREADY_RUNNING.
 *   3. The latest attempt FAILED or ABORTED → create attempt N+1 for the SAME logical
 *      fingerprint. This is the recovery path; the earlier attempt and all of its
 *      candidates are left untouched as operational evidence.
 *   4. No attempt exists           → create attempt 1.
 *
 * The lock serializes the decision, so two simultaneous retries produce exactly one new
 * attempt; the partial unique index on RUNNING is the backstop if the lock is ever
 * bypassed.
 */
async function claimAttempt(
  fingerprint: string,
  base: Omit<Prisma.FantasyProjectionRunUncheckedCreateInput, "fingerprint" | "attemptNumber" | "status" | "ownerTokenHash">,
  limits: ProjectionWorkloadLimits,
): Promise<ClaimedAttempt> {
  return db.$transaction(async (tx) => {
    const [a, b] = advisoryLockKeys(fingerprint);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${a}::int, ${b}::int)`;

    const completed = await tx.fantasyProjectionRun.findFirst({
      where: { fingerprint, status: "COMPLETED" },
      select: RUN_SUMMARY_SELECT,
    });
    if (completed) {
      return {
        runId: completed.id,
        attemptNumber: completed.attemptNumber,
        ownerToken: { token: "", hash: "" },
        version: 0,
        replayOf: summaryFromRow(completed),
      };
    }

    const running = await tx.fantasyProjectionRun.findFirst({
      where: { fingerprint, status: "RUNNING" },
      select: { id: true },
    });
    if (running) {
      throw new ProjectionError(
        "PROJECTION_ALREADY_RUNNING",
        "An identical projection is already running. Wait for it to finish, or abort it if it has stalled.",
      );
    }

    // Only now is expensive work about to start, so only now is a slot consumed.
    await assertWorkloadCapacity(tx, base.requestedByUserId ?? null, limits);

    const latest = await tx.fantasyProjectionRun.findFirst({
      where: { fingerprint },
      orderBy: { attemptNumber: "desc" },
      select: { id: true, attemptNumber: true },
    });

    const ownerToken = issueOwnerToken();
    const created = await tx.fantasyProjectionRun.create({
      data: {
        ...base,
        fingerprint,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        previousAttemptId: latest?.id ?? null,
        status: "RUNNING",
        ownerTokenHash: ownerToken.hash,
        heartbeatAt: new Date(),
      },
      select: { id: true, attemptNumber: true, version: true },
    });

    return {
      runId: created.id,
      attemptNumber: created.attemptNumber,
      ownerToken,
      version: created.version,
      replayOf: null,
    };
  });
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/**
 * Runs a projection over one stored raw batch.
 *
 * Reads eligible rows a page at a time and writes candidates a page at a time under an
 * ownership proof, so memory stays bounded and no page can land after the attempt has
 * been aborted. Only rows the ingestion stage marked ACCEPTED_RAW are decoded at all.
 */
export async function runProjection(options: ProjectionRunOptions): Promise<ProjectionRunSummary> {
  if (!isProjectionMode(options.mode)) {
    throw new ProjectionError("INVALID_MODE", "Projection mode is not supported.");
  }

  const batch = await db.fantasyRawBatch.findUnique({
    where: { id: options.batchId },
    select: {
      id: true,
      batchHash: true,
      contractVersion: true,
      encodingVersion: true,
      sourceMode: true,
      status: true,
      effectiveSourceStateAtIngestion: true,
      providerIdAtIngestion: true,
    },
  });
  if (!batch) throw new ProjectionError("BATCH_NOT_FOUND", "The raw batch does not exist.");

  // The profile is chosen by the provenance recorded on the batch, never by the
  // application's current configuration.
  const recordedState = batch.effectiveSourceStateAtIngestion;
  const profile =
    recordedState !== null && isEffectiveSourceStateValue(recordedState)
      ? await loadProfileForSourceState(recordedState)
      : null;

  const eligibility = decideProjectionEligibility({
    batchStatus: batch.status,
    batchSourceMode: batch.sourceMode,
    effectiveSourceStateAtIngestion: batch.effectiveSourceStateAtIngestion,
    providerIdAtIngestion: batch.providerIdAtIngestion,
    profile,
  });
  if (!eligibility.eligible || eligibility.effectiveSourceState === null || profile === null) {
    throw new ProjectionError(eligibility.code, "This batch cannot be projected.");
  }

  const effectiveSourceState = eligibility.effectiveSourceState;
  const measurementProfile = measurementProfileFor(effectiveSourceState === "FIXTURE_SIMULATION");

  const fingerprint = projectionFingerprint({
    batchId: batch.id,
    batchHash: batch.batchHash,
    mode: options.mode,
    contractVersion: batch.contractVersion,
    encodingVersion: batch.encodingVersion,
    effectiveSourceState,
    classificationProfile: profile.code,
    classificationProfileVersion: profile.version,
    identityPolicyVersion: IDENTITY_POLICY_VERSION,
    measurementPolicy: MEASUREMENT_POLICY,
    quantitySemantics: measurementProfile.quantitySemantics,
    weightUnit: measurementProfile.weightUnit,
  });

  const claim = await claimAttempt(
    fingerprint,
    {
      mode: options.mode,
      sourceBatchId: batch.id,
      contractVersion: batch.contractVersion,
      encodingVersion: batch.encodingVersion,
      effectiveSourceState,
      classificationProfile: profile.code,
      classificationProfileVersion: profile.version,
      identityPolicyVersion: IDENTITY_POLICY_VERSION,
      measurementPolicy: MEASUREMENT_POLICY,
      quantitySemantics: measurementProfile.quantitySemantics,
      weightUnit: measurementProfile.weightUnit,
      activationBlockedReason: ACTIVATION_BLOCKED_REASON,
      requestedByUserId: options.requestedByUserId,
    },
    options.limits ?? resolveProjectionWorkloadLimits(),
  );

  if (claim.replayOf) return claim.replayOf;

  const ctx: ProjectionContext = {
    runId: claim.runId,
    batchId: batch.id,
    classificationProfile: profile,
    measurementProfile,
    effectiveSourceState,
  };

  const reasonCounts: Record<string, number> = {};
  const bump = (code: string) => {
    reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
  };

  let rowsRead = 0;
  let rowsEligible = 0;
  let skippedQuarantined = 0;
  let skippedRejected = 0;
  let skippedNotNormalized = 0;
  let skippedUndecodable = 0;
  let projected = 0;
  let reviewRequired = 0;
  let quarantined = 0;
  let written = 0;
  // Keyset cursor on the unique (batchId, sourceRowNumber) pair, matching the ordering.
  let afterRowNumber: number | null = null;
  // The worker's ownership position. Every guarded write advances it.
  let version = claim.version;

  const counters = () => ({
    rowsRead,
    rowsEligible,
    rowsSkippedQuarantined: skippedQuarantined,
    rowsSkippedRejected: skippedRejected,
    rowsSkippedNotNormalized: skippedNotNormalized,
    rowsSkippedUndecodable: skippedUndecodable,
    candidatesProjected: projected,
    candidatesReviewRequired: reviewRequired,
    candidatesQuarantined: quarantined,
  });

  try {
    for (;;) {
      const page = await db.fantasyRawRow.findMany({
        where: {
          batchId: batch.id,
          ...(afterRowNumber === null ? {} : { sourceRowNumber: { gt: afterRowNumber } }),
        },
        select: {
          id: true,
          sourceRowNumber: true,
          normalizedRecordJson: true,
          encodingVersion: true,
          rowHash: true,
          outcome: true,
        },
        orderBy: { sourceRowNumber: "asc" },
        take: PROJECTION_PAGE_SIZE,
      });
      if (page.length === 0) break;
      afterRowNumber = page[page.length - 1].sourceRowNumber;

      const candidates: Prisma.FantasyProjectionCandidateCreateManyInput[] = [];

      for (const row of page) {
        rowsRead++;

        // --- Eligibility, before anything is decoded or interpreted ---------
        const skip = rowSkipReason(row.outcome);
        if (skip !== null) {
          bump(skip);
          if (skip === "ROW_SKIPPED_QUARANTINED_AT_INGESTION") skippedQuarantined++;
          else if (skip === "ROW_SKIPPED_REJECTED_AT_INGESTION") skippedRejected++;
          else skippedUndecodable++;
          continue;
        }

        if (row.normalizedRecordJson === null) {
          // Accepted but not normalized should not occur; counted rather than assumed.
          bump("ROW_SKIPPED_NOT_NORMALIZED");
          skippedNotNormalized++;
          continue;
        }

        let record: DecodedRecord;
        try {
          const decoded = decodeNormalizedRecord(row.normalizedRecordJson, row.encodingVersion);
          if (decoded === null) {
            bump("ROW_SKIPPED_UNDECODABLE");
            skippedUndecodable++;
            continue;
          }
          record = decoded;
        } catch {
          // The decode failure reason is intentionally not propagated: it can carry
          // positional detail about the stored payload.
          bump("ROW_SKIPPED_UNDECODABLE");
          skippedUndecodable++;
          continue;
        }

        rowsEligible++;

        const candidate = projectRow(
          record,
          { sourceRowNumber: row.sourceRowNumber, id: row.id, rowHash: row.rowHash },
          ctx,
        );

        for (const code of candidate.reasonCodes) bump(code);

        if (candidate.candidateState === "QUARANTINED") quarantined++;
        else if (candidate.candidateState === "REVIEW_REQUIRED") reviewRequired++;
        else projected++;

        candidates.push(candidate.data);
      }

      // DRY_RUN computes identically and stores nothing, so the two modes cannot drift.
      // Both still prove ownership every page: a dry run that lost its claim must stop
      // just as a shadow run does, and both advance the heartbeat.
      if (options.mode === "SHADOW") {
        const result = await writeCandidatePageOwned(claim.runId, claim.ownerToken.hash, version, candidates);
        version = result.version;
        written += result.written;
      } else {
        version = await touchHeartbeatOwned(claim.runId, claim.ownerToken.hash, version);
      }
    }

    // Persistence and the counters must agree exactly, or one of them is lying.
    if (options.mode === "SHADOW") {
      const expected = projected + reviewRequired + quarantined;
      if (written !== expected) {
        throw new ProjectionError(
          "PROJECTION_COUNT_MISMATCH",
          "Projection wrote a different number of candidates than it counted.",
        );
      }
    }

    const finalized = await finalizeOwnedAttempt({
      runId: claim.runId,
      ownerTokenHash: claim.ownerToken.hash,
      expectedVersion: version,
      status: "COMPLETED",
      terminalReasonCode: "COMPLETED_NORMALLY",
      counters: { ...counters(), diagnosticsJson: JSON.stringify({ reasonCounts }) },
    });
    if (!finalized) {
      // Ownership was taken away — almost certainly an operator abort — between the last
      // page and finalization. The abort stands; this worker does not overwrite it.
      throw new ProjectionError(
        "PROJECTION_OWNERSHIP_LOST",
        "This projection attempt is no longer owned by this worker.",
      );
    }

    return {
      runId: claim.runId,
      mode: options.mode,
      status: "COMPLETED",
      fingerprint,
      attemptNumber: claim.attemptNumber,
      effectiveSourceState,
      rowsRead,
      rowsEligible,
      rowsSkippedQuarantined: skippedQuarantined,
      rowsSkippedRejected: skippedRejected,
      rowsSkippedNotNormalized: skippedNotNormalized,
      rowsSkippedUndecodable: skippedUndecodable,
      candidatesProjected: projected,
      candidatesReviewRequired: reviewRequired,
      candidatesQuarantined: quarantined,
      reasonCounts,
      activationBlockedReason: ACTIVATION_BLOCKED_REASON,
      persisted: options.mode === "SHADOW",
      idempotentReplay: false,
    };
  } catch (error) {
    const lostOwnership =
      (error instanceof ProjectionError && error.code === "PROJECTION_OWNERSHIP_LOST") ||
      (error instanceof ProjectionRecoveryError && error.code === "PROJECTION_OWNERSHIP_LOST");

    if (!lostOwnership) {
      // Close the attempt out as FAILED, still conditional on ownership. A worker that
      // has lost the attempt must not be able to stamp FAILED over an operator's abort.
      await finalizeOwnedAttempt({
        runId: claim.runId,
        ownerTokenHash: claim.ownerToken.hash,
        expectedVersion: version,
        status: "FAILED",
        terminalReasonCode:
          error instanceof ProjectionError && error.code === "PROJECTION_COUNT_MISMATCH"
            ? "COUNT_MISMATCH"
            : "EXECUTION_ERROR",
        counters: { ...counters(), diagnosticsJson: JSON.stringify({ reasonCounts, failed: true }) },
      });
    }
    throw error;
  }
}
