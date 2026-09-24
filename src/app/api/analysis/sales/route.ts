import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { CATEGORY_SORT_KEYS, type CategorySortKey } from "@/lib/analytics/sales-history-contract";
import { getCategorySalesSummary, getSalesReadiness, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSalesPaging, parseSort } from "@/lib/analytics/sales-history-request";
import { withSalesScope } from "@/lib/analytics/sales-history";
import { resolveSourceDisclosure } from "@/lib/analysis/source-disclosure";

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
export const GET = withApi({ permission: "sales.read", scoped: true }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const readiness = await getSalesReadiness();
  const snapshot = await resolveSalesSnapshot();
  // Taken from the snapshot the page actually reads, so the notice cannot disagree with
  // the figures beneath it.
  const sourceDisclosure = resolveSourceDisclosure({
    isSimulated: snapshot?.isSimulated ?? null,
    hasData: Boolean(snapshot),
  });
  assertRequestedWindow(url, snapshot?.windowDays ?? null);

  if (!snapshot) {
    return ok({
      readiness,
      sourceDisclosure,
      rows: [],
      paging: { page: 1, pageSize: 0, total: 0, hasMore: false },
      totals: { confirmedQuantity: 0, confirmedWeight: 0, recordCount: 0, categories: 0 },
    });
  }

  const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
  const sort = parseSort<CategorySortKey>(url, CATEGORY_SORT_KEYS, "total90", "desc");
  const summary = await getCategorySalesSummary(snapshot, filters, sort, parseSalesPaging(url));

  return ok({ readiness, sourceDisclosure, ...summary });
});
