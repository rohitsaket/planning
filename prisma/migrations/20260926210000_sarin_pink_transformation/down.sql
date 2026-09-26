-- Reverses 20260926210000_sarin_pink_transformation.
--
-- Refuses while any Pink option exists: Blue/White constraints cannot hold Pink history,
-- and output history is never deleted to make a rollback pass. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SarinPlanOption" WHERE "optionKind" IN ('MK', 'SL', 'BP', 'BT')) THEN
    RAISE EXCEPTION 'Pink output versions exist; this migration cannot be reversed without losing output history';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "sarin_plan_option_insert_guard"() RETURNS trigger AS $$
DECLARE
  k_status TEXT;
  k_rough NUMERIC;
BEGIN
  PERFORM "sarin_assert_version_being_generated"(NEW."outputVersionId");
  SELECT "parseStatus", "roughWeight" INTO k_status, k_rough FROM "SarinStoneBlock" WHERE "id" = NEW."stoneBlockId";
  IF k_status IS DISTINCT FROM 'PARSED' OR k_rough IS NULL OR k_rough <> NEW."yieldDenominator" THEN
    RAISE EXCEPTION 'A Sarin plan option belongs to a parsed stone and uses its Rough Weight'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "sarin_plan_piece_insert_guard"() RETURNS trigger AS $$
DECLARE
  r RECORD;
  o_block TEXT;
  k_first INTEGER;
  k_last INTEGER;
  v_set TEXT;
  rule_set TEXT;
  rule_shape TEXT;
BEGIN
  PERFORM "sarin_assert_version_being_generated"(NEW."outputVersionId");
  -- A piece is its source row, placed: every copied value must be that row's value.
  SELECT "sourceRowNumber", "outcome", "shapeRaw", "estimatedWeight", "clarity", "color",
         "depthPct", "ratio", "length", "width", "depthMm"
    INTO r FROM "SarinSourceRow" WHERE "id" = NEW."sourceRowId";
  IF r."outcome" IS DISTINCT FROM 'ACCEPTED' OR r."sourceRowNumber" <> NEW."sourceRowNumber"
     OR r."shapeRaw" IS DISTINCT FROM NEW."rawShape" OR r."estimatedWeight" IS DISTINCT FROM NEW."estimatedWeight"
     OR r."clarity" IS DISTINCT FROM NEW."clarity" OR r."color" IS DISTINCT FROM NEW."color"
     OR r."depthPct" IS DISTINCT FROM NEW."depthPct" OR r."ratio" IS DISTINCT FROM NEW."ratio"
     OR r."length" IS DISTINCT FROM NEW."length" OR r."width" IS DISTINCT FROM NEW."width"
     OR r."depthMm" IS DISTINCT FROM NEW."depthMm" THEN
    RAISE EXCEPTION 'A Sarin plan piece must reproduce its accepted source row exactly'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The row lies inside the option's stone, and the shape comes from the version's set.
  SELECT o."stoneBlockId", k."firstRowNumber", k."lastRowNumber", v."shapeMappingSetId"
    INTO o_block, k_first, k_last, v_set
    FROM "SarinPlanOption" o
    JOIN "SarinStoneBlock" k ON k."id" = o."stoneBlockId"
    JOIN "SarinOutputVersion" v ON v."id" = o."outputVersionId"
   WHERE o."id" = NEW."planOptionId";
  IF NEW."sourceRowNumber" < k_first OR NEW."sourceRowNumber" > k_last THEN
    RAISE EXCEPTION 'A Sarin plan piece must come from its option''s stone'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT "mappingSetId", "normalizedShape" INTO rule_set, rule_shape FROM "SarinShapeMappingRule" WHERE "id" = NEW."mappingRuleId";
  IF rule_set IS DISTINCT FROM v_set OR rule_shape IS DISTINCT FROM NEW."normalizedShape" THEN
    RAISE EXCEPTION 'A Sarin plan piece shape must come from its version''s mapping set'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinOutputVersion" DROP CONSTRAINT "SarinOutputVersion_pink_counts_check";

ALTER TABLE "SarinPlanOption"
  DROP CONSTRAINT "SarinPlanOption_pairWeightDifference_check",
  DROP CONSTRAINT "SarinPlanOption_pink_sequence_check",
  DROP CONSTRAINT "SarinPlanOption_ordinal_check",
  DROP CONSTRAINT "SarinPlanOption_optionKind_check",
  ADD CONSTRAINT "SarinPlanOption_optionKind_check" CHECK ("optionKind" IN ('MAIN', 'ADDITIONAL')),
  ADD CONSTRAINT "SarinPlanOption_ordinal_check"
    CHECK (("optionKind" = 'MAIN' AND "mainOrdinal" > 0 AND "additionalGroupOrdinal" IS NULL AND "pieceCount" = 1)
        OR ("optionKind" = 'ADDITIONAL' AND "additionalGroupOrdinal" > 0 AND "mainOrdinal" IS NULL AND "pieceCount" >= 1));

ALTER TABLE "SarinPlanOption" DROP COLUMN "pairWeightDifference";

COMMIT;
