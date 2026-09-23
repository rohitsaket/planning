-- Reverses 20260922180000_fantasy_raw_ingestion.
--
-- Both tables hold raw staging data only; nothing else references them, so dropping
-- them cannot affect canonical operational, planning or history records. Dropping
-- them does discard stored raw evidence, so it is deliberate and explicit.

ALTER TABLE "FantasyRawRow" DROP CONSTRAINT IF EXISTS "FantasyRawRow_batchId_fkey";

DROP TABLE IF EXISTS "FantasyRawRow";
DROP TABLE IF EXISTS "FantasyRawBatch";
