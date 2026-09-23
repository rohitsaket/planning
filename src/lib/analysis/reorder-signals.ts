/**
 * REORDER SIGNALS — bounded read service.
 *
 * One question: which categories have an uncovered finished-stock requirement that needs
 * operational attention?
 *
 * "Reorder signal" is an advisory business label, not an instruction. Nothing here
 * decides that anything should be bought or manufactured, and the uncovered quantity is
 * never called a recommended order quantity — turning a shortage into an order needs a
 * business rule about lead time, safety stock and order economics that nobody has
 * confirmed.
 *
 * The page this replaces did invent one: it derived a "likely reorder window" and a
 * "likely reorder date" from the average gap between past sales, and attached a
 * confidence score computed as one minus the coefficient of variation of those gaps,
 * clamped between 0.3 and 0.95. Every part of that — the model, the clamp, the bounds —
 * was chosen in code with no approval, and it read the legacy seeded mirrors rather than
 * the authoritative demand result.
 *
 * A signal here is exactly one thing: the demand engine persisted a physical shortage
 * for this category. That is a fact the engine already established, so this module
 * delegates to the same reader Stockout Risk uses and re-labels the result. The two
 * pages therefore cannot disagree about whether a category is short.
 *
 * Server-only.
 */

import { db } from "@/lib/db";
import {
  readStockoutCategories,
  type Paging,
  type PagingMeta,
  type SortDirection,
  type StockoutDataState,
  type StockoutFilters,
  type StockoutRow,
  type StockoutSortKey,
} from "@/lib/analysis/stockout";

if (typeof window !== "undefined") {
  throw new Error("analysis/reorder-signals is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const SIGNAL_PAGE_DEFAULT = 25;
export const SIGNAL_PAGE_MAX = 200;

/**
 * Factual signals only.
 *
 * Each is decidable from a stored value. There is deliberately no priority, urgency or
 * score: ranking which shortage matters most is a business judgement, not a calculation.
 */
export const REORDER_SIGNALS = ["OUT_OF_STOCK", "SHORTAGE", "REVIEW_REQUIRED", "STALE", "NO_SIGNAL"] as const;
export type ReorderSignal = (typeof REORDER_SIGNALS)[number];

export const REORDER_SIGNAL_LABELS: Record<ReorderSignal, string> = {
  OUT_OF_STOCK: "Out of stock",
  SHORTAGE: "Shortage",
  REVIEW_REQUIRED: "Review required",
  STALE: "Stale",
  NO_SIGNAL: "No signal",
};

/** Business reasons. Each states an observed fact, never a formula or a threshold. */
export const REORDER_SIGNAL_REASONS: Record<ReorderSignal, string> = {
  OUT_OF_STOCK: "No physically available finished stock for this category.",
  SHORTAGE: "Finished stock does not cover the current target.",
  REVIEW_REQUIRED: "Category data requires review before the figures can be relied on.",
  STALE: "Inventory changed after this calculation, so the signal may no longer hold.",
  NO_SIGNAL: "Finished stock covers the current target.",
};

export interface ReorderSignalRow {
  readonly categoryId: string;
  readonly categoryLabel: string;
  readonly lab: string | null;
  readonly shape: string | null;
  readonly weightBand: string | null;
  readonly sales90d: number;
  readonly targetQuantity: number;
  readonly physicalAvailable: number;
  /**
   * The persisted physical shortage, named for what it is.
   *
   * Deliberately not "recommended order quantity": how much to order is a different
   * question with an unconfirmed answer.
   */
  readonly uncoveredQuantity: number;
  readonly memoQuantity: number;
  readonly wipQuantity: number;
  readonly signal: ReorderSignal;
  readonly reason: string;
  readonly dataState: StockoutDataState;
}

export interface ReorderSignalTotals {
  readonly categoriesNeedingAttention: number;
  readonly uncoveredQuantity: number;
  readonly categoriesOutOfStock: number;
  readonly categoriesRequiringReview: number;
}

export interface ReorderSignalsResult {
  readonly rows: ReorderSignalRow[];
  readonly paging: PagingMeta;
  readonly totals: ReorderSignalTotals;
  readonly sort: { key: StockoutSortKey; dir: SortDirection };
  /** True when inventory moved after the run, which qualifies every signal on the page. */
  readonly stale: boolean;
}

/**
 * Maps one stored category to its signal.
 *
 * Staleness qualifies a signal rather than replacing it: the shortage is still the
 * shortage the engine calculated, and hiding it because inventory has since moved would
 * lose a real finding. The row says both things.
 */
function toSignalRow(row: StockoutRow, stale: boolean): ReorderSignalRow {
  const signal: ReorderSignal =
    row.dataState !== "CONFIRMED" ? "REVIEW_REQUIRED"
    : row.stockoutState === "OUT_OF_STOCK" ? "OUT_OF_STOCK"
    : row.physicalShortage > 0 ? "SHORTAGE"
    : "NO_SIGNAL";

  return {
    categoryId: row.categoryId,
    categoryLabel: row.categoryLabel,
    lab: row.lab,
    shape: row.shape,
    weightBand: row.weightBand,
    sales90d: row.sales90d,
    targetQuantity: row.targetQuantity,
    physicalAvailable: row.physicalAvailable,
    uncoveredQuantity: row.physicalShortage,
    memoQuantity: row.memoQuantity,
    wipQuantity: row.wipQuantity,
    signal,
    reason:
      stale && signal !== "NO_SIGNAL" && signal !== "REVIEW_REQUIRED"
        ? `${REORDER_SIGNAL_REASONS[signal]} ${REORDER_SIGNAL_REASONS.STALE}`
        : REORDER_SIGNAL_REASONS[signal],
    dataState: row.dataState,
  };
}

/**
 * One page of signals.
 *
 * Delegates to the Stockout reader rather than re-querying `DemandMetric`, so the two
 * pages read the same rows through the same filters, ordering and totals. Nothing is
 * recomputed here; only the label changes.
 */
export async function readReorderSignals(
  runId: string,
  filters: StockoutFilters,
  paging: Paging,
  sort: { key: StockoutSortKey; dir: SortDirection },
  stale: boolean,
  client: DbClient = db,
): Promise<ReorderSignalsResult> {
  const result = await readStockoutCategories(runId, filters, paging, sort, client);

  return {
    rows: result.rows.map((r) => toSignalRow(r, stale)),
    paging: result.paging,
    totals: {
      categoriesNeedingAttention: result.totals.categoriesWithShortage,
      uncoveredQuantity: result.totals.totalPhysicalShortage,
      categoriesOutOfStock: result.totals.categoriesOutOfStock,
      categoriesRequiringReview: result.totals.categoriesRequiringReview,
    },
    sort,
    stale,
  };
}
