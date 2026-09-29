-- Super Admin is the only built-in system role. The other 14 system roles (ADMIN,
-- ANALYSIS_MANAGER, DATA_ANALYST, DATA_SCIENTIST, PLANNING_MANAGER, PLANNER,
-- PLANNING_VIEWER, MFG_MANAGER, MFG_VIEWER, SALES_MANAGER, SALES_VIEWER,
-- FANTASY_INTEGRATION, AUDITOR, VIEWER) are retired; narrower access is now given through
-- custom roles.
--
-- Business decision: every account that held a retired system role — by assignment or by
-- the legacy User.role column — becomes a Super Admin. For each such account an immutable
-- audit row (SYSTEM_ROLES_RETIRED) records its previous roles and whether Super Admin was
-- added, so down.sql can restore them. Custom roles and their assignments are untouched.
-- Super Admin does not carry sarin.output.approve: that stays with a custom role that
-- names it. Atomic; reversed by down.sql.

DO $$
DECLARE
  retired CONSTANT TEXT[] := ARRAY['ADMIN', 'ANALYSIS_MANAGER', 'DATA_ANALYST', 'DATA_SCIENTIST', 'PLANNING_MANAGER', 'PLANNER', 'PLANNING_VIEWER', 'MFG_MANAGER', 'MFG_VIEWER', 'SALES_MANAGER', 'SALES_VIEWER', 'FANTASY_INTEGRATION', 'AUDITOR', 'VIEWER'];
  now_utc TIMESTAMP(3) := (now() AT TIME ZONE 'UTC');
  super_id TEXT;
BEGIN
  SELECT "id" INTO super_id FROM "Role" WHERE "code" = 'SUPER_ADMIN' AND "isSystem" AND "status" = 'ACTIVE';
  IF super_id IS NULL THEN
    RAISE EXCEPTION 'Migration refused: the SUPER_ADMIN system role is missing or inactive';
  END IF;

  CREATE TEMP TABLE retired_accounts ON COMMIT DROP AS
  SELECT
    u."id" AS user_id,
    u."role" AS legacy_role,
    COALESCE((SELECT json_agg(r."code" ORDER BY r."code") FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE ur."userId" = u."id"), '[]'::json) AS roles,
    NOT EXISTS (SELECT 1 FROM "UserRole" ur WHERE ur."userId" = u."id" AND ur."roleId" = super_id) AS super_admin_added
  FROM "User" u
  WHERE u."role" = ANY (retired)
     OR EXISTS (SELECT 1 FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE ur."userId" = u."id" AND r."isSystem" AND r."code" = ANY (retired));

  INSERT INTO "AuditLog" ("id", "actor", "action", "entity", "entityId", "before", "after", "reason", "outcome", "timestamp")
  SELECT 'role_retired_' || md5(a.user_id), 'system', 'SYSTEM_ROLES_RETIRED', 'User', a.user_id,
         json_build_object('legacyRole', a.legacy_role, 'roles', a.roles)::text,
         json_build_object('superAdminAdded', a.super_admin_added)::text,
         'Super Admin is the only system role; this account held a retired system role and became a Super Admin', 'SUCCESS', now_utc
  FROM retired_accounts a
  -- A reapply after down.sql finds the record it restored from: audit rows are never replaced.
  ON CONFLICT ("id") DO NOTHING;

  INSERT INTO "UserRole" ("id", "userId", "roleId", "assignedAt", "reason")
  SELECT 'ur_retired_super_' || a.user_id, a.user_id, super_id, now_utc, 'Retired system role replaced by Super Admin'
  FROM retired_accounts a WHERE a.super_admin_added
  ON CONFLICT ("userId", "roleId") DO NOTHING;

  DELETE FROM "UserRole" ur USING "Role" r
  WHERE r."id" = ur."roleId" AND r."isSystem" AND r."code" = ANY (retired);

  UPDATE "User" u SET "role" = 'SUPER_ADMIN', "version" = u."version" + 1
  WHERE u."role" = ANY (retired);

  DELETE FROM "RolePermission" rp USING "Role" r
  WHERE r."id" = rp."roleId" AND r."isSystem" AND r."code" = ANY (retired);
  DELETE FROM "Role" WHERE "isSystem" AND "code" = ANY (retired);

  IF EXISTS (SELECT 1 FROM "Role" WHERE "isSystem" AND "code" <> 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'A system role other than SUPER_ADMIN remains';
  END IF;
END $$;
