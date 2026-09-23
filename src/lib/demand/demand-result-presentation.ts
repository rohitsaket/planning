/**
 * DEMAND RESULT — BROWSER PRESENTATION MAPPING
 *
 * The demand engine stores internal codes, rule identifiers and free-text reasons
 * so runs stay reproducible and auditable. None of that may reach the browser.
 *
 * This module is the single translation point between the internal calculation
 * record and the safe, business-facing values served to the frontend. It maps
 * codes to business language and never passes stored free text through, because
 * that text can contain rule identifiers and implementation wording.
 */

/** Business record categories shown as tabs on Demand Result Details. */
export const RECORD_TYPES = [
  "CONFIRMED_SALE",
  "AVAILABLE_STOCK",
  "MEMO_STOCK",
  "RESERVED_OR_BLOCKED",
  "MANUFACTURING_COVERAGE",
  "APPROVED_PLAN_COVERAGE",
  "EXCLUDED",
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export const RECORD_TYPE_LABELS: Record<RecordType, string> = {
  CONFIRMED_SALE: "Confirmed Sales",
  AVAILABLE_STOCK: "Available Stock",
  MEMO_STOCK: "Memo Stock",
  RESERVED_OR_BLOCKED: "Reserved or Blocked",
  MANUFACTURING_COVERAGE: "Manufacturing Coverage",
  APPROVED_PLAN_COVERAGE: "Approved Plan Coverage",
  EXCLUDED: "Excluded Records",
};

/**
 * Internal record classes behind each business record type. Kept server-side only:
 * the browser sends and receives the business record type, never these values.
 */
const RECORD_TYPE_TO_INTERNAL: Record<RecordType, string[]> = {
  CONFIRMED_SALE: ["SALE"],
  AVAILABLE_STOCK: ["STOCK"],
  MEMO_STOCK: ["MEMO"],
  RESERVED_OR_BLOCKED: ["RESERVED", "BLOCKED"],
  MANUFACTURING_COVERAGE: ["WIP_ELIGIBLE"],
  APPROVED_PLAN_COVERAGE: ["PLAN_APPROVED"],
  EXCLUDED: ["WIP_UNALLOCATED", "EXCLUSION"],
};

const INTERNAL_TO_RECORD_TYPE = new Map<string, RecordType>();
for (const [recordType, internals] of Object.entries(RECORD_TYPE_TO_INTERNAL)) {
  for (const internal of internals) INTERNAL_TO_RECORD_TYPE.set(internal, recordType as RecordType);
}

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

/** Internal record classes to query for a requested business record type. */
export function internalRecordClasses(recordType: RecordType): string[] {
  return RECORD_TYPE_TO_INTERNAL[recordType];
}

/** Business record type for a stored record class; unknown classes are treated as excluded. */
export function toRecordType(internal: string): RecordType {
  return INTERNAL_TO_RECORD_TYPE.get(internal) ?? "EXCLUDED";
}

export type InclusionStatus = "INCLUDED" | "EXCLUDED";

/**
 * Business-facing exclusion reasons. The stored reason text is only used to pick
 * one of these; it is never returned to the browser.
 */
const REASON_PATTERNS: Array<{ match: RegExp; reason: string }> = [
  { match: /unmapped_shape|shape could not|ambiguous.*shape/i, reason: "Shape could not be confirmed" },
  { match: /unmapped_lab|lab_requires_review|lab could not/i, reason: "Lab could not be confirmed" },
  { match: /unmapped_weight_band|weight band/i, reason: "Weight band could not be confirmed" },
  {
    match: /not an eligible stage|ineligible/i,
    reason: "Manufacturing stage is not currently eligible for coverage",
  },
  {
    match: /not configured|unavailable|policy/i,
    reason: "Manufacturing coverage is unavailable because its business configuration is incomplete",
  },
  { match: /already represented as polished|already_polished/i, reason: "Output is already represented in polished inventory" },
  { match: /already.*(wip|manufacturing)/i, reason: "Output is already represented in manufacturing coverage" },
  { match: /certification intent/i, reason: "Certification intent is missing" },
  { match: /complete/i, reason: "Manufacturing is complete and counted as finished stock" },
  { match: /memo/i, reason: "Memo stock is held by a customer and is not available for planning" },
  { match: /reserved/i, reason: "Stock is reserved and is not available for planning" },
  { match: /blocked|hold|unavailable for planning/i, reason: "Stock is on hold and is not available for planning" },
  { match: /ambiguous|could not be attributed/i, reason: "Category could not be confirmed for this record" },
];

const DEFAULT_EXCLUSION_REASON = "Excluded after data review";

/**
 * Business reason for an excluded record. Included records carry no reason.
 * Stored free text never leaves the server: it only selects a safe message.
 */
export function toBusinessReason(isIncluded: boolean, storedReason: string | null | undefined): string | null {
  if (isIncluded) return null;
  if (!storedReason) return DEFAULT_EXCLUSION_REASON;
  for (const { match, reason } of REASON_PATTERNS) {
    if (match.test(storedReason)) return reason;
  }
  return DEFAULT_EXCLUSION_REASON;
}

export type DemandCategoryStatusCode =
  | "REVIEW_REQUIRED"
  | "PLANNING_REQUIRED"
  | "SHORTAGE_COVERED"
  | "EXCESS"
  | "COVERED";

export interface DemandCategoryStatus {
  code: DemandCategoryStatusCode;
  label: string;
  intent: "critical" | "warning" | "success" | "info" | "neutral";
}

/**
 * Business status for one category, decided on the server so the browser never
 * derives it from the numbers.
 */
export function toBusinessStatus(input: {
  metricStatus: string;
  physicalShortage: number;
  remainingUnplanned: number;
  excessStock: number;
}): DemandCategoryStatus {
  if (input.metricStatus === "REVIEW_REQUIRED" || input.metricStatus === "BLOCKED_BY_DATA_QUALITY") {
    return { code: "REVIEW_REQUIRED", label: "Review required", intent: "warning" };
  }
  if (input.remainingUnplanned > 0) {
    return { code: "PLANNING_REQUIRED", label: "Planning required", intent: "critical" };
  }
  if (input.physicalShortage > 0) {
    return { code: "SHORTAGE_COVERED", label: "Shortage covered by pipeline", intent: "info" };
  }
  if (input.excessStock > 0) {
    return { code: "EXCESS", label: "Stock above target", intent: "warning" };
  }
  return { code: "COVERED", label: "Covered", intent: "success" };
}

// Source labelling lives in `@/lib/fantasy/source-state`. It is the single derivation
// for every page and route, so it is deliberately not duplicated here.

export interface WipCoverageState {
  available: boolean;
  /** True when this particular run applied manufacturing coverage. */
  appliedInRun: boolean;
  message: string;
}

/**
 * Manufacturing (WIP) coverage availability in business language. The underlying
 * rule identifier, version and configured stage list stay on the server.
 */
export function toWipCoverageState(input: { policyConfigured: boolean; appliedInRun: boolean }): WipCoverageState {
  if (input.policyConfigured && input.appliedInRun) {
    return {
      available: true,
      appliedInRun: true,
      message: "Manufacturing coverage is configured and applied to this demand result.",
    };
  }
  if (input.policyConfigured && !input.appliedInRun) {
    return {
      available: true,
      appliedInRun: false,
      message:
        "Manufacturing coverage is configured now, but it was not available when this demand result was calculated. Run the calculation again to apply it.",
    };
  }
  return {
    available: false,
    appliedInRun: false,
    message:
      "Manufacturing coverage is unavailable because its business configuration is incomplete. Pieces in manufacturing are listed for information only and do not reduce the pipeline requirement.",
  };
}

/** Display label for a category, built from confirmed business dimensions only. */
export function toCategoryLabel(lab: string, shape: string, weightBand: string): string {
  return [lab, shape, weightBand].filter(Boolean).join(" | ");
}

// ---------------------------------------------------------------------------
// Sales trend direction
// ---------------------------------------------------------------------------

/**
 * Trend labels derived from two factual sales windows.
 *
 * This is a description of what already happened, not a prediction: it compares the
 * count of sales in the earliest 30 days of a window with the count in the latest 30.
 * No forecast, no model, no confidence.
 */
export const SALES_TREND_DIRECTIONS = [
  "Strong Growth",
  "Growth",
  "Stable",
  "Declining",
  "Strong Decline",
  "New Demand",
  "Volatile",
  "Dormant",
] as const;
export type SalesTrendDirection = (typeof SALES_TREND_DIRECTIONS)[number];

/**
 * Classifies the direction between an earlier and a later 30-day sales count.
 *
 * Extracted so Sales Trends and Executive Analysis cannot drift apart: two copies of
 * these thresholds would eventually disagree about the same category.
 */
export function toSalesTrendDirection(earliest30: number, latest30: number): SalesTrendDirection {
  if (earliest30 === 0 && latest30 === 0) return "Dormant";
  if (earliest30 === 0 && latest30 > 0) return "New Demand";
  // One side zero with the other non-zero, after the two cases above, means the later
  // window collapsed to nothing — reported as volatile rather than as a clean decline.
  if (earliest30 === 0 || latest30 === 0) return "Volatile";

  const pct = ((latest30 - earliest30) / earliest30) * 100;
  if (pct >= 50) return "Strong Growth";
  if (pct >= 10) return "Growth";
  if (pct <= -50) return "Strong Decline";
  if (pct <= -10) return "Declining";
  return "Stable";
}
