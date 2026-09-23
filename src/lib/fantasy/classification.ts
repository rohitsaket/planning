/**
 * FANTASY CLASSIFICATION — the single authority for status, hold and availability.
 *
 * Before this module the decision lived in nine places: four copies of
 * `status === "STOCK" ? "PHYSICAL" : "MEMO"` in the synchronization service, an
 * unconditional `planningClass: "PHYSICAL"` on the replay path, a gate that only
 * mirrored lots whose status was literally `STOCK` or `MEMO`, and three more
 * reinterpretations inside demand and stock-position analytics. `FantasyStatusMapping`
 * existed but was never read. Every one of those now calls this service.
 *
 * Fails closed throughout. A status that is not mapped, a hold value that is not
 * mapped, an inactive mapping, or a simulation-only profile applied to non-simulated
 * data all produce an excluded, review-required record — never memo, never stock,
 * never available.
 *
 * Server-only: it reads mapping profiles and decides operational availability.
 */

import type { FantasyEffectiveSourceState } from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/classification is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Three semantic outcomes. There is deliberately no fourth, and no default. */
export const HOLD_STATES = ["HELD", "NOT_HELD", "UNKNOWN"] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/**
 * Only the lifecycle states current downstream logic actually consumes. Decorative
 * states are deliberately absent: an unused state invites someone to map a status to it
 * and believe something follows.
 */
export const CANONICAL_LIFECYCLES = [
  "AVAILABLE",
  "PLANNING_AVAILABLE",
  "RESERVED",
  "MEMO",
  "MANUFACTURING_WIP",
  "POLISHED_STOCK",
  "SOLD",
  "TRANSFERRED",
  "CLOSED",
  "UNKNOWN",
] as const;
export type CanonicalLifecycle = (typeof CANONICAL_LIFECYCLES)[number];

/** The coverage bucket a record may occupy. A record occupies exactly one. */
export const INVENTORY_CLASSES = ["PHYSICAL_AVAILABLE", "MEMO", "RESERVED", "WIP", "EXCLUDED"] as const;
export type InventoryClass = (typeof INVENTORY_CLASSES)[number];

export const CLASSIFICATION_STATES = ["CLASSIFIED", "BLOCKED", "NOT_CONFIGURED"] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

/** Fixed codes. No free text, no formula, no source value. */
export const EXCLUSION_REASON_CODES = [
  "STATUS_MISSING",
  "STATUS_UNMAPPED",
  "STATUS_MAPPING_INACTIVE",
  "HOLD_MISSING",
  "HOLD_UNMAPPED",
  "HOLD_ACTIVE",
  "HOLD_STATE_UNKNOWN",
  "SIMULATION_PROFILE_ON_LIVE_DATA",
  "SIMULATION_SENTINEL_FROM_SOURCE_ROW",
  "PROFILE_NOT_CONFIGURED",
  "PROFILE_INACTIVE",
  "STRUCTURALLY_INVALID",
  "BLOCKING_DATA_QUALITY",
  "TERMINAL_STATE",
  "MAPPING_FLAGS_INCONSISTENT",
] as const;
export type ExclusionReasonCode = (typeof EXCLUSION_REASON_CODES)[number];

/**
 * The application's own fixture adapter deliberately does not model hold. It supplies
 * this sentinel so the legacy pipeline still travels through the classifier rather than
 * being exempted from it. It is not a Fantasy value and must never be displayed as one.
 */
export const LEGACY_FIXTURE_HOLD_SENTINEL = "LEGACY_FIXTURE_HOLD_NOT_MODELLED";

/**
 * Where a hold value came from. The sentinel is only honoured when the application's own
 * adapter supplied it; the same string arriving on a provider row is refused, so a live
 * feed cannot spell it and become available.
 */
export type HoldValueOrigin = "ADAPTER_SENTINEL" | "SOURCE_ROW";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface StatusMappingRow {
  readonly sourceStatus: string;
  readonly canonicalLifecycle: string;
  readonly inventoryClass: string;
  readonly countsAvailable: boolean;
  readonly planningEligible: boolean;
  readonly terminalState: boolean;
  readonly reviewRequired: boolean;
  readonly isActive: boolean;
}

export interface HoldMappingRow {
  readonly sourceValue: string;
  readonly holdState: string;
  readonly isActive: boolean;
}

export interface ClassificationProfile {
  readonly code: string;
  readonly version: number;
  readonly applicability: "SIMULATION_ONLY" | "LIVE_ELIGIBLE";
  readonly isActive: boolean;
  readonly statusMappings: readonly StatusMappingRow[];
  readonly holdMappings: readonly HoldMappingRow[];
}

/** Trim and upper-case only. No aliasing, no punctuation folding, no guessing. */
export function normalizeSourceValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed.toUpperCase();
}

// ---------------------------------------------------------------------------
// Input and output
// ---------------------------------------------------------------------------

export interface ClassificationInput {
  /** Exact raw status as delivered. Not pre-normalized by the caller. */
  readonly rawStatus: unknown;
  /** Exact raw hold value as delivered, or the adapter sentinel. */
  readonly rawHold: unknown;
  readonly holdOrigin: HoldValueOrigin;
  readonly process?: unknown;
  readonly currentDepartment?: unknown;
  readonly previousDepartment?: unknown;
  /** False when the row failed structural validation upstream. */
  readonly structurallyValid: boolean;
  /** True when a blocking data-quality issue already applies to this record. */
  readonly hasBlockingDataQuality: boolean;
  /** Effective source state, so a simulation profile cannot classify live data. */
  readonly effectiveSourceState: FantasyEffectiveSourceState;
}

export interface ClassificationResult {
  readonly state: ClassificationState;
  readonly holdState: HoldState;
  readonly lifecycle: CanonicalLifecycle;
  readonly inventoryClass: InventoryClass;
  readonly available: boolean;
  readonly planningEligible: boolean;
  readonly reviewRequired: boolean;
  readonly terminal: boolean;
  /** Deduplicated and ordered. Codes only. */
  readonly exclusionReasons: readonly ExclusionReasonCode[];
  readonly profileCode: string | null;
  readonly profileVersion: number | null;
  /** Normalized status actually looked up, for diagnostics. Never a raw payload. */
  readonly normalizedStatus: string | null;
}

/** Everything excluded, with the reasons that got it there. */
function excluded(
  reasons: readonly ExclusionReasonCode[],
  holdState: HoldState,
  profile: ClassificationProfile | null,
  normalizedStatus: string | null,
  state: ClassificationState = "BLOCKED",
): ClassificationResult {
  return {
    state,
    holdState,
    lifecycle: "UNKNOWN",
    inventoryClass: "EXCLUDED",
    available: false,
    planningEligible: false,
    reviewRequired: true,
    terminal: false,
    exclusionReasons: Array.from(new Set(reasons)).sort(),
    profileCode: profile?.code ?? null,
    profileVersion: profile?.version ?? null,
    normalizedStatus,
  };
}

// ---------------------------------------------------------------------------
// Hold
// ---------------------------------------------------------------------------

/**
 * Resolves hold to one of three states.
 *
 * Only an explicitly mapped, active source value can become NOT_HELD. Absent, empty,
 * unmapped, and every false-looking value — `""`, `0`, `"false"`, `null` — resolve to
 * UNKNOWN, which blocks availability exactly as HELD does.
 */
export function resolveHoldState(
  input: Pick<ClassificationInput, "rawHold" | "holdOrigin" | "effectiveSourceState">,
  profile: ClassificationProfile,
): { holdState: HoldState; reason: ExclusionReasonCode | null } {
  const isSimulated = input.effectiveSourceState === "FIXTURE_SIMULATION";

  // The adapter sentinel is honoured only from the application's own adapter, and only
  // for simulated data. Arriving on a provider row it is just an unknown value.
  const sentinelSupplied = input.rawHold === LEGACY_FIXTURE_HOLD_SENTINEL;
  if (sentinelSupplied && input.holdOrigin === "SOURCE_ROW") {
    return { holdState: "UNKNOWN", reason: "SIMULATION_SENTINEL_FROM_SOURCE_ROW" };
  }
  if (sentinelSupplied && !isSimulated) {
    return { holdState: "UNKNOWN", reason: "SIMULATION_PROFILE_ON_LIVE_DATA" };
  }

  const normalized = normalizeSourceValue(input.rawHold);
  if (normalized === null) return { holdState: "UNKNOWN", reason: "HOLD_MISSING" };

  const mapping = profile.holdMappings.find((m) => m.sourceValue === normalized);
  if (!mapping) return { holdState: "UNKNOWN", reason: "HOLD_UNMAPPED" };
  if (!mapping.isActive) return { holdState: "UNKNOWN", reason: "HOLD_UNMAPPED" };

  if (mapping.holdState === "HELD") return { holdState: "HELD", reason: "HOLD_ACTIVE" };
  if (mapping.holdState === "NOT_HELD") return { holdState: "NOT_HELD", reason: null };
  // A stored value outside the two writable states is not trusted.
  return { holdState: "UNKNOWN", reason: "HOLD_STATE_UNKNOWN" };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function isLifecycle(v: string): v is CanonicalLifecycle {
  return (CANONICAL_LIFECYCLES as readonly string[]).includes(v);
}
function isInventoryClass(v: string): v is InventoryClass {
  return (INVENTORY_CLASSES as readonly string[]).includes(v);
}

/**
 * Classifies one record.
 *
 * Order matters: the profile's right to classify this data is checked before anything
 * else, hold is resolved before status, and a held or unknown-hold record can never be
 * rescued by its status mapping.
 */
export function classifyFantasyRecord(
  input: ClassificationInput,
  profile: ClassificationProfile | null,
): ClassificationResult {
  const normalizedStatus = normalizeSourceValue(input.rawStatus);

  if (profile === null) {
    return excluded(["PROFILE_NOT_CONFIGURED"], "UNKNOWN", null, normalizedStatus, "NOT_CONFIGURED");
  }
  if (!profile.isActive) {
    return excluded(["PROFILE_INACTIVE"], "UNKNOWN", profile, normalizedStatus, "NOT_CONFIGURED");
  }
  // A simulation-only profile must never decide anything about non-simulated data.
  if (profile.applicability === "SIMULATION_ONLY" && input.effectiveSourceState !== "FIXTURE_SIMULATION") {
    return excluded(["SIMULATION_PROFILE_ON_LIVE_DATA"], "UNKNOWN", profile, normalizedStatus);
  }

  const structural: ExclusionReasonCode[] = [];
  if (!input.structurallyValid) structural.push("STRUCTURALLY_INVALID");
  if (input.hasBlockingDataQuality) structural.push("BLOCKING_DATA_QUALITY");

  const hold = resolveHoldState(input, profile);

  // Held or unknown-hold: excluded regardless of status. Status cannot override hold.
  if (hold.holdState !== "NOT_HELD") {
    const reasons: ExclusionReasonCode[] = [...structural];
    if (hold.reason) reasons.push(hold.reason);
    else reasons.push(hold.holdState === "HELD" ? "HOLD_ACTIVE" : "HOLD_STATE_UNKNOWN");
    return excluded(reasons, hold.holdState, profile, normalizedStatus);
  }

  if (normalizedStatus === null) {
    return excluded([...structural, "STATUS_MISSING"], hold.holdState, profile, normalizedStatus);
  }

  const mapping = profile.statusMappings.find((m) => m.sourceStatus === normalizedStatus);
  if (!mapping) {
    return excluded([...structural, "STATUS_UNMAPPED"], hold.holdState, profile, normalizedStatus);
  }
  if (!mapping.isActive) {
    return excluded([...structural, "STATUS_MAPPING_INACTIVE"], hold.holdState, profile, normalizedStatus);
  }
  if (!isLifecycle(mapping.canonicalLifecycle) || !isInventoryClass(mapping.inventoryClass)) {
    // A stored vocabulary this build does not define is refused, never guessed at.
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }
  // A mapping cannot claim a record is available while also excluding it.
  if (mapping.countsAvailable && mapping.inventoryClass === "EXCLUDED") {
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }
  // Nothing terminal is available, whatever the mapping says.
  if (mapping.terminalState && (mapping.countsAvailable || mapping.planningEligible)) {
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }

  // Structural or blocking-quality problems exclude even a well-mapped status.
  if (structural.length > 0) {
    return excluded(structural, hold.holdState, profile, normalizedStatus);
  }

  const reasons: ExclusionReasonCode[] = [];
  if (mapping.terminalState) reasons.push("TERMINAL_STATE");

  return {
    state: "CLASSIFIED",
    holdState: "NOT_HELD",
    lifecycle: mapping.canonicalLifecycle,
    inventoryClass: mapping.inventoryClass,
    available: mapping.countsAvailable,
    planningEligible: mapping.planningEligible,
    reviewRequired: mapping.reviewRequired,
    terminal: mapping.terminalState,
    exclusionReasons: reasons,
    profileCode: profile.code,
    profileVersion: profile.version,
    normalizedStatus,
  };
}

/**
 * Inventory classes that receive an operational polished mirror.
 *
 * Deliberately the same set the removed `currentStatus === "STOCK" || === "MEMO"` gate
 * admitted, so routing the legacy pipeline through the classifier does not change which
 * lots have a mirror. Widening it — to mirror RESERVED or WIP lots, for instance —
 * changes mirror counts and the demand engine's missing-mirror handling, so it needs an
 * approved rule and a re-baselined parity run, not a quiet edit here.
 */
export const MIRRORED_INVENTORY_CLASSES: readonly InventoryClass[] = ["PHYSICAL_AVAILABLE", "MEMO"];

export function isMirroredInventoryClass(inventoryClass: InventoryClass): boolean {
  return MIRRORED_INVENTORY_CLASSES.includes(inventoryClass);
}

/**
 * Legacy `PolishedStone.planningClass` value for a classified record.
 *
 * The mirror column predates this service and is read by stock-position analytics and
 * the polished APIs, so the classifier's decision is translated into the existing
 * vocabulary rather than the column being migrated underneath those readers.
 */
export function toLegacyPlanningClass(inventoryClass: InventoryClass): string {
  switch (inventoryClass) {
    case "PHYSICAL_AVAILABLE":
      return "PHYSICAL";
    case "MEMO":
      return "MEMO";
    case "RESERVED":
      return "RESERVED";
    case "WIP":
    case "EXCLUDED":
      return "OTHER";
  }
}

/**
 * Classification input for a record produced by the application's own fixture provider.
 *
 * The fixture emits canonical records, not 46-column Fantasy rows, and deliberately does
 * not model hold — so the adapter supplies the internal sentinel. That is the only place
 * the sentinel originates, and `holdOrigin` marks it as coming from the adapter rather
 * than from a source row.
 */
export function legacyFixtureClassificationInput(input: {
  currentStatus: unknown;
  process?: unknown;
  currentDepartment?: unknown;
  previousDepartment?: unknown;
  structurallyValid?: boolean;
  hasBlockingDataQuality?: boolean;
}): ClassificationInput {
  return {
    rawStatus: input.currentStatus,
    rawHold: LEGACY_FIXTURE_HOLD_SENTINEL,
    holdOrigin: "ADAPTER_SENTINEL",
    process: input.process,
    currentDepartment: input.currentDepartment,
    previousDepartment: input.previousDepartment,
    structurallyValid: input.structurallyValid ?? true,
    hasBlockingDataQuality: input.hasBlockingDataQuality ?? false,
    effectiveSourceState: "FIXTURE_SIMULATION",
  };
}

/** The classification columns as persisted on a canonical record. */
export interface PersistedClassification {
  readonly classificationState: string | null;
  readonly holdState: string | null;
  readonly inventoryClass: string | null;
  readonly classificationAvailable: boolean | null;
  readonly classificationPlanningEligible: boolean | null;
  readonly classificationReasons: string | null;
  readonly classificationProfile: string | null;
  readonly classificationProfileVersion: number | null;
}

export interface EffectiveClassification {
  readonly inventoryClass: InventoryClass;
  readonly available: boolean;
  readonly planningEligible: boolean;
  readonly holdState: HoldState;
  readonly reasons: string | null;
  readonly profileCode: string | null;
  readonly profileVersion: number | null;
  /** True when the answer came from the record, false when it was computed on read. */
  readonly fromPersisted: boolean;
}

/**
 * The classification a consumer should act on.
 *
 * Prefers the value persisted by the projection or synchronization that wrote the
 * record. When a record predates persisted classification — or was written by a path
 * that does not classify, such as a test fixture — it is classified on read through the
 * same service, never by the consumer reinterpreting the raw status itself.
 *
 * A record that cannot be classified is excluded, exactly as if it had been classified
 * and blocked. Absence is never permissive.
 */
export function resolveEffectiveClassification(
  record: PersistedClassification & { currentStatus?: unknown; departmentName?: unknown },
  profile: ClassificationProfile | null,
  /**
   * Operational mirror classification, when one exists. Applied as a **restrictive-only**
   * override: a mirror may exclude a record the master classified as available, but can
   * never promote one. The synchronization service derives the mirror from the same
   * classifier, so a divergence means the mirror is stale or was written by hand — and
   * the safer of the two answers is the one to act on.
   */
  mirrorPlanningClass?: string | null,
): EffectiveClassification {
  if (record.classificationState !== null && record.inventoryClass !== null && isInventoryClass(record.inventoryClass)) {
    const restricted = applyMirrorRestriction(record.inventoryClass, mirrorPlanningClass);
    return {
      inventoryClass: restricted,
      available: restricted === "PHYSICAL_AVAILABLE" && record.classificationAvailable === true,
      planningEligible: record.classificationPlanningEligible === true,
      holdState: (HOLD_STATES as readonly string[]).includes(record.holdState ?? "")
        ? (record.holdState as HoldState)
        : "UNKNOWN",
      reasons: record.classificationReasons,
      profileCode: record.classificationProfile,
      profileVersion: record.classificationProfileVersion,
      fromPersisted: true,
    };
  }

  const computed = classifyFantasyRecord(
    legacyFixtureClassificationInput({
      currentStatus: record.currentStatus,
      currentDepartment: record.departmentName ?? null,
    }),
    profile,
  );
  const restricted = applyMirrorRestriction(computed.inventoryClass, mirrorPlanningClass);
  return {
    inventoryClass: restricted,
    available: restricted === "PHYSICAL_AVAILABLE" && computed.available,
    planningEligible: restricted === "PHYSICAL_AVAILABLE" && computed.planningEligible,
    holdState: computed.holdState,
    reasons: computed.exclusionReasons.length ? computed.exclusionReasons.join(",") : null,
    profileCode: computed.profileCode,
    profileVersion: computed.profileVersion,
    fromPersisted: false,
  };
}

/**
 * How restrictive each class is. The more restrictive of the master classification and
 * the operational mirror wins, so neither can make a record available on its own.
 */
const RESTRICTIVENESS: Record<InventoryClass, number> = {
  PHYSICAL_AVAILABLE: 0,
  MEMO: 1,
  RESERVED: 2,
  WIP: 3,
  EXCLUDED: 4,
};

/**
 * Legacy `planningClass` values that represent physically available stock.
 *
 * Derived from the classifier's own vocabulary rather than written out again in each
 * query, so a mapping change cannot leave an analytics filter behind. This is the set
 * `toLegacyPlanningClass` produces for PHYSICAL_AVAILABLE, plus the historical
 * PLANNING_AVAILABLE value that predates this service and still exists on older rows.
 */
export const AVAILABLE_LEGACY_PLANNING_CLASSES: readonly string[] = ["PHYSICAL", "PLANNING_AVAILABLE"];

/** Legacy mirror vocabulary, read back into the classifier's vocabulary. */
function mirrorClassToInventoryClass(planningClass: string): InventoryClass {
  switch (planningClass) {
    case "PHYSICAL":
    case "PLANNING_AVAILABLE":
      return "PHYSICAL_AVAILABLE";
    case "MEMO":
      return "MEMO";
    case "RESERVED":
      return "RESERVED";
    default:
      // HOLD, TRANSFER, OTHER and anything unrecognised exclude the record.
      return "EXCLUDED";
  }
}

function applyMirrorRestriction(base: InventoryClass, mirrorPlanningClass?: string | null): InventoryClass {
  if (!mirrorPlanningClass) return base;
  const fromMirror = mirrorClassToInventoryClass(mirrorPlanningClass);
  return RESTRICTIVENESS[fromMirror] > RESTRICTIVENESS[base] ? fromMirror : base;
}

/** Stable data-quality rule identity, so a repeated issue deduplicates rather than piles up. */
export function classificationIssueCode(recordKey: string, reason: ExclusionReasonCode): string {
  return `DQ-CLASSIFY-${reason}-${recordKey}`;
}
