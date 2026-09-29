-- Sarin shape mapping: the client-confirmed rule RAD MODIFIED -> Kriss Cut (additive, idempotent).
--
-- Confirmed by the client: the Sarin shape RAD MODIFIED is the Fantasy shape Kriss Cut, for
-- every Ratio and every stone type. (KRISS 3-STEP -> Radiant Modified is a different
-- confirmed rule and is not touched.)
--
-- The rule is installed the way a saved change is: a new immutable snapshot copying every
-- rule of the effective catalog plus this one, made EFFECTIVE while the previous snapshot
-- becomes SUPERSEDED, under the catalog lock every change takes. The snapshot's origin is
-- SYSTEM (new): installed by deployment, not by a user and not the original baseline.
--
-- It changes nothing when:
--   * no catalog is effective (there is nothing to extend);
--   * the effective catalog already maps RAD MODIFIED to Kriss Cut for all Ratios (a
--     repeated run, or a user who saved it first);
--   * the effective catalog maps RAD MODIFIED differently: that decision is a user's and is
--     never overwritten; an audit event records that the confirmed rule was not installed.
--
-- Reversal: down.sql (refuses once the installed snapshot has been used or replaced).

ALTER TABLE "SarinShapeMappingSet"
  DROP CONSTRAINT "SarinShapeMappingSet_origin_check",
  ADD CONSTRAINT "SarinShapeMappingSet_origin_check" CHECK ("origin" IN ('MIGRATION_BASELINE', 'USER', 'SYSTEM'));

DO $$
DECLARE
  current_id TEXT;
  current_version INTEGER;
  next_id TEXT;
  next_version INTEGER;
  existing_equivalent BOOLEAN;
  existing_conflict BOOLEAN;
  now_utc TIMESTAMP(3) := timezone('UTC', clock_timestamp());
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sarin.shape-mapping.catalog'));

  SELECT "id", "version" INTO current_id, current_version
    FROM "SarinShapeMappingSet" WHERE "sourceSystem" = 'SARIN' AND "status" = 'EFFECTIVE';
  IF current_id IS NULL THEN
    RAISE NOTICE 'RAD MODIFIED -> Kriss Cut not installed: no Sarin shape-mapping catalog is effective';
    RETURN;
  END IF;

  SELECT
    bool_or("conditionKind" = 'NONE' AND "normalizedShape" = 'Kriss Cut') AND COUNT(*) = 1,
    COUNT(*) > 0
    INTO existing_equivalent, existing_conflict
    FROM "SarinShapeMappingRule" WHERE "mappingSetId" = current_id AND "rawShapeKey" = 'RAD MODIFIED';
  IF existing_equivalent THEN
    RETURN;
  END IF;
  IF existing_conflict THEN
    INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "after", "reason", "outcome", "timestamp")
    VALUES ('sarin_mapping_system_' || md5(current_id || clock_timestamp()::text), 'system', 'SARIN_MAPPING_SYSTEM_RULE_NOT_INSTALLED', 'SarinShapeMappingSet', current_id,
            json_build_object('sarinShape', 'RAD MODIFIED', 'fantasyShape', 'Kriss Cut', 'effectiveVersion', current_version)::text,
            'The effective catalog already maps RAD MODIFIED differently; the confirmed rule was not installed over it', 'REJECTED', now_utc);
    RAISE NOTICE 'RAD MODIFIED -> Kriss Cut not installed: the effective catalog maps RAD MODIFIED differently';
    RETURN;
  END IF;

  SELECT COALESCE(MAX("version"), 0) + 1 INTO next_version FROM "SarinShapeMappingSet" WHERE "sourceSystem" = 'SARIN';
  next_id := 'sarin_shape_set_system_' || md5('RAD MODIFIED|Kriss Cut|' || current_id);
  INSERT INTO "SarinShapeMappingSet" ("id", "sourceSystem", "version", "status", "origin", "description", "copiedFromSetId", "createdAt")
  VALUES (next_id, 'SARIN', next_version, 'DRAFT', 'SYSTEM', 'Client-confirmed mapping installed on deployment: RAD MODIFIED is Kriss Cut', current_id, now_utc);

  -- Every current rule, as the service carries it: same content, same last change.
  INSERT INTO "SarinShapeMappingRule" ("id", "mappingSetId", "rawShapeKey", "sourceRawShape", "normalizedShape", "conditionKind", "ratioMin", "ratioMax", "note", "createdAt", "changedAt", "changedByUserId")
  SELECT 'sarin_rule_' || md5(next_id || r."id"), next_id, r."rawShapeKey", r."sourceRawShape", r."normalizedShape", r."conditionKind", r."ratioMin", r."ratioMax", r."note",
         now_utc, COALESCE(r."changedAt", r."createdAt"), r."changedByUserId"
    FROM "SarinShapeMappingRule" r WHERE r."mappingSetId" = current_id;
  INSERT INTO "SarinShapeMappingRule" ("id", "mappingSetId", "rawShapeKey", "sourceRawShape", "normalizedShape", "conditionKind", "ratioMin", "ratioMax", "note", "createdAt", "changedAt", "changedByUserId")
  VALUES ('sarin_rule_' || md5(next_id || 'RAD MODIFIED'), next_id, 'RAD MODIFIED', 'RAD MODIFIED', 'Kriss Cut', 'NONE', NULL, NULL, 'Confirmed by the client', now_utc, now_utc, NULL);

  UPDATE "SarinShapeMappingSet" SET "status" = 'SUPERSEDED', "supersededBySetId" = next_id WHERE "id" = current_id;
  UPDATE "SarinShapeMappingSet" SET "status" = 'EFFECTIVE' WHERE "id" = next_id;

  INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "after", "reason", "outcome", "timestamp")
  VALUES ('sarin_mapping_system_' || md5(next_id || clock_timestamp()::text), 'system', 'SARIN_MAPPING_SYSTEM_INSTALLED', 'SarinShapeMappingSet', next_id,
          json_build_object('sarinShape', 'RAD MODIFIED', 'fantasyShape', 'Kriss Cut', 'conditionKind', 'NONE', 'snapshotVersion', next_version, 'replacesVersion', current_version)::text,
          'Client-confirmed Sarin shape mapping installed on deployment', 'SUCCESS', now_utc);
END $$;
