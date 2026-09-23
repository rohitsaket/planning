-- Reverses 20260923160000_fantasy_shadow_projection.
--
-- Safe: these tables hold diagnostic shadow output only. Nothing downstream reads them,
-- no canonical record references them, and no approval or audit history lives here.
-- Dropping them discards projection runs and their candidates, which are reproducible by
-- re-running projection against the same raw batch.

DROP TABLE IF EXISTS "FantasyProjectionCandidate";
DROP TABLE IF EXISTS "FantasyProjectionRun";

ALTER INDEX IF EXISTS "LotMasterRecord_classificationProfile_classificationProfile_idx" RENAME TO "LotMasterRecord_classificationProfile_version_idx";
ALTER INDEX IF EXISTS "FantasyRawBatch_sourceMode_contractVersion_providerBatchId__key" RENAME TO "FantasyRawBatch_sourceMode_contractVersion_providerBatchId_batc";
