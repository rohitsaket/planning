/**
 * STOCKOUT RISK — bounded read service.
 *
 * One question: which planning categories have confirmed demand that physically
 * available finished polished stock does not cover?
 *
 * Every number here is read from `DemandMetric`, the row the approved demand engine
 * persisted for the selected run. This module computes no shortage of its own. That is
 * the whole point: the page that reports a shortage and the page that calculated it must
 * be the same answer, and the only way to guarantee that is to read the stored value
 * rather than re-derive it from inventory that has since moved.
 *
 * What the engine already decided, and this module does not revisit:
 *   - Memo stock is advisory and does not cover the target.
 *   - Reserved and blocked stock do not cover the target.
 *   - WIP is reported separately and does not reduce physical shortage until the WIP
 *     coverage policy is confirmed.
 *   - Held, excluded, unknown and unclassified stock do not cover the target.
 *
 * Rough stock is deliberately absent. `RoughStone` is keyed by kapan and packet and
 * carries no lab, shape or weight band, so there is no authoritative category to match a
 * rough figure to. Showing one would mean inventing the join.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatIST } from "@/lib/fantasy/time";
import { toCategoryLabel, toSalesTrendDirection, type SalesTrendDirection } from "@/lib/demand/demand-result-presentation";
import { resolveAnalysisAvailability, type AnalysisAvailability } from "@/lib/analysis/analysis-snapshot";

if (typeof window !== "undefined") {
  throw new Error("analysis/stockout is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const STOCKOUT_PAGE_DEFAULT = 25;
export const STOCKOUT_PAGE_MAX = 200;
/** Ceiling for one export. Declared to the caller; never a silent cut-off. */
export const STOCKOUT_EXPORT_ROW_LIMIT = Number(process.env.STOCKOUT_EXPORT_MAX_ROWS || 20_000);
/** Rows per query while exporting, so a large export never materializes one huge set. */
const EXPORT_READ_BATCH = 2_000;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Factual outcomes, each decidable from stored values alone.
 *
 * There is deliberately no Critical / High / Medium ranking: that would need a scoring
 * rule nobody has approved, and the previous page invented one.
 */
export const STOCKOUT_STATES = ["OUT_OF_STOCK", "SHORTAGE", "COVERED", "EXCESS", "REVIEW_REQUIRED"] as const;
export type StockoutState = (typeof STOCKOUT_STATES)[number];

export const STOCKOUT_STATE_LABELS: Record<StockoutState, string> = {
  OUT_OF_STOCK: "Out of stock",
  SHORTAGE: "Shortage",
  COVERED: "Covered",
  EXCESS: "Excess",
  REVIEW_REQUIRED: "Review required",
};

/** Whether a category's own figures can be trusted, as the engine recorded it. */
export const STOCKOUT_DATA_STATES = ["CONFIRMED", "REVIEW_REQUIRED", "BLOCKED"] as const;
export type StockoutDataState = (typeof STOCKOUT_DATA_STATES)[number];

export const STOCKOUT_SORTS = ["physicalShortage", "target", "available", "sales90d", "category"] as const;
export type StockoutSortKey = (typeof STOCKOUT_SORTS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export interface StockoutFilters {
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  stockoutState: StockoutState | null;
  dataState: StockoutDataState | null;
  search: string | null;
  /** Default view is the page's purpose: categories that are short. */
  shortageOnly: boolean;
}

export const EMPTY_STOCKOUT_FILTERS: StockoutFilters = {
  lab: null, shape: null, weightBand: null, stockoutState: null,
  dataState: null, search: null, shortageOnly: true,
};

export interface Paging { page: number; pageSize: number }
export interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

// ---------------------------------------------------------------------------
// Snapshot status
// ---------------------------------------------------------------------------

export interface StockoutSnapshotStatus {
  readonly hasRun: boolean;
  readonly runId: string | null;
  readonly availabilityState: AnalysisAvailability["state"];
  readonly availabilityMessage: string;
  readonly sourceState: "SIMULATION" | "LIVE";
  readonly sourceLabel: string;
  readonly runCompletedIst: string | null;
  readonly businessDateIst: string | null;
  readonly windowDays: number | null;
  readonly periodLabel: string;
  /** The inventory cutoff the run itself read. */
  readonly inventoryCutoffIst: string | null;
  /** True when canonical stock has been observed since the run's cutoff. */
  readonly inventoryChangedSinceRun: boolean;
  readonly latestInventoryObservedIst: string | null;
  readonly staleWarning: string | null;
  readonly reviewWarning: string | null;
  readonly unavailableMessage: string | null;
  /** Demand is stored per category only; country and branch are not dimensions of it. */
  readonly countryScopeSupported: false;
  readonly countryScopeNotice: string;
}

const COUNTRY_SCOPE_NOTICE =
  "Shortage is calculated per planning category across the whole business. Country and branch " +
  "are not dimensions of the stored demand target, so filtering by them here would narrow the " +
  "stock without narrowing the target and overstate the shortage.";

export async function readStockoutSnapshotStatus(
  client: DbClient = db,
  runIdOverride?: string | null,
): Promise<StockoutSnapshotStatus> {
  const availability = await resolveAnalysisAvailability(client);

  // A bookmarked link names its run. The latest is never substituted for it, because
  // that would answer a different question than the link asked.
  const runId = runIdOverride ?? availability.snapshot?.id ?? null;
  const run = runId
    ? await client.demandRun.findUnique({ where: { id: runId }, select: RUN_STATUS_SELECT })
    : null;

  if (!run) {
    return {
      hasRun: false,
      runId: null,
      availabilityState: availability.state,
      availabilityMessage: availability.message,
      sourceState: "SIMULATION",
      sourceLabel: "No demand calculation",
      runCompletedIst: null,
      businessDateIst: null,
      windowDays: null,
      periodLabel: "Past 90 days",
      inventoryCutoffIst: null,
      inventoryChangedSinceRun: false,
      latestInventoryObservedIst: null,
      staleWarning: null,
      reviewWarning: null,
      unavailableMessage:
        "No completed 90-day demand calculation is available. Stockout risk cannot be determined.",
      countryScopeSupported: false,
      countryScopeNotice: COUNTRY_SCOPE_NOTICE,
    };
  }

  // Staleness is measured against the run's own cutoff, not the clock: stock observed
  // after the run was calculated is not in its shortage figures.
  const cutoff = run.sourceCutoff ?? run.finishedAt ?? run.runDate;
  const latestInventory = await client.lotMasterRecord.findFirst({
    where: { isCurrent: true },
    orderBy: { lastSeenAt: "desc" },
    select: { lastSeenAt: true },
  });
  const inventoryChanged = Boolean(latestInventory?.lastSeenAt && cutoff && latestInventory.lastSeenAt > cutoff);
  const simulated = run.isSimulated;

  return {
    hasRun: true,
    runId: run.id,
    availabilityState: availability.state,
    availabilityMessage: availability.message,
    sourceState: simulated ? "SIMULATION" : "LIVE",
    sourceLabel: simulated ? "Fixture Simulation" : "Live Fantasy",
    runCompletedIst: formatIST(run.finishedAt ?? run.runDate, false),
    businessDateIst: run.businessDateIst,
    windowDays: run.windowDays,
    periodLabel: run.windowDays === 90 ? "Past 90 days (IST)" : `Past ${run.windowDays} days (IST)`,
    inventoryCutoffIst: cutoff ? formatIST(cutoff, false) : null,
    inventoryChangedSinceRun: inventoryChanged,
    latestInventoryObservedIst: latestInventory?.lastSeenAt ? formatIST(latestInventory.lastSeenAt, false) : null,
    staleWarning: inventoryChanged
      ? "Inventory has changed since this shortage calculation. Run an authorized demand refresh to update the results."
      : null,
    reviewWarning:
      run.status === "REVIEW_REQUIRED"
        ? "This calculation completed with categories that need review. Those rows are marked and excluded from the totals below."
        : null,
    unavailableMessage: null,
    countryScopeSupported: false,
    countryScopeNotice: COUNTRY_SCOPE_NOTICE,
  };
}

/**
 * Exactly what the status panel needs. `sourceCutoff` is not part of the shared
 * `SnapshotCandidate` contract, so this module selects its own fields rather than
 * widening a type other pages depend on.
 */
const RUN_STATUS_SELECT = {
  id: true, status: true, runDate: true, finishedAt: true, windowDays: true,
  businessDateIst: true, isSimulated: true, sourceCutoff: true,
} as const;

// ---------------------------------------------------------------------------
// Category rows
// ---------------------------------------------------------------------------

export interface StockoutRow {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly lab: string | null;
  readonly shape: string | null;
  readonly weightBand: string | null;
  readonly sales90d: number;
  readonly targetQuantity: number;
  readonly physicalAvailable: number;
  readonly physicalShortage: number;
  /** Advisory. Never deducted from shortage. */
  readonly memoQuantity: number;
  /** Reported separately. Never deducted until the coverage policy is confirmed. */
  readonly wipQuantity: number;
  readonly stockoutState: StockoutState;
  readonly dataState: StockoutDataState;
}

export interface StockoutTotals {
  readonly categoriesWithShortage: number;
  readonly categoriesOutOfStock: number;
  readonly totalTargetQuantity: number;
  readonly totalPhysicalAvailable: number;
  readonly totalPhysicalShortage: number;
  readonly categoriesRequiringReview: number;
}

export interface StockoutCategoriesResult {
  readonly rows: StockoutRow[];
  readonly paging: PagingMeta;
  readonly totals: StockoutTotals;
  readonly sort: { key: StockoutSortKey; dir: SortDirection };
}

/** A metric row is trusted unless the engine itself flagged it. */
function dataStateOf(status: string): StockoutDataState {
  if (status === "BLOCKED_BY_DATA_QUALITY") return "BLOCKED";
  return status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "CONFIRMED";
}

/**
 * The category's outcome, from stored values only.
 *
 * A category whose own figures need review is reported as such rather than being given a
 * shortage verdict its numbers cannot support.
 */
function stockoutStateOf(m: { roundedTarget: number; availableStock: number; physicalShortage: number; excessStock: number; status: string }): StockoutState {
  if (dataStateOf(m.status) !== "CONFIRMED") return "REVIEW_REQUIRED";
  if (m.roundedTarget > 0 && m.availableStock === 0) return "OUT_OF_STOCK";
  if (m.physicalShortage > 0) return "SHORTAGE";
  if (m.excessStock > 0) return "EXCESS";
  return "COVERED";
}

/** The Prisma filter for everything the database can decide. */
function whereFor(runId: string, f: StockoutFilters): Prisma.DemandMetricWhereInput {
  const where: Prisma.DemandMetricWhereInput = { runId };
  if (f.lab) where.labNormalized = f.lab;
  if (f.shape) where.shapeNormalized = f.shape;
  if (f.weightBand) where.weightBandLabel = f.weightBand;
  if (f.shortageOnly) where.physicalShortage = { gt: 0 };
  if (f.search) {
    const contains = f.search.replace(/[\\%_]/g, "\\$&");
    where.planningCategory = { contains, mode: "insensitive" };
  }
  if (f.dataState) {
    where.status =
      f.dataState === "BLOCKED" ? "BLOCKED_BY_DATA_QUALITY"
      : f.dataState === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED"
      : { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] };
  }
  // `stockoutState` mixes stored columns, so it is expressed as column predicates rather
  // than computed after paging — otherwise a page could come back short.
  if (f.stockoutState) {
    const confirmed = { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] };
    switch (f.stockoutState) {
      case "REVIEW_REQUIRED":
        where.status = { in: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] };
        break;
      case "OUT_OF_STOCK":
        where.status = confirmed;
        where.roundedTarget = { gt: 0 };
        where.availableStock = 0;
        break;
      case "SHORTAGE":
        where.status = confirmed;
        where.physicalShortage = { gt: 0 };
        where.availableStock = { gt: 0 };
        break;
      case "EXCESS":
        where.status = confirmed;
        where.physicalShortage = 0;
        where.excessStock = { gt: 0 };
        break;
      case "COVERED":
        where.status = confirmed;
        where.physicalShortage = 0;
        where.excessStock = 0;
        break;
    }
  }
  return where;
}

/** Deterministic ordering: the chosen key, then the category key as a stable tie-breaker. */
function orderFor(sort: { key: StockoutSortKey; dir: SortDirection }): Prisma.DemandMetricOrderByWithRelationInput[] {
  const column: Record<StockoutSortKey, keyof Prisma.DemandMetricOrderByWithRelationInput> = {
    physicalShortage: "physicalShortage",
    target: "roundedTarget",
    available: "availableStock",
    sales90d: "sales90d",
    category: "planningCategory",
  };
  const key = column[sort.key];
  if (key === "planningCategory") return [{ planningCategory: sort.dir }];
  return [{ [key]: sort.dir } as Prisma.DemandMetricOrderByWithRelationInput, { planningCategory: "asc" }];
}

const ROW_SELECT = {
  planningCategory: true, labNormalized: true, shapeNormalized: true, weightBandLabel: true,
  sales90d: true, roundedTarget: true, availableStock: true, physicalShortage: true,
  excessStock: true, memoQty: true, wipCoverage: true, unallocatedWip: true, status: true,
} as const;

type MetricRow = Prisma.DemandMetricGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(m: MetricRow): StockoutRow {
  const lab = m.labNormalized;
  const shape = m.shapeNormalized;
  const band = m.weightBandLabel;
  return {
    categoryId: m.planningCategory,
    categoryLabel: toCategoryLabel(lab ?? "", shape ?? "", band ?? ""),
    lab, shape, weightBand: band,
    sales90d: m.sales90d,
    targetQuantity: m.roundedTarget,
    physicalAvailable: m.availableStock,
    physicalShortage: m.physicalShortage,
    memoQuantity: m.memoQty,
    // Eligible plus unallocated: the whole WIP position for the category, shown beside
    // the shortage rather than inside it.
    wipQuantity: m.wipCoverage + m.unallocatedWip,
    stockoutState: stockoutStateOf(m),
    dataState: dataStateOf(m.status),
  };
}

/**
 * One page of categories, filtered sorted and counted by the database.
 *
 * Totals are computed across every matching category, not the visible page, and exclude
 * rows the engine flagged — a figure that cannot be trusted must not be summed into one
 * that is presented as authoritative.
 */
export async function readStockoutCategories(
  runId: string,
  filters: StockoutFilters,
  paging: Paging,
  sort: { key: StockoutSortKey; dir: SortDirection },
  client: DbClient = db,
): Promise<StockoutCategoriesResult> {
  const where = whereFor(runId, filters);
  const confirmedOnly: Prisma.DemandMetricWhereInput = {
    ...where,
    status: { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] },
  };

  const [total, rows, sums, shortageCount, outOfStockCount, reviewCount] = await Promise.all([
    client.demandMetric.count({ where }),
    client.demandMetric.findMany({
      where,
      orderBy: orderFor(sort),
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: ROW_SELECT,
    }),
    client.demandMetric.aggregate({
      where: confirmedOnly,
      _sum: { roundedTarget: true, availableStock: true, physicalShortage: true },
    }),
    client.demandMetric.count({ where: { ...confirmedOnly, physicalShortage: { gt: 0 } } }),
    client.demandMetric.count({ where: { ...confirmedOnly, roundedTarget: { gt: 0 }, availableStock: 0 } }),
    client.demandMetric.count({ where: { ...where, status: { in: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] } } }),
  ]);

  return {
    rows: rows.map(toRow),
    paging: {
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      hasMore: paging.page * paging.pageSize < total,
    },
    totals: {
      categoriesWithShortage: shortageCount,
      categoriesOutOfStock: outOfStockCount,
      totalTargetQuantity: sums._sum.roundedTarget ?? 0,
      totalPhysicalAvailable: sums._sum.availableStock ?? 0,
      totalPhysicalShortage: sums._sum.physicalShortage ?? 0,
      categoriesRequiringReview: reviewCount,
    },
    sort,
  };
}

/** Every matching row for an export, read in bounded batches. */
export async function readStockoutForExport(
  runId: string,
  filters: StockoutFilters,
  sort: { key: StockoutSortKey; dir: SortDirection },
  client: DbClient = db,
): Promise<{ rows: StockoutRow[]; total: number; truncated: boolean }> {
  const where = whereFor(runId, filters);
  const total = await client.demandMetric.count({ where });
  const target = Math.min(total, STOCKOUT_EXPORT_ROW_LIMIT);

  const rows: StockoutRow[] = [];
  while (rows.length < target) {
    const batch = await client.demandMetric.findMany({
      where,
      orderBy: orderFor(sort),
      skip: rows.length,
      take: Math.min(EXPORT_READ_BATCH, target - rows.length),
      select: ROW_SELECT,
    });
    if (batch.length === 0) break;
    rows.push(...batch.map(toRow));
  }

  return { rows, total, truncated: total > STOCKOUT_EXPORT_ROW_LIMIT };
}

// ---------------------------------------------------------------------------
// Category detail
// ---------------------------------------------------------------------------

export interface StockoutDetail extends StockoutRow {
  readonly found: true;
  readonly reservedQuantity: number;
  readonly blockedQuantity: number;
  readonly excessQuantity: number;
  readonly segments: ReadonlyArray<{ key: string; label: string; quantity: number }>;
  readonly trend: SalesTrendDirection;
  readonly latestSaleDateIst: string | null;
  readonly contributingStockLots: number;
  readonly excludedRecords: number;
}

export interface StockoutDetailMissing {
  readonly found: false;
  readonly categoryId: string;
  readonly message: string;
}

/**
 * Business supporting detail for one category.
 *
 * A category the selected run does not contain is reported as absent, never replaced
 * with the first row of the result — a bookmarked link to a category that has since
 * dropped out of the run must say so.
 */
export async function readStockoutDetail(
  runId: string,
  categoryId: string,
  client: DbClient = db,
): Promise<StockoutDetail | StockoutDetailMissing> {
  const metric = await client.demandMetric.findFirst({
    where: { runId, planningCategory: categoryId },
    select: { ...ROW_SELECT, reservedQty: true, blockedQty: true },
  });

  if (!metric) {
    return {
      found: false,
      categoryId,
      message: "This category is not part of the selected demand calculation.",
    };
  }

  const [segments, latestSale, stockLots, excluded] = await Promise.all([
    readSegments(client, runId, categoryId),
    client.demandMetricTraceItem.findFirst({
      where: { runId, planningCategory: categoryId, traceType: "SALE", isIncluded: true },
      orderBy: { docDate: "desc" },
      select: { docDate: true },
    }),
    client.demandMetricTraceItem.count({
      where: { runId, planningCategory: categoryId, traceType: "STOCK", isIncluded: true },
    }),
    client.demandMetricTraceItem.count({
      where: { runId, planningCategory: categoryId, isIncluded: false },
    }),
  ]);

  const base = toRow(metric);
  const earliest = segments[0]?.quantity ?? 0;
  const latest = segments[segments.length - 1]?.quantity ?? 0;

  return {
    ...base,
    found: true,
    reservedQuantity: metric.reservedQty,
    blockedQuantity: metric.blockedQty,
    excessQuantity: metric.excessStock,
    segments,
    trend: toSalesTrendDirection(earliest, latest),
    latestSaleDateIst: latestSale?.docDate ? formatIST(latestSale.docDate, false) : null,
    contributingStockLots: stockLots,
    excludedRecords: excluded,
  };
}

/**
 * The three approved 30-day segments, counted from the run's own persisted sale trace.
 *
 * Quantity comes from the trace row, so a record whose quantity was never established is
 * not silently counted as one piece.
 */
async function readSegments(
  client: DbClient,
  runId: string,
  categoryId: string,
): Promise<Array<{ key: string; label: string; quantity: number }>> {
  const run = await client.demandRun.findUnique({
    where: { id: runId },
    select: { lookbackStart: true, lookbackEnd: true },
  });
  if (!run?.lookbackStart || !run.lookbackEnd) return [];

  const end = run.lookbackEnd.getTime();
  const day = 86_400_000;
  const bounds = [
    { key: "previous30", label: "Previous 30D", from: end - 90 * day, to: end - 60 * day },
    { key: "middle30", label: "Middle 30D", from: end - 60 * day, to: end - 30 * day },
    { key: "latest30", label: "Latest 30D", from: end - 30 * day, to: end },
  ];

  return Promise.all(
    bounds.map(async (b) => {
      const agg = await client.demandMetricTraceItem.aggregate({
        where: {
          runId,
          planningCategory: categoryId,
          traceType: "SALE",
          isIncluded: true,
          docDate: { gte: new Date(b.from), lte: new Date(b.to) },
        },
        _sum: { quantity: true },
      });
      return { key: b.key, label: b.label, quantity: Number(agg._sum.quantity ?? 0) };
    }),
  );
}
