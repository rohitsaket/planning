-- Reverses 20260926150000_sarin_validation_attempts.
--
-- Drops validation attempts and row interpretations, the issue ordinal and the mapping-set
-- editor columns, and restores the previous guard functions (including their local-time
-- stamping). The one-time UTC correction of existing timestamps is not undone. Destroys
-- validation history: run only as a deliberate rollback before real Sarin validation
-- exists. Atomic.

BEGIN;

DROP TABLE IF EXISTS "SarinRowInterpretation";
DROP TABLE IF EXISTS "SarinValidationAttempt";
DROP FUNCTION IF EXISTS "sarin_row_interpretation_insert_guard"();
DROP FUNCTION IF EXISTS "sarin_validation_attempt_guard"();

CREATE OR REPLACE FUNCTION "sarin_validation_issue_guard"() RETURNS trigger AS $$
DECLARE
  batch_attempt INTEGER;
  batch_set TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' OR NEW."resolvedAt" IS NOT NULL OR NEW."resolvedByUserId" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin validation issue is raised OPEN'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Lineage: the issue records exactly the attempt and mapping set that raised it.
    SELECT "validationAttempt", "shapeMappingSetId" INTO batch_attempt, batch_set
      FROM "SarinImportBatch" WHERE "id" = NEW."batchId" FOR SHARE;
    IF NEW."validationAttempt" <> batch_attempt OR NEW."shapeMappingSetId" IS DISTINCT FROM batch_set THEN
      RAISE EXCEPTION 'A Sarin validation issue must carry its batch''s current attempt and mapping set'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."batchId" <> OLD."batchId"
     OR NEW."stoneBlockId" IS DISTINCT FROM OLD."stoneBlockId" OR NEW."sourceRowId" IS DISTINCT FROM OLD."sourceRowId"
     OR NEW."validationAttempt" <> OLD."validationAttempt"
     OR NEW."shapeMappingSetId" IS DISTINCT FROM OLD."shapeMappingSetId"
     OR NEW."code" <> OLD."code" OR NEW."severity" <> OLD."severity" OR NEW."blocking" <> OLD."blocking"
     OR NEW."fieldPosition" IS DISTINCT FROM OLD."fieldPosition" OR NEW."fieldName" IS DISTINCT FROM OLD."fieldName"
     OR NEW."parametersJson" IS DISTINCT FROM OLD."parametersJson" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A Sarin validation issue is immutable apart from its status'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."resolvedAt" IS DISTINCT FROM OLD."resolvedAt"
       OR NEW."resolvedByUserId" IS DISTINCT FROM OLD."resolvedByUserId" THEN
      RAISE EXCEPTION 'Resolution fields change only with the status'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT ((OLD."status" = 'OPEN'       AND NEW."status" IN ('OVERRIDDEN', 'RESOLVED', 'SUPERSEDED'))
       OR (OLD."status" = 'OVERRIDDEN' AND NEW."status" IN ('OPEN', 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'Sarin validation issue cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;

  -- The status must agree with the append-only override history.
  IF NEW."status" = 'OVERRIDDEN' AND NOT "sarin_issue_has_effective_override"(NEW."id") THEN
    RAISE EXCEPTION 'A Sarin validation issue is OVERRIDDEN only while it has an effective override'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'OVERRIDDEN' AND NEW."status" = 'OPEN' AND "sarin_issue_has_effective_override"(NEW."id") THEN
    RAISE EXCEPTION 'A Sarin validation issue reopens only after its override is revoked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" = 'OPEN' THEN
    NEW."resolvedAt" := NULL;
    NEW."resolvedByUserId" := NULL;
  ELSE
    NEW."resolvedAt" := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP INDEX IF EXISTS "SarinValidationIssue_attempt_ordinal_key";
ALTER TABLE "SarinValidationIssue" DROP CONSTRAINT IF EXISTS "SarinValidationIssue_ordinal_check";
ALTER TABLE "SarinValidationIssue" DROP COLUMN IF EXISTS "ordinal";

CREATE OR REPLACE FUNCTION "sarin_shape_mapping_set_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."approvedAt" IS NOT NULL OR NEW."contentHash" IS NOT NULL
       OR NEW."retiredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin shape mapping set is created as an unapproved DRAFT'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."sourceSystem" <> OLD."sourceSystem" OR NEW."version" <> OLD."version"
     OR NEW."origin" <> OLD."origin" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'The identity of a Sarin shape mapping set is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
       NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
       OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt") THEN
    RAISE EXCEPTION 'An approved or retired Sarin shape mapping set is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" <> OLD."status" THEN
    IF NOT ((OLD."status" = 'DRAFT' AND NEW."status" IN ('APPROVED', 'RETIRED'))
            OR (OLD."status" = 'APPROVED' AND NEW."status" = 'RETIRED')) THEN
      RAISE EXCEPTION 'Sarin shape mapping set cannot move from % to %', OLD."status", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."status" = 'APPROVED' THEN
      IF NEW."approvedByUserId" IS NULL THEN
        RAISE EXCEPTION 'Approving a Sarin shape mapping set requires the approver'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "mappingSetId" = NEW."id") THEN
        RAISE EXCEPTION 'An empty Sarin shape mapping set cannot be approved'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Server-derived: the hash describes the rules actually stored, and the time is the
      -- database's, so neither can be supplied by a caller.
      NEW."contentHash" := "sarin_shape_mapping_set_content_hash"(NEW."id");
      NEW."approvedAt" := now();
    END IF;

    IF NEW."status" = 'RETIRED' THEN
      IF NEW."retiredByUserId" IS NULL THEN
        RAISE EXCEPTION 'Retiring a Sarin shape mapping set requires the actor'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW."retiredAt" := now();
    END IF;
  ELSIF NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt"
        OR NEW."retiredByUserId" IS DISTINCT FROM OLD."retiredByUserId" THEN
    RAISE EXCEPTION 'Retirement fields change only with the status'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
     OR NEW."planningDate" <> OLD."planningDate"
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

CREATE OR REPLACE FUNCTION "sarin_stone_block_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "sarin_assert_batch_accepts_structure"(NEW."batchId");
    PERFORM pg_advisory_xact_lock(hashtext('sarin-block:' || NEW."batchId"));
    -- Blocks are runs of consecutive rows; two blocks never claim the same row.
    IF EXISTS (
      SELECT 1 FROM "SarinStoneBlock" b
       WHERE b."batchId" = NEW."batchId"
         AND b."firstRowNumber" <= NEW."lastRowNumber"
         AND NEW."firstRowNumber" <= b."lastRowNumber"
    ) THEN
      RAISE EXCEPTION 'Sarin stone block rows % to % overlap another block', NEW."firstRowNumber", NEW."lastRowNumber"
        USING ERRCODE = 'exclusion_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."batchId" <> OLD."batchId" OR NEW."blockSequence" <> OLD."blockSequence"
     OR NEW."stoneNameRaw" <> OLD."stoneNameRaw" OR NEW."firstRowNumber" <> OLD."firstRowNumber"
     OR NEW."lastRowNumber" <> OLD."lastRowNumber" OR NEW."rowCount" <> OLD."rowCount"
     OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'The identity and row range of a Sarin stone block are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Parsing happens once. After it, the parsed identity is evidence and cannot be edited.
  IF OLD."parseStatus" <> 'PENDING' AND (
       NEW."parseStatus" <> OLD."parseStatus" OR NEW."parsedAt" IS DISTINCT FROM OLD."parsedAt"
       OR NEW."kapan" IS DISTINCT FROM OLD."kapan" OR NEW."packet" IS DISTINCT FROM OLD."packet"
       OR NEW."signer" IS DISTINCT FROM OLD."signer" OR NEW."roughWeight" IS DISTINCT FROM OLD."roughWeight") THEN
    RAISE EXCEPTION 'A parsed or quarantined Sarin stone block is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."parseStatus" = 'PENDING' AND NEW."parseStatus" <> 'PENDING' THEN
    NEW."parsedAt" := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinShapeMappingSet" DROP COLUMN IF EXISTS "lastModifiedAt";
ALTER TABLE "SarinShapeMappingSet" DROP COLUMN IF EXISTS "lastModifiedByUserId";

COMMIT;
