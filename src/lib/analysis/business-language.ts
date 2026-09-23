/**
 * Business wording for analysis results.
 *
 * Analysis endpoints describe what a result *means*, never how it was derived. The
 * calculation stays in the service; this module holds the phrasing the browser is
 * allowed to receive, keyed by a stable code so a caller can branch on the outcome
 * without the wording becoming part of the contract.
 *
 * Both the code and the message are returned, so the wording lives in one place instead
 * of being duplicated into each view — and a client cannot drift from it.
 *
 * Nothing here may contain a formula, a threshold, a coefficient, a rule identifier or a
 * database identifier. The values are constants precisely so no caller can interpolate
 * one.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("analysis/business-language is server-only and must not be imported by client code.");
}

/**
 * Which side of its established range a category moved to.
 *
 * The detection method decides this; the name describes only the business outcome, so
 * the boundary that produced it stays server-side.
 */
export const ANOMALY_DIRECTIONS = {
  UNUSUALLY_HIGH: "Sales were unusually high for this category.",
  UNUSUALLY_LOW: "Sales were unusually low for this category.",
} as const;

export type AnomalyDirection = keyof typeof ANOMALY_DIRECTIONS;

/**
 * How far outside its established range a category sits, as an approved business label.
 *
 * The wording deliberately says "range" rather than naming the measure or its cut-offs.
 */
export const ANOMALY_SEVERITY_LABELS = {
  HIGH: "Far outside the category's established range",
  MEDIUM: "Clearly outside the category's established range",
  LOW: "Outside the category's established range",
} as const;

export type AnomalySeverity = keyof typeof ANOMALY_SEVERITY_LABELS;

/** Shown when detection ran and flagged nothing — an honest empty result, not an error. */
export const ANOMALY_NONE_FLAGGED =
  "No category moved outside its established range this month.";

/**
 * How a prediction was formed, in business terms.
 *
 * The model, its coefficient and its interval width are inputs the engine owns. A user
 * needs to know the prediction leans on recent reconciled results and is advisory —
 * not how it is weighted.
 */
export const YIELD_PREDICTION_BASIS =
  "Based on the most recent reconciled actual yields for this category, with recent months weighted more heavily. " +
  "The range shown reflects how much past results varied.";
