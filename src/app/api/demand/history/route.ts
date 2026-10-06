import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qInt } from "@/lib/api/with-api";
import { resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { readPublicFailure } from "@/lib/api/operational-failure";

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const sourceState = await resolveFantasySourceStateWithHistory(db);
  const url = new URL(req.url);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 200 });

  const [total, runs, allRunStats, lock] = await Promise.all([
    db.demandRun.count(),
    db.demandRun.findMany({
      orderBy: [{ runDate: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { metrics: true } } },
    }),
    db.demandRun.aggregate({ _avg: { totalShortage: true, totalExcess: true } }),
    db.demandCalculationLock.findUnique({ where: { id: "DEMAND_CALCULATION" } }),
  ]);

  const latestRun = await db.demandRun.findFirst({
    orderBy: [{ runDate: "desc" }, { id: "desc" }],
    include: { _count: { select: { metrics: true } } },
  });

  const rows = runs.map((r) => ({
    id: r.id,
    runDate: r.runDate.toISOString(),
    businessDateIst: r.businessDateIst,
    windowDays: r.windowDays,
    lookbackStart: r.lookbackStart?.toISOString() ?? null,
    lookbackEnd: r.lookbackEnd?.toISOString() ?? null,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status,
    totalShortage: r.totalShortage,
    totalExcess: r.totalExcess,
    salesCount: r.salesCount,
    inventoryCount: r.inventoryCount,
    wipCount: r.wipCount,
    excludedCount: r.excludedCount,
    sourceCutoff: r.sourceCutoff?.toISOString() ?? null,
    isSimulated: r.isSimulated,
    actor: r.actor || "system",
    durationMs: r.durationMs,
    metricCount: r._count.metrics,
    failure: readPublicFailure(r.errorSummary),
    wipPolicyStatus: r.wipPolicyStatus,
    wipEligibleStages: r.wipEligibleStages ? r.wipEligibleStages.split(",").filter(Boolean) : [],
  }));

  const totalRuns = total;
  const avgShortage = num(allRunStats._avg.totalShortage ?? 0);
  const avgExcess = num(allRunStats._avg.totalExcess ?? 0);
  const lastRun = latestRun;

  return ok({
    sourceMode: sourceState.effectiveState,
    isSimulated: sourceState.isSimulated,
    isLocked: lock?.isLocked ?? false,
    lockedAt: lock?.lockedAt?.toISOString() ?? null,
    lockedBy: lock?.lockedBy ?? null,
    hasEverRun: totalRuns > 0,
    rows,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    summary: {
      totalRuns,
      avgShortage,
      avgExcess,
      lastRunDate: lastRun?.runDate.toISOString() ?? null,
      lastBusinessDateIst: lastRun?.businessDateIst ?? null,
      lastStatus: lastRun?.status ?? "NOT_RUN",
      lastShortage: lastRun?.totalShortage ?? 0,
      lastExcess: lastRun?.totalExcess ?? 0,
      lastMetricCount: lastRun?._count.metrics ?? 0,
      lastWipPolicyStatus: lastRun?.wipPolicyStatus ?? null,
    },
  });
});
