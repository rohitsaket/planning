import { ok } from "@/lib/api-utils";
import { withApi, qInt, qStr } from "@/lib/api/with-api";
import { forbidden } from "@/lib/api/errors";
import { analyticsTimeZone } from "@/lib/analytics/reporting-date";
import { extraPermissionsFor } from "@/lib/analytics/sales-dimensions";
import { getSalesAnalysis, parseSalesDimension } from "@/lib/analytics/sales-analysis";

// Sales Analysis — Invoice rows grouped by dimension (lab, shape, weightBand, color, clarity,
// treatment, customer, country, branch, month). Window = run business date + previous N-1 dates.
// Honors global filter params: country, branch, lab.
export const GET = withApi({ permission: "sales.read" }, async (req: Request, _ctx, api) => {
  const url = new URL(req.url);
  const dimension = parseSalesDimension(url.searchParams.get("dimension"));
  // Customer grouping exposes customer names and revenue: it also needs customers.read.
  if (!extraPermissionsFor(dimension).every((p) => api.principal.permissions.includes(p as never))) {
    throw forbidden("Grouping sales by customer requires the customers.read permission.");
  }
  const result = await getSalesAnalysis(
    {
      dimension,
      windowDays: qInt(url, "windowDays", { def: 90, min: 1, max: 730 }),
      country: qStr(url, "country"),
      branch: qStr(url, "branch"),
      lab: qStr(url, "lab"),
      now: new Date(),
      timezone: analyticsTimeZone(),
    },
    api.requestId,
  );
  return ok(result);
});
