import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { runSynchronization } from "@/lib/fantasy/sync-service";
import { getFantasyConfig } from "@/lib/fantasy/config";

// GET: Fantasy Sync Dashboard — sync runs, active checkpoint & reconciliation summary
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const config = getFantasyConfig();

  const checkpoint = await db.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });

  const runs = await db.integrationSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  const latestRun = runs[0] ?? null;

  const summary = [
    {
      entity: "Polished Stock",
      lastStatus: latestRun?.status ?? "HEALTHY",
      recordsFetched: latestRun?.recordsFetched ?? 0,
      durationMs: latestRun?.durationMs ?? 0,
      startedAt: latestRun?.startedAt.toISOString() ?? new Date().toISOString(),
      finishedAt: latestRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      errors: latestRun?.errorSummary ? { count: 1, sample: latestRun.errorSummary } : null,
    },
    {
      entity: "Rough Stock",
      lastStatus: latestRun?.status ?? "HEALTHY",
      recordsFetched: latestRun?.recordsFetched ?? 0,
      durationMs: latestRun?.durationMs ?? 0,
      startedAt: latestRun?.startedAt.toISOString() ?? new Date().toISOString(),
      finishedAt: latestRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      errors: null,
    },
    {
      entity: "WIP Manufacturing",
      lastStatus: latestRun?.status ?? "HEALTHY",
      recordsFetched: latestRun?.recordsFetched ?? 0,
      durationMs: latestRun?.durationMs ?? 0,
      startedAt: latestRun?.startedAt.toISOString() ?? new Date().toISOString(),
      finishedAt: latestRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      errors: null,
    },
  ];

  // Live reconciliation statistics
  const fantasyRoughCount = await db.roughStone.count();
  const fantasyPolishedCount = await db.polishedStone.count();
  const totalOverallLots = await db.lotMasterRecord.count();
  const activeOverallLots = await db.lotMasterRecord.count({ where: { isCurrent: true } });
  const historicalOverallLots = await db.lotMasterRecord.count({ where: { isCurrent: false } });
  const unmappedStatuses = await db.fantasyStatusMapping.count({ where: { planningClass: "OTHER" } });
  const dataQualityErrors = await db.dataQualityIssue.count({ where: { source: "FANTASY", severity: { in: ["ERROR", "BLOCKING"] } } });
  const dataQualityWarnings = await db.dataQualityIssue.count({ where: { source: "FANTASY", severity: "WARNING" } });

  return ok({
    sourceMode: config.sourceMode,
    isSimulated: config.isSimulation,
    checkpoint: checkpoint?.currentCheckpoint ?? 0,
    isLocked: checkpoint?.isLocked ?? false,
    lastSyncAt: checkpoint?.lastSyncAt?.toISOString() ?? null,
    summary,
    reconciliation: {
      fantasyRoughCount,
      fantasyPolishedCount,
      totalOverallLots,
      activeOverallLots,
      historicalOverallLots,
      unmappedStatuses,
      dataQualityErrors,
      dataQualityWarnings,
      missingIds: 0,
      duplicateIds: 0,
      staleRecords: 0,
      latestRunMetrics: latestRun ? {
        recordsReceived: latestRun.recordsReceived,
        recordsCreated: latestRun.recordsCreated,
        recordsUpdated: latestRun.recordsUpdated,
        recordsUnchanged: latestRun.recordsUnchanged,
        recordsSkipped: latestRun.recordsSkipped,
        recordsRejected: latestRun.recordsRejected,
        recordsRemoved: latestRun.recordsRemoved,
        historyVersionsCreated: latestRun.historyVersionsCreated,
        dqIssuesCreated: latestRun.dqIssuesCreated,
      } : null,
    },
    recentRuns: runs.slice(0, 15).map((r) => ({
      id: r.id,
      source: r.source,
      entity: r.entity,
      status: r.status,
      batchId: r.batchId,
      startingCheckpoint: r.startingCheckpoint,
      endingCheckpoint: r.endingCheckpoint,
      recordsReceived: r.recordsReceived,
      recordsCreated: r.recordsCreated,
      recordsUpdated: r.recordsUpdated,
      recordsUnchanged: r.recordsUnchanged,
      recordsSkipped: r.recordsSkipped,
      recordsRejected: r.recordsRejected,
      recordsRemoved: r.recordsRemoved,
      historyVersionsCreated: r.historyVersionsCreated,
      dqIssuesCreated: r.dqIssuesCreated,
      recordsFetched: r.recordsFetched,
      durationMs: r.durationMs,
      triggeredBy: r.triggeredBy,
      errorSummary: r.errorSummary,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  });
});

// POST: Trigger real incremental synchronization batch
export const POST = withApi({ permission: "fantasy.sync" }, async (_req, _ctx, { principal, audit }) => {
  const result = await runSynchronization({
    actor: principal.username,
    actorUserId: principal.userId,
  });

  await audit(db, {
    action: "FANTASY_SYNC_TRIGGER",
    entity: "IntegrationSyncRun",
    entityId: result.runId,
    after: {
      batchId: result.batchId,
      startingCheckpoint: result.startingCheckpoint,
      endingCheckpoint: result.endingCheckpoint,
      status: result.status,
      reconciliation: result.reconciliation,
    },
    reason: `Manual trigger of synchronization batch ${result.batchId}`,
  });

  return ok({
    success: result.success,
    runId: result.runId,
    batchId: result.batchId,
    startingCheckpoint: result.startingCheckpoint,
    endingCheckpoint: result.endingCheckpoint,
    status: result.status,
    durationMs: result.durationMs,
    reconciliation: result.reconciliation,
    errorSummary: result.errorSummary,
  });
});
