/**
 * PROJECTION ATTEMPT OWNERSHIP, RECOVERY AND WORKLOAD LIMITS.
 *
 * A projection is a long piece of work performed by one worker over many pages. Three
 * things must be true for that to be safe across multiple application instances:
 *
 *   1. Exactly one worker owns a running attempt, and it can prove it before every
 *      write. Proof is a random token the worker holds and the database stores only as
 *      a hash — so taking ownership away is simply clearing the hash.
 *   2. A worker that has lost ownership cannot write another page and cannot finalize.
 *      Both are conditional updates evaluated by the database, not by the worker.
 *   3. Expensive work is capped by the database rather than by a process-local rate
 *      limiter, which caps nothing when a second instance is running.
 *
 * Recovery is explicit. Nothing here aborts a run on a timer: an invented staleness
 * threshold would kill healthy long-running projections, so the heartbeat is reported
 * and a human decides.
 *
 * Server-only.
 */

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

if (typeof window !== "undefined") {
  throw new Error("fantasy/projection-recovery is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Owner tokens
// ---------------------------------------------------------------------------

/**
 * A worker's claim token and the hash the database stores.
 *
 * The token never leaves the worker's memory: it is not persisted, returned from an API,
 * written to an audit record or included in a log line or error. Only the hash is stored,
 * so reading the database confers no ability to impersonate the owner.
 */
export interface OwnerToken {
  readonly token: string;
  readonly hash: string;
}

export function issueOwnerToken(): OwnerToken {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashOwnerToken(token) };
}

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Allowlisted abort reasons. An operator picks one; free text goes in a bounded note. */
export const ABORT_REASON_CODES = [
  "OPERATOR_REQUESTED",
  "SUSPECTED_STALLED_WORKER",
  "SUPERSEDED_BY_CORRECTED_SOURCE",
  "RESOURCE_PRESSURE",
] as const;
export type AbortReasonCode = (typeof ABORT_REASON_CODES)[number];

export function isAbortReasonCode(value: unknown): value is AbortReasonCode {
  return typeof value === "string" && (ABORT_REASON_CODES as readonly string[]).includes(value);
}

/** How an attempt ended, for the diagnostics list. Fixed codes only. */
export const TERMINAL_REASON_CODES = [
  "COMPLETED_NORMALLY",
  "EXECUTION_ERROR",
  "OWNERSHIP_LOST",
  "COUNT_MISMATCH",
  "ABORTED_BY_OPERATOR",
] as const;
export type TerminalReasonCode = (typeof TERMINAL_REASON_CODES)[number];

export const ABORT_NOTE_MAX_LENGTH = 500;

export class ProjectionRecoveryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectionRecoveryError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Ownership-guarded writes
// ---------------------------------------------------------------------------

type TxClient = Prisma.TransactionClient;

/**
 * Asserts the caller still owns this attempt, inside the caller's transaction.
 *
 * Conditional on all of run id, status RUNNING, owner-token hash and the expected
 * version. Every condition is evaluated by the database in one statement, so there is no
 * window between "checked" and "wrote" for an abort to slip through.
 *
 * Returns the new version. Bumping the version on each page is deliberate: it makes an
 * ownership change observable even if a token were somehow reused.
 */
async function assertOwnership(
  tx: TxClient,
  runId: string,
  ownerTokenHash: string,
  expectedVersion: number,
): Promise<number> {
  const updated = await tx.fantasyProjectionRun.updateMany({
    where: { id: runId, status: "RUNNING", ownerTokenHash, version: expectedVersion },
    data: { version: expectedVersion + 1, heartbeatAt: new Date() },
  });
  if (updated.count !== 1) {
    // Either the attempt is no longer RUNNING, the token no longer matches (an abort
    // cleared it), or another writer moved the version. The worker must stop.
    throw new ProjectionRecoveryError(
      "PROJECTION_OWNERSHIP_LOST",
      "This projection attempt is no longer owned by this worker.",
    );
  }
  return expectedVersion + 1;
}

/**
 * Writes one page of candidates only if ownership still holds, as a single transaction.
 *
 * The ownership check and the insert share one transaction, so a page cannot land after
 * an abort has taken ownership away: the abort either commits first and the check fails,
 * or it waits and observes the page. There is no interleaving that produces both.
 */
export async function writeCandidatePageOwned(
  runId: string,
  ownerTokenHash: string,
  expectedVersion: number,
  candidates: Prisma.FantasyProjectionCandidateCreateManyInput[],
): Promise<{ version: number; written: number }> {
  return db.$transaction(async (tx) => {
    const version = await assertOwnership(tx, runId, ownerTokenHash, expectedVersion);
    if (candidates.length === 0) return { version, written: 0 };
    // No skipDuplicates: within one claimed attempt a duplicate means a defect.
    const result = await tx.fantasyProjectionCandidate.createMany({ data: candidates });
    return { version, written: result.count };
  });
}

/** Advances the heartbeat for a page that wrote nothing, under the same ownership proof. */
export async function touchHeartbeatOwned(
  runId: string,
  ownerTokenHash: string,
  expectedVersion: number,
): Promise<number> {
  return db.$transaction((tx) => assertOwnership(tx, runId, ownerTokenHash, expectedVersion));
}

export interface FinalizeInput {
  readonly runId: string;
  readonly ownerTokenHash: string;
  readonly expectedVersion: number;
  readonly status: "COMPLETED" | "FAILED";
  readonly terminalReasonCode: TerminalReasonCode;
  readonly counters: Prisma.FantasyProjectionRunUpdateInput;
}

/**
 * Moves an attempt to its terminal state, only if the caller still owns it.
 *
 * The owner-token hash is cleared in the same statement, which is what the database's
 * `status <> 'RUNNING' → ownerTokenHash IS NULL` invariant requires, and what stops a
 * worker from finalizing an attempt twice.
 *
 * Returns false when ownership was lost — an old worker must not be able to complete or
 * overwrite an attempt that was aborted or reassigned.
 */
export async function finalizeOwnedAttempt(input: FinalizeInput): Promise<boolean> {
  const result = await db.fantasyProjectionRun.updateMany({
    where: {
      id: input.runId,
      status: "RUNNING",
      ownerTokenHash: input.ownerTokenHash,
      version: input.expectedVersion,
    },
    data: {
      ...(input.counters as Prisma.FantasyProjectionRunUpdateManyMutationInput),
      status: input.status,
      terminalReasonCode: input.terminalReasonCode,
      ownerTokenHash: null,
      completedAt: new Date(),
      version: input.expectedVersion + 1,
    },
  });
  return result.count === 1;
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export interface AbortInput {
  readonly runId: string;
  readonly expectedVersion: number;
  readonly actorUserId: string;
  readonly reasonCode: AbortReasonCode;
  readonly note: string | null;
}

export interface AbortResult {
  readonly runId: string;
  readonly attemptNumber: number;
  readonly status: "ABORTED";
  readonly abortedAt: Date;
  readonly abortReasonCode: AbortReasonCode;
  readonly version: number;
}

/**
 * Aborts one RUNNING attempt, atomically.
 *
 * Only RUNNING → ABORTED. A completed, failed or already-aborted attempt is refused
 * rather than re-aborted, so the recorded actor and reason always describe the change
 * that actually happened.
 *
 * `writeAudit` runs inside the same transaction as the status change. If the audit write
 * fails, the abort rolls back — an executed administrative recovery must never become
 * invisible, and a recorded one must never be fictional.
 */
export async function abortProjectionAttempt(
  input: AbortInput,
  writeAudit: (tx: TxClient, result: AbortResult) => Promise<void>,
): Promise<AbortResult> {
  if (!isAbortReasonCode(input.reasonCode)) {
    throw new ProjectionRecoveryError("ABORT_REASON_INVALID", "That abort reason is not recognized.");
  }
  if (input.note !== null && input.note.length > ABORT_NOTE_MAX_LENGTH) {
    throw new ProjectionRecoveryError("ABORT_NOTE_TOO_LONG", "The abort note is too long.");
  }

  return db.$transaction(async (tx) => {
    const existing = await tx.fantasyProjectionRun.findUnique({
      where: { id: input.runId },
      select: { id: true, status: true, version: true, attemptNumber: true },
    });
    if (!existing) {
      throw new ProjectionRecoveryError("RUN_NOT_FOUND", "The projection attempt does not exist.");
    }
    if (existing.status !== "RUNNING") {
      throw new ProjectionRecoveryError(
        "RUN_NOT_RUNNING",
        "Only a running projection attempt can be aborted.",
      );
    }
    if (existing.version !== input.expectedVersion) {
      // The attempt moved since the operator read it. Refusing rather than aborting
      // blind means the operator is never acting on a stale picture.
      throw new ProjectionRecoveryError(
        "VERSION_CONFLICT",
        "This projection attempt changed. Reload and try again.",
      );
    }

    const abortedAt = new Date();
    const updated = await tx.fantasyProjectionRun.updateMany({
      where: { id: input.runId, status: "RUNNING", version: input.expectedVersion },
      data: {
        status: "ABORTED",
        // Clearing the hash is the act that takes the run away from its worker.
        ownerTokenHash: null,
        abortedAt,
        abortedByUserId: input.actorUserId,
        abortReasonCode: input.reasonCode,
        abortReasonNote: input.note,
        terminalReasonCode: "ABORTED_BY_OPERATOR",
        version: input.expectedVersion + 1,
      },
    });
    if (updated.count !== 1) {
      throw new ProjectionRecoveryError(
        "VERSION_CONFLICT",
        "This projection attempt changed. Reload and try again.",
      );
    }

    const result: AbortResult = {
      runId: input.runId,
      attemptNumber: existing.attemptNumber,
      status: "ABORTED",
      abortedAt,
      abortReasonCode: input.reasonCode,
      version: input.expectedVersion + 1,
    };

    // Same transaction: the state change and its audit record commit together or not
    // at all.
    await writeAudit(tx, result);

    return result;
  });
}

// ---------------------------------------------------------------------------
// Workload limits
// ---------------------------------------------------------------------------

/**
 * Limits on expensive projection execution.
 *
 * These are decided against the database, so every application instance enforces the
 * same numbers. The request-level rate limiter stays as defense in depth but is
 * process-local and therefore is NOT the multi-instance control.
 */
export interface ProjectionWorkloadLimits {
  readonly maxActiveGlobal: number;
  readonly maxActivePerActor: number;
  readonly maxStartsPerActorPerWindow: number;
  readonly windowMs: number;
  /** True when a configured value was unusable and the safe default was used instead. */
  readonly usedFallback: boolean;
}

export const DEFAULT_PROJECTION_WORKLOAD_LIMITS = {
  maxActiveGlobal: 2,
  maxActivePerActor: 1,
  maxStartsPerActorPerWindow: 10,
  windowMs: 60 * 60 * 1000,
} as const;

function positiveIntOr(raw: string | undefined, fallback: number, max: number): { value: number; ok: boolean } {
  if (raw === undefined || raw.trim() === "") return { value: fallback, ok: true };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    // An invalid configured limit must not silently become "unlimited". The safe default
    // applies and the fallback is reported.
    return { value: fallback, ok: false };
  }
  return { value: parsed, ok: true };
}

/** Reads limits from any environment-shaped map, so tests can supply one directly. */
export type LimitEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveProjectionWorkloadLimits(
  env: LimitEnvironment = process.env,
): ProjectionWorkloadLimits {
  const global = positiveIntOr(env.FANTASY_PROJECTION_MAX_ACTIVE, DEFAULT_PROJECTION_WORKLOAD_LIMITS.maxActiveGlobal, 50);
  const perActor = positiveIntOr(
    env.FANTASY_PROJECTION_MAX_ACTIVE_PER_ACTOR,
    DEFAULT_PROJECTION_WORKLOAD_LIMITS.maxActivePerActor,
    10,
  );
  const starts = positiveIntOr(
    env.FANTASY_PROJECTION_MAX_STARTS_PER_WINDOW,
    DEFAULT_PROJECTION_WORKLOAD_LIMITS.maxStartsPerActorPerWindow,
    1000,
  );
  const window = positiveIntOr(
    env.FANTASY_PROJECTION_WINDOW_MS,
    DEFAULT_PROJECTION_WORKLOAD_LIMITS.windowMs,
    24 * 60 * 60 * 1000,
  );

  return {
    maxActiveGlobal: global.value,
    maxActivePerActor: perActor.value,
    maxStartsPerActorPerWindow: starts.value,
    windowMs: window.value,
    usedFallback: !global.ok || !perActor.ok || !starts.ok || !window.ok,
  };
}

/**
 * Checks the database-coordinated limits inside the caller's claim transaction.
 *
 * Called under the same advisory lock that serializes the claim, so two instances
 * deciding simultaneously cannot both observe spare capacity.
 *
 * An idempotent replay never reaches this: replaying a completed attempt performs no
 * expensive work and must not consume a slot.
 */
export async function assertWorkloadCapacity(
  tx: TxClient,
  actorUserId: string | null,
  limits: ProjectionWorkloadLimits,
  now: Date = new Date(),
): Promise<void> {
  const activeGlobal = await tx.fantasyProjectionRun.count({ where: { status: "RUNNING" } });
  if (activeGlobal >= limits.maxActiveGlobal) {
    throw new ProjectionRecoveryError(
      "PROJECTION_GLOBAL_CAPACITY_REACHED",
      "The maximum number of concurrent projections is already running. Try again later.",
    );
  }

  // An anonymous actor cannot be limited per actor, so it is held to the global cap
  // only. Server-initiated runs are the only callers without a user.
  if (actorUserId === null) return;

  const activeForActor = await tx.fantasyProjectionRun.count({
    where: { status: "RUNNING", requestedByUserId: actorUserId },
  });
  if (activeForActor >= limits.maxActivePerActor) {
    throw new ProjectionRecoveryError(
      "PROJECTION_ACTOR_BUSY",
      "You already have a projection running. Wait for it to finish.",
    );
  }

  const startsInWindow = await tx.fantasyProjectionRun.count({
    where: {
      requestedByUserId: actorUserId,
      startedAt: { gte: new Date(now.getTime() - limits.windowMs) },
    },
  });
  if (startsInWindow >= limits.maxStartsPerActorPerWindow) {
    throw new ProjectionRecoveryError(
      "PROJECTION_ACTOR_START_LIMIT_REACHED",
      "You have started too many projections recently. Try again later.",
    );
  }
}
