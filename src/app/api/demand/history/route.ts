import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Demand Run History — list all past demand runs (most recent first).
// Joins AuditLog to surface the actor who triggered each run.
export async function GET() {
  const runs = await db.demandRun.findMany({
    orderBy: { runDate: "desc" },
    take: 200,
  });

  // Resolve actor per run via the AuditLog join (entity=DemandRun, entityId=run.id)
  const runIds = runs.map((r) => r.id);
  const auditLogs = runIds.length
    ? await db.auditLog.findMany({
        where: { entity: "DemandRun", entityId: { in: runIds } },
        orderBy: { timestamp: "desc" },
      })
    : [];

  // Map runId -> first actor found (audit is ordered desc, so the first match
  // is the most recent audit log for that run — typically the trigger event)
  const actorByRun = new Map<string, { actor: string; reason: string | null }>();
  for (const log of auditLogs) {
    if (log.entityId && !actorByRun.has(log.entityId)) {
      actorByRun.set(log.entityId, { actor: log.actor, reason: log.reason });
    }
  }

  // Metric counts per run
  const metricCounts = runIds.length
    ? await db.demandMetric.groupBy({
        by: ["runId"],
        where: { runId: { in: runIds } },
        _count: { _all: true },
      })
    : [];
  const countByRun = new Map<string, number>();
  for (const m of metricCounts) {
    countByRun.set(m.runId, m._count._all);
  }

  const rows = runs.map((r) => {
    const actorInfo = actorByRun.get(r.id);
    return {
      id: r.id,
      runDate: r.runDate.toISOString(),
      windowDays: r.windowDays,
      ruleVersion: r.ruleVersion,
      status: r.status,
      totalShortage: r.totalShortage,
      totalExcess: r.totalExcess,
      metricCount: countByRun.get(r.id) ?? 0,
      actor: actorInfo?.actor ?? "system",
      reason: actorInfo?.reason ?? null,
    };
  });

  // Aggregate KPIs across the history
  const totalRuns = rows.length;
  const avgShortage = totalRuns > 0
    ? num(rows.reduce((s, r) => s + r.totalShortage, 0) / totalRuns)
    : 0;
  const avgExcess = totalRuns > 0
    ? num(rows.reduce((s, r) => s + r.totalExcess, 0) / totalRuns)
    : 0;
  const lastRunDate = rows.length > 0 ? rows[0].runDate : null;
  const lastShortage = rows.length > 0 ? rows[0].totalShortage : 0;
  const lastExcess = rows.length > 0 ? rows[0].totalExcess : 0;
  const lastMetricCount = rows.length > 0 ? rows[0].metricCount : 0;

  return ok({
    rows,
    summary: {
      totalRuns,
      avgShortage,
      avgExcess,
      lastRunDate,
      lastShortage,
      lastExcess,
      lastMetricCount,
    },
  });
}
