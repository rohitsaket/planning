import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";

// Demand Run History — list all past demand runs (most recent first)
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const config = getFantasyConfig();

  const runs = await db.demandRun.findMany({
    orderBy: { runDate: "desc" },
    take: 100,
    include: {
      _count: {
        select: { metrics: true },
      },
    },
  });

  const lock = await db.demandCalculationLock.findUnique({
    where: { id: "DEMAND_CALCULATION" },
  });

  const rows = runs.map((r) => ({
    id: r.id,
    runDate: r.runDate.toISOString(),
    businessDateIst: r.businessDateIst,
    windowDays: r.windowDays,
    ruleVersion: r.ruleVersion,
    sourcePolicy: r.sourcePolicy,
    mappingFingerprint: r.mappingFingerprint,
    mappingVersion: r.mappingVersion,
    status: r.status,
    totalShortage: r.totalShortage,
    totalExcess: r.totalExcess,
    salesCount: r.salesCount,
    inventoryCount: r.inventoryCount,
    wipCount: r.wipCount,
    planCount: r.planCount,
    excludedCount: r.excludedCount,
    checkpoint: r.checkpoint,
    lastBatchId: r.lastBatchId,
    sourceCutoff: r.sourceCutoff?.toISOString() ?? null,
    isSimulated: r.isSimulated,
    actor: r.actor || "system",
    durationMs: r.durationMs,
    metricCount: r._count.metrics,
    errorSummary: r.errorSummary,
  }));

  const totalRuns = rows.length;
  const avgShortage = totalRuns > 0
    ? num(rows.reduce((s, r) => s + r.totalShortage, 0) / totalRuns)
    : 0;
  const avgExcess = totalRuns > 0
    ? num(rows.reduce((s, r) => s + r.totalExcess, 0) / totalRuns)
    : 0;
  const lastRun = rows.length > 0 ? rows[0] : null;

  return ok({
    sourceMode: config.sourceMode,
    isSimulated: config.isSimulation,
    isLocked: lock?.isLocked ?? false,
    lockedAt: lock?.lockedAt?.toISOString() ?? null,
    lockedBy: lock?.lockedBy ?? null,
    hasEverRun: totalRuns > 0,
    rows,
    summary: {
      totalRuns,
      avgShortage,
      avgExcess,
      lastRunDate: lastRun?.runDate ?? null,
      lastBusinessDateIst: lastRun?.businessDateIst ?? null,
      lastShortage: lastRun?.totalShortage ?? 0,
      lastExcess: lastRun?.totalExcess ?? 0,
      lastMetricCount: lastRun?.metricCount ?? 0,
      lastCheckpoint: lastRun?.checkpoint ?? 0,
    },
  });
});
