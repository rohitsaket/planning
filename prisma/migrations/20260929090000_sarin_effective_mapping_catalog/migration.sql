-- Sarin shape mappings: one effective catalog, changed by saving (additive).
--
-- Replaces the draft -> approval workflow for current operations. Every saved change
-- becomes a new immutable snapshot that is EFFECTIVE at once and replaces (SUPERSEDED) the
-- previous one in the same transaction; validation captures the EFFECTIVE snapshot and
-- keeps it as lineage. No approver is recorded, because nothing is approved.
--
-- History is preserved: DRAFT, APPROVED and RETIRED sets keep their records; their
-- approval and retirement fields become immutable. Nothing is deleted except grants of the
-- withdrawn approval permission.
--
-- Data:
--   * the confirmed baseline (all 32 rows of the SARIN SHAPE master, design v1.7 §15.10),
--     when still an unreferenced DRAFT whose rules pass the structural checks below and no
--     catalog is effective, becomes the initial EFFECTIVE catalog, with a system audit
--     event; a user-maintained effective catalog is never replaced;
--   * user DRAFT sets that nothing references are ARCHIVED (they were never usable);
--   * grants of sarin.mapping.approve are removed from roles.
--
-- Reversal: down.sql (refuses once any saved snapshot, replacement, rule provenance or
-- reference to the effective catalog exists).

-- AlterTable
ALTER TABLE "SarinShapeMappingSet" ADD COLUMN "effectiveAt" TIMESTAMP(3),
ADD COLUMN "supersededAt" TIMESTAMP(3),
ADD COLUMN "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SarinShapeMappingRule" ADD COLUMN "changedAt" TIMESTAMP(3),
ADD COLUMN "changedByUserId" TEXT;

ALTER TABLE "SarinShapeMappingSet"
  DROP CONSTRAINT "SarinShapeMappingSet_status_check",
  DROP CONSTRAINT "SarinShapeMappingSet_approval_consistent_check",
  DROP CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check",
  ADD CONSTRAINT "SarinShapeMappingSet_status_check"
    CHECK ("status" IN ('DRAFT', 'APPROVED', 'RETIRED', 'EFFECTIVE', 'SUPERSEDED', 'ARCHIVED')),
  -- An approval names its approver; a content hash exists exactly when the set was approved
  -- or became effective. An effective snapshot is never recorded as approved.
  ADD CONSTRAINT "SarinShapeMappingSet_approval_consistent_check"
    CHECK (("approvedAt" IS NULL) = ("approvedByUserId" IS NULL)
           AND ("contentHash" IS NULL) = ("approvedAt" IS NULL AND "effectiveAt" IS NULL)),
  ADD CONSTRAINT "SarinShapeMappingSet_effective_consistent_check"
    CHECK (("status" IN ('EFFECTIVE', 'SUPERSEDED')) = ("effectiveAt" IS NOT NULL)
           AND ("effectiveAt" IS NULL OR "approvedAt" IS NULL)),
  ADD CONSTRAINT "SarinShapeMappingSet_superseded_consistent_check"
    CHECK (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL)
           AND ("status" <> 'SUPERSEDED' OR "supersededBySetId" IS NOT NULL)),
  ADD CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check"
    CHECK ("supersededBySetId" IS NULL OR "status" IN ('RETIRED', 'SUPERSEDED')),
  ADD CONSTRAINT "SarinShapeMappingSet_archived_consistent_check"
    CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

ALTER TABLE "SarinShapeMappingRule"
  ADD CONSTRAINT "SarinShapeMappingRule_changed_consistent_check"
    CHECK ("changedByUserId" IS NULL OR "changedAt" IS NOT NULL);

-- At most one effective catalog per source system, whatever the concurrency.
CREATE UNIQUE INDEX "SarinShapeMappingSet_one_effective_per_source"
  ON "SarinShapeMappingSet" ("sourceSystem")
  WHERE "status" = 'EFFECTIVE';

CREATE OR REPLACE FUNCTION "sarin_shape_mapping_set_guard"() RETURNS trigger AS $$
DECLARE
  successor_version INTEGER;
  successor_source TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' OR NEW."approvedAt" IS NOT NULL OR NEW."approvedByUserId" IS NOT NULL OR NEW."contentHash" IS NOT NULL
       OR NEW."retiredAt" IS NOT NULL OR NEW."supersededBySetId" IS NOT NULL
       OR NEW."effectiveAt" IS NOT NULL OR NEW."supersededAt" IS NOT NULL OR NEW."archivedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin shape mapping set is created as a DRAFT'
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

  -- Approval and retirement belong to the former governance workflow: their records are
  -- history and never change again.
  IF NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
     OR NEW."retiredByUserId" IS DISTINCT FROM OLD."retiredByUserId" OR NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
    RAISE EXCEPTION 'Approval and retirement records of a Sarin shape mapping set are history and immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
       NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."lastModifiedByUserId" IS DISTINCT FROM OLD."lastModifiedByUserId"
       OR NEW."lastModifiedAt" IS DISTINCT FROM OLD."lastModifiedAt") THEN
    RAISE EXCEPTION 'Only a DRAFT Sarin shape mapping set can change'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."status" = OLD."status" THEN
    IF NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt"
       OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" OR NEW."supersededBySetId" IS DISTINCT FROM OLD."supersededBySetId"
       OR NEW."archivedAt" IS DISTINCT FROM OLD."archivedAt" THEN
      RAISE EXCEPTION 'Lifecycle fields of a Sarin shape mapping set change only with its status'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'EFFECTIVE' THEN
    -- Server-derived: the hash describes the rules actually stored and the time is the
    -- database's. Nobody is recorded as an approver: this catalog was saved, not approved.
    IF NEW."supersededAt" IS NOT NULL OR NEW."supersededBySetId" IS NOT NULL OR NEW."archivedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A Sarin shape mapping set becomes EFFECTIVE with no replacement or archive record'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW."contentHash" := "sarin_shape_mapping_set_content_hash"(NEW."id");
    NEW."effectiveAt" := (now() AT TIME ZONE 'UTC');
    RETURN NEW;
  END IF;

  IF OLD."status" = 'EFFECTIVE' AND NEW."status" = 'SUPERSEDED' THEN
    -- Replaced only by the newer snapshot saved from it.
    SELECT "version", "copiedFromSetId" INTO successor_version, successor_source
      FROM "SarinShapeMappingSet" WHERE "id" = NEW."supersededBySetId";
    IF NEW."supersededBySetId" IS NULL OR successor_version IS NULL OR successor_version <= OLD."version"
       OR successor_source IS DISTINCT FROM OLD."id" THEN
      RAISE EXCEPTION 'An effective Sarin shape mapping snapshot is replaced only by a newer snapshot saved from it'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR NEW."effectiveAt" IS DISTINCT FROM OLD."effectiveAt" OR NEW."archivedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'A replaced Sarin shape mapping snapshot keeps its content'
        USING ERRCODE = 'restrict_violation';
    END IF;
    NEW."supersededAt" := (now() AT TIME ZONE 'UTC');
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ARCHIVED' THEN
    IF NEW."contentHash" IS NOT NULL OR NEW."effectiveAt" IS NOT NULL OR NEW."supersededAt" IS NOT NULL OR NEW."supersededBySetId" IS NOT NULL THEN
      RAISE EXCEPTION 'An archived Sarin shape mapping draft carries no effective record'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW."archivedAt" := (now() AT TIME ZONE 'UTC');
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Sarin shape mapping set cannot move from % to %', OLD."status", NEW."status"
    USING ERRCODE = 'check_violation';
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
    IF set_status IS DISTINCT FROM 'EFFECTIVE' THEN
      RAISE EXCEPTION 'A Sarin import batch can only be validated against the EFFECTIVE mapping catalog'
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
    IF s_status IS DISTINCT FROM 'EFFECTIVE' THEN
      RAISE EXCEPTION 'A Sarin validation attempt can only use the EFFECTIVE mapping catalog'
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
    -- current one, with the mapping snapshot it captured and the same validation profile. A
    -- snapshot replaced since then still counts: the attempt ran entirely against it.
    SELECT "status", "validationAttempt", "stoneType" INTO b_status, b_attempt, b_type
      FROM "SarinImportBatch" WHERE "id" = NEW."batchId" FOR SHARE;
    SELECT "attemptNumber", "status", "result", "shapeMappingSetId", "validationProfileVersion"
      INTO a_number, a_status, a_result, a_set, a_profile
      FROM "SarinValidationAttempt" WHERE "id" = NEW."validationAttemptId";
    SELECT "status" INTO s_status FROM "SarinShapeMappingSet" WHERE "id" = NEW."shapeMappingSetId" FOR SHARE;
    IF b_status IS DISTINCT FROM 'VALIDATED' OR a_number IS DISTINCT FROM b_attempt
       OR a_status IS DISTINCT FROM 'COMPLETED' OR a_result IS DISTINCT FROM 'VALIDATED'
       OR a_set IS DISTINCT FROM NEW."shapeMappingSetId" OR a_profile IS DISTINCT FROM NEW."validationProfileVersion"
       OR s_status IS NULL OR s_status NOT IN ('APPROVED', 'EFFECTIVE', 'SUPERSEDED') OR b_type IS DISTINCT FROM NEW."stoneType" THEN
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

-- ---------------------------------------------------------------- data

-- The confirmed baseline becomes the initial effective catalog, only when it is still an
-- unreferenced DRAFT with rules, no effective catalog exists yet, and its rules pass the
-- same structural checks a save applies: canonical keys, no duplicate or overlapping rule
-- for one shape, and well-formed ranges (all also enforced by constraints and the rule
-- trigger). Otherwise nothing is promoted and the application reports that shape mappings
-- are not configured.
DO $$
DECLARE
  baseline TEXT;
BEGIN
  -- The same lock every catalog change takes, so an installation never races a save.
  PERFORM pg_advisory_xact_lock(hashtext('sarin.shape-mapping.catalog'));
  SELECT s."id" INTO baseline
    FROM "SarinShapeMappingSet" s
   WHERE s."sourceSystem" = 'SARIN' AND s."origin" = 'MIGRATION_BASELINE' AND s."status" = 'DRAFT'
   ORDER BY s."version" LIMIT 1;
  IF baseline IS NULL OR EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "status" = 'EFFECTIVE') THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "mappingSetId" = baseline)
     OR EXISTS (SELECT 1 FROM "SarinValidationAttempt" WHERE "shapeMappingSetId" = baseline)
     OR EXISTS (SELECT 1 FROM "SarinImportBatch" WHERE "shapeMappingSetId" = baseline)
     OR EXISTS (
       SELECT 1 FROM "SarinShapeMappingRule" a
         JOIN "SarinShapeMappingRule" b ON b."mappingSetId" = a."mappingSetId" AND b."rawShapeKey" = a."rawShapeKey" AND b."id" <> a."id"
        WHERE a."mappingSetId" = baseline
          AND (a."conditionKind" = 'NONE' OR b."conditionKind" = 'NONE'
               OR (coalesce(a."ratioMin", -1) <= coalesce(b."ratioMax", 1000000) AND coalesce(b."ratioMin", -1) <= coalesce(a."ratioMax", 1000000))))
     OR EXISTS (
       SELECT 1 FROM "SarinShapeMappingRule"
        WHERE "mappingSetId" = baseline
          AND ("rawShapeKey" <> upper(btrim("rawShapeKey")) OR "normalizedShape" <> btrim("normalizedShape")
               OR ("ratioMin" IS NOT NULL AND "ratioMax" IS NOT NULL AND "ratioMin" > "ratioMax"))) THEN
    RAISE NOTICE 'Sarin baseline mapping not promoted: it failed the structural checks or is already referenced';
    RETURN;
  END IF;
  UPDATE "SarinShapeMappingSet" SET "status" = 'EFFECTIVE' WHERE "id" = baseline;
  -- The installation is itself audited: a system event naming the snapshot it made effective.
  INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "after", "reason", "outcome", "timestamp")
  SELECT 'sarin_mapping_baseline_' || md5(baseline || clock_timestamp()::text), 'system', 'SARIN_MAPPING_BASELINE_INSTALLED', 'SarinShapeMappingSet', baseline,
         json_build_object('snapshotVersion', s."version", 'rules', (SELECT COUNT(*) FROM "SarinShapeMappingRule" WHERE "mappingSetId" = baseline), 'source', 'Confirmed Sarin shape master')::text,
         'Built-in Sarin shape master installed as the effective shape-mapping catalog', 'SUCCESS', timezone('UTC', clock_timestamp())
    FROM "SarinShapeMappingSet" s WHERE s."id" = baseline;
END $$;

-- User drafts were never usable for validation. Those nothing references are archived.
UPDATE "SarinShapeMappingSet" s
   SET "status" = 'ARCHIVED'
 WHERE s."status" = 'DRAFT' AND s."origin" = 'USER'
   AND NOT EXISTS (SELECT 1 FROM "SarinValidationAttempt" a WHERE a."shapeMappingSetId" = s."id")
   AND NOT EXISTS (SELECT 1 FROM "SarinImportBatch" b WHERE b."shapeMappingSetId" = s."id")
   AND NOT EXISTS (SELECT 1 FROM "SarinOutputVersion" o WHERE o."shapeMappingSetId" = s."id")
   AND NOT EXISTS (SELECT 1 FROM "SarinValidationIssue" i WHERE i."shapeMappingSetId" = s."id")
   AND NOT EXISTS (SELECT 1 FROM "SarinRowInterpretation" x WHERE x."shapeMappingSetId" = s."id");

-- The approval permission is withdrawn from the application; its grants go with it. Audit
-- records of earlier approvals are untouched.
DELETE FROM "RolePermission" WHERE "permissionCode" = 'sarin.mapping.approve';
