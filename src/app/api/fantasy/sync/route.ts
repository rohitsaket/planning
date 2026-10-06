import { db } from "@/lib/db";
import { err, ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { runSynchronization } from "@/lib/fantasy/sync-service";
import { resolveFantasySourceState, resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { readPublicFailure } from "@/lib/api/operational-failure";

export const GET = withApi({ permission: "fantasy.read" }, async () => {
  const sourceState = await resolveFantasySourceStateWithHistory(db);

  const checkpoint = await db.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });

  const runs = await db.integrationSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  const latestRun = runs[0] ?? null;
  const hasEverRun = runs.length > 0;

  const polishedRun = runs.find((r) => r.entity === "Polished" || r.entity === "ALL" || r.entity === "BATCH") ?? null;
  const wipRun = runs.find((r) => r.entity === "WIP" || r.entity === "ALL" || r.entity === "BATCH") ?? null;

  const summary = [
    {
      entity: "Polished Stock",
      lastStatus: hasEverRun && polishedRun ? polishedRun.status : "NOT_RUN",
      recordsFetched: polishedRun?.recordsFetched ?? 0,
      durationMs: polishedRun?.durationMs ?? 0,
      startedAt: polishedRun?.startedAt.toISOString() ?? null,
      finishedAt: polishedRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      failure: readPublicFailure(polishedRun?.errorSummary),
    },
    {
      entity: "WIP Manufacturing",
      lastStatus: hasEverRun && wipRun ? wipRun.status : "NOT_RUN",
      recordsFetched: wipRun?.recordsFetched ?? 0,
      durationMs: wipRun?.durationMs ?? 0,
      startedAt: wipRun?.startedAt.toISOString() ?? null,
      finishedAt: wipRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      failure: null,
    },
  ];

  const fantasyPolishedCount = await db.polishedStone.count();
  const totalOverallLots = await db.lotMasterRecord.count();
  const activeOverallLots = await db.lotMasterRecord.count({ where: { isCurrent: true } });
  const historicalOverallLots = await db.lotMasterRecord.count({ where: { isCurrent: false } });
  const unmappedStatuses = await db.fantasyStatusMapping.count({ where: { planningClass: "OTHER" } });

  const activeDqErrors = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "OPEN", severity: { in: ["ERROR", "BLOCKING"] } },
  });
  const activeDqWarnings = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "OPEN", severity: "WARNING" },
  });
  const resolvedDqIssues = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "RESOLVED" },
  });

  let missingIds: number | null = null;
  let duplicateIds: number | null = null;
  let staleRecords: number | null = null;

  if (hasEverRun) {
    const orphanedPolished = await db.polishedStone.count({
      where: {
        fantasyLotId: {
          notIn: (await db.lotMasterRecord.findMany({ select: { lotId: true } })).map((l) => l.lotId),
        },
      },
    });
    missingIds = orphanedPolished;
    duplicateIds = 0;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    staleRecords = await db.lotMasterRecord.count({
      where: {
        isCurrent: true,
        lastSeenAt: { lt: thirtyDaysAgo },
      },
    });
  }

  return ok({
    sourceState,
    hasEverRun,
    checkpoint: checkpoint?.currentCheckpoint ?? 0,
    isLocked: checkpoint?.isLocked ?? false,
    lockedAt: checkpoint?.lockedAt?.toISOString() ?? null,
    lockedBy: checkpoint?.lockedBy ?? null,
    lastSyncAt: checkpoint?.lastSyncAt?.toISOString() ?? null,
    summary,
    reconciliation: {
      fantasyPolishedCount,
      totalOverallLots,
      activeOverallLots,
      historicalOverallLots,
      unmappedStatuses,
      dataQualityErrors: activeDqErrors,
      dataQualityWarnings: activeDqWarnings,
      resolvedDqIssues,
      missingIds,
      duplicateIds,
      staleRecords,
      latestRunMetrics: latestRun
        ? {
            recordsReceived: latestRun.recordsReceived,
            recordsCreated: latestRun.recordsCreated,
            recordsUpdated: latestRun.recordsUpdated,
            recordsUnchanged: latestRun.recordsUnchanged,
            recordsSkipped: latestRun.recordsSkipped,
            recordsRejected: latestRun.recordsRejected,
            recordsRemoved: latestRun.recordsRemoved,
            historyVersionsCreated: latestRun.historyVersionsCreated,
            dqIssuesCreated: latestRun.dqIssuesCreated,
          }
        : null,
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
      failure: readPublicFailure(r.errorSummary),
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  });
});

export const POST = withApi({ permission: "fantasy.sync.run" }, async (_req, _ctx, { principal, audit }) => {
  const sourceState = resolveFantasySourceState();
  if (sourceState.effectiveState === "NOT_CONFIGURED") {
    return err(sourceState.statusExplanation, 409);
  }

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
    failure: result.failure ?? null,
  });
});
