import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  EMPTY_STOCKOUT_FILTERS,
  SORT_DIRECTIONS,
  STOCKOUT_DATA_STATES,
  STOCKOUT_PAGE_DEFAULT,
  STOCKOUT_PAGE_MAX,
  STOCKOUT_SORTS,
  STOCKOUT_STATES,
  readStockoutCategories,
  readStockoutDetail,
  readStockoutSnapshotStatus,
  type StockoutDataState,
  type StockoutFilters,
  type StockoutSortKey,
  type StockoutState,
} from "@/lib/analysis/stockout";
import { describeScope, describeScopeApplication, type EffectiveScope } from "@/lib/auth/access-scope";

/**
 * STOCKOUT RISK — one bounded read endpoint.
 *
 * Replaces a route that read `ForecastPrediction` rows, subtracted a prediction from the
 * latest run's available stock inside the handler, and labelled the result CRITICAL /
 * HIGH / MEDIUM. None of that was a shortage: it was a forecast projection with an
 * invented risk ranking, and it disagreed with Demand Overview by construction.
 *
 * This route reports the shortage the approved demand engine already calculated and
 * persisted. It computes nothing, and it writes nothing — opening the page never repairs
 * or recalculates a run.
 *
 * Every field is mapped explicitly. No rule identifier, mapping fingerprint, batch id,
 * checkpoint, source-policy name or formula reaches the browser.
 */

const SECTIONS = ["status", "categories", "detail"] as const;

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "status");

  // A bookmarked link carries its run. Absent, the authoritative selector chooses.
  const requestedRunId = qStr(url, "runId", 64);

  const status = await readStockoutSnapshotStatus(undefined, requestedRunId);

  if (section === "status") {
    return ok({ section, ...status });
  }

  if (!status.hasRun || !status.runId) {
    // A state, not an empty table of zeros.
    return ok({
      section,
      available: false,
      runId: null,
      unavailableMessage: status.unavailableMessage,
      availabilityState: status.availabilityState,
      rows: [],
    });
  }

  if (section === "detail") {
    const categoryId = qStr(url, "category", 200);
    if (!categoryId) throw new ApiError(400, "BAD_REQUEST", "A category is required.");
    const detail = await readStockoutDetail(status.runId, categoryId);
    return ok({ section, available: true, runId: status.runId, detail });
  }

  const filters = parseFilters(url, scope);
  const sort = {
    key: qEnum(url, "sort", STOCKOUT_SORTS, "physicalShortage") as StockoutSortKey,
    dir: qEnum(url, "dir", SORT_DIRECTIONS, "desc"),
  };
  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: STOCKOUT_PAGE_DEFAULT, min: 1, max: STOCKOUT_PAGE_MAX }),
  };

  const result = await readStockoutCategories(status.runId, filters, paging, sort);

  return ok({
    section,
    available: true,
    runId: status.runId,
    unavailableMessage: null,
    activeFilters: describeFilters(filters),
    // Only the lab half of the caller's scope can be applied here: the persisted demand
    // result has no country column, because the target is calculated once per planning
    // category for the whole business. Saying so is the alternative to letting a
    // country-restricted caller read a business-wide figure as if it were their own.
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["LAB"]),
    ...result,
  });
  },
);

/** Every filter the stored result can actually honour. Unknown values are refused. */
export function parseFilters(url: URL, scope: EffectiveScope): StockoutFilters {
  const state = qStr(url, "stockoutState", 40);
  if (state && !(STOCKOUT_STATES as readonly string[]).includes(state)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'stockoutState' is not a recognized value.");
  }
  const dataState = qStr(url, "dataState", 40);
  if (dataState && !(STOCKOUT_DATA_STATES as readonly string[]).includes(dataState)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'dataState' is not a recognized value.");
  }

  return {
    ...EMPTY_STOCKOUT_FILTERS,
    // A required argument rather than a default: a route that forgets the caller's
    // scope must fail to compile, not quietly serve the whole business.
    scope,
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    stockoutState: (state as StockoutState | null) ?? null,
    dataState: (dataState as StockoutDataState | null) ?? null,
    search: qStr(url, "search", 120),
    // The page's purpose is categories that are short; the caller may widen it.
    shortageOnly: qStr(url, "shortageOnly", 10) !== "false",
  };
}

/**
 * The filters the caller chose, echoed back so the page can show them.
 *
 * `scope` is excluded: it is an authorization decision rather than something the
 * caller selected, and listing it as an active filter would invite an attempt to
 * clear it. The caller's own scope is disclosed separately and in full.
 */
export function describeFilters(f: StockoutFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "" && v !== false)
    .map(([key, value]) => ({ key, value: String(value) }));
}
