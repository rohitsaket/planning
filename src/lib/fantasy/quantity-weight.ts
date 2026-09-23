/**
 * QUANTITY AND WEIGHT SAFETY — strict, typed interpretation of Fantasy numerics.
 *
 * None of the following is confirmed by the client: what one Fantasy row represents,
 * whether `Qty` is a piece count, what unit any weight column is in, how `Weight`,
 * `Avg Weight`, `Est. Weight`, `Original Weight` and `Tot.Dia.Wgt` relate to each other,
 * what `Size`, `M1`, `M2` and `M3` mean, or how `Metal Wgt` differs from `Met.Wgt`.
 *
 * So this module parses and preserves; it does not interpret. Every field stays separate,
 * a value that cannot be parsed stays invalid rather than becoming zero, and a weight
 * without a configured unit profile cannot enter a weight band or a calculation. The
 * honest answer to "how many carats is this" is currently `UNIT_NOT_CONFIGURED`.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("fantasy/quantity-weight is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Numeric parsing
// ---------------------------------------------------------------------------

/** Why a value is not usable. Fixed codes; never free text and never the value itself. */
export const NUMERIC_REJECTION_CODES = [
  "MISSING",
  "NOT_NUMERIC",
  "NOT_FINITE",
  "NEGATIVE",
  "TOO_MANY_DECIMALS",
  "EXCEEDS_RANGE",
] as const;
export type NumericRejectionCode = (typeof NUMERIC_REJECTION_CODES)[number];

export type NumericState = "VALID" | "MISSING" | "INVALID";

export interface ParsedNumeric {
  readonly state: NumericState;
  /** Only ever set when state is VALID. Never a substituted zero. */
  readonly value: number | null;
  readonly reason: NumericRejectionCode | null;
  /** True when the source supplied a genuine, permitted zero. */
  readonly isExplicitZero: boolean;
}

const MISSING: ParsedNumeric = { state: "MISSING", value: null, reason: "MISSING", isExplicitZero: false };

function invalid(reason: NumericRejectionCode): ParsedNumeric {
  return { state: "INVALID", value: null, reason, isExplicitZero: false };
}

export interface NumericParseOptions {
  /** Reject values below zero. Physical weights and counts cannot be negative. */
  readonly allowNegative?: boolean;
  /** Whether zero is a meaningful value for this field, or a rejection. */
  readonly allowZero?: boolean;
  /** Maximum decimal places the source is permitted to supply. */
  readonly maxDecimals?: number;
  /** Absolute ceiling, to catch a field that is plainly not what it claims to be. */
  readonly maxValue?: number;
}

/**
 * Parses one source numeric.
 *
 * Missing, non-numeric, non-finite, negative and over-precise values are each reported
 * with their own code. Nothing is coerced: an unparseable value never becomes zero, and
 * an absent value never becomes zero either — the two are separate states because
 * "no reading" and "a reading of nothing" are different facts.
 */
export function parseSourceNumeric(raw: unknown, options: NumericParseOptions = {}): ParsedNumeric {
  const { allowNegative = false, allowZero = true, maxDecimals = 6, maxValue = 1_000_000_000 } = options;

  if (raw === null || raw === undefined) return MISSING;
  if (typeof raw === "boolean") return invalid("NOT_NUMERIC");

  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return invalid("NOT_FINITE");
    text = String(raw);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return MISSING;
    // Deliberately strict: no thousands separators, no currency, no units, no ranges.
    // A value this pattern rejects is reported, never cleaned up into something else.
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return invalid("NOT_NUMERIC");
    text = trimmed;
  } else {
    return invalid("NOT_NUMERIC");
  }

  const value = Number(text);
  if (!Number.isFinite(value)) return invalid("NOT_FINITE");
  if (value < 0 && !allowNegative) return invalid("NEGATIVE");
  if (Math.abs(value) > maxValue) return invalid("EXCEEDS_RANGE");

  const decimals = text.includes(".") ? text.split(".")[1].length : 0;
  if (decimals > maxDecimals) return invalid("TOO_MANY_DECIMALS");

  const isZero = value === 0;
  if (isZero && !allowZero) return invalid("NOT_NUMERIC");

  return { state: "VALID", value, reason: null, isExplicitZero: isZero };
}

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

/**
 * What `Qty` is permitted to mean.
 *
 * `NOT_CONFIGURED` is the only honest answer today: row granularity is unconfirmed, so
 * whether a row is a lot, a stone, a document line or an allocation event — and
 * therefore whether `Qty` is a piece count at all — is not known.
 */
export type QuantitySemantics = "NOT_CONFIGURED" | "PIECE_COUNT";

export const QUANTITY_STATES = [
  "USABLE",
  "SEMANTICS_NOT_CONFIGURED",
  "UNSUPPORTED_VALUE",
  "INVALID",
  "MISSING",
] as const;
export type QuantityState = (typeof QUANTITY_STATES)[number];

export interface QuantityInterpretation {
  readonly state: QuantityState;
  /** The parsed number, preserved regardless of whether it may be used. */
  readonly rawValue: number | null;
  /** Only set when the state is USABLE and the semantics are configured. */
  readonly pieces: number | null;
  readonly reason: string | null;
  readonly semantics: QuantitySemantics;
}

/**
 * The only quantity a simulation profile is allowed to treat as one piece.
 *
 * The fixture pipeline models one row as one stone, and its own records carry
 * `quantity = 1`. Nothing else may be assumed, so any other value is unsupported rather
 * than multiplied out.
 */
export const SIMULATION_SUPPORTED_QUANTITY = 1;

export interface QuantityContext {
  readonly semantics: QuantitySemantics;
  /** True only for fixture simulation. Live data never takes the simulation path. */
  readonly simulated: boolean;
}

/**
 * Interprets `Qty`.
 *
 * Refuses to assume a row equals one piece, refuses to treat `Qty` as a count until the
 * client confirms it is one, and never multiplies or divides a weight by it.
 */
export function interpretQuantity(raw: unknown, ctx: QuantityContext): QuantityInterpretation {
  const parsed = parseSourceNumeric(raw, { allowNegative: false, allowZero: true, maxDecimals: 3 });

  if (parsed.state === "MISSING") {
    return { state: "MISSING", rawValue: null, pieces: null, reason: "MISSING", semantics: ctx.semantics };
  }
  if (parsed.state === "INVALID") {
    return { state: "INVALID", rawValue: null, pieces: null, reason: parsed.reason, semantics: ctx.semantics };
  }

  if (ctx.semantics !== "PIECE_COUNT") {
    // Parsed and preserved, but not usable: what the number counts is unconfirmed.
    return {
      state: "SEMANTICS_NOT_CONFIGURED",
      rawValue: parsed.value,
      pieces: null,
      reason: "QUANTITY_SEMANTICS_NOT_CONFIGURED",
      semantics: ctx.semantics,
    };
  }

  // Even with semantics configured, a simulation profile only supports the one value its
  // own fixtures produce. Anything else is a structure this build cannot interpret.
  if (ctx.simulated && parsed.value !== SIMULATION_SUPPORTED_QUANTITY) {
    return {
      state: "UNSUPPORTED_VALUE",
      rawValue: parsed.value,
      pieces: null,
      reason: "QUANTITY_VALUE_UNSUPPORTED",
      semantics: ctx.semantics,
    };
  }

  if (!Number.isInteger(parsed.value)) {
    return {
      state: "UNSUPPORTED_VALUE",
      rawValue: parsed.value,
      pieces: null,
      reason: "QUANTITY_NOT_WHOLE",
      semantics: ctx.semantics,
    };
  }

  return { state: "USABLE", rawValue: parsed.value, pieces: parsed.value, reason: null, semantics: ctx.semantics };
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

/**
 * Every weight-like column, kept apart.
 *
 * They are listed separately on purpose: `Metal Wgt` and `Met.Wgt` are two different
 * source fields with similar names, and `Weight`, `Avg Weight`, `Original Weight` and
 * `Tot.Dia.Wgt` have no confirmed relationship to one another.
 */
export const WEIGHT_FIELDS = [
  "weightRaw",
  "averageWeightRaw",
  "estimatedWeightRaw",
  "originalWeightRaw",
  "totalDiamondWeightRaw",
  "metalWeightRaw",
  "metWeightRaw",
] as const;
export type WeightField = (typeof WEIGHT_FIELDS)[number];

/** Dimension-like columns whose meaning is entirely unconfirmed. */
export const UNCONFIRMED_DIMENSION_FIELDS = ["sizeRaw", "m1Raw", "m2Raw", "m3Raw"] as const;

export type WeightUnit = "UNIT_NOT_CONFIGURED" | "CARAT";

export const WEIGHT_STATES = ["USABLE", "UNIT_NOT_CONFIGURED", "INVALID", "MISSING"] as const;
export type WeightState = (typeof WEIGHT_STATES)[number];

export interface WeightInterpretation {
  readonly state: WeightState;
  /** The parsed number, preserved whatever the unit situation. */
  readonly rawValue: number | null;
  /** Only set when a unit profile is configured and the value parsed. */
  readonly carats: number | null;
  readonly unit: WeightUnit;
  readonly reason: string | null;
}

export interface WeightContext {
  readonly unit: WeightUnit;
  readonly simulated: boolean;
}

/**
 * Interprets one weight column.
 *
 * Without a configured unit profile the value is preserved and reported as
 * `UNIT_NOT_CONFIGURED`; it cannot enter a weight band, a demand category or a stock
 * calculation. There is deliberately no default unit shared between fixture and live.
 */
export function interpretWeight(raw: unknown, ctx: WeightContext): WeightInterpretation {
  const parsed = parseSourceNumeric(raw, { allowNegative: false, allowZero: false, maxDecimals: 4 });

  if (parsed.state === "MISSING") {
    return { state: "MISSING", rawValue: null, carats: null, unit: ctx.unit, reason: "MISSING" };
  }
  if (parsed.state === "INVALID") {
    return { state: "INVALID", rawValue: null, carats: null, unit: ctx.unit, reason: parsed.reason };
  }
  if (ctx.unit !== "CARAT") {
    return {
      state: "UNIT_NOT_CONFIGURED",
      rawValue: parsed.value,
      carats: null,
      unit: ctx.unit,
      reason: "WEIGHT_UNIT_NOT_CONFIGURED",
    };
  }

  return { state: "USABLE", rawValue: parsed.value, carats: parsed.value, unit: "CARAT", reason: null };
}

// ---------------------------------------------------------------------------
// Jewellery and multi-stone protection
// ---------------------------------------------------------------------------

export const STRUCTURE_RISK_CODES = [
  "QUANTITY_GREATER_THAN_ONE",
  "METAL_IDENTIFIER_PRESENT",
  "METAL_WEIGHT_PRESENT",
  "ITEM_NAME_SUGGESTS_ITEM",
  "TOTAL_WEIGHT_EXCEEDS_STONE_WEIGHT",
  "MULTIPLE_WEIGHT_RELATIONSHIP_UNINTERPRETABLE",
] as const;
export type StructureRiskCode = (typeof STRUCTURE_RISK_CODES)[number];

export interface StructureAssessment {
  /** True when the row may not be a single loose stone. */
  readonly reviewRequired: boolean;
  readonly risks: readonly StructureRiskCode[];
}

export interface StructureInput {
  readonly quantity: QuantityInterpretation;
  readonly metalId?: unknown;
  readonly metalWeight?: unknown;
  readonly metWeight?: unknown;
  readonly itemName?: unknown;
  readonly weight?: unknown;
  readonly totalDiamondWeight?: unknown;
}

function hasValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim() !== "";
  return true;
}

/**
 * Flags a row that may be jewellery or a multi-stone item rather than a loose stone.
 *
 * Whether the feed contains jewellery at all is unconfirmed, so this never classifies —
 * it only marks a row for review so loose-stone logic cannot silently consume it. Each
 * indicator is reported on its own; none is combined into a score.
 */
export function assessStructureRisk(input: StructureInput): StructureAssessment {
  const risks: StructureRiskCode[] = [];

  if (input.quantity.rawValue !== null && input.quantity.rawValue > 1) {
    risks.push("QUANTITY_GREATER_THAN_ONE");
  }
  if (hasValue(input.metalId)) risks.push("METAL_IDENTIFIER_PRESENT");
  if (hasValue(input.metalWeight) || hasValue(input.metWeight)) risks.push("METAL_WEIGHT_PRESENT");

  // A name is only an indicator, never a determination: the vocabulary is unconfirmed.
  if (typeof input.itemName === "string" && input.itemName.trim() !== "") {
    const name = input.itemName.toUpperCase();
    if (/\b(RING|PENDANT|EARRING|BRACELET|NECKLACE|BANGLE|STUD|SET|JEWEL)\b/.test(name)) {
      risks.push("ITEM_NAME_SUGGESTS_ITEM");
    }
  }

  // Only compared when both parse. No relationship between them is assumed beyond the
  // fact that a total cannot be smaller than a part it is claimed to contain.
  const stone = parseSourceNumeric(input.weight, { allowZero: false, maxDecimals: 4 });
  const total = parseSourceNumeric(input.totalDiamondWeight, { allowZero: false, maxDecimals: 4 });
  if (stone.state === "VALID" && total.state === "VALID" && stone.value !== null && total.value !== null) {
    if (total.value > stone.value) risks.push("TOTAL_WEIGHT_EXCEEDS_STONE_WEIGHT");
  }

  return { reviewRequired: risks.length > 0, risks };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface MeasurementProfile {
  readonly quantitySemantics: QuantitySemantics;
  readonly weightUnit: WeightUnit;
  readonly simulated: boolean;
}

/**
 * Live measurement profile: nothing is configured.
 *
 * Row granularity and weight units are unconfirmed, so a live row's quantity and weight
 * are preserved and reported as unusable. This is what keeps unconfirmed semantics out
 * of every calculation.
 */
export const LIVE_MEASUREMENT_PROFILE: MeasurementProfile = {
  quantitySemantics: "NOT_CONFIGURED",
  weightUnit: "UNIT_NOT_CONFIGURED",
  simulated: false,
};

/**
 * Fixture measurement profile.
 *
 * The application's own fixture provider emits one stone per row with carat weights, so
 * for simulated data — and only simulated data — those semantics are known. It shares no
 * default with the live profile: the two are separate constants precisely so a live row
 * can never inherit a fixture assumption.
 */
export const FIXTURE_MEASUREMENT_PROFILE: MeasurementProfile = {
  quantitySemantics: "PIECE_COUNT",
  weightUnit: "CARAT",
  simulated: true,
};

/** The profile a source state may use. A live source gets the unconfigured one. */
export function measurementProfileFor(simulated: boolean): MeasurementProfile {
  return simulated ? FIXTURE_MEASUREMENT_PROFILE : LIVE_MEASUREMENT_PROFILE;
}
