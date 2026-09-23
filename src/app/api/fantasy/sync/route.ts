import { db } from "@/lib/db";
import { err, ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { runSynchronization } from "@/lib/fantasy/sync-service";
import { resolveFantasySourceState, resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";

// GET: Fantasy Sync Dashboard — sync runs, active checkpoint & honest reconciliation summary
export const GET = withApi({ permission: "fantasy.read" }, async () => {
  // One centrally derived source state. This route never decides for itself what
  // "simulated", "live" or "degraded" means.
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

  // Real entity-specific statuses
  const polishedRun = runs.find((r) => r.entity === "Polished" || r.entity === "ALL" || r.entity === "BATCH") ?? null;
  const roughRun = runs.find((r) => r.entity === "Rough" || r.entity === "ALL" || r.entity === "BATCH") ?? null;
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
      errors: polishedRun?.errorSummary ? { count: 1, sample: polishedRun.errorSummary } : null,
    },
    {
      entity: "Rough Stock",
      lastStatus: hasEverRun && roughRun ? roughRun.status : "NOT_RUN",
      recordsFetched: roughRun?.recordsFetched ?? 0,
      durationMs: roughRun?.durationMs ?? 0,
      startedAt: roughRun?.startedAt.toISOString() ?? null,
      finishedAt: roughRun?.finishedAt?.toISOString() ?? null,
      nextRunAt: null,
      errors: null,
    },
    {
      entity: "WIP Manufacturing",
      lastStatus: hasEverRun && wipRun ? wipRun.status : "NOT_RUN",
      recordsFetched: wipRun?.recordsFetched ?? 0,
      durationMs: wipRun?.durationMs ?? 0,
      startedAt: wipRun?.startedAt.toISOString() ?? null,
      finishedAt: wipRun?.finishedAt?.toISOString() ?? null,
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

  // Separate active/open issues from resolved issues
  const activeDqErrors = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "OPEN", severity: { in: ["ERROR", "BLOCKING"] } },
  });
  const activeDqWarnings = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "OPEN", severity: "WARNING" },
  });
  const resolvedDqIssues = await db.dataQualityIssue.count({
    where: { source: "FANTASY", status: "RESOLVED" },
  });

  // Calculate missing IDs, duplicate IDs, and stale records when supporting data exists
  let missingIds: number | null = null;
  let duplicateIds: number | null = null;
  let staleRecords: number | null = null;

  if (hasEverRun) {
    // Check if any active polished inventory stone lacks a corresponding master record
    const orphanedPolished = await db.polishedStone.count({
      where: {
        fantasyLotId: {
          notIn: (await db.lotMasterRecord.findMany({ select: { lotId: true } })).map((l) => l.lotId),
        },
      },
    });
    missingIds = orphanedPolished;
    duplicateIds = 0; // Guarded by unique constraint

    // Check for records not seen in over 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    staleRecords = await db.lotMasterRecord.count({
      where: {
        isCurrent: true,
        lastSeenAt: { lt: thirtyDaysAgo },
      },
    });
  }

  return ok({
    // Sanitized: no credential, environment value, provider URL or cursor token.
    sourceState,
    hasEverRun,
    checkpoint: checkpoint?.currentCheckpoint ?? 0,
    isLocked: checkpoint?.isLocked ?? false,
    lockedAt: checkpoint?.lockedAt?.toISOString() ?? null,
    lockedBy: checkpoint?.lockedBy ?? null,
    lastSyncAt: checkpoint?.lastSyncAt?.toISOString() ?? null,
    summary,
    reconciliation: {
      fantasyRoughCount,
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
      // Sanitized error summary without exposing internal stack traces
      errorSummary: r.errorSummary ? r.errorSummary.split("\n")[0].slice(0, 250) : null,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
  });
});

// POST: Trigger real incremental synchronization batch
export const POST = withApi({ permission: "fantasy.sync.run" }, async (_req, _ctx, { principal, audit }) => {
  // Fails closed on an unconfigured or unsupported source: no lock, no run record and
  // a fixed safe explanation instead of an unhandled provider error.
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
    errorSummary: result.errorSummary ? result.errorSummary.split("\n")[0].slice(0, 250) : undefined,
  });
});
