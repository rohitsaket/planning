import { ok } from "@/lib/api-utils";
import { withApi, qEnum } from "@/lib/api/with-api";
import { TREND_INTERVALS, type TrendInterval } from "@/lib/analytics/sales-history-contract";
import { getSalesPeriodTrend, resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { assertRequestedWindow, parseSalesFilters } from "@/lib/analytics/sales-history-request";
import { withSalesScope } from "@/lib/analytics/sales-history";

/**
 * Sales Analysis — confirmed sales per period for the authoritative snapshot.
 *
 * Descriptive only: period quantity, period weight, qualifying record count and the
 * number of distinct categories that contributed. No forecast, no predicted demand and
 * no manufacturing priority is produced here or anywhere on this page.
 *
 * The chart on the page renders these exact rows; there is no second series computed in
 * the browser.
 */
export const GET = withApi({ permission: "sales.read", scoped: true }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const interval = qEnum<TrendInterval>(url, "interval", TREND_INTERVALS, "window30");
  const snapshot = await resolveSalesSnapshot();
  assertRequestedWindow(url, snapshot?.windowDays ?? null);
  if (!snapshot) return ok({ interval, rows: [], available: false, snapshotId: null });

  const filters = withSalesScope(parseSalesFilters(url, api.principal.permissions), api.scope);
  const trend = await getSalesPeriodTrend(snapshot, filters, interval);
  return ok({ ...trend, snapshotId: snapshot.id });
});
