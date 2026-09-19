import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";

// Fantasy Sync Dashboard — last sync runs + reconciliation summary
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const runs = await db.integrationSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
  });
  const latestByEntity = new Map<string, typeof runs[number]>();
  for (const r of runs) {
    if (!latestByEntity.has(r.entity)) latestByEntity.set(r.entity, r);
  }
  const summary = Array.from(latestByEntity.entries()).map(([entity, r]) => ({
    entity,
    lastStatus: r.status,
    recordsFetched: r.recordsFetched,
    durationMs: r.durationMs,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    nextRunAt: r.nextRunAt?.toISOString() ?? null,
    errors: r.errorsJson ? JSON.parse(r.errorsJson) : null,
  }));

  // Reconciliation summary (counts)
  const fantasyRoughCount = await db.roughStone.count();
  const fantasyPolishedCount = await db.polishedStone.count();
  const unmappedStatuses = await db.fantasyStatusMapping.count({ where: { planningClass: "OTHER" } });
  const dataQualityErrors = await db.dataQualityIssue.count({ where: { source: "FANTASY", severity: { in: ["ERROR", "BLOCKING"] } } });

  return ok({
    summary,
    reconciliation: {
      fantasyRoughCount,
      fantasyPolishedCount,
      unmappedStatuses,
      dataQualityErrors,
      missingIds: 0, // would require diff vs raw payload
      duplicateIds: 0,
      staleRecords: 0,
    },
    recentRuns: runs.slice(0, 15).map((r) => ({
      id: r.id,
      source: r.source,
      entity: r.entity,
      status: r.status,
      recordsFetched: r.recordsFetched,
      recordsCreated: r.recordsCreated,
      recordsUpdated: r.recordsUpdated,
      recordsSkipped: r.recordsSkipped,
      durationMs: r.durationMs,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      nextRunAt: r.nextRunAt?.toISOString() ?? null,
    })),
  });
});
