-- Quantity provenance, recorded rather than inferred.
--
-- `quantity` on these tables is Decimal DEFAULT 1, so a stored 1 cannot be distinguished
-- from a value the source never supplied. Every consumer that summed those columns was
-- therefore counting an unknown as a confirmed piece. These columns record what was
-- actually established, and leave the existing `quantity` column untouched so no history
-- is rewritten.
--
-- Additive only: three nullable columns, no constraint change, no data loss.
ALTER TABLE "LotMasterRecord"     ADD COLUMN IF NOT EXISTS "quantityProvenance" TEXT;
ALTER TABLE "LotMasterRecord"     ADD COLUMN IF NOT EXISTS "confirmedPieces"    INTEGER;
ALTER TABLE "LotHistoryRecord"    ADD COLUMN IF NOT EXISTS "quantityProvenance" TEXT;
ALTER TABLE "LotHistoryRecord"    ADD COLUMN IF NOT EXISTS "confirmedPieces"    INTEGER;
ALTER TABLE "DemandMetricTraceItem" ADD COLUMN IF NOT EXISTS "quantityProvenance" TEXT;

-- Backfill, deliberately narrow.
--
-- Only rows provably produced by the approved fixture contract are marked confirmed: it
-- emits a quantity on every record, so for those rows a stored value was supplied rather
-- than defaulted. The fixture contract models one stone per row, so a value other than a
-- positive whole number did not come from it and is not backfilled.
--
-- Everything else — live, unknown or legacy — is left NULL on purpose. NULL reads as
-- LEGACY_DEFAULT_AMBIGUOUS, which is the truth: nobody recorded where the number came
-- from. Backfilling those as confirmed would launder the exact ambiguity this migration
-- exists to remove.
UPDATE "LotMasterRecord"
   SET "quantityProvenance" = 'EXPLICIT_FIXTURE',
       "confirmedPieces"    = "quantity"::int
 WHERE "quantityProvenance" IS NULL
   AND "sourceType"  = 'FIXTURE'
   AND "isSimulated" = TRUE
   AND "quantity" > 0
   AND "quantity" = TRUNC("quantity");

UPDATE "LotHistoryRecord"
   SET "quantityProvenance" = 'EXPLICIT_FIXTURE',
       "confirmedPieces"    = "quantity"::int
 WHERE "quantityProvenance" IS NULL
   AND "isSimulated" = TRUE
   AND "quantity" > 0
   AND "quantity" = TRUNC("quantity");

-- Filtering "which records cannot be counted" is an operator and data-quality query on
-- both tables; without this it is a sequential scan of all canonical stock.
CREATE INDEX IF NOT EXISTS "LotMasterRecord_quantityProvenance_idx"
  ON "LotMasterRecord" ("quantityProvenance");
