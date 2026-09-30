import { Prisma } from "@prisma/client";

/**
 * A requirement's remaining need, from its factual quantities only: required minus
 * planning-available stock minus eligible WIP coverage. Planned coverage is unavailable
 * (see PLAN_COVERAGE) and never subtracted.
 *
 * The stored `remainingUnplanned` and `approvedPlanCoverage` columns were written by the
 * retired legacy planning seed, which subtracted fabricated plan coverage; they are not read.
 */
export function requirementRemainingNeed(r: { requiredQty: number; planningAvailableQty: number; wipCoverage: number }): number {
  return Math.max(0, r.requiredQty - r.planningAvailableQty - r.wipCoverage);
}

/** The same test as a SQL predicate, for counts that must not load every requirement. */
export const REQUIREMENT_HAS_NEED_SQL = Prisma.sql`("requiredQty" - "planningAvailableQty" - "wipCoverage") > 0`;

/**
 * Statuses the legacy planning seed derived from its fabricated plan coverage. They describe
 * no real plan, so a requirement holding one is presented, and filtered, as ACTIVE.
 */
export const PLAN_DERIVED_REQUIREMENT_STATUSES: readonly string[] = ["FULLY_PLANNED", "PARTIALLY_COVERED"];

export function presentRequirementStatus(status: string): string {
  return PLAN_DERIVED_REQUIREMENT_STATUSES.includes(status) ? "ACTIVE" : status;
}
