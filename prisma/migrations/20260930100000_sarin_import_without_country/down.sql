-- Reverses 20260930100000_sarin_import_without_country.
--
-- Restores each import's country from its SARIN_IMPORT_COUNTRY_RETIRED audit row, then
-- the column's NOT NULL, CHECK, index, duplicate identity and guard comparison. Refuses,
-- changing nothing, once an import exists that was created without a country: there is
-- no recorded country to give it. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SarinImportBatch" b
    WHERE NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'SARIN_IMPORT_COUNTRY_RETIRED' AND a."entityId" = b."id")
  ) THEN
    RAISE EXCEPTION 'Rollback refused: Sarin imports exist that were created without a country; none can be restored for them';
  END IF;
END $$;

ALTER TABLE "SarinImportBatch" ADD COLUMN "country" TEXT;
UPDATE "SarinImportBatch" b
SET "country" = (a."after"::json ->> 'country')
FROM "AuditLog" a
WHERE a."action" = 'SARIN_IMPORT_COUNTRY_RETIRED' AND a."entityId" = b."id";

ALTER TABLE "SarinImportBatch" ALTER COLUMN "country" SET NOT NULL;
ALTER TABLE "SarinImportBatch"
  ADD CONSTRAINT "SarinImportBatch_country_check"
    CHECK ("country" = btrim("country") AND char_length("country") BETWEEN 1 AND 64);
CREATE INDEX "SarinImportBatch_country_status_createdAt_idx" ON "SarinImportBatch"("country", "status", "createdAt");

DROP INDEX "SarinImportBatch_duplicate_identity_key";
CREATE UNIQUE INDEX "SarinImportBatch_duplicate_identity_key"
  ON "SarinImportBatch" ("sourceFileId", "packetType", "contractVersion", "country", (COALESCE("labScope", '')), "planningDate")
  WHERE "status" <> 'ARCHIVED';

DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'sarin_import_batch_guard';
  IF def IS NULL OR position('OR NEW."labScope" IS DISTINCT FROM OLD."labScope"' IN def) = 0 THEN
    RAISE EXCEPTION 'Unexpected definition of sarin_import_batch_guard';
  END IF;
  EXECUTE replace(def, 'OR NEW."labScope" IS DISTINCT FROM OLD."labScope"', 'OR NEW."country" <> OLD."country" OR NEW."labScope" IS DISTINCT FROM OLD."labScope"');
END $$;

COMMIT;
