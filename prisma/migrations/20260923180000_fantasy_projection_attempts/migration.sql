-- Fantasy shadow projection: recoverable attempts.
--
-- Forward-only. Applied migrations are left untouched.
--
-- THE DEFECT THIS FIXES. `fingerprint` was globally unique, so exactly one run could
-- ever exist for a given piece of work. A worker that died mid-run, a run that failed,
-- and a run an operator aborted all left that fingerprint permanently claimed. The only
-- way to run the work again was to alter one of its inputs so it hashed differently —
-- which is not a retry, it is a lie about what the operation is.
--
-- The fingerprint now stays the LOGICAL IDENTITY of the requested projection, and
-- attempts at it are numbered and append-only. A retry is attempt N+1; earlier attempts
-- and every candidate they wrote remain as immutable operational evidence.

-- ---------------------------------------------------------------------------
-- 1. Attempt columns
-- ---------------------------------------------------------------------------
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "attemptNumber"      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "previousAttemptId"  TEXT;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "version"            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "ownerTokenHash"     TEXT;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "heartbeatAt"        TIMESTAMP(3);
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "abortedAt"          TIMESTAMP(3);
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "abortedByUserId"    TEXT;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "abortReasonCode"    TEXT;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "abortReasonNote"    TEXT;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "terminalReasonCode" TEXT;

-- Existing rows become attempt 1 of their own fingerprint. The DEFAULT above already
-- does this; nothing is rewritten and no run loses its counts, diagnostics or candidates.

-- ---------------------------------------------------------------------------
-- 2. Uniqueness: one row per attempt, one RUNNING, one COMPLETED
-- ---------------------------------------------------------------------------
-- The global fingerprint key is what made recovery impossible. It goes.
DROP INDEX IF EXISTS "FantasyProjectionRun_fingerprint_key";

CREATE UNIQUE INDEX IF NOT EXISTS "FantasyProjectionRun_fingerprint_attemptNumber_key"
  ON "FantasyProjectionRun"("fingerprint", "attemptNumber");

-- Partial unique indexes carry the rules that actually matter. Prisma cannot express
-- these, so they live here and a test asserts the database enforces them.
--
-- At most one RUNNING attempt per fingerprint: two workers can never both believe they
-- own the same logical projection, regardless of application logic.
CREATE UNIQUE INDEX IF NOT EXISTS "FantasyProjectionRun_one_running_per_fingerprint"
  ON "FantasyProjectionRun"("fingerprint") WHERE "status" = 'RUNNING';

-- At most one COMPLETED attempt per fingerprint: the answer to a given piece of work is
-- singular, so an idempotent replay can never be ambiguous about which run it replays.
CREATE UNIQUE INDEX IF NOT EXISTS "FantasyProjectionRun_one_completed_per_fingerprint"
  ON "FantasyProjectionRun"("fingerprint") WHERE "status" = 'COMPLETED';

CREATE INDEX IF NOT EXISTS "FantasyProjectionRun_fingerprint_status_idx"        ON "FantasyProjectionRun"("fingerprint", "status");
CREATE INDEX IF NOT EXISTS "FantasyProjectionRun_status_heartbeatAt_idx"        ON "FantasyProjectionRun"("status", "heartbeatAt");
CREATE INDEX IF NOT EXISTS "FantasyProjectionRun_requestedByUserId_status_idx"  ON "FantasyProjectionRun"("requestedByUserId", "status");
CREATE INDEX IF NOT EXISTS "FantasyProjectionRun_requestedByUserId_startedAt_idx" ON "FantasyProjectionRun"("requestedByUserId", "startedAt");

-- ---------------------------------------------------------------------------
-- 3. State invariants
-- ---------------------------------------------------------------------------
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_status_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_status_check"
  CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'));

ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_attemptNumber_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_attemptNumber_check"
  CHECK ("attemptNumber" >= 1);

-- A terminal attempt must say when it ended. Backfilled from createdAt only for rows
-- that predate this migration and are already terminal without a timestamp; a newer row
-- can never reach a terminal state without one, because the service always sets it.
UPDATE "FantasyProjectionRun"
   SET "completedAt" = "createdAt"
 WHERE "status" IN ('COMPLETED', 'FAILED') AND "completedAt" IS NULL;

UPDATE "FantasyProjectionRun"
   SET "abortedAt" = COALESCE("completedAt", "createdAt")
 WHERE "status" = 'ABORTED' AND "abortedAt" IS NULL;

ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_terminal_timestamp_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_terminal_timestamp_check"
  CHECK (
    ("status" = 'RUNNING')
    OR ("status" IN ('COMPLETED', 'FAILED') AND "completedAt" IS NOT NULL)
    OR ("status" = 'ABORTED' AND "abortedAt" IS NOT NULL)
  );

-- Ownership belongs to a live attempt only. Clearing the hash is what takes the run away
-- from its worker on abort, so a terminal attempt holding one would mean the worker
-- could still believe it owns finished work.
UPDATE "FantasyProjectionRun" SET "ownerTokenHash" = NULL WHERE "status" <> 'RUNNING';

ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_owner_token_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_owner_token_check"
  CHECK ("status" = 'RUNNING' OR "ownerTokenHash" IS NULL);

-- An abort must record who and why. Enforced here so an abort can never be recorded as
-- an anonymous state change.
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_abort_attribution_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_abort_attribution_check"
  CHECK ("status" <> 'ABORTED' OR ("abortReasonCode" IS NOT NULL AND "abortedAt" IS NOT NULL));

-- Bounded operator note. The API validates length too; this is the backstop that holds
-- for a direct write.
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_abort_note_length_check";
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_abort_note_length_check"
  CHECK ("abortReasonNote" IS NULL OR char_length("abortReasonNote") <= 500);
