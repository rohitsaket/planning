import type { FantasyEffectiveSourceState } from "@/lib/fantasy/source-state";

if (typeof window !== "undefined") {
  throw new Error("fantasy/classification is server-only and must not be imported by client code.");
}

export const HOLD_STATES = ["HELD", "NOT_HELD", "UNKNOWN"] as const;
export type HoldState = (typeof HOLD_STATES)[number];

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

export const INVENTORY_CLASSES = ["PHYSICAL_AVAILABLE", "MEMO", "RESERVED", "WIP", "EXCLUDED"] as const;
export type InventoryClass = (typeof INVENTORY_CLASSES)[number];

export const CLASSIFICATION_STATES = ["CLASSIFIED", "BLOCKED", "NOT_CONFIGURED"] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

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

export const LEGACY_FIXTURE_HOLD_SENTINEL = "LEGACY_FIXTURE_HOLD_NOT_MODELLED";

export type HoldValueOrigin = "ADAPTER_SENTINEL" | "SOURCE_ROW";

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

export function normalizeSourceValue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed.toUpperCase();
}

export interface ClassificationInput {
  readonly rawStatus: unknown;
  readonly rawHold: unknown;
  readonly holdOrigin: HoldValueOrigin;
  readonly process?: unknown;
  readonly currentDepartment?: unknown;
  readonly previousDepartment?: unknown;
  readonly structurallyValid: boolean;
  readonly hasBlockingDataQuality: boolean;
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
  readonly exclusionReasons: readonly ExclusionReasonCode[];
  readonly profileCode: string | null;
  readonly profileVersion: number | null;
  readonly normalizedStatus: string | null;
}

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

export function resolveHoldState(
  input: Pick<ClassificationInput, "rawHold" | "holdOrigin" | "effectiveSourceState">,
  profile: ClassificationProfile,
): { holdState: HoldState; reason: ExclusionReasonCode | null } {
  const isSimulated = input.effectiveSourceState === "FIXTURE_SIMULATION";

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
  return { holdState: "UNKNOWN", reason: "HOLD_STATE_UNKNOWN" };
}

function isLifecycle(v: string): v is CanonicalLifecycle {
  return (CANONICAL_LIFECYCLES as readonly string[]).includes(v);
}
function isInventoryClass(v: string): v is InventoryClass {
  return (INVENTORY_CLASSES as readonly string[]).includes(v);
}

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
  if (profile.applicability === "SIMULATION_ONLY" && input.effectiveSourceState !== "FIXTURE_SIMULATION") {
    return excluded(["SIMULATION_PROFILE_ON_LIVE_DATA"], "UNKNOWN", profile, normalizedStatus);
  }

  const structural: ExclusionReasonCode[] = [];
  if (!input.structurallyValid) structural.push("STRUCTURALLY_INVALID");
  if (input.hasBlockingDataQuality) structural.push("BLOCKING_DATA_QUALITY");

  const hold = resolveHoldState(input, profile);

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
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }
  if (mapping.countsAvailable && mapping.inventoryClass === "EXCLUDED") {
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }
  if (mapping.terminalState && (mapping.countsAvailable || mapping.planningEligible)) {
    return excluded([...structural, "MAPPING_FLAGS_INCONSISTENT"], hold.holdState, profile, normalizedStatus);
  }

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

export const MIRRORED_INVENTORY_CLASSES: readonly InventoryClass[] = ["PHYSICAL_AVAILABLE", "MEMO"];

export function isMirroredInventoryClass(inventoryClass: InventoryClass): boolean {
  return MIRRORED_INVENTORY_CLASSES.includes(inventoryClass);
}

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
  readonly fromPersisted: boolean;
}

export function resolveEffectiveClassification(
  record: PersistedClassification & { currentStatus?: unknown; departmentName?: unknown },
  profile: ClassificationProfile | null,
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

const RESTRICTIVENESS: Record<InventoryClass, number> = {
  PHYSICAL_AVAILABLE: 0,
  MEMO: 1,
  RESERVED: 2,
  WIP: 3,
  EXCLUDED: 4,
};

export const AVAILABLE_LEGACY_PLANNING_CLASSES: readonly string[] = ["PHYSICAL", "PLANNING_AVAILABLE"];

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
      return "EXCLUDED";
  }
}

function applyMirrorRestriction(base: InventoryClass, mirrorPlanningClass?: string | null): InventoryClass {
  if (!mirrorPlanningClass) return base;
  const fromMirror = mirrorClassToInventoryClass(mirrorPlanningClass);
  return RESTRICTIVENESS[fromMirror] > RESTRICTIVENESS[base] ? fromMirror : base;
}

export function classificationIssueCode(recordKey: string, reason: ExclusionReasonCode): string {
  return `DQ-CLASSIFY-${reason}-${recordKey}`;
}
