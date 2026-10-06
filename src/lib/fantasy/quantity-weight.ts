if (typeof window !== "undefined") {
  throw new Error("fantasy/quantity-weight is server-only and must not be imported by client code.");
}

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
  readonly value: number | null;
  readonly reason: NumericRejectionCode | null;
  readonly isExplicitZero: boolean;
}

const MISSING: ParsedNumeric = { state: "MISSING", value: null, reason: "MISSING", isExplicitZero: false };

function invalid(reason: NumericRejectionCode): ParsedNumeric {
  return { state: "INVALID", value: null, reason, isExplicitZero: false };
}

export interface NumericParseOptions {
  readonly allowNegative?: boolean;
  readonly allowZero?: boolean;
  readonly maxDecimals?: number;
  readonly maxValue?: number;
}

export function parseSourceNumeric(raw: unknown, options: NumericParseOptions = {}): ParsedNumeric {
  const { allowNegative = false, allowZero = true, maxDecimals = 6, maxValue = 1_000_000_000 } = options;

  if (raw === null || raw === undefined) return MISSING;
  if (typeof raw === "boolean") return invalid("NOT_NUMERIC");
  if (typeof raw === "object" && raw !== null && typeof (raw as { toString?: unknown }).toString === "function") {
    const asText = String(raw);
    if (/^-?\d+(\.\d+)?$/.test(asText)) return parseSourceNumeric(asText, options);
  }

  let text: string;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return invalid("NOT_FINITE");
    text = String(raw);
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return MISSING;
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
  readonly rawValue: number | null;
  readonly pieces: number | null;
  readonly reason: string | null;
  readonly semantics: QuantitySemantics;
}

export const SIMULATION_SUPPORTED_QUANTITY = 1;

export interface QuantityContext {
  readonly semantics: QuantitySemantics;
  readonly simulated: boolean;
}

export function interpretQuantity(raw: unknown, ctx: QuantityContext): QuantityInterpretation {
  const parsed = parseSourceNumeric(raw, { allowNegative: false, allowZero: true, maxDecimals: 3 });

  if (parsed.state === "MISSING") {
    return { state: "MISSING", rawValue: null, pieces: null, reason: "MISSING", semantics: ctx.semantics };
  }
  if (parsed.state === "INVALID") {
    return { state: "INVALID", rawValue: null, pieces: null, reason: parsed.reason, semantics: ctx.semantics };
  }

  if (ctx.semantics !== "PIECE_COUNT") {
    return {
      state: "SEMANTICS_NOT_CONFIGURED",
      rawValue: parsed.value,
      pieces: null,
      reason: "QUANTITY_SEMANTICS_NOT_CONFIGURED",
      semantics: ctx.semantics,
    };
  }

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

export const UNCONFIRMED_DIMENSION_FIELDS = ["sizeRaw", "m1Raw", "m2Raw", "m3Raw"] as const;

export type WeightUnit = "UNIT_NOT_CONFIGURED" | "CARAT";

export const WEIGHT_STATES = ["USABLE", "UNIT_NOT_CONFIGURED", "INVALID", "MISSING"] as const;
export type WeightState = (typeof WEIGHT_STATES)[number];

export interface WeightInterpretation {
  readonly state: WeightState;
  readonly rawValue: number | null;
  readonly carats: number | null;
  readonly unit: WeightUnit;
  readonly reason: string | null;
}

export interface WeightContext {
  readonly unit: WeightUnit;
  readonly simulated: boolean;
}

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

export function assessStructureRisk(input: StructureInput): StructureAssessment {
  const risks: StructureRiskCode[] = [];

  if (input.quantity.rawValue !== null && input.quantity.rawValue > 1) {
    risks.push("QUANTITY_GREATER_THAN_ONE");
  }
  if (hasValue(input.metalId)) risks.push("METAL_IDENTIFIER_PRESENT");
  if (hasValue(input.metalWeight) || hasValue(input.metWeight)) risks.push("METAL_WEIGHT_PRESENT");

  if (typeof input.itemName === "string" && input.itemName.trim() !== "") {
    const name = input.itemName.toUpperCase();
    if (/\b(RING|PENDANT|EARRING|BRACELET|NECKLACE|BANGLE|STUD|SET|JEWEL)\b/.test(name)) {
      risks.push("ITEM_NAME_SUGGESTS_ITEM");
    }
  }

  const stone = parseSourceNumeric(input.weight, { allowZero: false, maxDecimals: 4 });
  const total = parseSourceNumeric(input.totalDiamondWeight, { allowZero: false, maxDecimals: 4 });
  if (stone.state === "VALID" && total.state === "VALID" && stone.value !== null && total.value !== null) {
    if (total.value > stone.value) risks.push("TOTAL_WEIGHT_EXCEEDS_STONE_WEIGHT");
  }

  return { reviewRequired: risks.length > 0, risks };
}

export interface MeasurementProfile {
  readonly quantitySemantics: QuantitySemantics;
  readonly weightUnit: WeightUnit;
  readonly simulated: boolean;
}

export const LIVE_MEASUREMENT_PROFILE: MeasurementProfile = {
  quantitySemantics: "NOT_CONFIGURED",
  weightUnit: "UNIT_NOT_CONFIGURED",
  simulated: false,
};

export const FIXTURE_MEASUREMENT_PROFILE: MeasurementProfile = {
  quantitySemantics: "PIECE_COUNT",
  weightUnit: "CARAT",
  simulated: true,
};

export function measurementProfileFor(simulated: boolean): MeasurementProfile {
  return simulated ? FIXTURE_MEASUREMENT_PROFILE : LIVE_MEASUREMENT_PROFILE;
}

export const CANONICAL_QUANTITY_PROVENANCES = [
  "EXPLICIT_FIXTURE",
  "LIVE_CONFIRMED",
  "MISSING",
  "INVALID",
  "UNSUPPORTED",
  "LEGACY_DEFAULT_AMBIGUOUS",
  "SEMANTICS_NOT_CONFIGURED",
] as const;
export type CanonicalQuantityProvenance = (typeof CANONICAL_QUANTITY_PROVENANCES)[number];

const COUNTABLE_PROVENANCES: readonly CanonicalQuantityProvenance[] = ["EXPLICIT_FIXTURE", "LIVE_CONFIRMED"];

export function isCountableQuantity(provenance: CanonicalQuantityProvenance): boolean {
  return COUNTABLE_PROVENANCES.includes(provenance);
}

export interface CanonicalQuantityDecision {
  readonly provenance: CanonicalQuantityProvenance;
  readonly pieces: number | null;
  readonly rawValue: number | null;
  readonly reviewCode: CanonicalQuantityProvenance | null;
}

export interface StoredQuantityInput {
  readonly quantity: unknown;
  readonly sourceType: string | null;
  readonly isSimulated: boolean;
  readonly quantityProvenance?: string | null;
}

export function resolveCanonicalQuantity(input: StoredQuantityInput): CanonicalQuantityDecision {
  const stored = input.quantityProvenance;

  if (stored && (CANONICAL_QUANTITY_PROVENANCES as readonly string[]).includes(stored)) {
    const provenance = stored as CanonicalQuantityProvenance;
    if (!isCountableQuantity(provenance)) {
      const parsed = parseSourceNumeric(input.quantity, { allowNegative: false, allowZero: true, maxDecimals: 3 });
      return { provenance, pieces: null, rawValue: parsed.value, reviewCode: provenance };
    }
    const parsed = parseSourceNumeric(input.quantity, { allowNegative: false, allowZero: false, maxDecimals: 0 });
    return parsed.state === "VALID" && parsed.value !== null && Number.isInteger(parsed.value)
      ? { provenance, pieces: parsed.value, rawValue: parsed.value, reviewCode: null }
      : { provenance: "INVALID", pieces: null, rawValue: parsed.value, reviewCode: "INVALID" };
  }

  const simulated = input.sourceType === "FIXTURE" && input.isSimulated;
  const profile = measurementProfileFor(simulated);
  const interpreted = interpretQuantity(input.quantity, {
    semantics: profile.quantitySemantics,
    simulated: false,
  });

  switch (interpreted.state) {
    case "USABLE":
      if (interpreted.pieces === 0) {
        return { provenance: "UNSUPPORTED", pieces: null, rawValue: 0, reviewCode: "UNSUPPORTED" };
      }
      return {
        provenance: simulated ? "EXPLICIT_FIXTURE" : "LIVE_CONFIRMED",
        pieces: interpreted.pieces,
        rawValue: interpreted.rawValue,
        reviewCode: null,
      };
    case "MISSING":
      return { provenance: "MISSING", pieces: null, rawValue: null, reviewCode: "MISSING" };
    case "INVALID":
      return { provenance: "INVALID", pieces: null, rawValue: null, reviewCode: "INVALID" };
    case "UNSUPPORTED_VALUE":
      return { provenance: "UNSUPPORTED", pieces: null, rawValue: interpreted.rawValue, reviewCode: "UNSUPPORTED" };
    default:
      return {
        provenance: "SEMANTICS_NOT_CONFIGURED",
        pieces: null,
        rawValue: interpreted.rawValue,
        reviewCode: "SEMANTICS_NOT_CONFIGURED",
      };
  }
}

export const QUANTITY_REVIEW_REASONS: Record<CanonicalQuantityProvenance, string> = {
  EXPLICIT_FIXTURE: "Quantity supplied by the simulation source.",
  LIVE_CONFIRMED: "Quantity supplied by the source under a confirmed contract.",
  MISSING: "The source supplied no quantity for this record, so its pieces are not counted.",
  INVALID: "The quantity supplied for this record could not be read, so its pieces are not counted.",
  UNSUPPORTED: "The quantity supplied for this record is not a whole number of pieces, so it is not counted.",
  LEGACY_DEFAULT_AMBIGUOUS:
    "This record was created before quantities were recorded with their source, so its pieces are not counted.",
  SEMANTICS_NOT_CONFIGURED:
    "The meaning of this source quantity has not been confirmed, so its pieces are not counted.",
};

export interface CanonicalWeightDecision {
  readonly carats: number | null;
  readonly state: WeightState;
  readonly rawValue: number | null;
  readonly reviewCode: string | null;
}

export function resolveCanonicalWeight(input: {
  weight: unknown;
  sourceType: string | null;
  isSimulated: boolean;
}): CanonicalWeightDecision {
  const profile = measurementProfileFor(input.sourceType === "FIXTURE" && input.isSimulated);
  const interpreted = interpretWeight(input.weight, { unit: profile.weightUnit, simulated: profile.simulated });
  return {
    carats: interpreted.carats,
    state: interpreted.state,
    rawValue: interpreted.rawValue,
    reviewCode: interpreted.state === "USABLE" ? null : interpreted.reason,
  };
}

export const WEIGHT_REVIEW_REASONS: Record<Exclude<WeightState, "USABLE">, string> = {
  UNIT_NOT_CONFIGURED:
    "The unit of this source weight has not been confirmed, so a weight band cannot be assigned.",
  INVALID: "The weight supplied for this record could not be read, so a weight band cannot be assigned.",
  MISSING: "The source supplied no weight for this record, so a weight band cannot be assigned.",
};
