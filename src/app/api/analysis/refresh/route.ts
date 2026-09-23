import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { ANALYSIS_SOURCE_POLICY, ANALYSIS_WINDOW_DAYS } from "@/lib/analysis/analysis-snapshot";
import { z } from "zod";

/**
 * ANALYSIS REFRESH — calculate the authoritative 90-day snapshot the Analysis pages read.
 *
 * Deliberately narrower than `POST /api/demand/run`. That endpoint lets a caller choose
 * a window and a source policy; this one cannot, because an Analysis snapshot is defined
 * as exactly 90 days over canonical Fantasy data. Accepting either from the request
 * would let the page ask for a run it is then not allowed to display — or, worse, one
 * built from legacy seeded sales.
 *
 * There is no fallback. If canonical data cannot produce a result, the answer is that
 * result, not a substitute drawn from another source.
 */

// No window and no policy in the body. Both are fixed constants below.
const refreshSchema = z.object({
  reason: z.string().trim().min(3).max(200).optional(),
});

export const POST = withApi(
  {
    permission: "demand.run",
    body: refreshSchema,
    // A run walks the whole canonical history. The batch limit already applies to
    // demand runs; this endpoint reuses it rather than inventing a looser one.
    rateLimit: LIMITS.batch,
  },
  async (_req, _ctx, { principal, body, audit }) => {
    try {
      const result = await runDemandCalculation({
        // Actor comes from the authenticated session, never from the request body.
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
      // A refused or failed refresh is recorded too, so repeated attempts are visible.
      const message = error instanceof Error ? error.message : "Analysis refresh failed.";
      await audit(db, {
        action: "ANALYSIS_SNAPSHOT_REFRESH",
        entity: "DemandRun",
        entityId: null,
        outcome: "FAILED",
        after: { windowDays: ANALYSIS_WINDOW_DAYS, sourcePolicy: ANALYSIS_SOURCE_POLICY },
        reason: "Analysis refresh did not complete",
      });

      // The demand engine's lock message is safe and actionable; anything else is not
      // returned verbatim.
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
