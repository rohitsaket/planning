import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/api/rate-limit";
import { runDemandCalculation } from "@/lib/demand/demand-service";

const triggerSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
});

// Trigger a new authoritative demand calculation run.
// Recomputes 90-day sales aggregates per planning category (Lab + Shape + Weight Band),
// applies the confirmed demand formula, and creates an immutable snapshot.
export const POST = withApi({
  permission: "demand.run",
  body: triggerSchema,
  rateLimit: LIMITS.batch,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await runDemandCalculation({
    actor: principal.username,
    actorUserId: principal.userId,
    windowDays: body?.windowDays ?? 90,
  });

  await audit(db, {
    action: "DEMAND_CALCULATION_RUN",
    entity: "DemandRun",
    entityId: result.runId,
    reason: `Recalculated ${result.windowDays}-day demand: ${result.totalCategories} categories, ${result.salesCount} sales records, shortage=${result.totalShortage}, excess=${result.totalExcess}`,
    after: {
      runId: result.runId,
      runDate: result.runDate,
      totalShortage: result.totalShortage,
      totalExcess: result.totalExcess,
      totalTarget: result.totalTarget,
      totalPhysicalStock: result.totalPhysicalStock,
      totalPipelineNeed: result.totalPipelineNeed,
      checkpoint: result.checkpoint,
    },
  });

  return ok(result);
});
