-- Reverses 20260930110000_single_system_role.
--
-- Recreates the 14 retired system roles exactly as 20260923090000_access_administration
-- defined them, then, from each SYSTEM_ROLES_RETIRED audit row, gives the account back its
-- previous role assignments and legacy role, and removes the Super Admin assignment the
-- migration added. Accounts created after the migration are left as they are. Refuses,
-- changing nothing, while any role already uses one of the retired codes (a custom role
-- created since). Atomic.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Role" WHERE "code" IN ('ADMIN', 'ANALYSIS_MANAGER', 'DATA_ANALYST', 'DATA_SCIENTIST', 'PLANNING_MANAGER', 'PLANNER', 'PLANNING_VIEWER', 'MFG_MANAGER', 'MFG_VIEWER', 'SALES_MANAGER', 'SALES_VIEWER', 'FANTASY_INTEGRATION', 'AUDITOR', 'VIEWER')) THEN
    RAISE EXCEPTION 'Rollback refused: a role now uses a retired system role code; rename or delete it first';
  END IF;
END $$;

INSERT INTO "Role" ("id", "code", "name", "description", "isSystem", "status", "version", "createdAt", "updatedAt")
VALUES
  ('role_sys_admin', 'ADMIN', 'Admin', 'Administrative and operational authority. Excludes planning approval, rule and flag management, role permission assignment and protected-role assignment.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_analysis_manager', 'ANALYSIS_MANAGER', 'Analysis Manager', 'Analysis, commercial reads, requirement creation and demand execution.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_data_analyst', 'DATA_ANALYST', 'Data Analyst', 'Analysis and commercial reads with export.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_data_scientist', 'DATA_SCIENTIST', 'Data Scientist', 'Analysis reads plus forecast execution and publishing.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_planning_manager', 'PLANNING_MANAGER', 'Planning Manager', 'Planning authority including explicit plan approval.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_planner', 'PLANNER', 'Planner', 'Plan creation, selection and replanning. No approval authority.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_planning_viewer', 'PLANNING_VIEWER', 'Planning Viewer', 'Read-only planning access.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_mfg_manager', 'MFG_MANAGER', 'Manufacturing Manager', 'Manufacturing and planning reads with analysis export.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_mfg_viewer', 'MFG_VIEWER', 'Manufacturing Viewer', 'Read-only manufacturing access.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_sales_manager', 'SALES_MANAGER', 'Sales Manager', 'Commercial reads with export.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_sales_viewer', 'SALES_VIEWER', 'Sales Viewer', 'Read-only commercial access.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_fantasy_integration', 'FANTASY_INTEGRATION', 'Fantasy Integration Service', 'Runs and retries synchronization. Cannot release a stuck lock.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_auditor', 'AUDITOR', 'Auditor', 'Audit and configuration read access with export.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('role_sys_viewer', 'VIEWER', 'Viewer', 'Baseline read-only access.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Previous assignments to the retired roles.
INSERT INTO "UserRole" ("id", "userId", "roleId", "assignedAt", "reason")
SELECT 'ur_restored_' || md5(a."entityId" || prev.code), a."entityId", r."id", CURRENT_TIMESTAMP, 'Restored when the single-system-role migration was rolled back'
FROM "AuditLog" a
CROSS JOIN LATERAL json_array_elements_text(a."before"::json -> 'roles') AS prev(code)
JOIN "Role" r ON r."code" = prev.code AND r."isSystem" AND r."code" <> 'SUPER_ADMIN'
JOIN "User" u ON u."id" = a."entityId"
WHERE a."action" = 'SYSTEM_ROLES_RETIRED'
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- The Super Admin assignment the migration added, and only that one.
DELETE FROM "UserRole" ur
USING "AuditLog" a
WHERE a."action" = 'SYSTEM_ROLES_RETIRED' AND (a."after"::json ->> 'superAdminAdded')::boolean
  AND ur."id" = 'ur_retired_super_' || a."entityId";

UPDATE "User" u SET "role" = a."before"::json ->> 'legacyRole', "version" = u."version" + 1
FROM "AuditLog" a
WHERE a."action" = 'SYSTEM_ROLES_RETIRED' AND a."entityId" = u."id";

COMMIT;
