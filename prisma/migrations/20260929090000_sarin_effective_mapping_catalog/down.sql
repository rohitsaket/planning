-- Reverses 20260929090000_sarin_effective_mapping_catalog.
--
-- Refuses once the effective catalog has been used or changed: any saved snapshot,
-- replacement, rule provenance, or validation, batch, issue, interpretation or output
-- bound to an EFFECTIVE or SUPERSEDED set would lose meaning or history. Otherwise the
-- promoted baseline returns to DRAFT and archived drafts return to DRAFT. Grants of the
-- withdrawn approval permission are not recreated. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "status" IN ('EFFECTIVE', 'SUPERSEDED') AND "origin" <> 'MIGRATION_BASELINE')
     OR EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "status" = 'SUPERSEDED')
     OR EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "changedAt" IS NOT NULL OR "changedByUserId" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "SarinShapeMappingSet" s WHERE s."status" = 'EFFECTIVE' AND (
          EXISTS (SELECT 1 FROM "SarinValidationAttempt" a WHERE a."shapeMappingSetId" = s."id")
          OR EXISTS (SELECT 1 FROM "SarinImportBatch" b WHERE b."shapeMappingSetId" = s."id")
          OR EXISTS (SELECT 1 FROM "SarinOutputVersion" o WHERE o."shapeMappingSetId" = s."id")
          OR EXISTS (SELECT 1 FROM "SarinValidationIssue" i WHERE i."shapeMappingSetId" = s."id")
          OR EXISTS (SELECT 1 FROM "SarinRowInterpretation" x WHERE x."shapeMappingSetId" = s."id"))) THEN
    RAISE EXCEPTION 'The effective Sarin mapping catalog has been used or changed; reversing would lose mapping history';
  END IF;
END $$;

ALTER TABLE "SarinShapeMappingSet" DISABLE TRIGGER "sarin_shape_mapping_set_guard";
UPDATE "SarinShapeMappingSet" SET "status" = 'DRAFT', "effectiveAt" = NULL, "contentHash" = NULL WHERE "status" = 'EFFECTIVE';
UPDATE "SarinShapeMappingSet" SET "status" = 'DRAFT', "archivedAt" = NULL WHERE "status" = 'ARCHIVED';
ALTER TABLE "SarinShapeMappingSet" ENABLE TRIGGER "sarin_shape_mapping_set_guard";

DROP INDEX "SarinShapeMappingSet_one_effective_per_source";

ALTER TABLE "SarinShapeMappingRule" DROP CONSTRAINT "SarinShapeMappingRule_changed_consistent_check";

ALTER TABLE "SarinShapeMappingSet"
  DROP CONSTRAINT "SarinShapeMappingSet_status_check",
  DROP CONSTRAINT "SarinShapeMappingSet_approval_consistent_check",
  DROP CONSTRAINT "SarinShapeMappingSet_effective_consistent_check",
  DROP CONSTRAINT "SarinShapeMappingSet_superseded_consistent_check",
  DROP CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check",
  DROP CONSTRAINT "SarinShapeMappingSet_archived_consistent_check",
  ADD CONSTRAINT "SarinShapeMappingSet_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'RETIRED')),
  ADD CONSTRAINT "SarinShapeMappingSet_approval_consistent_check"
    CHECK (("approvedAt" IS NULL) = ("approvedByUserId" IS NULL) AND ("approvedAt" IS NULL) = ("contentHash" IS NULL)),
  ADD CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check" CHECK ("supersededBySetId" IS NULL OR "status" = 'RETIRED');

CREATE OR REPLACE FUNCTION "sarin_shape_mapping_set_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."approvedAt" IS NOT NULL OR NEW."contentHash" IS NOT NULL
       OR NEW."retiredAt" IS NOT NULL OR NEW."supersededBySetId" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin shape mapping set is created as an unapproved DRAFT'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" <> OLD."id" OR NEW."sourceSystem" <> OLD."sourceSystem" OR NEW."version" <> OLD."version"
     OR NEW."origin" <> OLD."origin" OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" <> OLD."createdAt" OR NEW."copiedFromSetId" IS DISTINCT FROM OLD."copiedFromSetId" THEN
    RAISE EXCEPTION 'The identity of a Sarin shape mapping set is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
       NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
       OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
       OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."lastModifiedByUserId" IS DISTINCT FROM OLD."lastModifiedByUserId"
       OR NEW."lastModifiedAt" IS DISTINCT FROM OLD."lastModifiedAt") THEN
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
      -- Separation of duties: whoever created the draft, or last changed it, cannot also be
      -- the one who approves it.
      IF NEW."approvedByUserId" = OLD."createdByUserId" OR NEW."approvedByUserId" = OLD."lastModifiedByUserId" THEN
        RAISE EXCEPTION 'The creator or last editor of a Sarin shape mapping set cannot approve it'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "mappingSetId" = NEW."id") THEN
        RAISE EXCEPTION 'An empty Sarin shape mapping set cannot be approved'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Server-derived: the hash describes the rules actually stored, and the time is the
      -- database's, so neither can be supplied by a caller.
      NEW."contentHash" := "sarin_shape_mapping_set_content_hash"(NEW."id");
      NEW."approvedAt" := (now() AT TIME ZONE 'UTC');
    END IF;

    IF NEW."status" = 'RETIRED' THEN
      IF NEW."retiredByUserId" IS NULL THEN
        RAISE EXCEPTION 'Retiring a Sarin shape mapping set requires the actor'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Superseded: only an approved set, only by an approved clone of itself.
      IF NEW."supersededBySetId" IS NOT NULL THEN
        IF OLD."status" <> 'APPROVED' OR NOT EXISTS (
             SELECT 1 FROM "SarinShapeMappingSet" s
              WHERE s."id" = NEW."supersededBySetId" AND s."status" = 'APPROVED' AND s."copiedFromSetId" = OLD."id") THEN
          RAISE EXCEPTION 'A Sarin shape mapping set is superseded only by an approved clone of itself'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      NEW."retiredAt" := (now() AT TIME ZONE 'UTC');
    END IF;
  ELSIF NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt"
        OR NEW."retiredByUserId" IS DISTINCT FROM OLD."retiredByUserId"
        OR NEW."supersededBySetId" IS DISTINCT FROM OLD."supersededBySetId" THEN
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
    NEW."statusChangedAt" := (now() AT TIME ZONE 'UTC');
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
    NEW."statusChangedAt" := (now() AT TIME ZONE 'UTC');
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
     OR NEW."claimFencingVersion" <> OLD."claimFencingVersion" OR NEW."startedAt" <> OLD."startedAt"
     OR NEW."validationProfileVersion" <> OLD."validationProfileVersion" THEN
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

CREATE OR REPLACE FUNCTION "sarin_output_version_guard"() RETURNS trigger AS $$
DECLARE
  b_status TEXT;
  b_attempt INTEGER;
  b_type TEXT;
  a_number INTEGER;
  a_status TEXT;
  a_result TEXT;
  a_set TEXT;
  a_profile TEXT;
  s_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'GENERATED' OR NEW."supersededAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin output version is created GENERATED'
        USING ERRCODE = 'check_violation';
    END IF;
    -- An output is evidence of exactly one completed, clean validation attempt: the batch's
    -- current one, with its mapping set still approved and the same validation profile.
    SELECT "status", "validationAttempt", "stoneType" INTO b_status, b_attempt, b_type
      FROM "SarinImportBatch" WHERE "id" = NEW."batchId" FOR SHARE;
    SELECT "attemptNumber", "status", "result", "shapeMappingSetId", "validationProfileVersion"
      INTO a_number, a_status, a_result, a_set, a_profile
      FROM "SarinValidationAttempt" WHERE "id" = NEW."validationAttemptId";
    SELECT "status" INTO s_status FROM "SarinShapeMappingSet" WHERE "id" = NEW."shapeMappingSetId" FOR SHARE;
    IF b_status IS DISTINCT FROM 'VALIDATED' OR a_number IS DISTINCT FROM b_attempt
       OR a_status IS DISTINCT FROM 'COMPLETED' OR a_result IS DISTINCT FROM 'VALIDATED'
       OR a_set IS DISTINCT FROM NEW."shapeMappingSetId" OR a_profile IS DISTINCT FROM NEW."validationProfileVersion"
       OR s_status IS DISTINCT FROM 'APPROVED' OR b_type IS DISTINCT FROM NEW."stoneType" THEN
      RAISE EXCEPTION 'A Sarin output version must derive from the batch''s current clean validation'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW."generatedAt" := (now() AT TIME ZONE 'UTC');
    RETURN NEW;
  END IF;

  -- Only the lifecycle moves, and only from GENERATED to SUPERSEDED.
  IF OLD."status" <> 'GENERATED' OR NEW."status" <> 'SUPERSEDED'
     OR NEW."id" <> OLD."id" OR NEW."batchId" <> OLD."batchId" OR NEW."validationAttemptId" <> OLD."validationAttemptId"
     OR NEW."shapeMappingSetId" <> OLD."shapeMappingSetId" OR NEW."validationProfileVersion" <> OLD."validationProfileVersion"
     OR NEW."transformProfileVersion" <> OLD."transformProfileVersion" OR NEW."transformProfileHash" <> OLD."transformProfileHash"
     OR NEW."versionNumber" <> OLD."versionNumber" OR NEW."inputsHash" <> OLD."inputsHash" OR NEW."stoneType" <> OLD."stoneType"
     OR NEW."generatedByUserId" <> OLD."generatedByUserId" OR NEW."generatedAt" <> OLD."generatedAt"
     OR NEW."supersedesVersionId" IS DISTINCT FROM OLD."supersedesVersionId"
     OR NEW."stoneCount" <> OLD."stoneCount" OR NEW."optionCount" <> OLD."optionCount" OR NEW."pieceCount" <> OLD."pieceCount" THEN
    RAISE EXCEPTION 'A Sarin output version is immutable; only GENERATED -> SUPERSEDED is permitted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  NEW."supersededAt" := (now() AT TIME ZONE 'UTC');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinShapeMappingRule" DROP COLUMN "changedAt", DROP COLUMN "changedByUserId";
ALTER TABLE "SarinShapeMappingSet" DROP COLUMN "effectiveAt", DROP COLUMN "supersededAt", DROP COLUMN "archivedAt";


COMMIT;
