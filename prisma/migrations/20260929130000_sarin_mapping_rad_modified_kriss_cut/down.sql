-- Reverses 20260929130000_sarin_mapping_rad_modified_kriss_cut.
--
-- Refuses once the SYSTEM snapshot it installed has been used or replaced: any check, batch,
-- issue, interpretation or output bound to it, or any later snapshot saved from it, is
-- history that must keep meaning. Otherwise the snapshot it replaced becomes effective
-- again and the unused SYSTEM snapshot and its rules are removed (the installation audit
-- event is kept, and the rollback is audited). Atomic.

BEGIN;

DO $$
DECLARE
  installed_id TEXT;
  previous_id TEXT;
BEGIN
  SELECT "id", "copiedFromSetId" INTO installed_id, previous_id
    FROM "SarinShapeMappingSet" WHERE "origin" = 'SYSTEM' AND "description" LIKE 'Client-confirmed mapping installed on deployment: RAD MODIFIED is Kriss Cut%';
  IF installed_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "origin" = 'SYSTEM') THEN
      RAISE EXCEPTION 'Rollback refused: other SYSTEM Sarin mapping snapshots exist';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "id" = installed_id AND "status" <> 'EFFECTIVE')
       OR EXISTS (SELECT 1 FROM "SarinShapeMappingSet" WHERE "copiedFromSetId" = installed_id)
       OR EXISTS (SELECT 1 FROM "SarinValidationAttempt" WHERE "shapeMappingSetId" = installed_id)
       OR EXISTS (SELECT 1 FROM "SarinImportBatch" WHERE "shapeMappingSetId" = installed_id)
       OR EXISTS (SELECT 1 FROM "SarinValidationIssue" WHERE "shapeMappingSetId" = installed_id)
       OR EXISTS (SELECT 1 FROM "SarinRowInterpretation" WHERE "shapeMappingSetId" = installed_id)
       OR EXISTS (SELECT 1 FROM "SarinOutputVersion" WHERE "shapeMappingSetId" = installed_id) THEN
      RAISE EXCEPTION 'Rollback refused: the Kriss Cut mapping snapshot has been used or replaced; it is history and must be kept';
    END IF;
    -- The guards allow no such transition; they are suspended for these writes only.
    ALTER TABLE "SarinShapeMappingSet" DISABLE TRIGGER USER;
    ALTER TABLE "SarinShapeMappingRule" DISABLE TRIGGER USER;
    -- One effective snapshot at a time, and the previous one still names its successor:
    -- step the installed one down, restore the previous one, then remove the unused one.
    UPDATE "SarinShapeMappingSet" SET "status" = 'DRAFT', "effectiveAt" = NULL, "contentHash" = NULL WHERE "id" = installed_id;
    UPDATE "SarinShapeMappingSet" SET "status" = 'EFFECTIVE', "supersededBySetId" = NULL, "supersededAt" = NULL WHERE "id" = previous_id;
    DELETE FROM "SarinShapeMappingRule" WHERE "mappingSetId" = installed_id;
    DELETE FROM "SarinShapeMappingSet" WHERE "id" = installed_id;
    ALTER TABLE "SarinShapeMappingRule" ENABLE TRIGGER USER;
    ALTER TABLE "SarinShapeMappingSet" ENABLE TRIGGER USER;
    INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "after", "reason", "outcome", "timestamp")
    VALUES ('sarin_mapping_system_' || md5(installed_id || clock_timestamp()::text), 'system', 'SARIN_MAPPING_SYSTEM_ROLLED_BACK', 'SarinShapeMappingSet', previous_id,
            json_build_object('removedSnapshot', installed_id)::text, 'Unused Kriss Cut mapping snapshot removed by migration rollback', 'SUCCESS', timezone('UTC', clock_timestamp()));
  END IF;
END $$;

ALTER TABLE "SarinShapeMappingSet"
  DROP CONSTRAINT "SarinShapeMappingSet_origin_check",
  ADD CONSTRAINT "SarinShapeMappingSet_origin_check" CHECK ("origin" IN ('MIGRATION_BASELINE', 'USER'));

COMMIT;
