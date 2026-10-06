export const PLAN_COVERAGE = {
  status: "UNAVAILABLE",
  reason: "No selected Sarin plan source is configured, so planned coverage is not calculated.",
} as const;

export type PlanCoverageAvailability = typeof PLAN_COVERAGE;
