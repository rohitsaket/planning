import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, idSchema, paging, paged } from "@/lib/api/with-api";
import { downstreamPolicySummary } from "@/lib/fantasy/downstream-source-policy";
import {
  ACTIVATION_BLOCKED_REASON,
  ProjectionError,
  PROJECTION_MODES,
  runProjection,
  type ProjectionMode,
  type ProjectionRunSummary,
} from "@/lib/fantasy/projection";
import { ApiError } from "@/lib/api/errors";
import { z } from "zod";

/**
 * HTTP status per fixed projection code.
 *
 * 404 only for a batch that does not exist. 409 for a state conflict the caller could
 * resolve by looking at an existing run. 422 for a batch that is structurally ineligible
 * — rejected, conflicting, or carrying provenance this build refuses to interpret —
 * because retrying will never help. None of the messages carries payload content.
 */
const PROJECTION_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  BATCH_NOT_FOUND: 404,
  PROJECTION_ALREADY_RUNNING: 409,
  INVALID_MODE: 400,
});

/**
 * How old a heartbeat must be before a RUNNING attempt is *reported* as possibly needing
 * attention. Reporting only: nothing aborts on it.
 *
 * Null disables the flag entirely. A value is read from the environment and validated;
 * anything unusable disables reporting rather than guessing a threshold.
 */
const STALENESS_REPORTING_MS: number | null = (() => {
  const raw = process.env.FANTASY_PROJECTION_STALE_REPORT_MS;
  if (raw === undefined || raw.trim() === "") return 15 * 60 * 1000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 60_000 || parsed > 24 * 60 * 60 * 1000) return null;
  return parsed;
})();

/**
 * Automatic abort of a stale run is NOT implemented and stays disabled until a real
 * threshold is approved. Reported so the UI states it rather than implying a watchdog
 * exists.
 */
const AUTOMATIC_STALE_ABORT = Object.freeze({
  enabled: false,
  reasonCode: "AUTOMATIC_STALE_ABORT_NOT_APPROVED",
  reportingThresholdMs: STALENESS_REPORTING_MS,
});

async function runProjectionOrFail(
  batchId: string,
  mode: ProjectionMode,
  requestedByUserId: string | null,
): Promise<ProjectionRunSummary> {
  try {
    return await runProjection({ batchId, mode, requestedByUserId });
  } catch (error) {
    if (error instanceof ProjectionError) {
      throw new ApiError(PROJECTION_ERROR_STATUS[error.code] ?? 422, error.code, error.message);
    }
    throw error;
  }
}

/**
 * Shadow projection runs.
 *
 * GET lists past runs with their counts. POST starts a new one. Neither surfaces a
 * candidate's source values: a run is reported as counts and fixed codes, and the
 * per-candidate detail is deliberately not exposed through this API at all.
 */

const runSchema = z.object({
  batchId: idSchema,
  // ACTIVE is absent from this enum, from the service, and from a database CHECK
  // constraint. A request asking for it fails validation with 400 rather than being
  // quietly downgraded to SHADOW.
  mode: z.enum(PROJECTION_MODES),
});

export const GET = withApi({ permission: "fantasy.projection.read" }, async (req) => {
  const url = new URL(req.url);
  const p = paging(url);

  // An explicit allowlist, not a spread of the row. `ownerTokenHash` must never leave
  // the database, and a wildcard select is one schema change away from leaking it.
  const [rows, total] = await Promise.all([
    db.fantasyProjectionRun.findMany({
      select: {
        id: true,
        mode: true,
        status: true,
        attemptNumber: true,
        version: true,
        sourceBatchId: true,
        effectiveSourceState: true,
        classificationProfile: true,
        classificationProfileVersion: true,
        identityPolicyVersion: true,
        measurementPolicy: true,
        quantitySemantics: true,
        weightUnit: true,
        rowsRead: true,
        rowsEligible: true,
        rowsSkippedQuarantined: true,
        rowsSkippedRejected: true,
        rowsSkippedNotNormalized: true,
        rowsSkippedUndecodable: true,
        candidatesProjected: true,
        candidatesReviewRequired: true,
        candidatesQuarantined: true,
        activationBlockedReason: true,
        terminalReasonCode: true,
        abortReasonCode: true,
        abortedAt: true,
        heartbeatAt: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: { startedAt: "desc" },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
    }),
    db.fantasyProjectionRun.count(),
  ]);

  const now = Date.now();
  const decorated = rows.map((r) => ({
    ...r,
    // Advisory only. A run is flagged for a human to look at when it is RUNNING and its
    // heartbeat is older than the reporting threshold. Nothing acts on this: automatic
    // abort stays disabled until a real threshold is approved, because an invented one
    // would terminate healthy long-running projections.
    attentionMayBeRequired:
      r.status === "RUNNING" &&
      STALENESS_REPORTING_MS !== null &&
      r.heartbeatAt !== null &&
      now - r.heartbeatAt.getTime() > STALENESS_REPORTING_MS,
    // Aborts note is deliberately omitted: it is bounded operator free text, and the
    // list is a diagnostics surface, not an operator message board.
    abortReasonNoteOmitted: r.abortReasonCode !== null,
  }));

  return ok({
    ...paged(decorated, p),
    total,
    downstreamSourcePolicy: downstreamPolicySummary(),
    activationBlockedReason: ACTIVATION_BLOCKED_REASON,
    automaticStaleAbort: AUTOMATIC_STALE_ABORT,
  });
});

export const POST = withApi(
  {
    permission: "fantasy.projection.run",
    body: runSchema,
    // A projection walks an entire batch. Tighter than the default write limit so it
    // cannot be used to generate repeated batch-sized work.
    rateLimit: { limit: 5, windowMs: 60_000 },
  },
  async (_req, _ctx, { principal, body, audit }) => {
    // No source state is passed in. The service binds to the provenance recorded on the
    // batch itself: a caller — or the application's current configuration — must not be
    // able to tell an old batch that it is live data.
    let summary;
    try {
      summary = await runProjectionOrFail(body.batchId, body.mode as ProjectionMode, principal.userId);
    } catch (error) {
      // A refused or failed start is recorded too. An audit trail that only contains
      // successes cannot answer "who kept trying to run this and why did it not work".
      const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
      const denied = error instanceof ApiError && error.status < 500;
      await audit(db, {
        action: "FANTASY_PROJECTION_RUN",
        entity: "FantasyRawBatch",
        entityId: body.batchId,
        outcome: denied ? "DENIED" : "FAILED",
        after: { mode: body.mode, refusalCode: code },
        reason: `Projection start refused (${code})`,
      });
      throw error;
    }

    await audit(db, {
      action: summary.idempotentReplay ? "FANTASY_PROJECTION_REPLAY" : "FANTASY_PROJECTION_RUN",
      entity: "FantasyProjectionRun",
      entityId: summary.runId,
      outcome: summary.status === "COMPLETED" ? "SUCCESS" : "FAILED",
      after: {
        mode: summary.mode,
        status: summary.status,
        attemptNumber: summary.attemptNumber,
        idempotentReplay: summary.idempotentReplay,
        rowsRead: summary.rowsRead,
        rowsEligible: summary.rowsEligible,
        candidatesProjected: summary.candidatesProjected,
        candidatesReviewRequired: summary.candidatesReviewRequired,
        candidatesQuarantined: summary.candidatesQuarantined,
        persisted: summary.persisted,
      },
      reason: summary.idempotentReplay
        ? `Idempotent replay of completed projection attempt ${summary.attemptNumber}`
        : `Shadow projection (${summary.mode}) attempt ${summary.attemptNumber}`,
    });

    return ok(summary);
  },
);
