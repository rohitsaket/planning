/**
 * SALES HISTORY — REQUEST PARSING (server-only)
 *
 * One validated reading of the query string for every Sales Analysis route, so the
 * summary, the trend, the movement table, the contribution tables, the drill-down and
 * the export can never disagree about what was asked for.
 *
 * Every value is validated against a fixed enum or a length bound before it reaches a
 * query. Nothing here is interpolated into SQL — the read service binds parameters.
 */

import { badRequest, forbidden } from "@/lib/api/errors";
import { qEnum, qInt, qStr } from "@/lib/api/with-api";
import { SALES_TREND_DIRECTIONS, type SalesTrendDirection } from "@/lib/demand/demand-result-presentation";
import {
  SALES_DATA_STATES,
  SORT_DIRECTIONS,
  type SalesDataState,
  type SalesHistoryFilterValues,
  type SortDirection,
} from "@/lib/analytics/sales-history-contract";
import type { SalesPageRequest } from "@/lib/analytics/sales-history";

const MAX_FILTER_LENGTH = 120;
const MAX_SEARCH_LENGTH = 80;

/** Page sizes are bounded so one request can never ask for an unbounded read. */
export const SALES_PAGE_SIZE_DEFAULT = 25;
export const SALES_PAGE_SIZE_MAX = 200;

function qOneOf<T extends string>(url: URL, name: string, values: readonly T[]): T | null {
  const raw = qStr(url, name, MAX_FILTER_LENGTH);
  if (raw === null) return null;
  if (!(values as readonly string[]).includes(raw)) {
    throw badRequest(`Query parameter '${name}' is not one of the supported values.`);
  }
  return raw as T;
}

/**
 * Filter values for one request.
 *
 * `customerCode` narrows to one customer and therefore discloses that a named customer
 * bought something: it is refused outright without `customers.read` rather than being
 * quietly dropped, because silently ignoring a filter would return a different dataset
 * from the one that was asked for.
 */
export function parseSalesFilters(url: URL, permissions: readonly string[]): SalesHistoryFilterValues {
  const customerCode = qStr(url, "customerCode", MAX_FILTER_LENGTH);
  if (customerCode && !permissions.includes("customers.read")) {
    throw forbidden("Filtering sales by customer requires the customers.read permission.");
  }
  return {
    country: qStr(url, "country", MAX_FILTER_LENGTH),
    branch: qStr(url, "branch", MAX_FILTER_LENGTH),
    lab: qStr(url, "lab", MAX_FILTER_LENGTH),
    shape: qStr(url, "shape", MAX_FILTER_LENGTH),
    weightBand: qStr(url, "weightBand", MAX_FILTER_LENGTH),
    categoryId: qStr(url, "categoryId", MAX_FILTER_LENGTH),
    search: qStr(url, "search", MAX_SEARCH_LENGTH),
    customerCode,
    trend: qOneOf<SalesTrendDirection>(url, "trend", SALES_TREND_DIRECTIONS),
    dataState: qOneOf<SalesDataState>(url, "dataState", SALES_DATA_STATES),
  };
}

/**
 * `windowDays` used to select the sales window from the request. It no longer can: the
 * window is the one the authoritative snapshot was calculated with.
 *
 * The parameter is still validated and, when it names a different window from the
 * snapshot's, refused. Quietly ignoring it would serve a 90-day figure to a caller who
 * believes they asked for 30 days, which is exactly the kind of silent substitution a
 * sales number must never make.
 */
export function assertRequestedWindow(url: URL, snapshotWindowDays: number | null): void {
  const requested = qInt(url, "windowDays", { def: 0, min: 1, max: 730 });
  if (requested === 0 || snapshotWindowDays === null) return;
  if (requested !== snapshotWindowDays) {
    throw badRequest(
      "Sales history covers the window the authoritative sales snapshot was calculated with, which cannot be changed by this request.",
    );
  }
}

export function parseSalesPaging(url: URL, max = SALES_PAGE_SIZE_MAX): SalesPageRequest {
  return {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: SALES_PAGE_SIZE_DEFAULT, min: 1, max }),
  };
}

export function parseSort<T extends string>(
  url: URL,
  keys: readonly T[],
  defaultKey: T,
  defaultDir: SortDirection,
): { key: T; dir: SortDirection } {
  return {
    key: qEnum<T>(url, "sortKey", keys, defaultKey),
    dir: qEnum<SortDirection>(url, "sortDir", SORT_DIRECTIONS, defaultDir),
  };
}
