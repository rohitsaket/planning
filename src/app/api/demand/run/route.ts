import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { classifyWeightBand, normalizeLab, roundHalfUpInt } from "@/lib/domain/diamond-rules";

// Trigger a new demand calculation run.
// Recomputes 90-day sales aggregates per planning category (Lab + Shape + Weight Band),
// applies the confirmed demand formula, and updates demand metrics + requirement quantities.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const actor = body?.actor || "system";
  const windowDays = 90;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - windowDays);

  // Fetch all invoice sales in 90-day window
  const records = await db.salesRecord.findMany({
    where: { lotStatusDb: "Invoice", docDate: { gte: since } },
    include: { weightBand: true },
  });

  // Aggregate by planning category = lab | shape | weightBand.label
  const agg = new Map<string, { count: number }>();
  for (const r of records) {
    const cat = `${r.labNormalized ?? "Non-Cert"}|${r.shape}|${r.weightBand?.label ?? "Unmapped"}`;
    const cur = agg.get(cat) ?? { count: 0 };
    cur.count += 1;
    agg.set(cat, cur);
  }

  // Create new demand run
  const run = await db.demandRun.create({
    data: {
      runDate: now,
      windowDays,
      ruleVersion: "DEMAND-V1",
      status: "COMPLETED",
      totalShortage: 0,
      totalExcess: 0,
    },
  });

  let totalShortage = 0;
  let totalExcess = 0;
  const metricsCreated: string[] = [];

  for (const [cat, v] of agg.entries()) {
    const [lab, shape, bandLabel] = cat.split("|");
    const band = await db.weightBand.findFirst({ where: { label: bandLabel } });
    const sales90d = v.count;
    const monthlyAvg = sales90d / 3;
    const unroundedTarget = monthlyAvg * 2;
    const roundedTarget = roundHalfUpInt(unroundedTarget);
    const available = await db.polishedStone.count({
      where: {
        labNormalized: lab,
        shape,
        weightBand: { label: bandLabel },
        planningClass: { in: ["PHYSICAL", "PLANNING_AVAILABLE"] },
      },
    });
    const shortage = Math.max(0, roundedTarget - available);
    const excess = Math.max(0, available - roundedTarget);
    const wip = 0; // OPEN rule — do not auto-apply
    const planCov = 0;
    const pipeline = Math.max(0, shortage - wip);
    const remaining = Math.max(0, pipeline - planCov);
    totalShortage += shortage;
    totalExcess += excess;

    const m = await db.demandMetric.create({
      data: {
        runId: run.id,
        planningCategory: cat,
        sales90d,
        monthlyAverage: monthlyAvg,
        unroundedTarget,
        roundedTarget,
        availableStock: available,
        memoQty: 0,
        physicalShortage: shortage,
        excessStock: excess,
        wipCoverage: wip,
        pipelineNeed: pipeline,
        approvedPlanCoverage: planCov,
        remainingUnplanned: remaining,
        forecastSignal: Math.round(sales90d * 0.15),
      },
    });
    metricsCreated.push(m.id);
  }

  await db.demandRun.update({
    where: { id: run.id },
    data: { totalShortage, totalExcess },
  });

  await db.auditLog.create({
    data: {
      actor,
      action: "DEMAND_RUN",
      entity: "DemandRun",
      entityId: run.id,
      reason: `Recalculated 90-day demand: ${agg.size} categories, ${records.length} invoice records, shortage=${totalShortage}, excess=${totalExcess}`,
      timestamp: now,
    },
  });

  return ok({
    runId: run.id,
    runDate: now.toISOString(),
    windowDays,
    categoriesProcessed: agg.size,
    recordsProcessed: records.length,
    totalShortage,
    totalExcess,
    ruleVersion: "DEMAND-V1",
  });
}
