import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { ANALYSIS_SOURCE_POLICY, ANALYSIS_WINDOW_DAYS } from "@/lib/analysis/analysis-snapshot";
import { z } from "zod";

const refreshSchema = z.object({
  reason: z.string().trim().min(3).max(200).optional(),
});

export const POST = withApi(
  {
    permission: "demand.run",
    body: refreshSchema,
    rateLimit: LIMITS.batch,
  },
  async (_req, _ctx, { principal, body, audit }) => {
    try {
      const result = await runDemandCalculation({
        actor: principal.username,
        actorUserId: principal.userId,
        windowDays: ANALYSIS_WINDOW_DAYS,
        sourcePolicy: ANALYSIS_SOURCE_POLICY,
      });

      await audit(db, {
        action: "ANALYSIS_SNAPSHOT_REFRESH",
        entity: "DemandRun",
        entityId: result.runId,
        outcome: "SUCCESS",
        after: {
          runId: result.runId,
          windowDays: result.windowDays,
          sourcePolicy: ANALYSIS_SOURCE_POLICY,
          totalCategories: result.totalCategories,
          salesCount: result.salesCount,
          checkpoint: result.checkpoint,
        },
        reason: body?.reason ?? `Recalculated the ${ANALYSIS_WINDOW_DAYS}-day analysis snapshot`,
      });

      return ok({
        runId: result.runId,
        windowDays: result.windowDays,
        sourcePolicy: ANALYSIS_SOURCE_POLICY,
        salesCount: result.salesCount,
        totalCategories: result.totalCategories,
        runDate: result.runDate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis refresh failed.";
      await audit(db, {
        action: "ANALYSIS_SNAPSHOT_REFRESH",
        entity: "DemandRun",
        entityId: null,
        outcome: "FAILED",
        after: { windowDays: ANALYSIS_WINDOW_DAYS, sourcePolicy: ANALYSIS_SOURCE_POLICY },
        reason: "Analysis refresh did not complete",
      });

      const locked = /lock|already running|in progress/i.test(message);
      throw new ApiError(
        locked ? 409 : 500,
        locked ? "DEMAND_RUN_IN_PROGRESS" : "ANALYSIS_REFRESH_FAILED",
        locked
          ? "A demand calculation is already running. Wait for it to finish."
          : "The analysis refresh did not complete. Review the demand run history.",
      );
    }
  },
);
