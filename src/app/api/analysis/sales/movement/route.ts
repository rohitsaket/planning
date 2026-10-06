import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { MOVEMENT_SORT_KEYS, type MovementSortKey } from "@/lib/analytics/sales-history-contract";
import { getCategoryMovement, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSalesPaging, parseSort } from "@/lib/analytics/sales-history-request";
import { withSalesScope } from "@/lib/analytics/sales-history";

export const GET = withApi({ permission: "sales.read", scoped: true }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const snapshot = await resolveSalesSnapshot();
  assertRequestedWindow(url, snapshot?.windowDays ?? null);
  if (!snapshot) {
    return ok({ rows: [], paging: { page: 1, pageSize: 0, total: 0, hasMore: false }, available: false, snapshotId: null });
  }

  const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
  const sort = parseSort<MovementSortKey>(url, MOVEMENT_SORT_KEYS, "absoluteChange", "desc");
  const movement = await getCategoryMovement(snapshot, filters, sort, parseSalesPaging(url));
  return ok({ ...movement, snapshotId: snapshot.id });
});
