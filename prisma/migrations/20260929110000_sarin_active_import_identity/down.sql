-- Reverses 20260929110000_sarin_active_import_identity.
--
-- Restores the index over every status. Refuses while two imports share one identity
-- (an archived import and a later one made from the same file and details): the previous
-- index cannot hold both, and neither record may be removed. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SarinImportBatch"
     GROUP BY "sourceFileId", "stoneType", "contractVersion", "country", COALESCE("labScope", ''), "planningDate"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Rollback refused: an archived Sarin import shares its identity with a later import; both are history and must be kept';
  END IF;
END $$;

DROP INDEX "SarinImportBatch_duplicate_identity_key";
CREATE UNIQUE INDEX "SarinImportBatch_duplicate_identity_key"
  ON "SarinImportBatch" ("sourceFileId", "stoneType", "contractVersion", "country", (COALESCE("labScope", '')), "planningDate");

COMMIT;
