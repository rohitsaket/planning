-- Reverses 20260923170000_fantasy_projection_hardening.
--
-- Restores the weaker guarantees this migration added, so run it only as part of a
-- deliberate rollback to the 20260923160000 schema. Afterwards projection candidates are
-- no longer database-immutable, raw evidence is no longer protected by RESTRICT, and two
-- overlapping identical projection requests can once again create two runs.

DROP TRIGGER IF EXISTS "fantasy_projection_candidate_immutable" ON "FantasyProjectionCandidate";
DROP FUNCTION IF EXISTS "fantasy_projection_candidate_is_insert_only"();

ALTER TABLE "FantasyProjectionCandidate" DROP CONSTRAINT IF EXISTS "FantasyProjectionCandidate_sourceRowId_fkey";
ALTER TABLE "FantasyProjectionCandidate" DROP CONSTRAINT IF EXISTS "FantasyProjectionCandidate_runId_fkey";
ALTER TABLE "FantasyProjectionRun"       DROP CONSTRAINT IF EXISTS "FantasyProjectionRun_sourceBatchId_fkey";

ALTER TABLE "FantasyProjectionCandidate"
  ADD CONSTRAINT "FantasyProjectionCandidate_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "FantasyProjectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "FantasyProjectionRun_fingerprint_key";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "fingerprint";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "rowsSkippedUndecodable";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "rowsSkippedNotNormalized";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "rowsSkippedRejected";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "rowsSkippedQuarantined";
ALTER TABLE "FantasyProjectionRun" DROP COLUMN IF EXISTS "rowsEligible";

ALTER TABLE "FantasyRawBatch" DROP COLUMN IF EXISTS "providerIdAtIngestion";
ALTER TABLE "FantasyRawBatch" DROP COLUMN IF EXISTS "effectiveSourceStateAtIngestion";
