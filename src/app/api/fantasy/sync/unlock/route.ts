import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { unlockSynchronization } from "@/lib/fantasy/sync-service";
import { z } from "zod";

const unlockSchema = z.object({
  reason: z.string().min(3).max(300).optional(),
});

export const POST = withApi({
  permission: "fantasy.sync",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await unlockSynchronization(principal.username, body?.reason);

  await audit(db, {
    action: "FANTASY_SYNC_UNLOCK",
    entity: "SyncCheckpoint",
    entityId: "FANTASY",
    reason: body?.reason ?? "Authorized manual release of synchronization lock",
    after: {
      unlockedBy: principal.username,
      unlockedAt: new Date().toISOString(),
    },
  });

  return ok({
    success: result.success,
    message: result.message,
  });
});
