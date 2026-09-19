// Shared API response types for the Diamond Manufacturing ERP
export interface ApiList<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardKpi {
  physicalShortage: number;
  pipelineAdjusted: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastRequirement: number;
  polishedStock: number;
  roughAvailable: number;
  roughReserved: number;
  currentWip: number;
  criticalRequirements: number;
  highRequirements: number;
  overdueRequirements: number;
  openOrders: number;
  backorders: number;
  memoExposure: number;
  fantasySyncHealth: "HEALTHY" | "PARTIAL" | "FAILED";
  plannedYield: number;
  actualYield: number;
  yieldVariance: number;
}

export interface CountryShortage {
  country: string;
  physicalShortage: number;
  target: number;
  available: number;
  excess: number;
  wip: number;
  planCov: number;
}

export interface TopCategory {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  sales90d: number;
  target: number;
  available: number;
  shortage: number;
  excess: number;
  trend: string;
}

export interface SalesTrendPoint {
  bucket: string;
  pieces: number;
  carats: number;
  value: number;
}

export interface SalesByCategoryRow {
  dimension: string;
  pieces: number;
  carats: number;
  value: number;
  avgPerCt: number;
  pct: number;
}

export interface CustomerRow {
  id: string;
  customerCode: string;
  name: string;
  country: string;
  branch: string;
  accountOwner: string | null;
  businessPriority: string | null;
  pieces: number;
  carats: number;
  totalValue: number;
  avgPerCt: number;
  openOrders: number;
  memoExposure: number;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  requiredDate: string | null;
  status: string;
  priority: string;
  lines: number;
  qtyOrdered: number;
  qtyOutstanding: number;
  backorderQty: number;
}

export interface RequirementRow {
  id: string;
  requirementCode: string;
  type: string;
  status: string;
  customerName: string | null;
  orderNumber: string | null;
  country: string;
  branch: string;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  requiredQty: number;
  physicalStockQty: number;
  planningAvailableQty: number;
  memoQty: number;
  transferCoverage: number;
  wipCoverage: number;
  approvedPlanCoverage: number;
  actualCoverage: number;
  remainingUnplanned: number;
  forecastQty: number;
  requiredBy: string | null;
  ageDays: number;
  daysRemaining: number | null;
  daysOverdue: number;
  customerPriority: string | null;
  orderPriority: string | null;
  requirementPriority: string | null;
  priorityReason: string | null;
}

export interface RoughRow {
  id: string;
  fantasyRoughId: string;
  kapan: string;
  packet: string;
  stoneName: string;
  signer: string | null;
  stoneType: string;
  roughWeight: number;
  country: string;
  branch: string;
  fantasyStatus: string;
  planningEligible: boolean;
  planningStatus: string;
  lastMovement: string | null;
}

export interface PlanningCaseRow {
  id: string;
  caseCode: string;
  roughId: string;
  stoneName: string;
  kapan: string;
  packet: string;
  originalRoughWeight: number;
  stoneType: string;
  planner: string;
  planningDate: string;
  status: string;
  currentVersion: number;
  selectedOptionCode: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  optionCount: number;
  expectedPieces: number;
  expectedYieldPct: number;
  requirementCoveragePct: number;
}

export interface PlanOptionRow {
  id: string;
  optionCode: string;
  optionNumber: number;
  expectedPieces: number;
  expectedTotalWeight: number;
  yieldPct: number;
  matchingRequiredPieces: number;
  requirementCoverage: number;
  coveragePct: number;
  nonRequiredPieces: number;
  expectedColor: string | null;
  expectedClarity: string | null;
  certificationIntent: string | null;
  potentialExcess: number;
  validationWarnings: string | null;
  selected: boolean;
  approvalStatus: string;
  pieces: Array<{
    id: string;
    pieceCode: string;
    sequence: number;
    expectedShape: string;
    expectedWeight: number;
    expectedColor: string | null;
    expectedClarity: string | null;
    expectedCategory: string | null;
    certificationIntent: string | null;
    fulfilled: boolean;
  }>;
}

export interface TraceabilityNode {
  kind: "ROUGH" | "REQUIREMENT" | "PLAN" | "PIECE" | "FANTASY_POSITION" | "POLISHED" | "ACTUAL";
  id: string;
  label: string;
  attributes: Record<string, string | number | null>;
  children?: TraceabilityNode[];
}

export interface ForecastRow {
  category: string;
  prediction30d: number;
  prediction60d: number;
  prediction90d: number;
  confidence: number;
  trend: string;
  stockoutRisk: string;
  stockoutDate: string | null;
}

export interface BusinessRuleRow {
  id: string;
  ruleId: string;
  domain: string;
  name: string;
  version: string;
  effectiveDate: string;
  status: string;
  configuration: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}

export interface AuditLogRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
  timestamp: string;
  correlationId: string | null;
}

export interface DataQualityRow {
  id: string;
  issueCode: string;
  source: string;
  entity: string;
  recordId: string | null;
  rule: string;
  message: string;
  severity: string;
  status: string;
  assignedTo: string | null;
  detectedAt: string;
}

export interface SyncRunRow {
  id: string;
  source: string;
  entity: string;
  status: string;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
  nextRunAt: string | null;
}
