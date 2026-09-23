import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned, qStr } from "@/lib/api/with-api";
import { forbidden } from "@/lib/api/errors";

/**
 * Forecast runs and model versions.
 *
 * The page mixes two audiences. A planner reads the horizons and whether a model is
 * published — business results they act on. Model governance additionally reads the
 * algorithm, the training and validation windows and the error metrics the model is
 * judged on, which say how a prediction is produced.
 *
 * Both come from the same two queries, so the route filters the technical fields out of
 * the response rather than duplicating the reads behind a second endpoint. A caller that
 * explicitly asks for methodology without the permission is refused outright, so the
 * denial is unambiguous rather than an empty-looking success.
 */
export const GET = withApi({ permission: "analysis.read" }, async (req: Request, _ctx, { principal }) => {
  const canSeeMethodology = principal.permissions.includes("forecast.methodology.read");

  if (qStr(new URL(req.url), "include", 40) === "methodology" && !canSeeMethodology) {
    throw forbidden("Forecast model methodology requires the model methodology permission.");
  }

  const runs = await db.forecastRun.findMany({
    include: { predictions: true },
    orderBy: { runDate: "desc" },
    take: 10,
  });
  const models = await db.modelVersion.findMany({ take: SCAN_MAX, orderBy: { createdAt: "desc" } }).then(scanned);

  return ok({
    canSeeMethodology,
    runs: runs.map((r) => ({
      id: r.id,
      modelVersion: r.modelVersion,
      runDate: r.runDate.toISOString(),
      status: r.status,
      horizon30d: r.horizon30d,
      horizon60d: r.horizon60d,
      horizon90d: r.horizon90d,
      predictionCount: r.predictions.length,
      // Evaluation metrics are how a model is scored, not what it predicts.
      ...(canSeeMethodology ? { metrics: r.metricsJson ? JSON.parse(r.metricsJson) : null } : {}),
    })),
    models: models.map((m) => ({
      id: m.id,
      modelName: m.modelName,
      publishedBy: m.publishedBy,
      publishedAt: m.publishedAt?.toISOString() ?? null,
      status: m.status,
      ...(canSeeMethodology
        ? {
            version: m.version,
            algorithm: m.algorithm,
            trainingPeriod: m.trainingPeriod,
            validationPeriod: m.validationPeriod,
            metrics: m.metricsJson ? JSON.parse(m.metricsJson) : null,
          }
        : {}),
    })),
    advisoryNotice: "Forecast is advisory and remains separate from confirmed manufacturing requirement.",
  });
});
