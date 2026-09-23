/**
 * SALES HISTORY — SHARED CONTRACT
 *
 * Vocabulary shared by the Sales Analysis & Trends page and its API routes. Pure and
 * client-safe: no database client, no environment read, no query text, no formula.
 *
 * The page analyses *historical confirmed sales only*. It never calculates a
 * manufacturing priority, a reorder quantity, a forecast or a plan coverage figure.
 *
 * WHERE THE NUMBERS COME FROM
 * ---------------------------
 * Every figure on this page is read back from the persisted sale trace of an
 * authoritative demand run (`DemandMetricTraceItem`, trace type SALE, included rows).
 * Those rows *are* the output of the one centralized confirmed-sales eligibility and
 * lifecycle-deduplication policy that the demand calculation applies. Reading them —
 * rather than re-deriving "what counts as a sale" here — is what makes the 90-day
 * confirmed quantity on this page equal the sales input of the demand result by
 * construction rather than by agreement between two copies of a rule.
 *
 * Consequence, stated rather than hidden: this page shows a *snapshot*. It can never be
 * newer than the demand run it reports, and it always says which run that is.
 */

import type { SalesTrendDirection } from "@/lib/demand/demand-result-presentation";

export type { SalesTrendDirection };

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * The one honest answer the readiness panel may show. A fabricated "healthy" value is
 * not in this list: when no authoritative run exists the answer is NOT_RUN, and when a
 * figure cannot be established it is UNAVAILABLE.
 */
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

/** Fixed, value-free explanations. No environment value, no query, no error text. */
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

export const READINESS_INTENT: Record<SalesReadinessState, "success" | "info" | "warning" | "critical" | "neutral"> = {
  CURRENT: "success",
  SIMULATED: "info",
  STALE: "warning",
  INCOMPLETE: "warning",
  BLOCKED_BY_DATA_QUALITY: "critical",
  NOT_RUN: "neutral",
  UNAVAILABLE: "neutral",
};

// ---------------------------------------------------------------------------
// The approved 90-day layout
// ---------------------------------------------------------------------------

/**
 * The approved 90-day view is exactly three non-overlapping, gap-free 30-day windows of
 * IST business dates, anchored on the snapshot's authoritative sales cutoff D:
 *
 *   latest30    D-29 .. D     (both inclusive)
 *   middle30    D-59 .. D-30  (both inclusive)
 *   previous30  D-89 .. D-60  (both inclusive)
 *
 * The boundaries are calendar dates in Asia/Kolkata, never instants, and they are
 * decided once on the server. The browser never computes one.
 */
export const SALES_WINDOW_KEYS = ["previous30", "middle30", "latest30"] as const;
export type SalesWindowKey = (typeof SALES_WINDOW_KEYS)[number];

export const SALES_WINDOW_LABELS: Record<SalesWindowKey, string> = {
  previous30: "Previous 30D",
  middle30: "Middle 30D",
  latest30: "Latest 30D",
};

export const APPROVED_SALES_WINDOW_DAYS = 90;
export const SALES_WINDOW_SIZE_DAYS = 30;

/** Bucket index a window occupies, counting back from the cutoff (0 = latest). */
export const WINDOW_INDEX: Record<SalesWindowKey, number> = { latest30: 0, middle30: 1, previous30: 2 };

export interface SalesWindowBounds {
  key: SalesWindowKey;
  label: string;
  /** First included IST business date, "YYYY-MM-DD". */
  startDate: string;
  /** Last included IST business date, "YYYY-MM-DD". */
  endDate: string;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/**
 * Comparability of a percentage change. A zero earlier window has no valid denominator,
 * so no percentage is produced at all — not infinity, not 100%, not a dash that reads
 * like zero.
 */
export const COMPARABILITY_STATES = ["COMPARABLE", "NOT_COMPARABLE"] as const;
export type ComparabilityState = (typeof COMPARABILITY_STATES)[number];

export const NOT_COMPARABLE_LABEL = "NOT COMPARABLE";

// ---------------------------------------------------------------------------
// Per-row data state
// ---------------------------------------------------------------------------

/**
 * What the snapshot can say about one aggregated category or one record. Fixed codes; a
 * stored reason string never reaches the browser in their place.
 */
export const SALES_DATA_STATES = ["CONFIRMED", "REVIEW_REQUIRED", "INSUFFICIENT_HISTORY"] as const;
export type SalesDataState = (typeof SALES_DATA_STATES)[number];

export const SALES_DATA_STATE_LABELS: Record<SalesDataState, string> = {
  CONFIRMED: "Confirmed",
  REVIEW_REQUIRED: "Review required",
  INSUFFICIENT_HISTORY: "Insufficient history",
};

// ---------------------------------------------------------------------------
// Sorting, intervals, contribution dimensions
// ---------------------------------------------------------------------------

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

/** Trend interval. `window30` is the approved 30-day layout; day and week are calendar. */
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

/** Contribution by customer exposes customer identity: it needs its own permission. */
export function extraPermissionsForContribution(dimension: ContributionDimension): string[] {
  return dimension === "customer" ? ["customers.read"] : [];
}

export function contributionsAllowed(permissions: readonly string[]): ContributionDimension[] {
  return CONTRIBUTION_DIMENSIONS.filter((d) =>
    extraPermissionsForContribution(d).every((p) => permissions.includes(p)),
  );
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Identity and provenance of the snapshot every figure on the page was read from. */
export interface SalesSnapshotMeta {
  /** Null when no authoritative snapshot exists. */
  snapshotId: string | null;
  /** When the snapshot was produced (UTC ISO). */
  snapshotAt: string | null;
  /** Authoritative sales cutoff — IST business date, "YYYY-MM-DD". */
  salesCutoffIst: string | null;
  /** Canonical window bounds in UTC, exactly as the snapshot recorded them. */
  lookbackStartUtc: string | null;
  lookbackEndUtc: string | null;
  windowDays: number | null;
  /** True only when the snapshot used the approved 90-day layout. */
  approvedWindowLayout: boolean;
  windows: SalesWindowBounds[];
  timezone: string;
  /** Effective source state of the snapshot, from the shared source vocabulary. */
  sourceState: string;
  sourceStateLabel: string;
  isSimulated: boolean;
}

export interface SalesReadiness {
  state: SalesReadinessState;
  stateLabel: string;
  explanation: string;
  snapshot: SalesSnapshotMeta;
  /** Earliest / latest IST business date actually present in the snapshot's sales. */
  historyCoverageStart: string | null;
  historyCoverageEnd: string | null;
  /** Last successful source synchronization, and the cutoff it reached. */
  lastSuccessfulSyncAt: string | null;
  sourceCutoffUtc: string | null;
  eligibleSalesRecords: number | null;
  eligibleConfirmedQuantity: number | null;
  excludedRecords: number | null;
  /** Integrity check: included sale events sharing one lifecycle event key. Expected 0. */
  duplicateLifecycleEvents: number | null;
  recordsBlockedByMissingCategory: number | null;
  recordsWithUnconfirmedQuantity: number | null;
  /** Advisory, operator-configurable freshness threshold in hours. */
  freshnessThresholdHours: number;
  snapshotAgeHours: number | null;
}

export interface PagingMeta {
  page: number;
  pageSize: number;
  /** Total matching rows on the server. Results are never silently truncated. */
  total: number;
  hasMore: boolean;
}

export interface CategorySalesRow {
  /** Stable category identity: lab | shape | weight band. */
  categoryId: string;
  lab: string;
  shape: string;
  weightBand: string;
  previous30Quantity: number;
  middle30Quantity: number;
  latest30Quantity: number;
  total90Quantity: number;
  /** Measured carat weight. Deliberately a separate figure from quantity. */
  total90Weight: number;
  /** Number of contributing sale records — not a piece quantity. */
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
  /** Null whenever the earlier window has no valid denominator. */
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
  /** Canonical sale identifier inside the snapshot. */
  recordId: string;
  lotId: string | null;
  docDate: string | null;
  lifecycle: string;
  categoryId: string;
  confirmedQuantity: number;
  measuredWeight: number | null;
  country: string | null;
  branch: string | null;
  /** Present only for a principal holding customers.read. */
  customerCode?: string | null;
  customerName?: string | null;
  sourceState: string;
  dataState: SalesDataState;
}

/** Lifecycle label shown on a supporting record. Fixed value, never a source string. */
export const CONFIRMED_SALE_LIFECYCLE = "Confirmed sale";

// ---------------------------------------------------------------------------
// Page-level filter vocabulary (shared by the view and the routes)
// ---------------------------------------------------------------------------

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

/**
 * Query string for the filter set. One builder, used by every table on the page and by
 * the export, so the screen and the exported file can never disagree about the filters.
 */
export function filterQuery(f: SalesHistoryFilterValues): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  return p;
}
