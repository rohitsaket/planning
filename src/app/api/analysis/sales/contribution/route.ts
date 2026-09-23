import { ok } from "@/lib/api-utils";
import { withApi, qEnum } from "@/lib/api/with-api";
import { forbidden } from "@/lib/api/errors";
import {
  CONTRIBUTION_DIMENSIONS,
  extraPermissionsForContribution,
  type ContributionDimension,
} from "@/lib/analytics/sales-history-contract";
import { getSalesContribution, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters, parseSalesPaging } from "@/lib/analytics/sales-history-request";

/**
 * Sales Analysis — who and where the confirmed sales came from, aggregated and bounded.
 *
 * Grouping by customer discloses customer identity and revenue-bearing volume, so it
 * carries its own permission on top of sales.read. Hiding the control in the browser is
 * UX; this check is the boundary.
 *
 * Detail per customer belongs to the Customers & Orders page and is not duplicated here.
 */
export const GET = withApi({ permission: "sales.read" }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const dimension = qEnum<ContributionDimension>(url, "dimension", CONTRIBUTION_DIMENSIONS, "country");
  if (!extraPermissionsForContribution(dimension).every((p) => api.principal.permissions.includes(p as never))) {
    throw forbidden("Grouping sales by customer requires the customers.read permission.");
  }

  const snapshot = await resolveSalesSnapshot();
  assertRequestedWindow(url, snapshot?.windowDays ?? null);
  if (!snapshot) {
    return ok({ dimension, rows: [], paging: { page: 1, pageSize: 0, total: 0, hasMore: false }, snapshotId: null });
  }

  const filters = parseSalesFilters(url, api.principal.permissions);
  const result = await getSalesContribution(snapshot, filters, dimension, parseSalesPaging(url));
  return ok({ ...result, snapshotId: snapshot.id });
});
