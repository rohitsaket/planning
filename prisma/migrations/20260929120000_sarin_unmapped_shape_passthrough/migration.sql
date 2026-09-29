-- Sarin output: an unmapped shape is written as its raw Sarin text (additive, reversible).
--
-- Design v1.7 §15.10: when a present Sarin shape has no confirmed mapping, the output keeps
-- the original shape and a warning is recorded. A plan piece therefore records how its
-- shape was resolved:
--   MAPPED           the canonical Fantasy shape of a rule in the version's mapping set
--                    (normalizedShape and mappingRuleId set, as before);
--   RAW_PASSTHROUGH  no rule exists for the shape in that set: normalizedShape and
--                    mappingRuleId stay NULL and the output shows rawShape. A raw value is
--                    never stored as a canonical shape.
-- The insert guard admits a pass-through only when the check that produced the version
-- recorded the row as UNMAPPED under the same shape key and the set has no rule for it,
-- and never for Pink. Existing pieces are all MAPPED; nothing is rewritten.
--
-- Reversal: down.sql (refuses while any pass-through piece exists).

ALTER TABLE "SarinPlanPiece" ADD COLUMN "shapeResolution" TEXT NOT NULL DEFAULT 'MAPPED';
ALTER TABLE "SarinPlanPiece" ALTER COLUMN "normalizedShape" DROP NOT NULL;
ALTER TABLE "SarinPlanPiece" ALTER COLUMN "mappingRuleId" DROP NOT NULL;

ALTER TABLE "SarinPlanPiece"
  DROP CONSTRAINT "SarinPlanPiece_values_check",
  ADD CONSTRAINT "SarinPlanPiece_values_check"
    CHECK ("estimatedWeight" >= 0 AND char_length("clarity") > 0 AND char_length("color") > 0
           AND "depthPct" >= 0 AND "ratio" >= 0 AND "length" >= 0 AND "width" >= 0 AND "depthMm" >= 0
           AND char_length("rawShape") > 0),
  ADD CONSTRAINT "SarinPlanPiece_shape_resolution_check"
    CHECK (("shapeResolution" = 'MAPPED' AND "normalizedShape" IS NOT NULL AND char_length("normalizedShape") > 0 AND "mappingRuleId" IS NOT NULL)
        OR ("shapeResolution" = 'RAW_PASSTHROUGH' AND "normalizedShape" IS NULL AND "mappingRuleId" IS NULL AND char_length(btrim("rawShape")) > 0));

-- Counting a version's pass-through rows (its warning state) reads only those rows.
CREATE INDEX "SarinPlanPiece_passthrough_idx" ON "SarinPlanPiece" ("outputVersionId") WHERE "shapeResolution" = 'RAW_PASSTHROUGH';

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
  v_type TEXT;
  v_attempt TEXT;
  i_result TEXT;
  i_key TEXT;
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
  IF NEW."shapeResolution" = 'MAPPED' THEN
    SELECT "mappingSetId", "normalizedShape" INTO rule_set, rule_shape FROM "SarinShapeMappingRule" WHERE "id" = NEW."mappingRuleId";
    IF rule_set IS DISTINCT FROM v_set OR rule_shape IS DISTINCT FROM NEW."normalizedShape" THEN
      RAISE EXCEPTION 'A Sarin plan piece shape must come from its version''s mapping set'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- A raw pass-through is allowed only where the check that produced this version found
    -- no rule at all for the shape in the version's mapping set, and never for Pink, whose
    -- positional contract needs confirmed shapes.
    SELECT v."stoneType", v."validationAttemptId" INTO v_type, v_attempt FROM "SarinOutputVersion" v WHERE v."id" = NEW."outputVersionId";
    SELECT i."mappingResult", i."rawShapeKey" INTO i_result, i_key
      FROM "SarinRowInterpretation" i
     WHERE i."attemptId" = v_attempt AND i."sourceRowNumber" = NEW."sourceRowNumber";
    IF v_type = 'PINK' OR i_result IS DISTINCT FROM 'UNMAPPED' OR i_key IS NULL
       OR i_key IS DISTINCT FROM upper(btrim(NEW."rawShape"))
       OR EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "mappingSetId" = v_set AND "rawShapeKey" = i_key) THEN
      RAISE EXCEPTION 'A Sarin plan piece may keep its raw shape only when its mapping set has no rule for it'
        USING ERRCODE = 'check_violation';
    END IF;
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
