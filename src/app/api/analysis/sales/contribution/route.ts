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
import { withSalesScope } from "@/lib/analytics/sales-history";

export const GET = withApi({ permission: "sales.read", scoped: true }, async (req: Request, _ctx, api) => {
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

  const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
  const result = await getSalesContribution(snapshot, filters, dimension, parseSalesPaging(url));
  return ok({ ...result, snapshotId: snapshot.id });
});
