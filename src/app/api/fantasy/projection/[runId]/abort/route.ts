import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  ABORT_NOTE_MAX_LENGTH,
  ABORT_REASON_CODES,
  abortProjectionAttempt,
  ProjectionRecoveryError,
} from "@/lib/fantasy/projection-recovery";
import { z } from "zod";

/**
 * Aborts one RUNNING projection attempt.
 *
 * The narrowest possible recovery action: it changes a status and records who did it and
 * why. It does not delete anything, does not clean up candidates, and does not start a
 * replacement — retrying is a separate, explicit request that creates the next attempt.
 *
 * There is no automatic abort. A stalled-looking heartbeat is reported for a human to
 * judge; an invented staleness threshold would eventually kill a healthy long run.
 */

const abortSchema = z.object({
  /** The version the operator read. Refusing a stale version stops blind aborts. */
  expectedVersion: z.number().int().min(0),
  reasonCode: z.enum(ABORT_REASON_CODES),
  /** Bounded free text. Length-limited here and by a database CHECK constraint. */
  note: z.string().trim().max(ABORT_NOTE_MAX_LENGTH).optional(),
});

const ABORT_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  RUN_NOT_FOUND: 404,
  RUN_NOT_RUNNING: 409,
  VERSION_CONFLICT: 409,
  ABORT_REASON_INVALID: 400,
  ABORT_NOTE_TOO_LONG: 400,
});

// Both generics are explicit: naming the route-parameter type suppresses inference of
// the body type, which would otherwise be silently `undefined`.
export const POST = withApi<{ runId: string }, z.infer<typeof abortSchema>>(
  {
    // Deliberately NOT fantasy.projection.run or .read. Being allowed to start or
    // inspect a projection says nothing about the authority to terminate someone
    // else's running work.
    permission: "fantasy.projection.recover",
    body: abortSchema,
    rateLimit: { limit: 20, windowMs: 60_000 },
  },
  async (_req, ctx, { principal, body, audit }) => {
    const runId = idSchema.parse((await ctx.params).runId);

    try {
      const result = await abortProjectionAttempt(
        {
          runId,
          expectedVersion: body.expectedVersion,
          // The actor comes from the authenticated session, never from the request body.
          actorUserId: principal.userId,
          reasonCode: body.reasonCode,
          note: body.note ?? null,
        },
        // Written inside the abort's own transaction. If this throws, the status change
        // rolls back — an executed administrative recovery must never be invisible.
        async (tx, aborted) =>
          audit(tx, {
            action: "FANTASY_PROJECTION_ABORT",
            entity: "FantasyProjectionRun",
            entityId: aborted.runId,
            outcome: "SUCCESS",
            after: {
              status: aborted.status,
              attemptNumber: aborted.attemptNumber,
              abortReasonCode: aborted.abortReasonCode,
              version: aborted.version,
            },
            reason: `Projection attempt aborted (${aborted.abortReasonCode})`,
          }),
      );

      // No owner token, no hash, no raw Fantasy value.
      return ok({
        runId: result.runId,
        attemptNumber: result.attemptNumber,
        status: result.status,
        abortedAt: result.abortedAt.toISOString(),
        abortReasonCode: result.abortReasonCode,
        version: result.version,
      });
    } catch (error) {
      if (error instanceof ProjectionRecoveryError) {
        throw new ApiError(ABORT_ERROR_STATUS[error.code] ?? 409, error.code, error.message);
      }
      throw error;
    }
  },
);
