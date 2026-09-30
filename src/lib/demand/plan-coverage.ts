/**
 * Planned coverage: how much of a category's need a selected plan already covers.
 *
 * No selected-plan source exists. The legacy planning cases were seed data and are retired,
 * and a generated Sarin option is a possibility, not a selection. So planned coverage is not
 * calculated: it is reported as unavailable (never as a computed zero), and it never reduces
 * a requirement — the remaining need is the need after stock and WIP coverage.
 *
 * Free of database imports so the same wording reaches every API and view.
 */
export const PLAN_COVERAGE = {
  status: "UNAVAILABLE",
  reason: "No selected Sarin plan source is configured, so planned coverage is not calculated.",
} as const;

export type PlanCoverageAvailability = typeof PLAN_COVERAGE;
