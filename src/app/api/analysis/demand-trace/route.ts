import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// ============================================================================
// Demand Calculation Trace — exposes every intermediate step of the
// confirmed DEMAND-V1 90-day demand rule (section 4 + section 104).
// Each step shows: step#, label, value, formula, source.
// Categories come from the latest DemandRun's DemandMetric rows.
// ============================================================================
export async function GET() {
  // 1. Latest confirmed demand run
  const latestRun = await db.demandRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });
  if (!latestRun) {
    return ok({
      ruleVersion: "DEMAND-V1",
      runDate: null,
      windowDays: 90,
      categories: [],
      summary: {
        totalCategories: 0,
        totalShortage: 0,
        totalExcess: 0,
        categoriesWithShortage: 0,
        categoriesWithExcess: 0,
      },
    });
  }

  // 2. Latest forecast run predictions joined for the Forecast Signal source line
  const latestForecastRun = await db.forecastRun.findFirst({
    orderBy: { runDate: "desc" },
    select: { id: true, modelVersion: true, horizon90d: true },
  });
  const forecastByCategory = new Map<string, number>();
  if (latestForecastRun) {
    const preds = await db.forecastPrediction.findMany({
      where: { runId: latestForecastRun.id },
      select: { category: true, prediction90d: true },
    });
    for (const p of preds) {
      forecastByCategory.set(p.category, num(p.prediction90d));
    }
  }

  // 3. Build per-category trace
  const categories = latestRun.metrics.map((m) => {
    const sales90d = num(m.sales90d);
    const monthlyAverage = num(m.monthlyAverage);
    const unroundedTarget = num(m.unroundedTarget);
    const roundedTarget = num(m.roundedTarget);
    const availableStock = num(m.availableStock);
    const memoQty = num(m.memoQty);
    const physicalShortage = num(m.physicalShortage);
    const excessStock = num(m.excessStock);
    const wipCoverage = num(m.wipCoverage);
    const pipelineNeed = num(m.pipelineNeed);
    const approvedPlanCoverage = num(m.approvedPlanCoverage);
    const remainingUnplanned = num(m.remainingUnplanned);
    const forecastSignal = num(m.forecastSignal);
    // Prefer the freshly-fetched prediction if present (proves lineage to
    // the ForecastPrediction table); fall back to the stored metric value.
    const forecastSource = forecastByCategory.has(m.planningCategory)
      ? `ForecastPrediction table (run ${latestForecastRun?.modelVersion ?? "—"} · horizon 90d)`
      : `DemandMetric.forecastSignal (no live prediction found for this category)`;

    // Split planningCategory (Lab|Shape|WeightBand) — defaults to "—"
    const parts = m.planningCategory.split("|");
    const lab = parts[0] ?? "—";
    const shape = parts[1] ?? "—";
    const weightBand = parts.slice(2).join("|") || "—";

    return {
      category: m.planningCategory,
      lab,
      shape,
      weightBand,
      steps: [
        {
          step: 1,
          label: "90-Day Sales (Invoice lots in window)",
          value: sales90d,
          formula:
            "COUNT(SalesRecord WHERE lotStatusDb='Invoice' AND docDate >= runDate-90d AND category matches)",
          source: "SalesRecord table",
        },
        {
          step: 2,
          label: "Monthly Average",
          value: round2(monthlyAverage),
          formula: "90D Sales / 3",
          source: "Step 1 / 3",
        },
        {
          step: 3,
          label: "Unrounded Target Stock",
          value: round2(unroundedTarget),
          formula: "Monthly Average × 2",
          source: "Step 2 × 2",
        },
        {
          step: 4,
          label: "Rounded Target Stock",
          value: roundedTarget,
          formula: "round_half_up(Unrounded Target)",
          source: "Step 3 (conventional rounding, .5 rounds up)",
        },
        {
          step: 5,
          label: "Available Finished Stock",
          value: availableStock,
          formula:
            "COUNT(PolishedStone WHERE planningClass IN ['PHYSICAL','PLANNING_AVAILABLE'] AND category matches)",
          source: "PolishedStone table",
        },
        {
          step: 6,
          label: "Physical Shortage",
          value: physicalShortage,
          formula: "MAX(0, Target Stock - Available)",
          source: "Step 4 - Step 5",
          tone: "shortage",
        },
        {
          step: 7,
          label: "Memo Qty (NOT reducing shortage)",
          value: memoQty,
          formula:
            "COUNT(MemoRecord WHERE category matches) — excluded per BR-MEMO-001",
          source: "MemoRecord table (advisory only)",
          tone: "advisory",
        },
        {
          step: 8,
          label: "WIP Coverage (OPEN rule)",
          value: wipCoverage,
          formula: "OPEN — BR-WIP-001 not confirmed. Currently 0.",
          source: "Configurable (OPEN)",
          tone: "advisory",
        },
        {
          step: 9,
          label: "Pipeline-Adjusted Need",
          value: pipelineNeed,
          formula: "MAX(0, Physical Shortage - Eligible WIP)",
          source: "Step 6 - Step 8",
          tone: "shortage",
        },
        {
          step: 10,
          label: "Approved Plan Coverage",
          value: approvedPlanCoverage,
          formula:
            "SUM(PlanOption.expectedPieces WHERE approvalStatus='APPROVED' AND category matches)",
          source: "PlanOption table",
          tone: "coverage",
        },
        {
          step: 11,
          label: "Remaining Unplanned Need",
          value: remainingUnplanned,
          formula: "MAX(0, Pipeline Need - Approved Plan Coverage)",
          source: "Step 9 - Step 10",
          tone: "shortage",
        },
        {
          step: 12,
          label: "Excess Stock",
          value: excessStock,
          formula:
            "MAX(0, Available - Target) — advisory only, does NOT change shortage",
          source: "Step 5 - Step 4 (if positive)",
          tone: "advisory",
        },
        {
          step: 13,
          label: "Forecast Signal",
          value: forecastSignal,
          formula: "PREDICTION — advisory only, NOT confirmed demand",
          source: forecastSource,
          tone: "advisory",
        },
      ],
      fourNumbers: {
        physicalShortage,
        pipelineAdjusted: pipelineNeed,
        planningAdjusted: remainingUnplanned,
        forecastRequirement: forecastSignal,
      },
    };
  });

  // 4. Summary — totalExcess / categoriesWithExcess use step 12 value
  const totalCategories = categories.length;
  const totalShortage = categories.reduce(
    (s, c) => s + c.fourNumbers.physicalShortage,
    0,
  );
  let totalExcess = 0;
  let categoriesWithExcess = 0;
  for (const c of categories) {
    const excessVal = c.steps.find((st) => st.step === 12)?.value ?? 0;
    if (excessVal > 0) {
      totalExcess += excessVal;
      categoriesWithExcess += 1;
    }
  }
  const categoriesWithShortage = categories.filter(
    (c) => c.fourNumbers.physicalShortage > 0,
  ).length;

  return ok({
    ruleVersion: latestRun.ruleVersion,
    runDate: latestRun.runDate.toISOString(),
    windowDays: latestRun.windowDays,
    forecastRunVersion: latestForecastRun?.modelVersion ?? null,
    categories,
    summary: {
      totalCategories,
      totalShortage,
      totalExcess,
      categoriesWithShortage,
      categoriesWithExcess,
    },
  });
}

function round2(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 100) / 100;
}
