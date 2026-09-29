/**
 * Business vocabulary for recorded data-quality issues.
 *
 * Synchronization and the demand calculation record each issue under a fixed rule code.
 * Those codes are internal; readers see the issue type they belong to. A rule this build
 * does not know is reported as "Other issue" rather than folded into a neighbouring type,
 * so an unfamiliar problem is never presented as a familiar one.
 *
 * Client-safe: no database or permission imports.
 */

export const ISSUE_TYPES = {
  INVALID_RECORD: { label: "Invalid records", rules: ["INVALID_CANONICAL_RECORD", "MISSING_CERTIFICATION_INTENT"] },
  UNMAPPED_VALUE: { label: "Unmapped source values", rules: ["UNMAPPED_LAB_WARNING"] },
  RECONCILIATION: { label: "Reconciliation issues", rules: ["SOURCE_DISAPPEARANCE_WITHOUT_INVOICE"] },
  IMPORT: { label: "Import problems", rules: ["DUPLICATE_LOT_IN_BATCH", "OUT_OF_ORDER_UPDATE"] },
  INCOMPLETE_INPUT: { label: "Incomplete calculation inputs", rules: ["NO_COUNTABLE_INPUTS", "MISSING_OPERATIONAL_MIRROR", "OPERATIONAL_PROJECTION_INCOMPLETE"] },
} as const satisfies Record<string, { label: string; rules: readonly string[] }>;

export type IssueType = keyof typeof ISSUE_TYPES;
export type IssueTypeOrOther = IssueType | "OTHER";

export const ISSUE_TYPE_KEYS = Object.keys(ISSUE_TYPES) as IssueType[];

export function isIssueType(value: string): value is IssueType {
  return Object.prototype.hasOwnProperty.call(ISSUE_TYPES, value);
}

export function issueTypeOfRule(rule: string): IssueTypeOrOther {
  return ISSUE_TYPE_KEYS.find((key) => (ISSUE_TYPES[key].rules as readonly string[]).includes(rule)) ?? "OTHER";
}

export function issueTypeLabel(type: IssueTypeOrOther): string {
  return type === "OTHER" ? "Other issue" : ISSUE_TYPES[type].label;
}

export const ISSUE_SOURCE_LABELS: Record<string, string> = {
  FANTASY: "Fantasy synchronization",
  DEMAND_CALCULATION: "Demand calculation",
};

export const ISSUE_SEVERITIES = ["INFO", "WARNING", "ERROR", "BLOCKING"] as const;
export const ISSUE_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "IGNORED"] as const;
