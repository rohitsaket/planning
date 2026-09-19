// ============================================================================
// CORE DOMAIN: WEIGHT BANDS, LAB NORMALIZATION, SHAPE MAPPING
// Single authoritative implementation of confirmed business rules.
// ============================================================================

export interface WeightBandDef {
  code: string;
  label: string;
  minCt: number;
  maxCt: number;
  sortOrder: number;
}

// Confirmed analytical weight bands (starts at 1.00 ct).
// Inclusive lower bound, inclusive upper bound, no gaps for in-scope values.
export const CONFIRMED_WEIGHT_BANDS: WeightBandDef[] = [
  { code: "WB_1.00_1.09", label: "1.00-1.09", minCt: 1.0, maxCt: 1.09, sortOrder: 1 },
  { code: "WB_1.10_1.49", label: "1.10-1.49", minCt: 1.1, maxCt: 1.49, sortOrder: 2 },
  { code: "WB_1.50_1.59", label: "1.50-1.59", minCt: 1.5, maxCt: 1.59, sortOrder: 3 },
  { code: "WB_1.60_1.69", label: "1.60-1.69", minCt: 1.6, maxCt: 1.69, sortOrder: 4 },
  { code: "WB_1.70_1.99", label: "1.70-1.99", minCt: 1.7, maxCt: 1.99, sortOrder: 5 },
  { code: "WB_2.00_2.09", label: "2.00-2.09", minCt: 2.0, maxCt: 2.09, sortOrder: 6 },
  { code: "WB_2.10_2.49", label: "2.10-2.49", minCt: 2.1, maxCt: 2.49, sortOrder: 7 },
  { code: "WB_2.50_2.59", label: "2.50-2.59", minCt: 2.5, maxCt: 2.59, sortOrder: 8 },
  { code: "WB_2.60_2.99", label: "2.60-2.99", minCt: 2.6, maxCt: 2.99, sortOrder: 9 },
  { code: "WB_3.00_3.09", label: "3.00-3.09", minCt: 3.0, maxCt: 3.09, sortOrder: 10 },
  { code: "WB_3.10_3.49", label: "3.10-3.49", minCt: 3.1, maxCt: 3.49, sortOrder: 11 },
  { code: "WB_3.50_3.99", label: "3.50-3.99", minCt: 3.5, maxCt: 3.99, sortOrder: 12 },
  { code: "WB_4.00_4.09", label: "4.00-4.09", minCt: 4.0, maxCt: 4.09, sortOrder: 13 },
  { code: "WB_4.10_4.49", label: "4.10-4.49", minCt: 4.1, maxCt: 4.49, sortOrder: 14 },
  { code: "WB_4.50_4.99", label: "4.50-4.99", minCt: 4.5, maxCt: 4.99, sortOrder: 15 },
  { code: "WB_5.00_5.99", label: "5.00-5.99", minCt: 5.0, maxCt: 5.99, sortOrder: 16 },
  { code: "WB_6.00_6.99", label: "6.00-6.99", minCt: 6.0, maxCt: 6.99, sortOrder: 17 },
  { code: "WB_7.00_7.99", label: "7.00-7.99", minCt: 7.0, maxCt: 7.99, sortOrder: 18 },
  { code: "WB_8.00_8.99", label: "8.00-8.99", minCt: 8.0, maxCt: 8.99, sortOrder: 19 },
  { code: "WB_9.00_9.99", label: "9.00-9.99", minCt: 9.0, maxCt: 9.99, sortOrder: 20 },
  { code: "WB_10.00_14.99", label: "10.00-14.99", minCt: 10.0, maxCt: 14.99, sortOrder: 21 },
  { code: "WB_15.00_19.99", label: "15.00-19.99", minCt: 15.0, maxCt: 19.99, sortOrder: 22 },
  { code: "WB_20.00_24.99", label: "20.00-24.99", minCt: 20.0, maxCt: 24.99, sortOrder: 23 },
  { code: "WB_25_PLUS", label: "25+", minCt: 25.0, maxCt: 999999, sortOrder: 24 },
];

/**
 * Decimal-safe weight-band lookup. Uses scaled integers (carats * 1000) to
 * avoid floating-point boundary bugs.
 */
export function classifyWeightBand(weightCt: number | string | null | undefined): WeightBandDef | null {
  if (weightCt === null || weightCt === undefined) return null;
  const w = typeof weightCt === "string" ? parseFloat(weightCt) : weightCt;
  if (!Number.isFinite(w)) return null;
  const scaled = Math.round(w * 1000);
  for (const band of CONFIRMED_WEIGHT_BANDS) {
    const minScaled = Math.round(band.minCt * 1000);
    const maxScaled = Math.round(band.maxCt * 1000);
    if (scaled >= minScaled && scaled <= maxScaled) return band;
  }
  return null;
}

// ---------------------------------------------------------------------------
// LAB NORMALIZATION
// ---------------------------------------------------------------------------
export const CONFIRMED_LAB_MAPPINGS: { raw: string; normalized: string }[] = [
  { raw: "GIA", normalized: "GIA" },
  { raw: "GIA-Premium", normalized: "GIA" },
  { raw: "GIA-Standard", normalized: "GIA" },
  { raw: "", normalized: "Non-Cert" },
];

export function normalizeLab(rawLab: string | null | undefined): { normalized: string; known: boolean } {
  if (rawLab === null || rawLab === undefined || rawLab.trim() === "") {
    return { normalized: "Non-Cert", known: true };
  }
  const trimmed = rawLab.trim();
  const confirmed = CONFIRMED_LAB_MAPPINGS.find(
    (m) => m.raw.toLowerCase() === trimmed.toLowerCase()
  );
  if (confirmed) return { normalized: confirmed.normalized, known: true };
  return { normalized: trimmed, known: false };
}

// ---------------------------------------------------------------------------
// SHAPE NORMALIZATION
// ---------------------------------------------------------------------------
export const CONFIRMED_SHAPE_MAPPINGS: { raw: string; normalized: string }[] = [
  { raw: "ROUND", normalized: "Round" },
  { raw: "OLD ROUND", normalized: "Old European Brilliant" },
  { raw: "LIYO MQ", normalized: "Marquise" },
  { raw: "MQ_21", normalized: "Antique Marquise" },
  { raw: "LeoPear11", normalized: "Pear" },
  { raw: "LeoOval22", normalized: "Oval" },
  { raw: "KRISS 3-STEP", normalized: "Radiant Modified" },
  { raw: "RAD4(1)", normalized: "Radiant" },
  { raw: "SQ.BE.CUS", normalized: "Square Cushion Brilliant" },
  { raw: "SQ_CU", normalized: "Square Cushion Modified" },
  { raw: "BE.CU.LONG", normalized: "Cushion Brilliant" },
  { raw: "CU.LONG", normalized: "Cushion Modified" },
  { raw: "SQ.ANTIK.CUS", normalized: "Square Antique Cushion" },
  { raw: "ANTIK-CU-LONG", normalized: "Antique Cushion" },
  { raw: "BEZEL PRINCESS", normalized: "Princess" },
  { raw: "S.HEART", normalized: "Heart" },
  { raw: "KRISS OVAL", normalized: "KRISS OVAL" },
  { raw: "STEP MQ", normalized: "Step Marquise" },
  { raw: "ANT-OVAL", normalized: "Antique Oval" },
  { raw: "Moval", normalized: "Moval" },
  { raw: "FABRIZIO", normalized: "Febrizio" },
  { raw: "LOZENGES-2", normalized: "Lozenge Step Cut" },
  { raw: "Kite_V2", normalized: "Kite" },
  { raw: "TREGAL(1)", normalized: "Triangle" },
  { raw: "CAD", normalized: "Cadillacs" },
  { raw: "TAPERED-BG-LW", normalized: "Trapper Baguette" },
  { raw: "TRAP50", normalized: "Trapezoid" },
  { raw: "BE-TRA", normalized: "BRILLANT TRAPEZOID" },
  { raw: "HALF_MOON", normalized: "Moon Half" },
  { raw: "BAGUETTE-LW", normalized: "Baguette" },
];

export function normalizeShape(rawShape: string | null | undefined): { normalized: string; known: boolean } {
  if (!rawShape || rawShape.trim() === "") return { normalized: "", known: false };
  const trimmed = rawShape.trim();
  const match = CONFIRMED_SHAPE_MAPPINGS.find(
    (m) => m.raw.toLowerCase() === trimmed.toLowerCase()
  );
  if (match) return { normalized: match.normalized, known: true };
  return { normalized: trimmed, known: false };
}

// ---------------------------------------------------------------------------
// EMERALD 5STEP
// ---------------------------------------------------------------------------
export function resolveEmerald5Step(ratio: number | null | undefined): {
  shape: string;
  valid: boolean;
  issue?: string;
} {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return { shape: "EMERALD 5STEP", valid: false, issue: "Ratio missing or non-numeric" };
  }
  if (ratio < 1.0) {
    return { shape: "EMERALD 5STEP", valid: false, issue: "Ratio below 1.00" };
  }
  if (ratio >= 1.0 && ratio <= 1.03) return { shape: "Asscher", valid: true };
  if (ratio >= 1.4) return { shape: "Emerald", valid: true };
  return {
    shape: "EMERALD 5STEP",
    valid: false,
    issue: "Ratio between 1.04 and 1.39 is ambiguous",
  };
}

// ---------------------------------------------------------------------------
// DEMAND CALCULATION — confirmed 90-day rule, decimal-safe rounding
// ---------------------------------------------------------------------------

/**
 * Conventional round-half-up to nearest integer.
 * 5.49 -> 5, 5.50 -> 6, 5.51 -> 6, 5.33 -> 5.
 */
export function roundHalfUpInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value + 0.5 + 1e-9);
}

export interface DemandInput {
  sales90d: number;
  availableStock: number;
  memoQty?: number;
}

export interface DemandResult {
  sales90d: number;
  monthlyAverage: number;
  unroundedTarget: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  physicalShortage: number;
  excessStock: number;
}

export function calculateDemand(input: DemandInput): DemandResult {
  const sales90d = Math.max(0, Math.floor(input.sales90d));
  const monthlyAverage = sales90d / 3;
  const unroundedTarget = monthlyAverage * 2;
  const roundedTarget = roundHalfUpInt(unroundedTarget);
  const availableStock = Math.max(0, Math.floor(input.availableStock));
  const memoQty = Math.max(0, Math.floor(input.memoQty ?? 0));
  const physicalShortage = Math.max(0, roundedTarget - availableStock);
  const excessStock = Math.max(0, availableStock - roundedTarget);
  return {
    sales90d,
    monthlyAverage,
    unroundedTarget,
    roundedTarget,
    availableStock,
    memoQty,
    physicalShortage,
    excessStock,
  };
}

// ---------------------------------------------------------------------------
// FOUR REQUIREMENT NUMBERS
// ---------------------------------------------------------------------------
export interface FourRequirementNumbers {
  physicalShortage: number;
  pipelineAdjusted: number;
  planningAdjusted: number;
  forecastRequirement: number;
  eligibleWipCoverage: number;
  approvedPlanCoverage: number;
}

export function calculateFourRequirements(params: {
  physicalShortage: number;
  eligibleWipCoverage: number;
  approvedPlanCoverage: number;
  forecastQty: number;
}): FourRequirementNumbers {
  const physicalShortage = Math.max(0, Math.floor(params.physicalShortage));
  const eligibleWipCoverage = Math.max(0, Math.floor(params.eligibleWipCoverage));
  const approvedPlanCoverage = Math.max(0, Math.floor(params.approvedPlanCoverage));
  const pipelineAdjusted = Math.max(0, physicalShortage - eligibleWipCoverage);
  const planningAdjusted = Math.max(0, pipelineAdjusted - approvedPlanCoverage);
  const forecastRequirement = Math.max(0, Math.floor(params.forecastQty));
  return {
    physicalShortage,
    pipelineAdjusted,
    planningAdjusted,
    forecastRequirement,
    eligibleWipCoverage,
    approvedPlanCoverage,
  };
}

// ---------------------------------------------------------------------------
// PLAN YIELD
// ---------------------------------------------------------------------------
export function calculatePlanYield(estWeight: number, roughWeight: number): number {
  if (!roughWeight || roughWeight <= 0) return 0;
  return (estWeight / roughWeight) * 100;
}

export function formatYield(pct: number): string {
  return pct.toFixed(2) + "%";
}

export function formatEstWeight(w: number): string {
  return w.toFixed(3);
}

// ---------------------------------------------------------------------------
// STONE NAME PARSING (Blue / White)
// ---------------------------------------------------------------------------
export interface ParsedStoneName {
  kapan: string;
  packet: string;
  signer: string;
  unresolved: string;
  stoneType: "BLUE" | "WHITE" | "UNKNOWN";
}

export function parseStoneName(rawName: string): ParsedStoneName {
  const name = rawName.trim();
  if (name.includes("_") && name.includes("+")) {
    // BLUE pattern: 670D-764_E+pv
    const kapan = name.split("-")[0] || "";
    const rest = name.slice(kapan.length + 1);
    const [packetPart, signerPart] = rest.split("+");
    const packet = (packetPart || "").split("_")[0] || "";
    const signer = signerPart || "";
    return { kapan, packet, signer, unresolved: "_E", stoneType: "BLUE" };
  }
  if (name.includes("-")) {
    // WHITE pattern: 2501-001 HA
    const [kapanPart, afterHyphen] = name.split("-");
    const kapan = kapanPart || "";
    const afterHyphenTrim = (afterHyphen || "").trim();
    const spaceIdx = afterHyphenTrim.indexOf(" ");
    const packet = spaceIdx >= 0 ? afterHyphenTrim.slice(0, spaceIdx) : afterHyphenTrim;
    const signer = spaceIdx >= 0 ? afterHyphenTrim.slice(spaceIdx + 1).trim() : "";
    return { kapan, packet, signer, unresolved: "", stoneType: "WHITE" };
  }
  return { kapan: name, packet: "", signer: "", unresolved: "", stoneType: "UNKNOWN" };
}

// ---------------------------------------------------------------------------
// TREND CLASSIFICATION
// ---------------------------------------------------------------------------
export type TrendClass =
  | "Strong Growth"
  | "Growth"
  | "Stable"
  | "Declining"
  | "Strong Decline"
  | "New Demand"
  | "Dormant"
  | "Volatile";

export function classifyTrend(prev30: number, mid30: number, latest30: number): {
  trend: TrendClass;
  pctChange: number;
} {
  if (prev30 === 0 && mid30 === 0 && latest30 === 0) {
    return { trend: "Dormant", pctChange: 0 };
  }
  if (prev30 === 0 && latest30 > 0) {
    return { trend: "New Demand", pctChange: 100 };
  }
  if (prev30 === 0 || mid30 === 0) {
    return { trend: "Volatile", pctChange: 0 };
  }
  const pct = ((latest30 - prev30) / prev30) * 100;
  if (pct >= 50) return { trend: "Strong Growth", pctChange: pct };
  if (pct >= 10) return { trend: "Growth", pctChange: pct };
  if (pct <= -50) return { trend: "Strong Decline", pctChange: pct };
  if (pct <= -10) return { trend: "Declining", pctChange: pct };
  return { trend: "Stable", pctChange: pct };
}

// ---------------------------------------------------------------------------
// STOCKOUT RISK
// ---------------------------------------------------------------------------
export type StockoutRisk = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export function classifyStockoutRisk(projected30d: number, projected90d: number): StockoutRisk {
  if (projected30d <= 0) return "CRITICAL";
  const projected60 = (projected30d + projected90d) / 2;
  if (projected60 <= 0) return "HIGH";
  if (projected90d <= 0) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// PRIORITY HELPERS
// ---------------------------------------------------------------------------
export const REQUIREMENT_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "LOW", "WATCH"] as const;
export const CUSTOMER_PRIORITIES = ["Strategic", "Key", "Standard", "New", "Internal"] as const;
export const REQUIREMENT_TYPES = [
  "STOCK_REPLENISHMENT",
  "CUSTOMER_ORDER",
  "BACKORDER",
  "SPECIAL_REQUIREMENT",
  "FORECAST",
  "MANUAL_APPROVED",
] as const;
export const REQUIREMENT_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "PARTIALLY_COVERED",
  "FULLY_PLANNED",
  "IN_MANUFACTURING",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "ON_HOLD",
  "CANCELLED",
  "EXPIRED",
] as const;
export const PLAN_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "SELECTED",
  "APPROVAL_PENDING",
  "APPROVED",
  "RELEASED_TO_MANUFACTURING",
  "REJECTED",
  "CANCELLED",
  "REPLAN_REQUIRED",
  "SUPERSEDED",
] as const;
export const RULE_STATUSES = ["CONFIRMED", "PROPOSED", "OPEN", "DEPRECATED"] as const;
