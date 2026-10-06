import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";
import { runLiveDataSync } from "@/lib/fantasy/live-sync";

// Manual "Sync Now": same service the scheduler uses. fantasy.sync permission, same-origin check
// and write rate limit come from withApi. The response never carries credentials or tokens.
export const POST = withApi({ permission: "fantasy.sync.run", rateLimit: LIMITS.batch }, async (_req, _ctx, { principal, audit }) => {
  const r = await runLiveDataSync({ trigger: "manual", actor: principal.username, actorUserId: principal.userId, chainCanonical: "background" });
  if (r.status === "LOCKED") throw new ApiError(409, "SYNC_RUNNING", "Synchronization is already running.");
  await audit(db, {
    action: "FANTASY_LIVE_SYNC",
    entity: "IntegrationSyncRun",
    entityId: r.syncRunId,
    after: { status: r.status, recordsFetched: r.recordsFetched, inserted: r.recordsInserted, updated: r.recordsUpdated, unchanged: r.recordsUnchanged, failed: r.recordsFailed, staled: r.recordsStaled, errorCode: r.errorCode ?? null },
    reason: "Manual Fantasy Live Data synchronization",
  });
  return ok({
    success: r.success, syncRunId: r.syncRunId, status: r.status.toLowerCase(),
    recordsFetched: r.recordsFetched, recordsInserted: r.recordsInserted, recordsUpdated: r.recordsUpdated, recordsUnchanged: r.recordsUnchanged, recordsFailed: r.recordsFailed, recordsStaled: r.recordsStaled,
    pagesFetched: r.pagesFetched, durationMs: r.durationMs, errorCode: r.errorCode ?? null, errorSummary: r.errorSummary ?? null,
  });
});
