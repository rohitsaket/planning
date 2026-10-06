import {
  parseSourceNumeric,
  type MeasurementProfile,
  type ParsedNumeric,
} from "@/lib/fantasy/quantity-weight";

if (typeof window !== "undefined") {
  throw new Error("fantasy/measurements is server-only and must not be imported by client code.");
}

export const VALUE_PROVENANCES = ["ACTUAL", "ESTIMATED", "NONE"] as const;
export type ValueProvenance = (typeof VALUE_PROVENANCES)[number];

export const ESTIMATION_METHODS = ["UNKNOWN_PROVIDER_METHOD", "NOT_ESTIMATED"] as const;
export type EstimationMethod = (typeof ESTIMATION_METHODS)[number];

export const ESTIMATED_ID_STATES = [
  "PRESENT_UNRESOLVED",
  "RESOLVED",
  "LOOKUP_NOT_CONFIGURED",
  "ABSENT",
  "INVALID",
] as const;
export type EstimatedIdState = (typeof ESTIMATED_ID_STATES)[number];

export const DUAL_SOURCE_ATTRIBUTES = ["shape", "color", "clarity", "weight"] as const;
export type DualSourceAttribute = (typeof DUAL_SOURCE_ATTRIBUTES)[number];

export const ACTUAL_ONLY_ATTRIBUTES = [
  "labName",
  "cut",
  "polish",
  "symmetry",
  "fluorescence",
  "tableValue",
  "depth",
  "ratio",
  "tone",
  "fancyColor",
] as const;
export type ActualOnlyAttribute = (typeof ACTUAL_ONLY_ATTRIBUTES)[number];

export interface ResolutionPolicy {
  readonly allowEstimatedFallback: boolean;
  readonly estimatedIdLookup?: ReadonlyMap<string, string>;
}

export const STRICT_ACTUAL_ONLY: ResolutionPolicy = { allowEstimatedFallback: false };

export interface ResolvedTextAttribute {
  readonly actual: string | null;
  readonly estimatedId: string | null;
  readonly estimatedIdState: EstimatedIdState;
  readonly value: string | null;
  readonly provenance: ValueProvenance;
  readonly estimationMethod: EstimationMethod;
  readonly advisory: boolean;
}

export interface ResolvedWeightAttribute {
  readonly actual: ParsedNumeric;
  readonly estimated: ParsedNumeric;
  readonly value: number | null;
  readonly provenance: ValueProvenance;
  readonly estimationMethod: EstimationMethod;
  readonly advisory: boolean;
  readonly divergence: number | null;
}

function presentText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

function readEstimatedId(raw: unknown): { id: string | null; state: EstimatedIdState } {
  if (raw === null || raw === undefined) return { id: null, state: "ABSENT" };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { id: null, state: "INVALID" };
    return { id: String(raw), state: "PRESENT_UNRESOLVED" };
  }
  if (typeof raw !== "string") return { id: null, state: "INVALID" };
  const trimmed = raw.trim();
  if (trimmed === "") return { id: null, state: "ABSENT" };
  return { id: trimmed, state: "PRESENT_UNRESOLVED" };
}

export function resolveTextAttribute(
  actualRaw: unknown,
  estimatedIdRaw: unknown,
  policy: ResolutionPolicy = STRICT_ACTUAL_ONLY,
): ResolvedTextAttribute {
  const actual = presentText(actualRaw);
  const { id, state } = readEstimatedId(estimatedIdRaw);

  let estimatedIdState: EstimatedIdState = state;
  let resolvedEstimate: string | null = null;

  if (state === "PRESENT_UNRESOLVED" && id !== null) {
    const mapped = policy.estimatedIdLookup?.get(id);
    if (mapped === undefined) {
      estimatedIdState = "LOOKUP_NOT_CONFIGURED";
    } else {
      estimatedIdState = "RESOLVED";
      resolvedEstimate = mapped;
    }
  }

  if (actual !== null) {
    return {
      actual,
      estimatedId: id,
      estimatedIdState,
      value: actual,
      provenance: "ACTUAL",
      estimationMethod: "NOT_ESTIMATED",
      advisory: false,
    };
  }

  if (policy.allowEstimatedFallback && resolvedEstimate !== null) {
    return {
      actual: null,
      estimatedId: id,
      estimatedIdState,
      value: resolvedEstimate,
      provenance: "ESTIMATED",
      estimationMethod: "UNKNOWN_PROVIDER_METHOD",
      advisory: true,
    };
  }

  return {
    actual: null,
    estimatedId: id,
    estimatedIdState,
    value: null,
    provenance: "NONE",
    estimationMethod: id === null ? "NOT_ESTIMATED" : "UNKNOWN_PROVIDER_METHOD",
    advisory: false,
  };
}

export function resolveWeightAttribute(
  actualRaw: unknown,
  estimatedRaw: unknown,
  policy: ResolutionPolicy = STRICT_ACTUAL_ONLY,
): ResolvedWeightAttribute {
  const actual = parseSourceNumeric(actualRaw, { allowZero: false, maxDecimals: 4 });
  const estimated = parseSourceNumeric(estimatedRaw, { allowZero: false, maxDecimals: 4 });

  const divergence =
    actual.state === "VALID" && estimated.state === "VALID" && actual.value !== null && estimated.value !== null
      ? Number((estimated.value - actual.value).toFixed(4))
      : null;

  if (actual.state === "VALID") {
    return {
      actual,
      estimated,
      value: actual.value,
      provenance: "ACTUAL",
      estimationMethod: "NOT_ESTIMATED",
      advisory: false,
      divergence,
    };
  }

  if (policy.allowEstimatedFallback && estimated.state === "VALID") {
    return {
      actual,
      estimated,
      value: estimated.value,
      provenance: "ESTIMATED",
      estimationMethod: "UNKNOWN_PROVIDER_METHOD",
      advisory: true,
      divergence,
    };
  }

  return {
    actual,
    estimated,
    value: null,
    provenance: "NONE",
    estimationMethod: estimated.state === "VALID" ? "UNKNOWN_PROVIDER_METHOD" : "NOT_ESTIMATED",
    advisory: false,
    divergence,
  };
}

export interface MeasurementSourceFields {
  readonly shapeRaw?: unknown;
  readonly colorRaw?: unknown;
  readonly clarityRaw?: unknown;
  readonly weightRaw?: unknown;
  readonly labNameRaw?: unknown;
  readonly cutRaw?: unknown;
  readonly polishRaw?: unknown;
  readonly symmetryRaw?: unknown;
  readonly fluorescenceRaw?: unknown;
  readonly tableRaw?: unknown;
  readonly depthRaw?: unknown;
  readonly ratioRaw?: unknown;
  readonly toneRaw?: unknown;
  readonly fancyColorRaw?: unknown;
  readonly estimatedShapeId?: unknown;
  readonly estimatedColorId?: unknown;
  readonly estimatedClarityId?: unknown;
  readonly estimatedWeightRaw?: unknown;
}

export interface MeasurementSet {
  readonly shape: ResolvedTextAttribute;
  readonly color: ResolvedTextAttribute;
  readonly clarity: ResolvedTextAttribute;
  readonly weight: ResolvedWeightAttribute;
  readonly actualOnly: Readonly<Record<ActualOnlyAttribute, string | null>>;
  readonly containsEstimatedValues: boolean;
  readonly missingAttributes: readonly string[];
  readonly profileSimulated: boolean;
}

export function resolveMeasurements(
  fields: MeasurementSourceFields,
  profile: MeasurementProfile,
  policy: ResolutionPolicy = STRICT_ACTUAL_ONLY,
): MeasurementSet {
  const shape = resolveTextAttribute(fields.shapeRaw, fields.estimatedShapeId, policy);
  const color = resolveTextAttribute(fields.colorRaw, fields.estimatedColorId, policy);
  const clarity = resolveTextAttribute(fields.clarityRaw, fields.estimatedClarityId, policy);
  const weight = resolveWeightAttribute(fields.weightRaw, fields.estimatedWeightRaw, policy);

  const actualOnly = {
    labName: presentText(fields.labNameRaw),
    cut: presentText(fields.cutRaw),
    polish: presentText(fields.polishRaw),
    symmetry: presentText(fields.symmetryRaw),
    fluorescence: presentText(fields.fluorescenceRaw),
    tableValue: presentText(fields.tableRaw),
    depth: presentText(fields.depthRaw),
    ratio: presentText(fields.ratioRaw),
    tone: presentText(fields.toneRaw),
    fancyColor: presentText(fields.fancyColorRaw),
  } satisfies Record<ActualOnlyAttribute, string | null>;

  const missingAttributes: string[] = [];
  if (shape.value === null) missingAttributes.push("shape");
  if (color.value === null) missingAttributes.push("color");
  if (clarity.value === null) missingAttributes.push("clarity");
  if (weight.value === null) missingAttributes.push("weight");
  for (const key of ACTUAL_ONLY_ATTRIBUTES) {
    if (actualOnly[key] === null) missingAttributes.push(key);
  }

  return {
    shape,
    color,
    clarity,
    weight,
    actualOnly,
    containsEstimatedValues:
      shape.provenance === "ESTIMATED" ||
      color.provenance === "ESTIMATED" ||
      clarity.provenance === "ESTIMATED" ||
      weight.provenance === "ESTIMATED",
    missingAttributes,
    profileSimulated: profile.simulated,
  };
}

export function countsTowardConfirmedShortage(measurements: MeasurementSet): boolean {
  return !measurements.containsEstimatedValues;
}

export function measurementProvenanceSummary(measurements: MeasurementSet): string {
  return [
    `shape:${measurements.shape.provenance}`,
    `color:${measurements.color.provenance}`,
    `clarity:${measurements.clarity.provenance}`,
    `weight:${measurements.weight.provenance}`,
  ].join(",");
}
