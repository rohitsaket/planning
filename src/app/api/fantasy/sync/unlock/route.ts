import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { unlockSynchronization } from "@/lib/fantasy/sync-service";
import { forceReleaseCanonicalState } from "@/lib/fantasy/canonical-state-claim";
import { z } from "zod";

/**
 * Administrative release of a stuck synchronization.
 *
 * Two things are held by a running sync: its own operation lock, and the claim on the
 * canonical Fantasy records that stops a demand calculation reading them mid-change.
 * Releasing only the first would leave the canonical claim held for a full lease, during
 * which no demand run could start — so both are released here.
 *
 * The reason is required rather than optional: a forced release can discard another
 * worker's in-flight batch, and the audit record should say why someone did that.
 */
// Not `.strict()`: `withApi` already strips and logs client-supplied identity fields,
// so refusing the whole request would replace a working defence with a different one.
const unlockSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});

export const POST = withApi({
  permission: "fantasy.sync.unlock",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit, requestId }) => {
  // Actor comes from the authenticated session. A request body never names who acted.
  const actor = principal.username;

  const result = await unlockSynchronization(actor, body.reason);
  // Force-releasing increments the claim generation, which fences the displaced worker:
  // its ownership check fails, so it can no longer advance the checkpoint or mark its
  // run successful.
  const canonical = await forceReleaseCanonicalState(actor);

  await audit(db, {
    action: "FANTASY_SYNC_UNLOCK",
    entity: "SyncCheckpoint",
    entityId: "FANTASY",
    reason: body.reason,
    after: {
      unlockedBy: actor,
      unlockedAt: new Date().toISOString(),
      // Breaking live work is a different act from clearing a stale lock; the record
      // says which happened. No owner token is stored — it identifies nothing a reader
      // needs and everything a future claimant must not know.
      syncLeaseWasActive: result.forcedActiveLease ?? false,
      canonicalClaimReleased: canonical.released,
      canonicalClaimWasActive: canonical.forcedActiveClaim,
      canonicalClaimHolder: canonical.previousHolder,
      canonicalClaimHeldBy: canonical.previousClaimedBy,
    },
  });

  return ok({
    success: result.success,
    message: result.message,
    // Whether a running operation was interrupted, so the operator knows to expect a
    // discarded run rather than a silently cleared lock.
    interruptedActiveWork: Boolean(result.forcedActiveLease) || canonical.forcedActiveClaim,
    reference: requestId.slice(0, 8),
  });
});
