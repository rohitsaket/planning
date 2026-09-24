import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { describeScope, describeScopeApplication } from "@/lib/auth/access-scope";

// Forecast Analysis — clearly separate from confirmed demand
export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (_req: Request, _ctx, { scope }) => {
  const latestRun = await db.forecastRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { predictions: true },
  });
  if (!latestRun) {
    return ok({
      rows: [], modelVersion: null, horizon30d: 0, horizon60d: 0, horizon90d: 0,
      accessScope: describeScope(scope),
      scopeApplication: describeScopeApplication(scope, ["LAB"]),
    });
  }

  // A prediction is keyed by planning category — "Lab|Shape|WeightBand" — and carries no
  // country column, so only the lab half of the caller's scope can be applied. The lab is
  // the first segment of that canonical key, which is how every other surface reads it.
  const allowedLabs = scope.labs;
  const predictions = allowedLabs === null
    ? latestRun.predictions
    : latestRun.predictions.filter((p) => allowedLabs.includes(p.category.split("|")[0] ?? ""));

  const rows = predictions.map((p) => ({
    category: p.category,
    prediction30d: p.prediction30d,
    prediction60d: p.prediction60d,
    prediction90d: p.prediction90d,
    confidence: num(p.confidence),
    trend: p.trend,
    stockoutRisk: p.stockoutRisk,
    stockoutDate: p.stockoutDate?.toISOString() ?? null,
  })).sort((a, b) => b.prediction90d - a.prediction90d);

  return ok({
    rows,
    modelVersion: latestRun.modelVersion,
    runDate: latestRun.runDate.toISOString(),
    horizon30d: latestRun.horizon30d,
    horizon60d: latestRun.horizon60d,
    horizon90d: latestRun.horizon90d,
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["LAB"]),
    advisoryNotice: "FORECAST IS A PREDICTION, NOT CONFIRMED DEMAND. Forecast must remain separate from confirmed current manufacturing requirement.",
  });
},
);
