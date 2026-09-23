-- Reverses 20260923180000_fantasy_projection_attempts.
--
-- Restoring the global unique fingerprint re-introduces the defect this migration fixed:
-- a crashed, failed or aborted run permanently blocks its own work. It will also FAIL if
-- more than one attempt exists for any fingerprint, which is correct — rolling back must
-- not silently discard attempt history.

ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_abort_note_length_check";
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_abort_attribution_check";
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_owner_token_check";
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_terminal_timestamp_check";
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_attemptNumber_check";
ALTER TABLE "FantasyProjectionRun" DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_status_check";

DROP INDEX IF EXISTS "FantasyProjectionRun_requestedByUserId_startedAt_idx";
DROP INDEX IF EXISTS "FantasyProjectionRun_requestedByUserId_status_idx";
DROP INDEX IF EXISTS "FantasyProjectionRun_status_heartbeatAt_idx";
DROP INDEX IF EXISTS "FantasyProjectionRun_fingerprint_status_idx";
DROP INDEX IF EXISTS "FantasyProjectionRun_one_completed_per_fingerprint";
DROP INDEX IF EXISTS "FantasyProjectionRun_one_running_per_fingerprint";
DROP INDEX IF EXISTS "FantasyProjectionRun_fingerprint_attemptNumber_key";

CREATE UNIQUE INDEX "FantasyProjectionRun_fingerprint_key" ON "FantasyProjectionRun"("fingerprint");

ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "terminalReasonCode";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "abortReasonNote";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "abortReasonCode";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "abortedByUserId";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "abortedAt";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "heartbeatAt";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "ownerTokenHash";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "version";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "previousAttemptId";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "attemptNumber";
