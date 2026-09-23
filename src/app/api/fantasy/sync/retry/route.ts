import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { retrySynchronization } from "@/lib/fantasy/sync-service";
import { z } from "zod";

const retrySchema = z.object({
  reason: z.string().min(3).max(200).optional(),
});

export const POST = withApi({
  permission: "fantasy.sync.retry",
  body: retrySchema,
}, async (_req, _ctx, { principal, body, audit }) => {
  // Retries current failed checkpoint only; does not accept arbitrary checkpoints
  const result = await retrySynchronization({
    actor: principal.username,
    actorUserId: principal.userId,
  });

  await audit(db, {
    action: "FANTASY_SYNC_RETRY",
    entity: "IntegrationSyncRun",
    entityId: result.runId,
    after: {
      status: result.status,
      batchId: result.batchId,
      startingCheckpoint: result.startingCheckpoint,
      endingCheckpoint: result.endingCheckpoint,
      reconciliation: result.reconciliation,
    },
    reason: body?.reason ?? "Manual retry of current failed checkpoint",
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
