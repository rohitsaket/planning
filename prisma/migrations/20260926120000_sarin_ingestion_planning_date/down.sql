-- Reverses 20260926120000_sarin_ingestion_planning_date.
--
-- Drops the planning date and the row evidence columns, and restores the Phase 2 duplicate
-- identity and batch guard. Destroys uploaded import metadata: run only as a deliberate
-- rollback before real Sarin imports exist.
--
-- Atomic: one transaction. It refuses, changing nothing, while any two batches differ only
-- by planning date, because the Phase 2 identity cannot hold both of them.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SarinImportBatch"
     GROUP BY "sourceFileId", "stoneType", "contractVersion", "country", COALESCE("labScope", '')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot reverse the Sarin ingestion migration: some imports differ only by planning date. Nothing was changed.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "sarin_import_batch_guard"() RETURNS trigger AS $$
DECLARE
  entering_validation BOOLEAN;
  set_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A batch starts as an honest UPLOADED record. It cannot be born validated, claimed,
    -- archived or bound to a mapping set.
    IF NEW."status" <> 'UPLOADED' OR NEW."validationAttempt" <> 0 OR NEW."fencingVersion" <> 0
       OR NEW."claimToken" IS NOT NULL OR NEW."shapeMappingSetId" IS NOT NULL
       OR NEW."transformProfileVersion" IS NOT NULL OR NEW."archivedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin import batch is created in status UPLOADED with no claim, attempt or mapping set'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW."statusChangedAt" := now();
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."sourceFileId" <> OLD."sourceFileId" OR NEW."stoneType" <> OLD."stoneType"
     OR NEW."country" <> OLD."country" OR NEW."labScope" IS DISTINCT FROM OLD."labScope"
     OR NEW."contractVersion" <> OLD."contractVersion" OR NEW."uploadedByUserId" <> OLD."uploadedByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'The identity and scope of a Sarin import batch are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" <> OLD."status" THEN
    IF NOT (
         (OLD."status" = 'UPLOADED'     AND NEW."status" IN ('VALIDATING', 'FAILED', 'ARCHIVED'))
      OR (OLD."status" = 'VALIDATING'   AND NEW."status" IN ('NEEDS_REVIEW', 'VALIDATED', 'FAILED'))
      OR (OLD."status" = 'NEEDS_REVIEW' AND NEW."status" IN ('VALIDATING', 'ARCHIVED'))
      OR (OLD."status" = 'VALIDATED'    AND NEW."status" IN ('VALIDATING', 'ARCHIVED'))
      OR (OLD."status" = 'FAILED'       AND NEW."status" IN ('VALIDATING', 'ARCHIVED'))
    ) THEN
      RAISE EXCEPTION 'Sarin import batch cannot move from % to %', OLD."status", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
    NEW."statusChangedAt" := now();
  ELSIF NEW."statusChangedAt" <> OLD."statusChangedAt" THEN
    RAISE EXCEPTION 'statusChangedAt changes only with the status'
      USING ERRCODE = 'restrict_violation';
  END IF;

  entering_validation := NEW."status" = 'VALIDATING' AND OLD."status" <> 'VALIDATING';

  -- Each validation attempt is numbered, so issues can say which attempt raised them.
  IF entering_validation THEN
    IF NEW."validationAttempt" <> OLD."validationAttempt" + 1 THEN
      RAISE EXCEPTION 'Entering VALIDATING must increment validationAttempt by exactly one'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."validationAttempt" <> OLD."validationAttempt" THEN
    RAISE EXCEPTION 'validationAttempt changes only on entry into VALIDATING'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The rules an attempt runs under are fixed for that attempt.
  IF NOT entering_validation AND (
       NEW."shapeMappingSetId" IS DISTINCT FROM OLD."shapeMappingSetId"
       OR NEW."transformProfileVersion" IS DISTINCT FROM OLD."transformProfileVersion") THEN
    RAISE EXCEPTION 'The mapping set and transform profile change only on entry into VALIDATING'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF entering_validation AND NEW."shapeMappingSetId" IS NOT NULL THEN
    SELECT "status" INTO set_status FROM "SarinShapeMappingSet" WHERE "id" = NEW."shapeMappingSetId" FOR SHARE;
    IF set_status IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'A Sarin import batch can only be validated against an APPROVED mapping set'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Fencing: a displaced worker can never finalize after its claim was replaced.
  IF NEW."fencingVersion" < OLD."fencingVersion" THEN
    RAISE EXCEPTION 'fencingVersion is monotonic'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."claimToken" IS NOT NULL AND NEW."claimToken" IS DISTINCT FROM OLD."claimToken"
     AND NEW."fencingVersion" <= OLD."fencingVersion" THEN
    RAISE EXCEPTION 'A new claim token must advance fencingVersion'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinSourceRow" DROP CONSTRAINT IF EXISTS "SarinSourceRow_fields_present_check";
ALTER TABLE "SarinSourceRow" DROP CONSTRAINT IF EXISTS "SarinSourceRow_rejection_reason_consistent_check";
ALTER TABLE "SarinSourceRow" DROP CONSTRAINT IF EXISTS "SarinSourceRow_rejectionCodes_format_check";
ALTER TABLE "SarinSourceRow" DROP CONSTRAINT IF EXISTS "SarinSourceRow_rawFieldsJson_check";

DROP INDEX IF EXISTS "SarinImportBatch_duplicate_identity_key";
CREATE UNIQUE INDEX "SarinImportBatch_duplicate_identity_key"
  ON "SarinImportBatch" ("sourceFileId", "stoneType", "contractVersion", "country", (COALESCE("labScope", '')));

ALTER TABLE "SarinSourceRow" DROP COLUMN IF EXISTS "rejectionCodes";
ALTER TABLE "SarinSourceRow" DROP COLUMN IF EXISTS "rawFieldsJson";
ALTER TABLE "SarinImportBatch" DROP COLUMN IF EXISTS "planningDate";

COMMIT;
