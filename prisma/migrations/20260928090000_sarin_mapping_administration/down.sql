-- Reverses 20260928090000_sarin_mapping_administration.
--
-- Refuses once any clone lineage, supersession or rule note exists: dropping them would
-- erase mapping history. Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "copiedFromSetId" IS NOT NULL OR "supersededBySetId" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "SarinShapeMappingRule" WHERE "note" IS NOT NULL) THEN
    RAISE EXCEPTION 'Mapping lineage or rule notes exist; this migration cannot be reversed without losing mapping history';
  END IF;
END $$;

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
      NEW."retiredAt" := (now() AT TIME ZONE 'UTC');
    END IF;
  ELSIF NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt"
        OR NEW."retiredByUserId" IS DISTINCT FROM OLD."retiredByUserId" THEN
    RAISE EXCEPTION 'Retirement fields change only with the status'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "SarinShapeMappingRule" DROP CONSTRAINT "SarinShapeMappingRule_note_check";
ALTER TABLE "SarinShapeMappingSet"
  DROP CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check",
  DROP CONSTRAINT "SarinShapeMappingSet_not_own_clone_check",
  DROP CONSTRAINT "SarinShapeMappingSet_supersededBySetId_fkey",
  DROP CONSTRAINT "SarinShapeMappingSet_copiedFromSetId_fkey";
DROP INDEX "SarinShapeMappingSet_supersededBySetId_key";
ALTER TABLE "SarinShapeMappingRule" DROP COLUMN "note";
ALTER TABLE "SarinShapeMappingSet" DROP COLUMN "supersededBySetId", DROP COLUMN "copiedFromSetId";

COMMIT;
