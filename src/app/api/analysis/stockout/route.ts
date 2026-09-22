import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Stockout Risk — ADVISORY forecast projection against the available stock of the
// latest usable demand run. A prediction never becomes confirmed demand, and the
// figures are only shown against a run that actually completed.
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const predictions = await db.forecastPrediction.findMany({ take: SCAN_MAX }).then(scanned);
  const latestRun = await db.demandRun.findFirst({
    where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } },
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });
  if (!latestRun) {
    return ok({
      rows: [],
      critical: 0,
      high: 0,
      medium: 0,
      hasEverRun: false,
      runStatus: "NOT_RUN",
      runId: null,
      runDate: null,
      advisory: true,
      advisoryNotice:
        "Stockout risk is unavailable: no completed demand calculation exists yet, so there is no available-stock baseline to project against.",
    });
  }
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

  return ok({
    rows,
    critical,
    high,
    medium,
    hasEverRun: true,
    runStatus: latestRun.status,
    runId: latestRun.id,
    runDate: latestRun.runDate.toISOString(),
    advisory: true,
    advisoryNotice:
      "Predicted stockout is advisory only. It is not confirmed demand and never triggers an order, requirement or reservation.",
  });
});
