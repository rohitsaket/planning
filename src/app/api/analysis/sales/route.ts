import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { CATEGORY_SORT_KEYS, type CategorySortKey } from "@/lib/analytics/sales-history-contract";
import { getCategorySalesSummary, getSalesReadiness, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSalesPaging, parseSort } from "@/lib/analytics/sales-history-request";

/**
 * Sales Analysis — readiness of the confirmed sales history, and the category summary
 * (Lab + Shape + Weight Band) for the authoritative snapshot.
 *
 * Confirmed-sales eligibility, lifecycle deduplication and category normalization are
 * the demand calculation's centralized policy; this route reads its persisted result and
 * re-derives none of it. When no authoritative snapshot exists the readiness state is
 * NOT_RUN and no rows are invented in its place.
 *
 * Filtering, searching, sorting and paging are all server-side, and the response always
 * carries the real total so a page is never mistaken for the whole table.
 */
export const GET = withApi({ permission: "sales.read" }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const readiness = await getSalesReadiness();
  const snapshot = await resolveSalesSnapshot();
  assertRequestedWindow(url, snapshot?.windowDays ?? null);

  if (!snapshot) {
    return ok({
      readiness,
      rows: [],
      paging: { page: 1, pageSize: 0, total: 0, hasMore: false },
      totals: { confirmedQuantity: 0, confirmedWeight: 0, recordCount: 0, categories: 0 },
    });
  }

  const filters = parseSalesFilters(url, api.principal.permissions);
  const sort = parseSort<CategorySortKey>(url, CATEGORY_SORT_KEYS, "total90", "desc");
  const summary = await getCategorySalesSummary(snapshot, filters, sort, parseSalesPaging(url));

  return ok({ readiness, ...summary });
});
