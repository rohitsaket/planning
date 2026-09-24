import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";
import { YIELD_PREDICTION_BASIS } from "@/lib/analysis/business-language";
import { describeScope, describeScopeApplication } from "@/lib/auth/access-scope";

// Yield Prediction — predicts expected actual yield % for rough stones based
// on historical plan-actual reconciliation data. Spec §61 — data science
// module infrastructure. ADVISORY ONLY.
//
// Method (baseline forecasting — NOT a trained ML model, per spec
// "Start with baselines: Naive Last Period, Moving Average, Exponential
// Smoothing where appropriate"):
//   • Naive Last Period: actualYieldPct of the most recent reconciliation.
//   • Moving Average (last 5): mean of actualYieldPct over the last 5
//     reconciliations. This is the PRIMARY prediction baseline.
//   • Exponential Smoothing (α=0.3): recursive S_t = α·X_t + (1-α)·S_{t-1},
//     giving more weight to recent observations.
//   • Prediction interval = ±1σ (std-dev of historical actual yields).
//   • MAE = mean absolute error of (actualYield - plannedYield) across all
//     reconciliations. Bias = signed mean of the same residuals.
//   • Confidence = 1 − CV of historical variance, where
//     CV = σ(variance)/mean(|variance|). Capped to [0,1].
//   • Risk:
//       - HIGH   if |predictedActual − plannedYield| > 2σ
//       - MEDIUM if |predictedActual − plannedYield| > 1σ
//       - LOW    otherwise
//
// Predictions are computed for every APPROVED or RELEASED_TO_MANUFACTURING
// planning case whose selected option has NOT yet been reconciled.
//
// OPEN rule: model selection logic is unconfirmed. Currently uses a fixed
// baseline (moving average of last 5). Auto-model selection (Naive / MA / ES
// based on accuracy) is deferred to a future task.

export const dynamic = "force-dynamic";

const ALPHA = 0.3; // exponential smoothing factor
const MA_WINDOW = 5; // moving average window

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stdDevPop(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / xs.length;
  return Math.sqrt(variance);
}

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (_req: Request, _ctx, { scope }) => {
  // -------------------------------------------------------------------------
  // 1. Historical reconciliations
  // -------------------------------------------------------------------------
  const reconciliations = await db.planActualReconciliation.findMany({ take: SCAN_MAX,
    include: { planOption: true },
    orderBy: { createdAt: "asc" },
  }).then(scanned);

  const actuals: number[] = reconciliations.map((r) => num(r.actualYieldPct));
  const planned: number[] = reconciliations.map((r) => num(r.plannedYieldPct));
  const residuals: number[] = reconciliations.map((r, i) => actuals[i] - planned[i]);
  const absResiduals: number[] = residuals.map((x) => Math.abs(x));

  // -------------------------------------------------------------------------
  // 2. Baselines
  // -------------------------------------------------------------------------
  const naiveLastPeriod = actuals.length > 0 ? actuals[actuals.length - 1] : 0;

  const maSlice = actuals.slice(-MA_WINDOW);
  const movingAverage = mean(maSlice);

  // Exponential smoothing — recursive S_t = α·X_t + (1-α)·S_{t-1}.
  let expSmoothed = actuals.length > 0 ? actuals[0] : 0;
  for (let i = 1; i < actuals.length; i++) {
    expSmoothed = ALPHA * actuals[i] + (1 - ALPHA) * expSmoothed;
  }
  if (actuals.length === 0) expSmoothed = 0;

  const sd = stdDevPop(actuals);
  const mae = mean(absResiduals);
  const bias = mean(residuals);

  // Confidence: 1 − CV of historical variance, where CV = σ(variance) / mean(|variance|).
  const varStd = stdDevPop(residuals);
  const meanAbsVar = mean(absResiduals);
  const cv = meanAbsVar > 0 ? varStd / meanAbsVar : 0;
  const confidence = Math.max(0, Math.min(1, 1 - cv));

  const predictionLower = movingAverage - sd;
  const predictionUpper = movingAverage + sd;

  const historical = reconciliations.map((r) => {
    const plannedYield = num(r.plannedYieldPct);
    const actualYield = num(r.actualYieldPct);
    return {
      id: r.id,
      planOptionId: r.planOptionId,
      planOptionCode: r.planOption?.optionCode ?? "—",
      plannedYield: round2(plannedYield),
      actualYield: round2(actualYield),
      variance: round2(actualYield - plannedYield),
      status: r.status,
      reconciledAt: r.reconciledAt,
    };
  });

  // -------------------------------------------------------------------------
  // 3. Predictions for un-reconciled APPROVED / RELEASED cases
  // -------------------------------------------------------------------------
  const reconciledOptionIds = new Set(reconciliations.map((r) => r.planOptionId));

  const activeCases = await db.planningCase.findMany({ take: SCAN_MAX,
    where: { status: { in: ["APPROVED", "RELEASED_TO_MANUFACTURING"] } },
    include: {
      rough: true,
      versions: { include: { options: true } },
    },
    orderBy: { caseCode: "asc" },
  }).then(scanned);

  const predictions = activeCases
    .map((pc) => {
      // Find the selected option across all versions
      const selectedOption = pc.versions
        .flatMap((v) => v.options)
        .find((o) => o.id === pc.selectedOptionId);
      if (!selectedOption) return null;
      if (reconciledOptionIds.has(selectedOption.id)) return null; // already reconciled

      const plannedYield = num(selectedOption.yieldPct);
      const predictedActual = movingAverage;
      const variance = predictedActual - plannedYield;
      const absVar = Math.abs(variance);

      const riskLevel: "HIGH" | "MEDIUM" | "LOW" =
        sd > 0 && absVar > 2 * sd
          ? "HIGH"
          : sd > 0 && absVar > sd
            ? "MEDIUM"
            : "LOW";

      return {
        caseId: pc.id,
        caseCode: pc.caseCode,
        stoneName: pc.stoneName,
        stoneType: pc.stoneType,
        roughWeight: round2(num(pc.rough.roughWeight)),
        plannedYieldPct: round2(plannedYield),
        predictedActualYield: round2(predictedActual),
        predictionLower: round2(predictionLower),
        predictionUpper: round2(predictionUpper),
        variance: round2(variance),
        confidence: Math.round(confidence * 100) / 100,
        riskLevel,
        selectedOptionCode: selectedOption.optionCode,
        status: pc.status,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const summary = {
    historicalReconciliations: reconciliations.length,
    mae: round2(mae),
    bias: round2(bias),
    movingAverageYield: round2(movingAverage),
    naiveLastPeriodYield: round2(naiveLastPeriod),
    exponentialSmoothedYield: round2(expSmoothed),
    stdDev: round2(sd),
    predictionInterval: {
      lower: round2(predictionLower),
      upper: round2(predictionUpper),
    },
    confidence: Math.round(confidence * 100) / 100,
    predictionCount: predictions.length,
  };

  // The model, its smoothing coefficient, its interval width and its risk cut-offs stay
  // in this route. A reader is told what the prediction rests on and that it is
  // advisory, which is what they can act on.
  const basis = YIELD_PREDICTION_BASIS;

  const advisoryNotice =
    "PREDICTION — Yield prediction is advisory. Never auto-approve or auto-reject a plan based on predicted yield alone. " +
    "OPEN rule: model selection logic is unconfirmed.";

  return ok({
    summary,
    predictions,
    historical,
    basis,
    advisoryNotice,
    accessScope: describeScope(scope),
    // Neither dimension can be applied: a plan-versus-actual reconciliation carries
    // no country and no lab, so a restricted caller is told the figures are not
    // narrowed rather than being left to assume they are.
    scopeApplication: describeScopeApplication(scope, []),
  });
},
);
