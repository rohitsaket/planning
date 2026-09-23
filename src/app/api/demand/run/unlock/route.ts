import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { unlockDemandCalculation } from "@/lib/demand/demand-service";
import { forceReleaseCanonicalState } from "@/lib/fantasy/canonical-state-claim";

/**
 * Administrative release of a stuck demand calculation.
 *
 * A running calculation holds its own operation lock and a claim on the canonical
 * Fantasy records. Releasing only the first would leave synchronization blocked for a
 * full lease, so both are released — and the forced release fences the displaced run,
 * which can then no longer persist its metrics or mark itself completed.
 */

const unlockSchema = z.object({
  reason: z.string().trim().min(5, "A justification reason of at least 5 characters is mandatory").max(300),
});
// Deliberately not `.strict()`: `withApi` already strips and logs client-supplied
// identity fields, and a test sends forged ones precisely to prove they are ignored.
// Refusing the whole request instead would replace a working defence with a different
// one for no gain.

export const POST = withApi({
  permission: "demand.unlock",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit, requestId }) => {
  // Actor comes from the authenticated session, never from the request body.
  const actor = principal.username;

  const result = await unlockDemandCalculation(actor, body.reason, principal.userId);
  const canonical = await forceReleaseCanonicalState(actor);

  await audit(db, {
    action: "DEMAND_CALCULATION_UNLOCK",
    entity: "DemandCalculationLock",
    entityId: "DEMAND_CALCULATION",
    reason: body.reason,
    after: {
      unlockedBy: actor,
      unlockedAt: new Date().toISOString(),
      // No owner token is recorded: it identifies nothing a reader needs and everything
      // a future claimant must not know.
      canonicalClaimReleased: canonical.released,
      canonicalClaimWasActive: canonical.forcedActiveClaim,
      canonicalClaimHolder: canonical.previousHolder,
      canonicalClaimHeldBy: canonical.previousClaimedBy,
    },
  });

  return ok({
    success: result.success,
    message: result.message,
    interruptedActiveWork: canonical.forcedActiveClaim,
    reference: requestId.slice(0, 8),
  });
});
