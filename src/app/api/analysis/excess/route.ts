import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { readStockoutSnapshotStatus, SORT_DIRECTIONS, STOCKOUT_DATA_STATES, type StockoutDataState } from "@/lib/analysis/stockout";
import {
  EMPTY_EXCESS_FILTERS,
  EXCESS_PAGE_DEFAULT,
  EXCESS_PAGE_MAX,
  EXCESS_SORTS,
  EXCESS_STATES,
  readExcessCategories,
  type ExcessFilters,
  type ExcessSortKey,
  type ExcessState,
} from "@/lib/analysis/excess";
import { describeScope, describeScopeApplication, type EffectiveScope } from "@/lib/auth/access-scope";

const SECTIONS = ["status", "categories"] as const;

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "status");

  const status = await readStockoutSnapshotStatus(undefined, qStr(url, "runId", 64));

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

  const filters = parseExcessFilters(url, scope);
  const sort = {
    key: qEnum(url, "sort", EXCESS_SORTS, "excess") as ExcessSortKey,
    dir: qEnum(url, "dir", SORT_DIRECTIONS, "desc"),
  };
  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: EXCESS_PAGE_DEFAULT, min: 1, max: EXCESS_PAGE_MAX }),
  };

  const result = await readExcessCategories(status.runId, filters, paging, sort);

  return ok({
    section,
    available: true,
    runId: status.runId,
    unavailableMessage: null,
    activeFilters: describeExcessFilters(filters),
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["LAB"]),
    ...result,
  });
  },
);

export function parseExcessFilters(url: URL, scope: EffectiveScope): ExcessFilters {
  const state = qStr(url, "excessState", 40);
  if (state && !(EXCESS_STATES as readonly string[]).includes(state)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'excessState' is not a recognized value.");
  }
  const dataState = qStr(url, "dataState", 40);
  if (dataState && !(STOCKOUT_DATA_STATES as readonly string[]).includes(dataState)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'dataState' is not a recognized value.");
  }

  return {
    ...EMPTY_EXCESS_FILTERS,
    scope,
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    excessState: (state as ExcessState | null) ?? null,
    dataState: (dataState as StockoutDataState | null) ?? null,
    search: qStr(url, "search", 120),
    excessOnly: qStr(url, "excessOnly", 10) !== "false",
  };
}

export function describeExcessFilters(f: ExcessFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "" && v !== false)
    .map(([key, value]) => ({ key, value: String(value) }));
}
