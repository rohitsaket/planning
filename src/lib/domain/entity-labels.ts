/**
 * Business names for the records the application audits and quality-checks.
 *
 * Data Quality Issues and the Audit Log both filter by which kind of record an entry
 * concerns. The stored value is the Prisma model name, which is a storage detail: it
 * tells a reader how the database is laid out and means nothing to them in business
 * terms. This module is the one place that maps the stored key to what a user sees.
 *
 * The key still travels to the server, because it is what the column holds — but only
 * a key from this catalogue does. `isAuditableEntity` is the allow-list a route filters
 * through, so an arbitrary client string never reaches a query.
 *
 * Shared by the server routes and the client views, so the wording cannot drift between
 * a filter, a table cell and an export. It is deliberately free of database, permission
 * and session imports so importing it from a client component stays cheap.
 */

/** Stored model name → business name. The order is the order the filters offer. */
export const ENTITY_LABELS = {
  SalesRecord: "Sales Records",
  PolishedStone: "Polished Inventory",
  RoughStone: "Rough Inventory",
  MemoRecord: "Memo Records",
  Requirement: "Requirements",
  PlanningCase: "Planning Cases",
  PlanVersion: "Plan Versions",
  PlanOption: "Plan Options",
  ForecastRun: "Forecast Runs",
  DemandRun: "Demand Calculations",
  BusinessRule: "Business Rules",
  FeatureFlag: "Feature Flags",
  LabMapping: "Lab Mappings",
  ShapeMapping: "Shape Mappings",
  WeightBand: "Weight Bands",
  LotMasterRecord: "Fantasy Lots",
  IntegrationSyncRun: "Synchronization Runs",
  User: "User Accounts",
  Role: "Roles",
} as const;

export type AuditableEntity = keyof typeof ENTITY_LABELS;

/** Every key, for a strict server-side allow-list and for building filter options. */
export const AUDITABLE_ENTITIES = Object.keys(ENTITY_LABELS) as AuditableEntity[];

export function isAuditableEntity(value: string): value is AuditableEntity {
  return Object.prototype.hasOwnProperty.call(ENTITY_LABELS, value);
}

/**
 * The business name for a stored value.
 *
 * A row written by an older build may name something this catalogue does not cover. It
 * is reported as unknown rather than being folded into a neighbouring category, because
 * silently relabelling it would misstate what the record concerns.
 */
export function entityLabel(value: string | null | undefined): string {
  if (!value) return "Unknown entity";
  return isAuditableEntity(value) ? ENTITY_LABELS[value] : "Unknown entity";
}

/** Filter options for a select: business label for display, stored key as the value. */
export const ENTITY_FILTER_OPTIONS: ReadonlyArray<{ value: AuditableEntity; label: string }> =
  AUDITABLE_ENTITIES.map((value) => ({ value, label: ENTITY_LABELS[value] }));
