import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { retrySynchronization } from "@/lib/fantasy/sync-service";
import { z } from "zod";

const retrySchema = z.object({
  targetCheckpoint: z.number().int().min(0).max(10).optional(),
  reason: z.string().min(3).max(200).optional(),
});

export const POST = withApi({
  permission: "fantasy.sync",
  body: retrySchema,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await retrySynchronization(body.targetCheckpoint, principal.username);

  await audit(db, {
    action: "FANTASY_SYNC_RETRY",
    entity: "IntegrationSyncRun",
    entityId: result.runId,
    after: {
      targetCheckpoint: body.targetCheckpoint,
      status: result.status,
      batchId: result.batchId,
      reconciliation: result.reconciliation,
    },
    reason: body.reason ?? "Manual retry of synchronization run",
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
