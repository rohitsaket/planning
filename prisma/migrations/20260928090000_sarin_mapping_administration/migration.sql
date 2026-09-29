-- Sarin shape mapping administration (additive).
--
-- Rules gain a reviewer note. Sets record the set a draft was cloned from, and an approved
-- set retired because an approved clone of it replaced it records that clone. Lineage is
-- fixed: the clone source at creation, the successor only in the APPROVED -> RETIRED step.
-- Existing sets, rules and every reference to them are unchanged.
--
-- Reversal: down.sql (refuses once lineage or notes exist).

-- AlterTable
ALTER TABLE "SarinShapeMappingSet" ADD COLUMN     "copiedFromSetId" TEXT,
ADD COLUMN     "supersededBySetId" TEXT;

-- AlterTable
ALTER TABLE "SarinShapeMappingRule" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SarinShapeMappingSet_supersededBySetId_key" ON "SarinShapeMappingSet"("supersededBySetId");

-- AddForeignKey
ALTER TABLE "SarinShapeMappingSet" ADD CONSTRAINT "SarinShapeMappingSet_copiedFromSetId_fkey" FOREIGN KEY ("copiedFromSetId") REFERENCES "SarinShapeMappingSet"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SarinShapeMappingSet" ADD CONSTRAINT "SarinShapeMappingSet_supersededBySetId_fkey" FOREIGN KEY ("supersededBySetId") REFERENCES "SarinShapeMappingSet"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "SarinShapeMappingSet"
  ADD CONSTRAINT "SarinShapeMappingSet_not_own_clone_check" CHECK ("copiedFromSetId" IS NULL OR "copiedFromSetId" <> "id"),
  ADD CONSTRAINT "SarinShapeMappingSet_superseded_is_retired_check" CHECK ("supersededBySetId" IS NULL OR "status" = 'RETIRED');

ALTER TABLE "SarinShapeMappingRule"
  ADD CONSTRAINT "SarinShapeMappingRule_note_check"
    CHECK ("note" IS NULL OR ("note" = btrim("note") AND char_length("note") BETWEEN 1 AND 500 AND "note" !~ '[[:cntrl:]]'));

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
