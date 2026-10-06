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

export function internalRecordClasses(recordType: RecordType): string[] {
  return RECORD_TYPE_TO_INTERNAL[recordType];
}

export function toRecordType(internal: string): RecordType {
  return INTERNAL_TO_RECORD_TYPE.get(internal) ?? "EXCLUDED";
}

export type InclusionStatus = "INCLUDED" | "EXCLUDED";

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

export interface WipCoverageState {
  available: boolean;
  appliedInRun: boolean;
  message: string;
}

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

export function toCategoryLabel(lab: string, shape: string, weightBand: string): string {
  return [lab, shape, weightBand].filter(Boolean).join(" | ");
}

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

export function toSalesTrendDirection(earliest30: number, latest30: number): SalesTrendDirection {
  if (earliest30 === 0 && latest30 === 0) return "Dormant";
  if (earliest30 === 0 && latest30 > 0) return "New Demand";
  if (earliest30 === 0 || latest30 === 0) return "Volatile";

  const pct = ((latest30 - earliest30) / earliest30) * 100;
  if (pct >= 50) return "Strong Growth";
  if (pct >= 10) return "Growth";
  if (pct <= -50) return "Strong Decline";
  if (pct <= -10) return "Declining";
  return "Stable";
}
