-- Sarin imports no longer carry a country: the business confirmed that country plays no
-- part in preparing Sarin output. The upload has no country field; lab scope still
-- narrows who may see and act on an import.
--
--   1. The country each existing import was declared with is written to the audit log
--      (SARIN_IMPORT_COUNTRY_RETIRED, one row per import), so the history is kept and
--      down.sql can restore it. Audit rows are immutable.
--   2. The active-import duplicate identity is rebuilt without country. The migration
--      refuses, changing nothing, if two active imports would then collide.
--   3. The import guard no longer compares a country, then the column, its CHECK and its
--      index are dropped.
--
-- No other value changes. Atomic; reversed by down.sql.

DO $$
DECLARE
  now_utc TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
  def TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SarinImportBatch"
    WHERE "status" <> 'ARCHIVED'
    GROUP BY "sourceFileId", "packetType", "contractVersion", COALESCE("labScope", ''), "planningDate"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration refused: active Sarin imports of the same file, packet type, lab and planning date differ only by country. Archive the extra imports first.';
  END IF;

  INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "after", "reason", "outcome", "timestamp")
  SELECT 'sarin_country_retired_' || md5(b."id"), 'system', 'SARIN_IMPORT_COUNTRY_RETIRED', 'SarinImportBatch', b."id",
         json_build_object('country', b."country")::text,
         'Sarin imports no longer carry a country; the country declared at upload is kept here', 'SUCCESS', now_utc
  FROM "SarinImportBatch" b
  -- A reapply after down.sql finds the record it restored from: audit rows are never replaced.
  ON CONFLICT ("id") DO NOTHING;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = current_schema() AND p.proname = 'sarin_import_batch_guard';
  IF def IS NULL OR position('OR NEW."country" <> OLD."country" ' IN def) = 0 THEN
    RAISE EXCEPTION 'Unexpected definition of sarin_import_batch_guard: it does not compare the country';
  END IF;
  EXECUTE replace(def, 'OR NEW."country" <> OLD."country" ', '');
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname LIKE 'sarin_%' AND p.prosrc LIKE '%"country"%'
  ) THEN
    RAISE EXCEPTION 'A Sarin function still names the country column';
  END IF;
END $$;

DROP INDEX "SarinImportBatch_duplicate_identity_key";
CREATE UNIQUE INDEX "SarinImportBatch_duplicate_identity_key"
  ON "SarinImportBatch" ("sourceFileId", "packetType", "contractVersion", (COALESCE("labScope", '')), "planningDate")
  WHERE "status" <> 'ARCHIVED';

DROP INDEX "SarinImportBatch_country_status_createdAt_idx";
ALTER TABLE "SarinImportBatch" DROP CONSTRAINT "SarinImportBatch_country_check";
ALTER TABLE "SarinImportBatch" DROP COLUMN "country";
