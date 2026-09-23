-- Fantasy shadow projection hardening.
--
-- Forward-only. The already-applied 20260923160000 migration is left untouched.
--
-- Four things change, all of them about making a guarantee real rather than merely
-- intended:
--
--   1. Raw batches record the source provenance they were ingested under, so projection
--      can bind to what was true then instead of to what is configured now.
--   2. Projection runs carry a unique fingerprint, so the DATABASE decides the race
--      between two overlapping requests for identical work.
--   3. Projection lineage becomes real foreign keys with RESTRICT, so raw evidence
--      cannot be deleted out from under a projection and a run cannot cascade away the
--      candidates that justify it.
--   4. Projection candidates become insert-only AT THE DATABASE, not merely by the
--      absence of update calls in application code.
--
-- Nothing is dropped or retyped, and no canonical record table is touched.

-- ---------------------------------------------------------------------------
-- 1. Ingestion provenance
-- ---------------------------------------------------------------------------
-- Nullable on purpose. A batch ingested before this existed has no provenance, and a
-- null must NOT be read as "assume fixture" — projection refuses such a batch with
-- SOURCE_PROVENANCE_NOT_CONFIGURED. Backfilling a guess is exactly the invented meaning
-- this work exists to remove.
ALTER TABLE "FantasyRawBatch" ADD COLUMN IF NOT EXISTS "effectiveSourceStateAtIngestion" TEXT;
ALTER TABLE "FantasyRawBatch" ADD COLUMN IF NOT EXISTS "providerIdAtIngestion"           TEXT;

-- ---------------------------------------------------------------------------
-- 2. Run counters and the idempotency fingerprint
-- ---------------------------------------------------------------------------
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "rowsEligible"             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "rowsSkippedQuarantined"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "rowsSkippedRejected"      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "rowsSkippedNotNormalized" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "rowsSkippedUndecodable"   INTEGER NOT NULL DEFAULT 0;

-- Added nullable, backfilled, then constrained: a NOT NULL UNIQUE column cannot be added
-- to a table that already has rows in one statement.
ALTER TABLE "FantasyProjectionRun" ADD COLUMN IF NOT EXISTS "fingerprint" TEXT;

-- Runs that predate fingerprinting get a unique value derived from their own id. It is
-- deliberately not a real fingerprint: a legacy run must never satisfy an idempotent
-- replay for work whose inputs it cannot be shown to match.
UPDATE "FantasyProjectionRun" SET "fingerprint" = 'LEGACY_UNFINGERPRINTED:' || "id" WHERE "fingerprint" IS NULL;

ALTER TABLE "FantasyProjectionRun" ALTER COLUMN "fingerprint" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "FantasyProjectionRun_fingerprint_key" ON "FantasyProjectionRun"("fingerprint");

-- ---------------------------------------------------------------------------
-- 3. Lineage: real foreign keys, RESTRICT on every edge
-- ---------------------------------------------------------------------------
-- The run's existing CASCADE to its candidates is replaced by RESTRICT. Deleting a run
-- that has candidates now fails rather than silently discarding the evidence.
ALTER TABLE "FantasyProjectionCandidate" DROP CONSTRAINT IF EXISTS "FantasyProjectionCandidate_runId_fkey";

ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_sourceBatchId_fkey"
  FOREIGN KEY ("sourceBatchId") REFERENCES "FantasyRawBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyProjectionCandidate"
  ADD CONSTRAINT "FantasyProjectionCandidate_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "FantasyProjectionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FantasyProjectionCandidate"
  ADD CONSTRAINT "FantasyProjectionCandidate_sourceRowId_fkey"
  FOREIGN KEY ("sourceRowId") REFERENCES "FantasyRawRow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Candidate immutability, enforced by the database
-- ---------------------------------------------------------------------------
-- "No code calls update" is a property of today's code, not of the table. A trigger is
-- a property of the table: a direct psql session, a future ORM call and an ad-hoc script
-- all fail identically.
--
-- A trigger rather than a RULE, because `DO INSTEAD NOTHING` would silently discard the
-- write and report success — the opposite of what an integrity control should do.
CREATE OR REPLACE FUNCTION "fantasy_projection_candidate_is_insert_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FantasyProjectionCandidate is insert-only; % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "fantasy_projection_candidate_immutable" ON "FantasyProjectionCandidate";
CREATE TRIGGER "fantasy_projection_candidate_immutable"
  BEFORE UPDATE OR DELETE ON "FantasyProjectionCandidate"
  FOR EACH ROW EXECUTE FUNCTION "fantasy_projection_candidate_is_insert_only"();

-- The parent run must still be able to move RUNNING -> COMPLETED/FAILED/ABORTED, so no
-- equivalent trigger is placed on FantasyProjectionRun. Its immutable facts are instead
-- protected by the fingerprint's uniqueness and the mode CHECK constraint.
