/**
 * EXCESS STOCK — bounded read service.
 *
 * One question: which planning categories hold more physically available finished
 * polished stock than the demand target the engine stored for them?
 *
 * The factual counterpart of Stockout Risk, and deliberately built from the same parts:
 * the same snapshot selection, the same filters, the same row projection. Both read
 * `DemandMetric.excessStock` and `DemandMetric.physicalShortage` — two values the
 * approved demand engine already decided — so the two pages cannot disagree about the
 * same category. Nothing here recomputes either.
 *
 * What the engine already decided, and this module does not revisit:
 *   - Memo is advisory and is neither availability nor excess.
 *   - Reserved, blocked, held and review-required stock are not availability.
 *   - WIP is reported separately and is not finished stock.
 *   - Rough is not finished stock at all.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatIST } from "@/lib/fantasy/time";
import { toCategoryLabel } from "@/lib/demand/demand-result-presentation";
import {
  EMPTY_STOCKOUT_FILTERS,
  type Paging,
  type PagingMeta,
  type SortDirection,
  type StockoutDataState,
  type StockoutFilters,
} from "@/lib/analysis/stockout";

if (typeof window !== "undefined") {
  throw new Error("analysis/excess is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const EXCESS_PAGE_DEFAULT = 25;
export const EXCESS_PAGE_MAX = 200;
export const EXCESS_EXPORT_ROW_LIMIT = Number(process.env.EXCESS_EXPORT_MAX_ROWS || 20_000);
const EXPORT_READ_BATCH = 2_000;

/**
 * Factual outcomes, each decidable from stored values alone.
 *
 * No ranking, no severity: how much stock is "too much" is a business judgement nobody
 * has made, and inventing a threshold would put an unapproved rule on the page.
 */
export const EXCESS_STATES = ["EXCESS", "AT_TARGET", "BELOW_TARGET", "NO_TARGET", "REVIEW_REQUIRED"] as const;
export type ExcessState = (typeof EXCESS_STATES)[number];

export const EXCESS_STATE_LABELS: Record<ExcessState, string> = {
  EXCESS: "Stock held above target",
  AT_TARGET: "At target",
  BELOW_TARGET: "Below target",
  NO_TARGET: "No target",
  REVIEW_REQUIRED: "Review required",
};

export const EXCESS_SORTS = ["excess", "available", "target", "sales90d", "category"] as const;
export type ExcessSortKey = (typeof EXCESS_SORTS)[number];

/** The same filter vocabulary as Stockout, with the page's own default view. */
export interface ExcessFilters extends Omit<StockoutFilters, "stockoutState" | "shortageOnly"> {
  excessState: ExcessState | null;
  /** The page's purpose: categories actually holding stock above target. */
  excessOnly: boolean;
}

export const EMPTY_EXCESS_FILTERS: ExcessFilters = {
  lab: EMPTY_STOCKOUT_FILTERS.lab,
  shape: EMPTY_STOCKOUT_FILTERS.shape,
  weightBand: EMPTY_STOCKOUT_FILTERS.weightBand,
  dataState: EMPTY_STOCKOUT_FILTERS.dataState,
  search: EMPTY_STOCKOUT_FILTERS.search,
  excessState: null,
  excessOnly: true,
};

export interface ExcessRow {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly lab: string | null;
  readonly shape: string | null;
  readonly weightBand: string | null;
  readonly sales90d: number;
  readonly targetQuantity: number;
  readonly physicalAvailable: number;
  readonly excessQuantity: number;
  /** Advisory. Neither availability nor excess. */
  readonly memoQuantity: number;
  /** Reported separately. Not finished stock. */
  readonly wipQuantity: number;
  readonly latestSaleDateIst: string | null;
  readonly excessState: ExcessState;
  readonly dataState: StockoutDataState;
}

export interface ExcessTotals {
  readonly categoriesWithExcess: number;
  readonly totalPhysicalAvailable: number;
  readonly totalTargetQuantity: number;
  readonly totalExcessQuantity: number;
  readonly categoriesRequiringReview: number;
}

export interface ExcessCategoriesResult {
  readonly rows: ExcessRow[];
  readonly paging: PagingMeta;
  readonly totals: ExcessTotals;
  readonly sort: { key: ExcessSortKey; dir: SortDirection };
}

function dataStateOf(status: string): StockoutDataState {
  if (status === "BLOCKED_BY_DATA_QUALITY") return "BLOCKED";
  return status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "CONFIRMED";
}

/**
 * The category's outcome, from stored values only.
 *
 * A category the engine flagged is reported as needing review rather than being given an
 * excess verdict its own figures cannot support.
 */
function excessStateOf(m: {
  roundedTarget: number;
  availableStock: number;
  excessStock: number;
  physicalShortage: number;
  status: string;
}): ExcessState {
  if (dataStateOf(m.status) !== "CONFIRMED") return "REVIEW_REQUIRED";
  if (m.excessStock > 0) return "EXCESS";
  if (m.roundedTarget === 0) return "NO_TARGET";
  if (m.physicalShortage > 0) return "BELOW_TARGET";
  return "AT_TARGET";
}

const CONFIRMED_STATUS = { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] };

function whereFor(runId: string, f: ExcessFilters): Prisma.DemandMetricWhereInput {
  const where: Prisma.DemandMetricWhereInput = { runId };
  if (f.lab) where.labNormalized = f.lab;
  if (f.shape) where.shapeNormalized = f.shape;
  if (f.weightBand) where.weightBandLabel = f.weightBand;
  if (f.excessOnly) where.excessStock = { gt: 0 };
  if (f.search) {
    const contains = f.search.replace(/[\\%_]/g, "\\$&");
    where.planningCategory = { contains, mode: "insensitive" };
  }
  if (f.dataState) {
    where.status =
      f.dataState === "BLOCKED" ? "BLOCKED_BY_DATA_QUALITY"
      : f.dataState === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED"
      : CONFIRMED_STATUS;
  }
  // Expressed as column predicates rather than filtered after paging, so a page can
  // never come back short.
  if (f.excessState) {
    switch (f.excessState) {
      case "REVIEW_REQUIRED":
        where.status = { in: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] };
        break;
      case "EXCESS":
        where.status = CONFIRMED_STATUS;
        where.excessStock = { gt: 0 };
        break;
      case "NO_TARGET":
        where.status = CONFIRMED_STATUS;
        where.excessStock = 0;
        where.roundedTarget = 0;
        break;
      case "BELOW_TARGET":
        where.status = CONFIRMED_STATUS;
        where.excessStock = 0;
        where.physicalShortage = { gt: 0 };
        break;
      case "AT_TARGET":
        where.status = CONFIRMED_STATUS;
        where.excessStock = 0;
        where.physicalShortage = 0;
        where.roundedTarget = { gt: 0 };
        break;
    }
  }
  return where;
}

/** Deterministic ordering: the chosen key, then the category key as a stable tie-break. */
function orderFor(sort: { key: ExcessSortKey; dir: SortDirection }): Prisma.DemandMetricOrderByWithRelationInput[] {
  const column: Record<ExcessSortKey, keyof Prisma.DemandMetricOrderByWithRelationInput> = {
    excess: "excessStock",
    available: "availableStock",
    target: "roundedTarget",
    sales90d: "sales90d",
    category: "planningCategory",
  };
  const key = column[sort.key];
  if (key === "planningCategory") return [{ planningCategory: sort.dir }];
  return [{ [key]: sort.dir } as Prisma.DemandMetricOrderByWithRelationInput, { planningCategory: "asc" }];
}

const ROW_SELECT = {
  planningCategory: true, labNormalized: true, shapeNormalized: true, weightBandLabel: true,
  sales90d: true, roundedTarget: true, availableStock: true, excessStock: true,
  physicalShortage: true, memoQty: true, wipCoverage: true, unallocatedWip: true, status: true,
} as const;

type MetricRow = Prisma.DemandMetricGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(m: MetricRow, latestSale: string | null): ExcessRow {
  return {
    categoryId: m.planningCategory,
    categoryLabel: toCategoryLabel(m.labNormalized ?? "", m.shapeNormalized ?? "", m.weightBandLabel ?? ""),
    lab: m.labNormalized,
    shape: m.shapeNormalized,
    weightBand: m.weightBandLabel,
    sales90d: m.sales90d,
    targetQuantity: m.roundedTarget,
    physicalAvailable: m.availableStock,
    excessQuantity: m.excessStock,
    memoQuantity: m.memoQty,
    // Eligible plus unallocated: the whole WIP position, beside the excess rather than
    // inside it.
    wipQuantity: m.wipCoverage + m.unallocatedWip,
    latestSaleDateIst: latestSale,
    excessState: excessStateOf(m),
    dataState: dataStateOf(m.status),
  };
}

/**
 * The latest confirmed sale for each category on the page, in one grouped query.
 *
 * Deliberately not a per-row lookup: a page of 200 categories would otherwise issue 200
 * queries for a single display column.
 */
async function latestSalesFor(
  client: DbClient,
  runId: string,
  categories: string[],
): Promise<Map<string, string>> {
  if (categories.length === 0) return new Map();
  const grouped = await client.demandMetricTraceItem.groupBy({
    by: ["planningCategory"],
    where: { runId, planningCategory: { in: categories }, traceType: "SALE", isIncluded: true },
    _max: { docDate: true },
  });
  const map = new Map<string, string>();
  for (const g of grouped) {
    if (g._max.docDate) map.set(g.planningCategory, formatIST(g._max.docDate, false));
  }
  return map;
}

/**
 * One page of categories, filtered sorted and counted by the database.
 *
 * Totals are computed across every matching category, not the visible page, and exclude
 * rows the engine flagged — a figure that cannot be trusted must not be summed into one
 * presented as authoritative.
 */
export async function readExcessCategories(
  runId: string,
  filters: ExcessFilters,
  paging: Paging,
  sort: { key: ExcessSortKey; dir: SortDirection },
  client: DbClient = db,
): Promise<ExcessCategoriesResult> {
  const where = whereFor(runId, filters);
  const confirmedOnly: Prisma.DemandMetricWhereInput = { ...where, status: CONFIRMED_STATUS };

  const [total, rows, sums, excessCount, reviewCount] = await Promise.all([
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
      _sum: { availableStock: true, roundedTarget: true, excessStock: true },
    }),
    client.demandMetric.count({ where: { ...confirmedOnly, excessStock: { gt: 0 } } }),
    client.demandMetric.count({
      where: { ...where, status: { in: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] } },
    }),
  ]);

  const latest = await latestSalesFor(client, runId, rows.map((r) => r.planningCategory));

  return {
    rows: rows.map((m) => toRow(m, latest.get(m.planningCategory) ?? null)),
    paging: {
      page: paging.page,
      pageSize: paging.pageSize,
      total,
      hasMore: paging.page * paging.pageSize < total,
    },
    totals: {
      categoriesWithExcess: excessCount,
      totalPhysicalAvailable: sums._sum.availableStock ?? 0,
      totalTargetQuantity: sums._sum.roundedTarget ?? 0,
      totalExcessQuantity: sums._sum.excessStock ?? 0,
      categoriesRequiringReview: reviewCount,
    },
    sort,
  };
}

/** Every matching row for an export, read in bounded batches. */
export async function readExcessForExport(
  runId: string,
  filters: ExcessFilters,
  sort: { key: ExcessSortKey; dir: SortDirection },
  client: DbClient = db,
): Promise<{ rows: ExcessRow[]; total: number; truncated: boolean }> {
  const where = whereFor(runId, filters);
  const total = await client.demandMetric.count({ where });
  const target = Math.min(total, EXCESS_EXPORT_ROW_LIMIT);

  const rows: ExcessRow[] = [];
  while (rows.length < target) {
    const batch = await client.demandMetric.findMany({
      where,
      orderBy: orderFor(sort),
      skip: rows.length,
      take: Math.min(EXPORT_READ_BATCH, target - rows.length),
      select: ROW_SELECT,
    });
    if (batch.length === 0) break;
    const latest = await latestSalesFor(client, runId, batch.map((r) => r.planningCategory));
    rows.push(...batch.map((m) => toRow(m, latest.get(m.planningCategory) ?? null)));
  }

  return { rows, total, truncated: total > EXCESS_EXPORT_ROW_LIMIT };
}
