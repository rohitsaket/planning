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

const refreshSchema = z.object({
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
