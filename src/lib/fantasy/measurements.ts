/**
 * ACTUAL VERSUS ESTIMATED MEASUREMENT SEPARATION.
 *
 * The Fantasy row carries two parallel descriptions of the same stone. One is measured:
 * `Shape`, `Color`, `Clarity`, `Weight`, `Lab Name`, `Cut`, `Polish`, `Symm`, `Fluo.`,
 * `Table`, `Depth`, `Ratio`, `Tone`, `Fancy Color`. The other is predicted, and arrives
 * as opaque provider identifiers: `Est. Shape ID`, `Est. Color ID`, `Est. Clarity ID`,
 * `Est. Weight`.
 *
 * Merging the two would be the most damaging thing this pipeline could do, because once
 * written the result is indistinguishable from a real grading. So they are never merged.
 * They occupy separate fields, they resolve separately, and every attribute reports
 * which of the two — if either — it actually has. A missing measurement stays missing;
 * an estimate does not step into the gap.
 *
 * What is NOT confirmed, and therefore not implemented: what any `Est. * ID` integer
 * refers to, which grading scale `Color`, `Clarity`, `Cut`, `Polish`, `Symm`, `Fluo.` or
 * `Tone` use, whether `Fancy Color` overrides `Color`, and whether `Est. Weight` shares a
 * unit with `Weight`. No lookup table is invented here; an estimated identifier stays a
 * provider identifier until the client supplies an approved mapping.
 *
 * Server-only.
 */

import {
  parseSourceNumeric,
  type MeasurementProfile,
  type ParsedNumeric,
} from "@/lib/fantasy/quantity-weight";

if (typeof window !== "undefined") {
  throw new Error("fantasy/measurements is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Where an attribute's usable value came from.
 *
 * `ESTIMATED` is reachable only when a caller explicitly opts in; nothing in this module
 * ever promotes an estimate on its own.
 */
export const VALUE_PROVENANCES = ["ACTUAL", "ESTIMATED", "NONE"] as const;
export type ValueProvenance = (typeof VALUE_PROVENANCES)[number];

/**
 * How an estimated value was produced. `UNKNOWN_PROVIDER_METHOD` is the only honest
 * answer today: Fantasy supplies the estimate but not the method behind it, and this
 * application computes no estimates of its own.
 */
export const ESTIMATION_METHODS = ["UNKNOWN_PROVIDER_METHOD", "NOT_ESTIMATED"] as const;
export type EstimationMethod = (typeof ESTIMATION_METHODS)[number];

/** State of an estimated identifier, whose meaning depends on a lookup that may not exist. */
export const ESTIMATED_ID_STATES = [
  "PRESENT_UNRESOLVED",
  "RESOLVED",
  "LOOKUP_NOT_CONFIGURED",
  "ABSENT",
  "INVALID",
] as const;
export type EstimatedIdState = (typeof ESTIMATED_ID_STATES)[number];

/** Attributes that exist in both a measured and a predicted form. */
export const DUAL_SOURCE_ATTRIBUTES = ["shape", "color", "clarity", "weight"] as const;
export type DualSourceAttribute = (typeof DUAL_SOURCE_ATTRIBUTES)[number];

/** Attributes the source only ever supplies as measurements. */
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

// ---------------------------------------------------------------------------
// Resolution policy
// ---------------------------------------------------------------------------

/**
 * Whether estimated values may be surfaced as usable at all.
 *
 * The default everywhere is `false`. A caller that sets it must be a context where an
 * advisory value is acceptable and labelled — never a stock figure, a shortage figure or
 * an approval.
 */
export interface ResolutionPolicy {
  /** Allow an estimate to fill an empty attribute, marked advisory. Default false. */
  readonly allowEstimatedFallback: boolean;
  /** An approved provider-id to grade lookup. Absent means estimates stay unresolved. */
  readonly estimatedIdLookup?: ReadonlyMap<string, string>;
}

export const STRICT_ACTUAL_ONLY: ResolutionPolicy = { allowEstimatedFallback: false };

// ---------------------------------------------------------------------------
// Attribute resolution
// ---------------------------------------------------------------------------

export interface ResolvedTextAttribute {
  /** The measured value, preserved exactly as the source supplied it. */
  readonly actual: string | null;
  /** The provider's estimated identifier, never interpreted as a grade. */
  readonly estimatedId: string | null;
  readonly estimatedIdState: EstimatedIdState;
  /** The value a consumer may use, and where it came from. */
  readonly value: string | null;
  readonly provenance: ValueProvenance;
  readonly estimationMethod: EstimationMethod;
  /** True when the usable value is an estimate, so consumers must treat it as advisory. */
  readonly advisory: boolean;
}

export interface ResolvedWeightAttribute {
  readonly actual: ParsedNumeric;
  readonly estimated: ParsedNumeric;
  readonly value: number | null;
  readonly provenance: ValueProvenance;
  readonly estimationMethod: EstimationMethod;
  readonly advisory: boolean;
  /** Difference between the two raw numbers when both parse. Never a correction. */
  readonly divergence: number | null;
}

/** Trim only. No case folding and no alias expansion: the grading scale is unconfirmed. */
function presentText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Reads an estimated identifier as an opaque token.
 *
 * Deliberately not parsed into a grade or looked up against anything by default. Until
 * the client confirms what these identifiers reference, converting one into a grade
 * would be fabricating a measurement.
 */
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

/**
 * Resolves one dual-source text attribute.
 *
 * A measured value always wins. Where there is none the result is `NONE` unless the
 * caller opted into estimated fallback *and* an approved lookup resolved the identifier.
 * An unresolved provider identifier is never presented as a grade.
 */
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
      // No approved lookup, or the identifier is absent from it. Report, never guess.
      estimatedIdState = "LOOKUP_NOT_CONFIGURED";
    } else {
      estimatedIdState = "RESOLVED";
      resolvedEstimate = mapped;
    }
  }

  if (actual !== null) {
    // An estimate never overwrites, adjusts or corroborates a measured value.
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

/**
 * Resolves weight, where both sides are numeric but their units are separately
 * unconfirmed.
 *
 * `Est. Weight` is not assumed to share a unit with `Weight`, so the divergence below is
 * reported as a difference between two raw numbers for review — never as a correction,
 * and never as grounds for replacing the measured value.
 */
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

// ---------------------------------------------------------------------------
// Whole-record measurement set
// ---------------------------------------------------------------------------

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
  /** Measured-only attributes, preserved verbatim and never estimated. */
  readonly actualOnly: Readonly<Record<ActualOnlyAttribute, string | null>>;
  /** True when any attribute's usable value is an estimate. */
  readonly containsEstimatedValues: boolean;
  /** Attributes with neither a measurement nor a usable estimate. */
  readonly missingAttributes: readonly string[];
  readonly profileSimulated: boolean;
}

/**
 * Resolves a whole row's measurements under one policy.
 *
 * Every attribute keeps its own provenance, so a consumer can tell a graded stone from
 * one described entirely by prediction without inspecting the raw row.
 */
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

// ---------------------------------------------------------------------------
// Shortage protection
// ---------------------------------------------------------------------------

/**
 * Whether a record may be counted against confirmed physical shortage.
 *
 * Estimated attributes are excluded by default. A predicted shape or weight reducing a
 * confirmed shortage would let a forecast quietly cancel a real procurement need, so
 * only measured values count unless a caller deliberately asks for the advisory view.
 */
export function countsTowardConfirmedShortage(measurements: MeasurementSet): boolean {
  return !measurements.containsEstimatedValues;
}

/** Compact provenance summary for persistence and diagnostics. Codes only. */
export function measurementProvenanceSummary(measurements: MeasurementSet): string {
  return [
    `shape:${measurements.shape.provenance}`,
    `color:${measurements.color.provenance}`,
    `clarity:${measurements.clarity.provenance}`,
    `weight:${measurements.weight.provenance}`,
  ].join(",");
}
