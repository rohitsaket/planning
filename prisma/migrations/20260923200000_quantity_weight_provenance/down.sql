-- Reverses 20260923200000_quantity_weight_provenance.
--
-- Dropping these columns discards the record of which quantities were established and
-- which were assumed. The pipeline then falls back to inferring provenance from
-- `sourceType`/`isSimulated`, which is what it did before — so no calculation breaks,
-- but the distinction between a supplied 1 and a defaulted 1 is lost again.
DROP INDEX IF EXISTS "LotMasterRecord_quantityProvenance_idx";
ALTER TABLE "DemandMetricTraceItem" DROP COLUMN IF EXISTS "quantityProvenance";
ALTER TABLE "LotHistoryRecord"      DROP COLUMN IF EXISTS "confirmedPieces";
ALTER TABLE "LotHistoryRecord"      DROP COLUMN IF EXISTS "quantityProvenance";
ALTER TABLE "LotMasterRecord"       DROP COLUMN IF EXISTS "confirmedPieces";
ALTER TABLE "LotMasterRecord"       DROP COLUMN IF EXISTS "quantityProvenance";
