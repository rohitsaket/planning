-- Reverses 20260926180000_sarin_output_versions.
--
-- Drops output versions, plan options and pieces and the validation-profile column, and
-- restores the previous attempt guard. Destroys generated output history: run only as a
-- deliberate rollback before real Sarin output exists. Atomic.

BEGIN;

DROP TABLE IF EXISTS "SarinPlanPiece";
DROP TABLE IF EXISTS "SarinPlanOption";
DROP TABLE IF EXISTS "SarinOutputVersion";
DROP FUNCTION IF EXISTS "sarin_plan_piece_insert_guard"();
DROP FUNCTION IF EXISTS "sarin_plan_option_insert_guard"();
DROP FUNCTION IF EXISTS "sarin_assert_version_being_generated"(TEXT);
DROP FUNCTION IF EXISTS "sarin_output_version_guard"();

CREATE OR REPLACE FUNCTION "sarin_validation_attempt_guard"() RETURNS trigger AS $$
DECLARE
  b_status TEXT;
  b_attempt INTEGER;
  b_set TEXT;
  b_fence INTEGER;
  s_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RUNNING' OR NEW."result" IS NOT NULL OR NEW."failureCode" IS NOT NULL OR NEW."finishedAt" IS NOT NULL
       OR NEW."blockCount" IS NOT NULL OR NEW."issueCount" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin validation attempt starts RUNNING with no result'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The attempt is exactly the one the batch's claim just started.
    SELECT "status", "validationAttempt", "shapeMappingSetId", "fencingVersion" INTO b_status, b_attempt, b_set, b_fence
      FROM "SarinImportBatch" WHERE "id" = NEW."batchId" FOR SHARE;
    IF b_status IS DISTINCT FROM 'VALIDATING' OR NEW."attemptNumber" <> b_attempt
       OR NEW."shapeMappingSetId" IS DISTINCT FROM b_set OR NEW."claimFencingVersion" <> b_fence THEN
      RAISE EXCEPTION 'A Sarin validation attempt must match the batch claim that started it'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT "status" INTO s_status FROM "SarinShapeMappingSet" WHERE "id" = NEW."shapeMappingSetId" FOR SHARE;
    IF s_status IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'A Sarin validation attempt can only use an APPROVED mapping set'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" <> 'RUNNING' THEN
    RAISE EXCEPTION 'A finished Sarin validation attempt is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."batchId" <> OLD."batchId" OR NEW."attemptNumber" <> OLD."attemptNumber"
     OR NEW."shapeMappingSetId" <> OLD."shapeMappingSetId" OR NEW."startedByUserId" <> OLD."startedByUserId"
     OR NEW."claimFencingVersion" <> OLD."claimFencingVersion" OR NEW."startedAt" <> OLD."startedAt" THEN
    RAISE EXCEPTION 'The identity of a Sarin validation attempt is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'RUNNING' THEN
    RAISE EXCEPTION 'A running Sarin validation attempt changes only by finishing'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW."finishedAt" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinValidationAttempt" DROP CONSTRAINT IF EXISTS "SarinValidationAttempt_validationProfileVersion_check";
ALTER TABLE "SarinValidationAttempt" DROP COLUMN IF EXISTS "validationProfileVersion";

COMMIT;
