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

const SECTIONS = ["status", "categories", "detail"] as const;

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "status");

  const requestedRunId = qStr(url, "runId", 64);

  const status = await readStockoutSnapshotStatus(undefined, requestedRunId);

  if (section === "status") {
    return ok({ section, ...status });
  }

  if (!status.hasRun || !status.runId) {
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
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["LAB"]),
    ...result,
  });
  },
);

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
    scope,
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    stockoutState: (state as StockoutState | null) ?? null,
    dataState: (dataState as StockoutDataState | null) ?? null,
    search: qStr(url, "search", 120),
    shortageOnly: qStr(url, "shortageOnly", 10) !== "false",
  };
}

export function describeFilters(f: StockoutFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "" && v !== false)
    .map(([key, value]) => ({ key, value: String(value) }));
}
