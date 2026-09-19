import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";

// Forecast Analysis — clearly separate from confirmed demand
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const latestRun = await db.forecastRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { predictions: true },
  });
  if (!latestRun) return ok({ rows: [], modelVersion: null, horizon30d: 0, horizon60d: 0, horizon90d: 0 });

  const rows = latestRun.predictions.map((p) => ({
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
    advisoryNotice: "FORECAST IS A PREDICTION, NOT CONFIRMED DEMAND. Forecast must remain separate from confirmed current manufacturing requirement.",
  });
});
