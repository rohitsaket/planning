-- Reverses 20260930090000_packet_type_terminology: renames "packetType" back to
-- "stoneType" in place, with its constraints, and redefines the Sarin guard functions to
-- name the old column again. No value is rewritten, so it is always safe. Atomic.

BEGIN;

ALTER TABLE "SarinImportBatch" RENAME COLUMN "packetType" TO "stoneType";
ALTER TABLE "SarinOutputVersion" RENAME COLUMN "packetType" TO "stoneType";
ALTER TABLE "RoughStone" RENAME COLUMN "packetType" TO "stoneType";
ALTER TABLE "PlanningCase" RENAME COLUMN "packetType" TO "stoneType";

ALTER TABLE "SarinImportBatch" RENAME CONSTRAINT "SarinImportBatch_packetType_check" TO "SarinImportBatch_stoneType_check";
ALTER TABLE "SarinOutputVersion" RENAME CONSTRAINT "SarinOutputVersion_packetType_check" TO "SarinOutputVersion_stoneType_check";

DO $$
DECLARE
  r RECORD;
  def TEXT;
  fn TEXT;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN ('SarinImportBatch', 'SarinOutputVersion', 'RoughStone', 'PlanningCase')
      AND con.conname = c.relname || '_packetType_not_null'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, r.tbl || '_stoneType_not_null');
  END LOOP;

  FOREACH fn IN ARRAY ARRAY['sarin_import_batch_guard', 'sarin_output_version_guard', 'sarin_plan_option_insert_guard', 'sarin_plan_piece_insert_guard']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = fn;
    IF def IS NULL OR position('"packetType"' IN def) = 0 THEN
      RAISE EXCEPTION 'Unexpected definition of %: it does not name the packetType column', fn;
    END IF;
    EXECUTE replace(replace(def, '"packetType"', '"stoneType"'), 's packet type', 's stone type');
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.prosrc LIKE '%"packetType"%'
  ) THEN
    RAISE EXCEPTION 'A function still names the packetType column';
  END IF;
END $$;

COMMIT;
