import type { SalesTrendDirection } from "@/lib/demand/demand-result-presentation";

export type { SalesTrendDirection };

export const SALES_READINESS_STATES = [
  "CURRENT",
  "SIMULATED",
  "STALE",
  "INCOMPLETE",
  "BLOCKED_BY_DATA_QUALITY",
  "NOT_RUN",
  "UNAVAILABLE",
] as const;
export type SalesReadinessState = (typeof SALES_READINESS_STATES)[number];

export const SALES_READINESS_LABELS: Record<SalesReadinessState, string> = {
  CURRENT: "CURRENT",
  SIMULATED: "SIMULATED",
  STALE: "STALE",
  INCOMPLETE: "INCOMPLETE",
  BLOCKED_BY_DATA_QUALITY: "BLOCKED BY DATA QUALITY",
  NOT_RUN: "NOT RUN",
  UNAVAILABLE: "UNAVAILABLE",
};

export const SALES_READINESS_EXPLANATIONS: Record<SalesReadinessState, string> = {
  CURRENT:
    "Sales history is read from the most recent authoritative sales snapshot, and that snapshot is within the configured freshness threshold.",
  SIMULATED:
    "Every figure on this page comes from simulation fixtures. This is not a connection to the Fantasy ERP and these are not real sales.",
  STALE:
    "The most recent authoritative sales snapshot is older than the configured freshness threshold. The figures below are exactly what that snapshot contained; they are not current.",
  INCOMPLETE:
    "The most recent authoritative sales snapshot completed while holding records that could not be attributed to a confirmed category. Totals below exclude those records.",
  BLOCKED_BY_DATA_QUALITY:
    "The most recent authoritative sales snapshot admitted no confirmed sales while holding records blocked by data quality. No sales total can be shown.",
  NOT_RUN:
    "No authoritative sales snapshot has completed, so there is no confirmed sales history to report. Nothing is shown in its place.",
  UNAVAILABLE: "This figure cannot be established from the current snapshot.",
};

export const SALES_WINDOW_KEYS = ["previous30", "middle30", "latest30"] as const;
export type SalesWindowKey = (typeof SALES_WINDOW_KEYS)[number];

export const SALES_WINDOW_LABELS: Record<SalesWindowKey, string> = {
  previous30: "Previous 30D",
  middle30: "Middle 30D",
  latest30: "Latest 30D",
};

export const APPROVED_SALES_WINDOW_DAYS = 90;
export const SALES_WINDOW_SIZE_DAYS = 30;

export const WINDOW_INDEX: Record<SalesWindowKey, number> = { latest30: 0, middle30: 1, previous30: 2 };

export interface SalesWindowBounds {
  key: SalesWindowKey;
  label: string;
  startDate: string;
  endDate: string;
}

export const COMPARABILITY_STATES = ["COMPARABLE", "NOT_COMPARABLE"] as const;
export type ComparabilityState = (typeof COMPARABILITY_STATES)[number];

export const NOT_COMPARABLE_LABEL = "NOT COMPARABLE";

export const SALES_DATA_STATES = ["CONFIRMED", "REVIEW_REQUIRED", "INSUFFICIENT_HISTORY"] as const;
export type SalesDataState = (typeof SALES_DATA_STATES)[number];

export const SALES_DATA_STATE_LABELS: Record<SalesDataState, string> = {
  CONFIRMED: "Confirmed",
  REVIEW_REQUIRED: "Review required",
  INSUFFICIENT_HISTORY: "Insufficient history",
};

export const CATEGORY_SORT_KEYS = [
  "category",
  "total90",
  "latest30",
  "middle30",
  "previous30",
  "weight",
  "records",
  "latestSaleDate",
] as const;
export type CategorySortKey = (typeof CATEGORY_SORT_KEYS)[number];

export const MOVEMENT_SORT_KEYS = ["category", "absoluteChange", "latest30", "previous30", "total90"] as const;
export type MovementSortKey = (typeof MOVEMENT_SORT_KEYS)[number];

export const RECORD_SORT_KEYS = ["docDate", "quantity", "weight", "category"] as const;
export type RecordSortKey = (typeof RECORD_SORT_KEYS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const TREND_INTERVALS = ["day", "week", "window30"] as const;
export type TrendInterval = (typeof TREND_INTERVALS)[number];

export const TREND_INTERVAL_LABELS: Record<TrendInterval, string> = {
  day: "Day",
  week: "Week",
  window30: "30-day window",
};

export const CONTRIBUTION_DIMENSIONS = ["customer", "country", "branch"] as const;
export type ContributionDimension = (typeof CONTRIBUTION_DIMENSIONS)[number];

export const CONTRIBUTION_LABELS: Record<ContributionDimension, string> = {
  customer: "Customer",
  country: "Country",
  branch: "Branch",
};

export function extraPermissionsForContribution(dimension: ContributionDimension): string[] {
  return dimension === "customer" ? ["customers.read"] : [];
}

export function contributionsAllowed(permissions: readonly string[]): ContributionDimension[] {
  return CONTRIBUTION_DIMENSIONS.filter((d) =>
    extraPermissionsForContribution(d).every((p) => permissions.includes(p)),
  );
}

export interface SalesSnapshotMeta {
  snapshotId: string | null;
  snapshotAt: string | null;
  salesCutoffIst: string | null;
  lookbackStartUtc: string | null;
  lookbackEndUtc: string | null;
  windowDays: number | null;
  approvedWindowLayout: boolean;
  windows: SalesWindowBounds[];
  timezone: string;
  sourceState: string;
  sourceStateLabel: string;
  isSimulated: boolean;
}

export interface SalesReadiness {
  state: SalesReadinessState;
  stateLabel: string;
  explanation: string;
  snapshot: SalesSnapshotMeta;
  historyCoverageStart: string | null;
  historyCoverageEnd: string | null;
  lastSuccessfulSyncAt: string | null;
  sourceCutoffUtc: string | null;
  eligibleSalesRecords: number | null;
  eligibleConfirmedQuantity: number | null;
  excludedRecords: number | null;
  duplicateLifecycleEvents: number | null;
  recordsBlockedByMissingCategory: number | null;
  recordsWithUnconfirmedQuantity: number | null;
  freshnessThresholdHours: number;
  snapshotAgeHours: number | null;
}

export interface PagingMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface CategorySalesRow {
  categoryId: string;
  lab: string;
  shape: string;
  weightBand: string;
  previous30Quantity: number;
  middle30Quantity: number;
  latest30Quantity: number;
  total90Quantity: number;
  total90Weight: number;
  recordCount: number;
  latestSaleDate: string | null;
  trend: SalesTrendDirection;
  dataState: SalesDataState;
}

export interface TrendPeriodRow {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  confirmedQuantity: number;
  confirmedWeight: number;
  recordCount: number;
  distinctCategories: number;
}

export interface MovementRow {
  categoryId: string;
  lab: string;
  shape: string;
  weightBand: string;
  previous30Quantity: number;
  middle30Quantity: number;
  latest30Quantity: number;
  absoluteChange: number;
  percentChange: number | null;
  comparability: ComparabilityState;
  trend: SalesTrendDirection;
  dataState: SalesDataState;
}

export interface ContributionRow {
  key: string;
  label: string;
  confirmedQuantity: number;
  confirmedWeight: number;
  recordCount: number;
  latestSaleDate: string | null;
}

export interface SupportingRecordRow {
  recordId: string;
  lotId: string | null;
  docDate: string | null;
  lifecycle: string;
  categoryId: string;
  confirmedQuantity: number;
  measuredWeight: number | null;
  country: string | null;
  branch: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  sourceState: string;
  dataState: SalesDataState;
}

export const CONFIRMED_SALE_LIFECYCLE = "Confirmed sale";

export interface SalesHistoryFilterValues {
  country: string | null;
  branch: string | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  categoryId: string | null;
  search: string | null;
  customerCode: string | null;
  trend: SalesTrendDirection | null;
  dataState: SalesDataState | null;
}

export const EMPTY_FILTERS: SalesHistoryFilterValues = {
  country: null,
  branch: null,
  lab: null,
  shape: null,
  weightBand: null,
  categoryId: null,
  search: null,
  customerCode: null,
  trend: null,
  dataState: null,
};

export function filterQuery(f: SalesHistoryFilterValues): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  return p;
}
