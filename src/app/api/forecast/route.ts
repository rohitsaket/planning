import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Forecast runs + model versions
export async function GET() {
  const runs = await db.forecastRun.findMany({
    include: { predictions: true },
    orderBy: { runDate: "desc" },
    take: 10,
  });
  const models = await db.modelVersion.findMany({ orderBy: { createdAt: "desc" } });

  return ok({
    runs: runs.map((r) => ({
      id: r.id,
      modelVersion: r.modelVersion,
      runDate: r.runDate.toISOString(),
      status: r.status,
      horizon30d: r.horizon30d,
      horizon60d: r.horizon60d,
      horizon90d: r.horizon90d,
      metrics: r.metricsJson ? JSON.parse(r.metricsJson) : null,
      predictionCount: r.predictions.length,
    })),
    models: models.map((m) => ({
      id: m.id,
      modelName: m.modelName,
      version: m.version,
      algorithm: m.algorithm,
      trainingPeriod: m.trainingPeriod,
      validationPeriod: m.validationPeriod,
      metrics: m.metricsJson ? JSON.parse(m.metricsJson) : null,
      publishedBy: m.publishedBy,
      publishedAt: m.publishedAt?.toISOString() ?? null,
      status: m.status,
    })),
    advisoryNotice: "Forecast is advisory and remains separate from confirmed manufacturing requirement.",
  });
}
