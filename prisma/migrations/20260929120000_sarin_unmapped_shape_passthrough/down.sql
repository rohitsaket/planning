-- Reverses 20260929120000_sarin_unmapped_shape_passthrough.
--
-- Refuses while any output piece keeps a raw pass-through shape: those outputs are
-- immutable history and the previous schema cannot hold them. Otherwise restores the
-- previous constraints and insert guard and drops the column. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SarinPlanPiece" WHERE "shapeResolution" <> 'MAPPED') THEN
    RAISE EXCEPTION 'Rollback refused: stored Sarin outputs keep raw pass-through shapes; they are history and must be kept';
  END IF;
END $$;

DROP INDEX "SarinPlanPiece_passthrough_idx";
ALTER TABLE "SarinPlanPiece"
  DROP CONSTRAINT "SarinPlanPiece_shape_resolution_check",
  DROP CONSTRAINT "SarinPlanPiece_values_check",
  ADD CONSTRAINT "SarinPlanPiece_values_check"
    CHECK ("estimatedWeight" >= 0 AND char_length("clarity") > 0 AND char_length("color") > 0
           AND "depthPct" >= 0 AND "ratio" >= 0 AND "length" >= 0 AND "width" >= 0 AND "depthMm" >= 0
           AND char_length("rawShape") > 0 AND char_length("normalizedShape") > 0);

CREATE OR REPLACE FUNCTION "sarin_plan_piece_insert_guard"() RETURNS trigger AS $$
DECLARE
  r RECORD;
  o_block TEXT;
  k_first INTEGER;
  k_last INTEGER;
  v_set TEXT;
  rule_set TEXT;
  rule_shape TEXT;
  o_kind TEXT;
  o_difference NUMERIC;
  twin_weight NUMERIC;
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
  -- The second twin completes a Best Twin: the recorded difference must be exactly theirs.
  SELECT "optionKind", "pairWeightDifference" INTO o_kind, o_difference FROM "SarinPlanOption" WHERE "id" = NEW."planOptionId";
  IF o_kind = 'BT' AND NEW."pieceSequence" = 2 THEN
    SELECT "estimatedWeight" INTO twin_weight FROM "SarinPlanPiece" WHERE "planOptionId" = NEW."planOptionId" AND "pieceSequence" = 1;
    IF twin_weight IS NULL OR abs(twin_weight - NEW."estimatedWeight") <> o_difference THEN
      RAISE EXCEPTION 'A Sarin Best Twin must record the exact weight difference of its pieces'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinPlanPiece" ALTER COLUMN "mappingRuleId" SET NOT NULL;
ALTER TABLE "SarinPlanPiece" ALTER COLUMN "normalizedShape" SET NOT NULL;
ALTER TABLE "SarinPlanPiece" DROP COLUMN "shapeResolution";

COMMIT;
