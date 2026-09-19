import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Stockout Risk — projected position: Available + Eligible WIP - Predicted Demand
// Eligible WIP is OPEN rule; display counts separately, do not auto-apply.
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const predictions = await db.forecastPrediction.findMany({ take: SCAN_MAX }).then(scanned);
  const latestRun = await db.demandRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });
  if (!latestRun) return ok({ rows: [] });
  const metricsByCat = new Map(latestRun.metrics.map((m) => [m.planningCategory, m]));

  const rows = predictions.map((p) => {
    const m = metricsByCat.get(p.category);
    const available = m ? num(m.availableStock) : 0;
    const p30 = p.prediction30d;
    const p60 = p.prediction60d;
    const p90 = p.prediction90d;
    const projected30 = available - p30;
    const projected60 = available - (p30 + p60) / 2;
    const projected90 = available - p90;
    return {
      category: p.category,
      available,
      prediction30d: p30,
      prediction60d: p60,
      prediction90d: p90,
      projected30d: projected30,
      projected60d: num(projected60),
      projected90d: projected90,
      stockoutRisk: p.stockoutRisk,
      stockoutDate: p.stockoutDate?.toISOString() ?? null,
      confidence: num(p.confidence),
      trend: p.trend,
    };
  }).sort((a, b) => b.prediction90d - a.prediction90d);

  const critical = rows.filter((r) => r.stockoutRisk === "CRITICAL").length;
  const high = rows.filter((r) => r.stockoutRisk === "HIGH").length;
  const medium = rows.filter((r) => r.stockoutRisk === "MEDIUM").length;

  return ok({ rows, critical, high, medium, advisoryNotice: "Predicted stockout is advisory, not a confirmed order trigger." });
});
