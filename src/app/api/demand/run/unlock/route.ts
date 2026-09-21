import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { unlockDemandCalculation } from "@/lib/demand/demand-service";

const unlockSchema = z.object({
  reason: z.string().min(3, "A justification reason of at least 3 characters is mandatory").max(300),
});

export const POST = withApi({
  permission: "demand.unlock",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await unlockDemandCalculation(principal.username, body.reason, principal.userId);

  await audit(db, {
    action: "DEMAND_CALCULATION_UNLOCK",
    entity: "DemandCalculationLock",
    entityId: "DEMAND_CALCULATION",
    reason: body.reason,
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
