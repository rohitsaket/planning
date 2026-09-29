-- Blue, White and Pink are packet types: the colour of the packet a stone is kept in. All
-- stones are white diamonds. The columns that hold that classification are renamed from
-- "stoneType" to "packetType" in place:
--
--   SarinImportBatch, SarinOutputVersion  BLUE | WHITE | PINK
--   RoughStone, PlanningCase              WHITE | BLUE
--
-- No value is rewritten. RENAME COLUMN keeps every stored value, default, NOT NULL, CHECK,
-- index (including the active-import duplicate identity) and foreign key; the constraints
-- named after the column are renamed to match. The Sarin guard functions name the column
-- in their source, which PostgreSQL does not follow, so each is redefined from its current
-- definition with the column reference (and its one message) updated, and the migration
-- fails if any function still names the old column. Atomic; reversed by down.sql.

ALTER TABLE "SarinImportBatch" RENAME COLUMN "stoneType" TO "packetType";
ALTER TABLE "SarinOutputVersion" RENAME COLUMN "stoneType" TO "packetType";
ALTER TABLE "RoughStone" RENAME COLUMN "stoneType" TO "packetType";
ALTER TABLE "PlanningCase" RENAME COLUMN "stoneType" TO "packetType";

ALTER TABLE "SarinImportBatch" RENAME CONSTRAINT "SarinImportBatch_stoneType_check" TO "SarinImportBatch_packetType_check";
ALTER TABLE "SarinOutputVersion" RENAME CONSTRAINT "SarinOutputVersion_stoneType_check" TO "SarinOutputVersion_packetType_check";

DO $$
DECLARE
  r RECORD;
  def TEXT;
  fn TEXT;
BEGIN
  -- PostgreSQL 18 names NOT NULL constraints after their column; earlier versions do not.
  FOR r IN
    SELECT c.relname AS tbl, con.conname
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname IN ('SarinImportBatch', 'SarinOutputVersion', 'RoughStone', 'PlanningCase')
      AND con.conname = c.relname || '_stoneType_not_null'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.conname, r.tbl || '_packetType_not_null');
  END LOOP;

  FOREACH fn IN ARRAY ARRAY['sarin_import_batch_guard', 'sarin_output_version_guard', 'sarin_plan_option_insert_guard', 'sarin_plan_piece_insert_guard']
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.proname = fn;
    IF def IS NULL OR position('"stoneType"' IN def) = 0 THEN
      RAISE EXCEPTION 'Unexpected definition of %: it does not name the stoneType column', fn;
    END IF;
    EXECUTE replace(replace(def, '"stoneType"', '"packetType"'), 's stone type', 's packet type');
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = current_schema() AND p.prosrc LIKE '%"stoneType"%'
  ) THEN
    RAISE EXCEPTION 'A function still names the stoneType column';
  END IF;
END $$;
