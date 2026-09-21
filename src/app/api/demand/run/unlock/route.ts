import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { unlockDemandCalculation } from "@/lib/demand/demand-service";

const unlockSchema = z.object({
  reason: z.string().min(3).max(300).optional(),
});

export const POST = withApi({
  permission: "demand.run",
  body: unlockSchema,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await unlockDemandCalculation(principal.username, body?.reason);

  await audit(db, {
    action: "DEMAND_CALCULATION_UNLOCK",
    entity: "DemandCalculationLock",
    entityId: "DEMAND_CALCULATION",
    reason: body?.reason ?? "Authorized manual release of demand calculation lock",
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
