/**
 * SALES HISTORY — BOUNDED SERVER READ SERVICE (server-only)
 *
 * Answers, for confirmed historical sales only: what sold, when, in which category,
 * how recent activity changed, who and where contributed, which exact records support
 * each number, and whether the underlying history can be trusted at all.
 *
 * ONE ELIGIBILITY POLICY
 * ----------------------
 * This module does not decide what a confirmed sale is. That decision belongs to the
 * demand calculation, which applies the approved lifecycle mapping, the IST business
 * window, the cancellation/reversal and non-sale-removal exclusions, the lifecycle
 * episode deduplication and the canonical category normalization — and then *persists
 * the admitted sale events* as `DemandMetricTraceItem` rows of trace type SALE.
 *
 * This service reads those rows back. There is therefore no second sales calculation to
 * drift: the 90-day confirmed quantity here is the same set of rows that produced the
 * demand result's sales input, from the same snapshot, under the same policy.
 *
 * WHAT THIS COSTS, STATED PLAINLY
 * -------------------------------
 * The page can never be newer than the last authoritative run, and it says so. It never
 * claims to be live and never invents a figure for a run that has not happened.
 *
 * SCALE
 * -----
 * Row-level filtering and every aggregate run in the database. Only grouped rows or one
 * page of records ever reach this process. The category dimension (lab x shape x weight
 * band) is bounded by configuration rather than by sales volume, and the one query that
 * returns a whole grouped set is still guarded by an explicit ceiling: it errors rather
 * than truncating.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { ApiError } from "@/lib/api/errors";
import { BUSINESS_TIMEZONE } from "@/lib/fantasy/time";
import {
  deriveHistoricalSourceState,
  FANTASY_SOURCE_STATE_LABELS,
  type FantasyEffectiveSourceState,
} from "@/lib/fantasy/source-state";
import { toSalesTrendDirection } from "@/lib/demand/demand-result-presentation";
import {
  APPROVED_SALES_WINDOW_DAYS,
  CONFIRMED_SALE_LIFECYCLE,
  SALES_READINESS_EXPLANATIONS,
  SALES_READINESS_LABELS,
  SALES_WINDOW_KEYS,
  SALES_WINDOW_LABELS,
  SALES_WINDOW_SIZE_DAYS,
  WINDOW_INDEX,
  type CategorySalesRow,
  type CategorySortKey,
  type ContributionDimension,
  type ContributionRow,
  type MovementRow,
  type MovementSortKey,
  type PagingMeta,
  type RecordSortKey,
  type SalesDataState,
  type SalesHistoryFilterValues,
  type SalesReadiness,
  type SalesReadinessState,
  type SalesSnapshotMeta,
  type SalesWindowBounds,
  type SortDirection,
  type SupportingRecordRow,
  type TrendInterval,
  type TrendPeriodRow,
} from "@/lib/analytics/sales-history-contract";
import { resolveExportRowLimit } from "@/lib/config/export-limits";
import { scopeSql, type EffectiveScope } from "@/lib/auth/access-scope";

if (typeof window !== "undefined") {
  throw new Error("analytics/sales-history is server-only and must not be imported by client code.");
}

/**
 * Advisory freshness threshold for the sales snapshot, in hours. No business rule fixes
 * this number, so it is operator-configurable and labelled as advisory in the UI rather
 * than presented as an authoritative cutoff. An unusable value falls back to the
 * default instead of making every snapshot look permanently fresh or permanently stale.
 */
const DEFAULT_SNAPSHOT_FRESHNESS_HOURS = 24;

export function snapshotFreshnessThresholdHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SALES_SNAPSHOT_FRESHNESS_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SNAPSHOT_FRESHNESS_HOURS;
}

/**
 * Ceiling on the number of *grouped* category rows one request may materialise.
 * Exceeding it is an explicit error, never a silently shortened table.
 */
const GROUP_CEILING = resolveExportRowLimit("SALES_GROUP_MAX", 5_000).rows;

/** Row ceiling for a single server-side export, validated centrally. */
export const SALES_EXPORT_LIMIT = resolveExportRowLimit("SALES_EXPORT_MAX_ROWS", 10_000);
export const EXPORT_ROW_LIMIT = SALES_EXPORT_LIMIT.rows;

/** Run statuses that produced a persisted, authoritative sale trace. */
const AUTHORITATIVE_RUN_STATUSES = ["COMPLETED", "REVIEW_REQUIRED"] as const;

export interface SalesPageRequest {
  page: number;
  pageSize: number;
}

export interface SalesSnapshot {
  id: string;
  runDate: Date;
  finishedAt: Date | null;
  windowDays: number;
  businessDateIst: string;
  lookbackStart: Date | null;
  lookbackEnd: Date | null;
  status: string;
  sourceMode: string;
  isSimulated: boolean;
  sourceCutoff: Date | null;
  excludedCount: number;
}

// ---------------------------------------------------------------------------
// Snapshot resolution
// ---------------------------------------------------------------------------

/**
 * The authoritative sales snapshot: the most recent demand run that finished and
 * persisted its sale trace. A RUNNING or FAILED run is never read — a half-written
 * trace is not a sales history.
 */
export async function resolveSalesSnapshot(): Promise<SalesSnapshot | null> {
  const run = await db.demandRun.findFirst({
    where: { status: { in: [...AUTHORITATIVE_RUN_STATUSES] }, finishedAt: { not: null }, businessDateIst: { not: null } },
    orderBy: [{ runDate: "desc" }, { finishedAt: "desc" }],
    select: {
      id: true,
      runDate: true,
      finishedAt: true,
      windowDays: true,
      businessDateIst: true,
      lookbackStart: true,
      lookbackEnd: true,
      status: true,
      sourceMode: true,
      isSimulated: true,
      sourceCutoff: true,
      excludedCount: true,
    },
  });
  if (!run || !run.businessDateIst) return null;
  return { ...run, businessDateIst: run.businessDateIst };
}

/** Calendar arithmetic on "YYYY-MM-DD" strings. Timezone-free by construction. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The approved three-window layout for a cutoff business date.
 *
 * Boundaries are inclusive on both ends and are pure IST calendar dates. Window i covers
 * [D - 30i - 29, D - 30i], so consecutive windows touch without overlapping and without
 * leaving a gap, across month and year boundaries alike.
 */
export function salesWindows(cutoffIst: string): SalesWindowBounds[] {
  return SALES_WINDOW_KEYS.map((key) => {
    const i = WINDOW_INDEX[key];
    const endDate = addDays(cutoffIst, -i * SALES_WINDOW_SIZE_DAYS);
    return { key, label: SALES_WINDOW_LABELS[key], startDate: addDays(endDate, -(SALES_WINDOW_SIZE_DAYS - 1)), endDate };
  });
}

function snapshotMeta(run: SalesSnapshot | null): SalesSnapshotMeta {
  if (!run) {
    return {
      snapshotId: null,
      snapshotAt: null,
      salesCutoffIst: null,
      lookbackStartUtc: null,
      lookbackEndUtc: null,
      windowDays: null,
      approvedWindowLayout: false,
      windows: [],
      timezone: BUSINESS_TIMEZONE,
      sourceState: "NOT_CONFIGURED",
      sourceStateLabel: FANTASY_SOURCE_STATE_LABELS.NOT_CONFIGURED,
      isSimulated: false,
    };
  }
  const approved = run.windowDays === APPROVED_SALES_WINDOW_DAYS;
  const state: FantasyEffectiveSourceState = deriveHistoricalSourceState(run.isSimulated, run.sourceMode);
  return {
    snapshotId: run.id,
    snapshotAt: (run.finishedAt ?? run.runDate).toISOString(),
    salesCutoffIst: run.businessDateIst,
    lookbackStartUtc: run.lookbackStart ? run.lookbackStart.toISOString() : null,
    lookbackEndUtc: run.lookbackEnd ? run.lookbackEnd.toISOString() : null,
    windowDays: run.windowDays,
    approvedWindowLayout: approved,
    windows: approved ? salesWindows(run.businessDateIst) : [],
    timezone: BUSINESS_TIMEZONE,
    sourceState: state,
    sourceStateLabel: FANTASY_SOURCE_STATE_LABELS[state],
    isSimulated: run.isSimulated || state === "FIXTURE_SIMULATION",
  };
}

// ---------------------------------------------------------------------------
// Shared SQL
// ---------------------------------------------------------------------------

/**
 * IST business date of a stored UTC instant. Canonical timestamps stay in UTC; only the
 * business calendar is evaluated in IST, in one place.
 */
const istDateSql = Prisma.sql`((("t"."docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE})::date)`;

/**
 * Row-level predicates. Values are always bound parameters; no identifier and no value
 * is ever concatenated from a request.
 */
/**
 * The request filters plus the caller's authorization scope.
 *
 * The scope is deliberately NOT a field of `SalesHistoryFilterValues`: that type lives in
 * the shared contract, which the browser imports to build query strings, and an
 * authorization decision has no business being constructible on a client. It is added
 * here, on the server side of the boundary, by `withSalesScope`.
 */
export interface ScopedSalesFilters extends SalesHistoryFilterValues {
  readonly scope: EffectiveScope;
}

/** Attaches a caller's scope to the filters they asked for. Server-side only. */
export function withSalesScope(
  filters: SalesHistoryFilterValues,
  scope: EffectiveScope,
): ScopedSalesFilters {
  return { ...filters, scope };
}

function filterSql(f: ScopedSalesFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.country) parts.push(Prisma.sql`AND "m"."country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`AND "m"."branch" = ${f.branch}`);
  if (f.customerCode) parts.push(Prisma.sql`AND "m"."customerCode" = ${f.customerCode}`);
  if (f.lab) parts.push(Prisma.sql`AND "t"."lab" = ${f.lab}`);
  if (f.shape) parts.push(Prisma.sql`AND "t"."shape" = ${f.shape}`);
  if (f.weightBand) parts.push(Prisma.sql`AND "t"."weightBand" = ${f.weightBand}`);
  if (f.categoryId) parts.push(Prisma.sql`AND "t"."planningCategory" = ${f.categoryId}`);
  if (f.search) parts.push(Prisma.sql`AND "t"."planningCategory" ILIKE ${`%${f.search}%`}`);
  // The country is on the canonical lot the sale is joined to; the lab is on the trace
  // row. Applied unconditionally, so an unfiltered request returns the caller's scope.
  const scope = scopeSql(f.scope, { country: '"m"."country"', lab: '"t"."lab"' });
  if (scope !== Prisma.empty) parts.push(scope);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

/**
 * The confirmed sales of one snapshot, already filtered, with the IST business date and
 * the 30-day window index attached. Everything else in this module builds on it.
 *
 * `LotMasterRecord.lotId` is unique, so the join adds location and customer identity
 * without ever multiplying a sale row.
 */
function saleCte(run: SalesSnapshot, f: ScopedSalesFilters): Prisma.Sql {
  return Prisma.sql`
    WITH base AS (
      SELECT
        "t"."id"                        AS record_id,
        "t"."planningCategory"          AS category_id,
        COALESCE("t"."lab", '')         AS lab,
        COALESCE("t"."shape", '')       AS shape,
        COALESCE("t"."weightBand", '')  AS weight_band,
        "t"."lotId"                     AS lot_id,
        "t"."eventKey"                  AS event_key,
        COALESCE("t"."quantity", 0)::float8 AS qty,
        COALESCE("t"."weight", 0)::float8   AS wt,
        "t"."docDate"                   AS doc_date,
        ${istDateSql}                   AS ist_date,
        "m"."country"                   AS country,
        "m"."branch"                    AS branch,
        "m"."customerCode"              AS customer_code,
        COALESCE("m"."customerName", "t"."customerName") AS customer_name
      FROM "DemandMetricTraceItem" "t"
      LEFT JOIN "LotMasterRecord" "m" ON "m"."lotId" = "t"."lotId"
      WHERE "t"."runId" = ${run.id}
        AND "t"."traceType" = 'SALE'
        AND "t"."isIncluded" = TRUE
        AND "t"."docDate" IS NOT NULL
        ${filterSql(f)}
    ),
    sale AS (
      SELECT *, (((${run.businessDateIst}::date - ist_date) / ${SALES_WINDOW_SIZE_DAYS}::int))::int AS widx
      FROM base
      WHERE ist_date <= ${run.businessDateIst}::date
    )
  `;
}

const EMPTY_PAGING = (p: SalesPageRequest): PagingMeta => ({ page: p.page, pageSize: p.pageSize, total: 0, hasMore: false });

function guardGroups(count: number): void {
  if (count > GROUP_CEILING) {
    throw new ApiError(
      503,
      "RESULT_LIMIT_EXCEEDED",
      "This selection produces more categories than the report can return in one request. Narrow the filters.",
    );
  }
}

function pageOf<T>(rows: T[], p: SalesPageRequest): { rows: T[]; paging: PagingMeta } {
  const start = (p.page - 1) * p.pageSize;
  const slice = rows.slice(start, start + p.pageSize);
  return { rows: slice, paging: { page: p.page, pageSize: p.pageSize, total: rows.length, hasMore: start + p.pageSize < rows.length } };
}

const cmp = (a: number | string | null, b: number | string | null): number => {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
};

// ---------------------------------------------------------------------------
// A. Readiness
// ---------------------------------------------------------------------------

interface ReadinessAggRow {
  records: number;
  quantity: number | null;
  distinct_events: number;
  unconfirmed_qty: number;
  coverage_start: string | null;
  coverage_end: string | null;
}

function readinessState(input: {
  run: SalesSnapshot | null;
  eligibleRecords: number;
  blockedByCategory: number;
  ageHours: number | null;
  thresholdHours: number;
  isSimulated: boolean;
}): SalesReadinessState {
  if (!input.run) return "NOT_RUN";
  if (input.eligibleRecords === 0 && input.blockedByCategory > 0) return "BLOCKED_BY_DATA_QUALITY";
  if (input.run.status === "REVIEW_REQUIRED" || input.blockedByCategory > 0) return "INCOMPLETE";
  if (input.ageHours !== null && input.ageHours > input.thresholdHours) return "STALE";
  if (input.isSimulated) return "SIMULATED";
  return "CURRENT";
}

export async function getSalesReadiness(now: Date = new Date()): Promise<SalesReadiness> {
  const run = await resolveSalesSnapshot();
  const meta = snapshotMeta(run);
  const thresholdHours = snapshotFreshnessThresholdHours();

  if (!run) {
    return {
      state: "NOT_RUN",
      stateLabel: SALES_READINESS_LABELS.NOT_RUN,
      explanation: SALES_READINESS_EXPLANATIONS.NOT_RUN,
      snapshot: meta,
      historyCoverageStart: null,
      historyCoverageEnd: null,
      lastSuccessfulSyncAt: null,
      sourceCutoffUtc: null,
      eligibleSalesRecords: null,
      eligibleConfirmedQuantity: null,
      excludedRecords: null,
      duplicateLifecycleEvents: null,
      recordsBlockedByMissingCategory: null,
      recordsWithUnconfirmedQuantity: null,
      freshnessThresholdHours: thresholdHours,
      snapshotAgeHours: null,
    };
  }

  const [agg, excluded, blockedByCategory, lastSync] = await Promise.all([
    db.$queryRaw<ReadinessAggRow[]>`
      SELECT
        COUNT(*)::int                                   AS records,
        SUM(COALESCE("quantity", 0))::float8            AS quantity,
        COUNT(DISTINCT COALESCE("eventKey", "id"))::int AS distinct_events,
        (COUNT(*) FILTER (WHERE "quantity" IS NULL OR "quantity" <= 0))::int AS unconfirmed_qty,
        to_char(MIN((("docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE})::date), 'YYYY-MM-DD') AS coverage_start,
        to_char(MAX((("docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE})::date), 'YYYY-MM-DD') AS coverage_end
      FROM "DemandMetricTraceItem"
      WHERE "runId" = ${run.id} AND "traceType" = 'SALE' AND "isIncluded" = TRUE`,
    db.demandMetricTraceItem.count({ where: { runId: run.id, traceType: "EXCLUSION" } }),
    // Sale records the centralized policy could not attribute to a confirmed category.
    // The demand calculation records each one as an open data-quality issue; counting
    // them here reads that record rather than re-deciding what "unmapped" means.
    db.dataQualityIssue.count({
      where: { source: "DEMAND_CALCULATION", entity: "SaleEvent", status: { in: ["OPEN", "IN_REVIEW"] } },
    }),
    db.integrationSyncRun.findFirst({
      where: { source: { in: ["FANTASY", "Fantasy"] }, status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);

  const a = agg[0] ?? { records: 0, quantity: 0, distinct_events: 0, unconfirmed_qty: 0, coverage_start: null, coverage_end: null };
  const finishedAt = run.finishedAt ?? run.runDate;
  const ageHours = (now.getTime() - finishedAt.getTime()) / 3_600_000;
  const state = readinessState({
    run,
    eligibleRecords: a.records,
    blockedByCategory,
    ageHours,
    thresholdHours,
    isSimulated: meta.isSimulated,
  });

  return {
    state,
    stateLabel: SALES_READINESS_LABELS[state],
    explanation: SALES_READINESS_EXPLANATIONS[state],
    snapshot: meta,
    historyCoverageStart: a.coverage_start,
    historyCoverageEnd: a.coverage_end,
    lastSuccessfulSyncAt: lastSync?.finishedAt ? lastSync.finishedAt.toISOString() : null,
    sourceCutoffUtc: run.sourceCutoff ? run.sourceCutoff.toISOString() : null,
    eligibleSalesRecords: a.records,
    eligibleConfirmedQuantity: num(a.quantity),
    excludedRecords: excluded,
    duplicateLifecycleEvents: a.records - a.distinct_events,
    recordsBlockedByMissingCategory: blockedByCategory,
    recordsWithUnconfirmedQuantity: a.unconfirmed_qty,
    freshnessThresholdHours: thresholdHours,
    snapshotAgeHours: Math.round(ageHours * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// B / D. Category summary and movement (one grouped aggregate, two presentations)
// ---------------------------------------------------------------------------

interface CategoryAggRow {
  category_id: string;
  lab: string;
  shape: string;
  weight_band: string;
  prev30: number | null;
  mid30: number | null;
  latest30: number | null;
  total_qty: number | null;
  total_weight: number | null;
  records: number;
  latest_date: string | null;
}

interface CategoryAggregate extends CategorySalesRow {
  absoluteChange: number;
  percentChange: number | null;
}

/**
 * One database aggregate per category. Window quantities come back as three FILTERed
 * sums over the same scan, so the three windows are guaranteed to partition the same
 * rows that the total is taken over.
 */
async function categoryAggregates(run: SalesSnapshot, f: ScopedSalesFilters): Promise<CategoryAggregate[]> {
  const approved = run.windowDays === APPROVED_SALES_WINDOW_DAYS;
  const rows = await db.$queryRaw<CategoryAggRow[]>`
    ${saleCte(run, f)}
    SELECT
      category_id,
      MIN(lab)         AS lab,
      MIN(shape)       AS shape,
      MIN(weight_band) AS weight_band,
      (SUM(qty) FILTER (WHERE widx = ${WINDOW_INDEX.previous30}::int))::float8 AS prev30,
      (SUM(qty) FILTER (WHERE widx = ${WINDOW_INDEX.middle30}::int))::float8   AS mid30,
      (SUM(qty) FILTER (WHERE widx = ${WINDOW_INDEX.latest30}::int))::float8   AS latest30,
      SUM(qty)::float8 AS total_qty,
      SUM(wt)::float8  AS total_weight,
      COUNT(*)::int    AS records,
      to_char(MAX(ist_date), 'YYYY-MM-DD') AS latest_date
    FROM sale
    GROUP BY category_id
    LIMIT ${GROUP_CEILING + 1}`;
  guardGroups(rows.length);

  return rows.map((r) => {
    const prev = num(r.prev30);
    const mid = num(r.mid30);
    const latest = num(r.latest30);
    const total = num(r.total_qty);
    // The approved trend rule lives in the demand presentation module and is reused, not
    // restated: two copies of these thresholds would eventually disagree.
    const trend = toSalesTrendDirection(Math.round(prev), Math.round(latest));
    const comparable = prev > 0;
    const parts = [r.lab, r.shape, r.weight_band].filter(Boolean);
    return {
      categoryId: r.category_id,
      lab: r.lab,
      shape: r.shape,
      weightBand: r.weight_band,
      previous30Quantity: approved ? prev : 0,
      middle30Quantity: approved ? mid : 0,
      latest30Quantity: approved ? latest : 0,
      total90Quantity: total,
      total90Weight: Math.round(num(r.total_weight) * 1e6) / 1e6,
      recordCount: r.records,
      latestSaleDate: r.latest_date,
      trend,
      // A category whose identity is not fully confirmed, or that has no comparable
      // earlier window, is reported as such instead of being shown as a clean figure.
      dataState: (parts.length < 3 ? "REVIEW_REQUIRED" : !approved || !comparable ? "INSUFFICIENT_HISTORY" : "CONFIRMED") as SalesDataState,
      absoluteChange: approved ? latest - prev : 0,
      percentChange: approved && comparable ? Math.round(((latest - prev) / prev) * 1000) / 10 : null,
    };
  });
}

export interface CategorySummaryResult {
  rows: CategorySalesRow[];
  paging: PagingMeta;
  totals: { confirmedQuantity: number; confirmedWeight: number; recordCount: number; categories: number };
}

const CATEGORY_SORT: Record<CategorySortKey, (r: CategoryAggregate) => number | string | null> = {
  category: (r) => r.categoryId,
  total90: (r) => r.total90Quantity,
  latest30: (r) => r.latest30Quantity,
  middle30: (r) => r.middle30Quantity,
  previous30: (r) => r.previous30Quantity,
  weight: (r) => r.total90Weight,
  records: (r) => r.recordCount,
  latestSaleDate: (r) => r.latestSaleDate,
};

/**
 * Filtering, sorting and paging all happen on the server. The browser receives one page
 * plus the real total, so a page of rows can never be mistaken for the whole table.
 */
export async function getCategorySalesSummary(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  sort: { key: CategorySortKey; dir: SortDirection },
  page: SalesPageRequest,
): Promise<CategorySummaryResult> {
  const all = await categoryAggregates(run, f);
  const filtered = all.filter((r) => (!f.trend || r.trend === f.trend) && (!f.dataState || r.dataState === f.dataState));
  const sign = sort.dir === "asc" ? 1 : -1;
  const pick = CATEGORY_SORT[sort.key];
  // Category id breaks every tie, so paging over the same filters is stable.
  filtered.sort((a, b) => sign * cmp(pick(a), pick(b)) || a.categoryId.localeCompare(b.categoryId));

  const totals = filtered.reduce(
    (acc, r) => ({
      confirmedQuantity: acc.confirmedQuantity + r.total90Quantity,
      confirmedWeight: acc.confirmedWeight + r.total90Weight,
      recordCount: acc.recordCount + r.recordCount,
      categories: acc.categories + 1,
    }),
    { confirmedQuantity: 0, confirmedWeight: 0, recordCount: 0, categories: 0 },
  );
  totals.confirmedWeight = Math.round(totals.confirmedWeight * 1e6) / 1e6;

  const { rows, paging } = pageOf(filtered, page);
  return {
    rows: rows.map(({ absoluteChange: _a, percentChange: _p, ...row }) => row),
    paging,
    totals,
  };
}

export interface MovementResult {
  rows: MovementRow[];
  paging: PagingMeta;
  /** False when the snapshot did not use the approved 90-day layout. */
  available: boolean;
}

const MOVEMENT_SORT: Record<MovementSortKey, (r: CategoryAggregate) => number | string | null> = {
  category: (r) => r.categoryId,
  absoluteChange: (r) => r.absoluteChange,
  latest30: (r) => r.latest30Quantity,
  previous30: (r) => r.previous30Quantity,
  total90: (r) => r.total90Quantity,
};

export async function getCategoryMovement(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  sort: { key: MovementSortKey; dir: SortDirection },
  page: SalesPageRequest,
): Promise<MovementResult> {
  if (run.windowDays !== APPROVED_SALES_WINDOW_DAYS) {
    return { rows: [], paging: EMPTY_PAGING(page), available: false };
  }
  const all = await categoryAggregates(run, f);
  const filtered = all.filter((r) => (!f.trend || r.trend === f.trend) && (!f.dataState || r.dataState === f.dataState));
  const sign = sort.dir === "asc" ? 1 : -1;
  const pick = MOVEMENT_SORT[sort.key];
  filtered.sort((a, b) => sign * cmp(pick(a), pick(b)) || a.categoryId.localeCompare(b.categoryId));

  const { rows, paging } = pageOf(filtered, page);
  return {
    available: true,
    paging,
    rows: rows.map((r) => ({
      categoryId: r.categoryId,
      lab: r.lab,
      shape: r.shape,
      weightBand: r.weightBand,
      previous30Quantity: r.previous30Quantity,
      middle30Quantity: r.middle30Quantity,
      latest30Quantity: r.latest30Quantity,
      absoluteChange: r.absoluteChange,
      percentChange: r.percentChange,
      comparability: r.percentChange === null ? "NOT_COMPARABLE" : "COMPARABLE",
      trend: r.trend,
      dataState: r.dataState,
    })),
  };
}

// ---------------------------------------------------------------------------
// C. Period trend
// ---------------------------------------------------------------------------

interface TrendAggRow {
  period_key: string;
  period_start: string;
  period_end: string;
  qty: number | null;
  wt: number | null;
  records: number;
  categories: number;
}

/**
 * One row per period. The chart and the table are served the same rows; there is no
 * second series computed anywhere.
 */
export async function getSalesPeriodTrend(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  interval: TrendInterval,
): Promise<{ interval: TrendInterval; rows: TrendPeriodRow[]; available: boolean }> {
  if (interval === "window30" && run.windowDays !== APPROVED_SALES_WINDOW_DAYS) {
    return { interval, rows: [], available: false };
  }

  // Period identity per interval. `widx` is the approved 30-day layout; day and week are
  // plain IST calendar periods anchored on the cutoff so the newest period is complete.
  const bucket =
    interval === "day"
      ? Prisma.sql`ist_date`
      : interval === "week"
        ? Prisma.sql`(${run.businessDateIst}::date - ((((${run.businessDateIst}::date - ist_date) / 7::int))::int * 7))`
        : Prisma.sql`(${run.businessDateIst}::date - (widx * ${SALES_WINDOW_SIZE_DAYS}::int))`;
  const span = interval === "day" ? 1 : interval === "week" ? 7 : SALES_WINDOW_SIZE_DAYS;

  const rows = await db.$queryRaw<TrendAggRow[]>`
    ${saleCte(run, f)}
    SELECT
      to_char(${bucket}, 'YYYY-MM-DD')                    AS period_key,
      to_char(${bucket} - ${span - 1}::int, 'YYYY-MM-DD') AS period_start,
      to_char(${bucket}, 'YYYY-MM-DD')                    AS period_end,
      SUM(qty)::float8                    AS qty,
      SUM(wt)::float8                     AS wt,
      COUNT(*)::int                       AS records,
      COUNT(DISTINCT category_id)::int    AS categories
    FROM sale
    GROUP BY 1, 2, 3
    ORDER BY 1 ASC
    LIMIT ${GROUP_CEILING + 1}`;
  guardGroups(rows.length);

  return {
    interval,
    available: true,
    rows: rows.map((r) => ({
      periodKey: r.period_key,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      confirmedQuantity: num(r.qty),
      confirmedWeight: Math.round(num(r.wt) * 1e6) / 1e6,
      recordCount: r.records,
      distinctCategories: r.categories,
    })),
  };
}

// ---------------------------------------------------------------------------
// E. Customer / country / branch contribution
// ---------------------------------------------------------------------------

interface ContributionAggRow {
  k: string | null;
  label: string | null;
  sum_qty: number | null;
  sum_wt: number | null;
  records: number;
  latest_date: string | null;
  total_groups: number;
}

const UNATTRIBUTED = "Not attributed";

export async function getSalesContribution(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  dimension: ContributionDimension,
  page: SalesPageRequest,
): Promise<{ dimension: ContributionDimension; rows: ContributionRow[]; paging: PagingMeta }> {
  // The grouping column comes from this fixed map, never from the request.
  const keyCol =
    dimension === "customer" ? Prisma.sql`customer_code` : dimension === "country" ? Prisma.sql`country` : Prisma.sql`branch`;
  const labelCol = dimension === "customer" ? Prisma.sql`MIN(customer_name)` : Prisma.sql`MIN(${keyCol})`;
  const offset = (page.page - 1) * page.pageSize;

  const rows = await db.$queryRaw<ContributionAggRow[]>`
    ${saleCte(run, f)}
    SELECT
      ${keyCol}        AS k,
      ${labelCol}      AS label,
      SUM(qty)::float8 AS sum_qty,
      SUM(wt)::float8  AS sum_wt,
      COUNT(*)::int    AS records,
      to_char(MAX(ist_date), 'YYYY-MM-DD') AS latest_date,
      (COUNT(*) OVER ())::int AS total_groups
    FROM sale
    GROUP BY 1
    ORDER BY sum_qty DESC NULLS LAST, k ASC NULLS LAST
    LIMIT ${page.pageSize} OFFSET ${offset}`;

  const total = rows[0]?.total_groups ?? 0;
  return {
    dimension,
    paging: { page: page.page, pageSize: page.pageSize, total, hasMore: offset + page.pageSize < total },
    rows: rows.map((r) => ({
      key: r.k ?? "",
      label: r.label ?? UNATTRIBUTED,
      confirmedQuantity: num(r.sum_qty),
      confirmedWeight: Math.round(num(r.sum_wt) * 1e6) / 1e6,
      recordCount: r.records,
      latestSaleDate: r.latest_date,
    })),
  };
}

// ---------------------------------------------------------------------------
// F. Supporting records
// ---------------------------------------------------------------------------

interface RecordAggRow {
  record_id: string;
  lot_id: string | null;
  doc_date: Date | null;
  category_id: string;
  qty: number;
  wt: number | null;
  country: string | null;
  branch: string | null;
  customer_code: string | null;
  customer_name: string | null;
  lab: string;
  shape: string;
  weight_band: string;
  total_rows: number;
}

const RECORD_ORDER: Record<RecordSortKey, Prisma.Sql> = {
  docDate: Prisma.sql`doc_date`,
  quantity: Prisma.sql`qty`,
  weight: Prisma.sql`wt`,
  category: Prisma.sql`category_id`,
};

/**
 * The exact records behind an aggregate. Allowlisted business fields only: no raw source
 * payload, no stored reason text, no remark, no formula and no internal identifier
 * beyond the ones the drill-down itself needs.
 */
export async function getSupportingRecords(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  sort: { key: RecordSortKey; dir: SortDirection },
  page: SalesPageRequest,
  options: { includeCustomer: boolean },
): Promise<{ rows: SupportingRecordRow[]; paging: PagingMeta }> {
  const offset = (page.page - 1) * page.pageSize;
  const dir = sort.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const sourceState = snapshotMeta(run).sourceState;

  const rows = await db.$queryRaw<RecordAggRow[]>`
    ${saleCte(run, f)}
    SELECT
      record_id, lot_id, doc_date, category_id, qty, wt,
      country, branch, customer_code, customer_name, lab, shape, weight_band,
      (COUNT(*) OVER ())::int AS total_rows
    FROM sale
    ORDER BY ${RECORD_ORDER[sort.key]} ${dir} NULLS LAST, record_id ASC
    LIMIT ${page.pageSize} OFFSET ${offset}`;

  const total = rows[0]?.total_rows ?? 0;
  return {
    paging: { page: page.page, pageSize: page.pageSize, total, hasMore: offset + page.pageSize < total },
    rows: rows.map((r) => {
      const confirmed = [r.lab, r.shape, r.weight_band].filter(Boolean).length === 3;
      const row: SupportingRecordRow = {
        recordId: r.record_id,
        lotId: r.lot_id,
        docDate: r.doc_date ? r.doc_date.toISOString() : null,
        lifecycle: CONFIRMED_SALE_LIFECYCLE,
        categoryId: r.category_id,
        confirmedQuantity: num(r.qty),
        measuredWeight: r.wt === null ? null : Math.round(num(r.wt) * 1e6) / 1e6,
        country: r.country,
        branch: r.branch,
        sourceState,
        dataState: confirmed ? "CONFIRMED" : "REVIEW_REQUIRED",
      };
      if (options.includeCustomer) {
        row.customerCode = r.customer_code;
        row.customerName = r.customer_name;
      }
      return row;
    }),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Category rows for a server-generated export. Same snapshot, same filters and the same
 * eligibility policy as the screen; capped, and the cap is reported rather than hidden.
 */
export async function getCategorySummaryForExport(
  run: SalesSnapshot,
  f: ScopedSalesFilters,
  sort: { key: CategorySortKey; dir: SortDirection },
): Promise<{ rows: CategorySalesRow[]; total: number; truncated: boolean }> {
  const result = await getCategorySalesSummary(run, f, sort, { page: 1, pageSize: EXPORT_ROW_LIMIT });
  return { rows: result.rows, total: result.paging.total, truncated: result.paging.total > EXPORT_ROW_LIMIT };
}
