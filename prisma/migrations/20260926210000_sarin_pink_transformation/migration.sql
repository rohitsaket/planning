-- Sarin Pink transformation (additive).
--
-- Pink output versions reuse SarinOutputVersion, SarinPlanOption and SarinPlanPiece. An
-- option's kind now also covers the four Pink plan codes, which the raw file never
-- carries: MK (Makeable), SL (Solace), BP (Best Pair) and BT (Best Twin), derived from the
-- records' physical positions. Blue/White kinds and every existing row keep their meaning.
-- A Best Twin records the exact Estimated Weight difference of its two pieces; no
-- tolerance is confirmed, so the difference is an advisory, never a rejection.
--
-- Reversal: down.sql (refuses while any Pink option exists).

-- AlterTable
ALTER TABLE "SarinPlanOption" ADD COLUMN     "pairWeightDifference" DECIMAL(12,3);

ALTER TABLE "SarinPlanOption"
  DROP CONSTRAINT "SarinPlanOption_optionKind_check",
  DROP CONSTRAINT "SarinPlanOption_ordinal_check",
  ADD CONSTRAINT "SarinPlanOption_optionKind_check" CHECK ("optionKind" IN ('MAIN', 'ADDITIONAL', 'MK', 'SL', 'BP', 'BT')),
  ADD CONSTRAINT "SarinPlanOption_ordinal_check"
    CHECK (("optionKind" = 'MAIN' AND "mainOrdinal" > 0 AND "additionalGroupOrdinal" IS NULL AND "pieceCount" = 1)
        OR ("optionKind" = 'ADDITIONAL' AND "additionalGroupOrdinal" > 0 AND "mainOrdinal" IS NULL AND "pieceCount" >= 1)
        OR ("optionKind" = 'MK' AND "mainOrdinal" IS NULL AND "additionalGroupOrdinal" IS NULL AND "pieceCount" = 1)
        OR ("optionKind" IN ('SL', 'BP', 'BT') AND "mainOrdinal" IS NULL AND "additionalGroupOrdinal" IS NULL AND "pieceCount" = 2)),
  -- A Pink stone has exactly 27 options.
  ADD CONSTRAINT "SarinPlanOption_pink_sequence_check"
    CHECK ("optionKind" NOT IN ('MK', 'SL', 'BP', 'BT') OR "optionSequence" BETWEEN 1 AND 27),
  ADD CONSTRAINT "SarinPlanOption_pairWeightDifference_check"
    CHECK ((("optionKind" = 'BT') = ("pairWeightDifference" IS NOT NULL)) AND ("pairWeightDifference" IS NULL OR "pairWeightDifference" >= 0));

-- Every Pink stone is exactly 27 options of 45 pieces.
ALTER TABLE "SarinOutputVersion"
  ADD CONSTRAINT "SarinOutputVersion_pink_counts_check"
    CHECK ("stoneType" <> 'PINK' OR ("optionCount" = 27 * "stoneCount" AND "pieceCount" = 45 * "stoneCount"));

CREATE OR REPLACE FUNCTION "sarin_plan_option_insert_guard"() RETURNS trigger AS $$
DECLARE
  k_status TEXT;
  k_rough NUMERIC;
  v_type TEXT;
BEGIN
  PERFORM "sarin_assert_version_being_generated"(NEW."outputVersionId");
  SELECT "parseStatus", "roughWeight" INTO k_status, k_rough FROM "SarinStoneBlock" WHERE "id" = NEW."stoneBlockId";
  IF k_status IS DISTINCT FROM 'PARSED' OR k_rough IS NULL OR k_rough <> NEW."yieldDenominator" THEN
    RAISE EXCEPTION 'A Sarin plan option belongs to a parsed stone and uses its Rough Weight'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Blue/White versions hold MAIN/ADDITIONAL options only; Pink versions MK/SL/BP/BT only.
  SELECT "stoneType" INTO v_type FROM "SarinOutputVersion" WHERE "id" = NEW."outputVersionId";
  IF (v_type = 'PINK') IS DISTINCT FROM (NEW."optionKind" IN ('MK', 'SL', 'BP', 'BT')) THEN
    RAISE EXCEPTION 'A Sarin plan option kind must belong to its version''s stone type'
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
