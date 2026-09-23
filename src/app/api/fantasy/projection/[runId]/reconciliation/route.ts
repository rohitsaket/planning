import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { downstreamPolicySummary } from "@/lib/fantasy/downstream-source-policy";
import { ReconciliationError, reconcileProjectionRun } from "@/lib/fantasy/projection-reconciliation";

/**
 * Reconciliation for one shadow projection run.
 *
 * Returns counts and fixed difference codes only. There is deliberately no per-candidate
 * listing and no export: the useful question here is "how much would change and in which
 * direction", and answering it does not require handing out source values.
 */
export const GET = withApi<{ runId: string }>(
  { permission: "fantasy.projection.read" },
  async (_req, ctx) => {
    const runId = idSchema.parse((await ctx.params).runId);

    try {
      const summary = await reconcileProjectionRun(runId);
      return ok({
        ...summary,
        downstreamSourcePolicy: downstreamPolicySummary(),
      });
    } catch (error) {
      if (error instanceof ReconciliationError) {
        // Fixed codes mapped to safe statuses. The service message is already free of
        // source values, identifiers and internal detail.
        throw new ApiError(error.code === "RUN_NOT_FOUND" ? 404 : 409, error.code, error.message);
      }
      throw error;
    }
  },
);
