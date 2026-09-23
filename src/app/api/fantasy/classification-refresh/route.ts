import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  ClassificationRefreshError,
  refreshFixtureClassification,
  REFRESH_MAX_RECORDS,
} from "@/lib/fantasy/classification-refresh";
import { z } from "zod";

/**
 * Classifies canonical fixture records that predate the classification columns.
 *
 * Guarded by `fantasy.sync.run` because it writes canonical records, and that is the
 * established authority for writing them. It is deliberately not a read permission: this
 * appends history versions and audit rows.
 *
 * Fixture-only by construction — the service refuses anything it cannot prove came from
 * the known fixture adapter, and this route adds no way to widen that.
 */

const refreshSchema = z.object({
  /** Compute and report without writing. */
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(REFRESH_MAX_RECORDS).optional(),
});

export const POST = withApi(
  {
    permission: "fantasy.sync.run",
    body: refreshSchema,
    rateLimit: { limit: 5, windowMs: 60_000 },
  },
  async (_req, _ctx, { principal, body, audit }) => {
    try {
      const result = await refreshFixtureClassification({
        actor: principal.username,
        actorUserId: principal.userId,
        dryRun: body?.dryRun ?? false,
        limit: body?.limit,
      });

      // The service writes a per-record audit row; this records the operation itself.
      await audit(db, {
        action: "FANTASY_CLASSIFICATION_REFRESH_RUN",
        entity: "LotMasterRecord",
        entityId: null,
        outcome: "SUCCESS",
        after: {
          dryRun: result.dryRun,
          inspected: result.inspected,
          refreshed: result.refreshed,
          historyVersionsAppended: result.historyVersionsAppended,
          profile: result.profileCode,
          profileVersion: result.profileVersion,
        },
        reason: result.dryRun
          ? "Fixture classification refresh (dry run)"
          : "Fixture classification refresh",
      });

      return ok(result);
    } catch (error) {
      if (error instanceof ClassificationRefreshError) {
        throw new ApiError(409, error.code, error.message);
      }
      throw error;
    }
  },
);
