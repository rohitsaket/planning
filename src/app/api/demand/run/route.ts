import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/api/rate-limit";
import { runDemandCalculation } from "@/lib/demand/demand-service";

/**
 * Which source a run reads is not the caller's decision.
 *
 * The schema is strict, so a request that names a source policy is refused rather than
 * silently ignored: the legacy source cannot be discovered by probing this endpoint, and
 * no client can quietly produce a run that the analysis snapshot guard would later
 * reject as non-canonical. The service still accepts the policy as a parameter — the
 * demand test suite exercises both, and `assessSnapshot` relies on the recorded value to
 * prove a snapshot was canonical — but it is chosen here, on the server, and never
 * accepted from a browser.
 */
const triggerSchema = z
  .object({
    windowDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();

// Trigger a new authoritative demand calculation run.
// Recomputes 90-day sales aggregates per planning category (Lab + Shape + Weight Band),
// applies the confirmed demand rule, and creates an immutable snapshot.
export const POST = withApi({
  permission: "demand.run",
  body: triggerSchema,
  rateLimit: LIMITS.batch,
}, async (_req, _ctx, { principal, body, audit }) => {
  const result = await runDemandCalculation({
    actor: principal.username,
    actorUserId: principal.userId,
    windowDays: body?.windowDays ?? 90,
    sourcePolicy: "CANONICAL_FANTASY",
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
