import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { unlockSynchronization } from "@/lib/fantasy/sync-service";
import { forceReleaseCanonicalState } from "@/lib/fantasy/canonical-state-claim";
import { z } from "zod";

const unlockSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});

export const POST = withApi({
  permission: "fantasy.sync.unlock",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit, requestId }) => {
  const actor = principal.username;

  const result = await unlockSynchronization(actor, body.reason);
  const canonical = await forceReleaseCanonicalState(actor);

  await audit(db, {
    action: "FANTASY_SYNC_UNLOCK",
    entity: "SyncCheckpoint",
    entityId: "FANTASY",
    reason: body.reason,
    after: {
      unlockedBy: actor,
      unlockedAt: new Date().toISOString(),
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
    interruptedActiveWork: Boolean(result.forcedActiveLease) || canonical.forcedActiveClaim,
    reference: requestId.slice(0, 8),
  });
});
