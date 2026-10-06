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
  ApprovalPolicy: "Approval Policy",
  FeatureFlag: "Feature Flags (retired)",
  LabMapping: "Lab Mappings",
  ShapeMapping: "Shape Mappings",
  WeightBand: "Weight Bands",
  LotMasterRecord: "Fantasy Lots",
  IntegrationSyncRun: "Synchronization Runs",
  User: "User Accounts",
  Role: "Roles",
} as const;

export type AuditableEntity = keyof typeof ENTITY_LABELS;

export const AUDITABLE_ENTITIES = Object.keys(ENTITY_LABELS) as AuditableEntity[];

export function isAuditableEntity(value: string): value is AuditableEntity {
  return Object.prototype.hasOwnProperty.call(ENTITY_LABELS, value);
}

export function entityLabel(value: string | null | undefined): string {
  if (!value) return "Unknown entity";
  return isAuditableEntity(value) ? ENTITY_LABELS[value] : "Unknown entity";
}

export const ENTITY_FILTER_OPTIONS: ReadonlyArray<{ value: AuditableEntity; label: string }> =
  AUDITABLE_ENTITIES.map((value) => ({ value, label: ENTITY_LABELS[value] }));
