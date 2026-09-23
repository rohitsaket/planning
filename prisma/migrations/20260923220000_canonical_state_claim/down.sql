-- Reverses 20260923220000_canonical_state_claim.
--
-- Dropping the claim table restores the defect it fixes: synchronization and demand
-- coordinate through nothing, and a demand run can again read canonical rows a sync is
-- committing. Dropping the column loses which sync run each demand run was bound to;
-- the run itself and all of its metrics are untouched.
DROP INDEX IF EXISTS "DemandRun_sourceSyncRunId_idx";
ALTER TABLE "DemandRun" DROP COLUMN IF EXISTS "sourceSyncRunId";
DROP TABLE IF EXISTS "CanonicalStateClaim";
