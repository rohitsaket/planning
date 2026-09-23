-- Access administration: role assignment model, account lifecycle fields and audit outcome.
--
-- Additive only. Three new tables, new nullable/defaulted columns on existing tables, and
-- new indexes. No column is dropped, renamed or retyped, and `User.role` is deliberately
-- retained so an unmigrated reader keeps working during the transition.
--
-- The data backfill at the end creates one protected system Role per role code already in
-- use and one UserRole per existing account, so every current user keeps exactly the
-- access they have today.

-- ---------------------------------------------------------------------------
-- 1. Role assignment model
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Role" (
    "id"              TEXT NOT NULL,
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "isSystem"        BOOLEAN NOT NULL DEFAULT false,
    "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
    "version"         INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Role_code_key" ON "Role"("code");
CREATE INDEX IF NOT EXISTS "Role_status_idx" ON "Role"("status");
CREATE INDEX IF NOT EXISTS "Role_isSystem_idx" ON "Role"("isSystem");

CREATE TABLE IF NOT EXISTS "RolePermission" (
    "id"               TEXT NOT NULL,
    "roleId"           TEXT NOT NULL,
    "permissionCode"   TEXT NOT NULL,
    "assignedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "reason"           TEXT,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RolePermission_roleId_permissionCode_key" ON "RolePermission"("roleId", "permissionCode");
CREATE INDEX IF NOT EXISTS "RolePermission_permissionCode_idx" ON "RolePermission"("permissionCode");

CREATE TABLE IF NOT EXISTS "UserRole" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "roleId"           TEXT NOT NULL,
    "assignedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedByUserId" TEXT,
    "reason"           TEXT,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");
CREATE INDEX IF NOT EXISTS "UserRole_roleId_idx" ON "UserRole"("roleId");

-- Role assignments are security history: no cascade delete. A role or user that is
-- referenced can be deactivated, never silently removed along with its assignments.
ALTER TABLE "RolePermission"
    ADD CONSTRAINT "RolePermission_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserRole"
    ADD CONSTRAINT "UserRole_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "UserRole"
    ADD CONSTRAINT "UserRole_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Account lifecycle fields
-- ---------------------------------------------------------------------------

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt"  TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "suspendedAt"        TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt"      TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "version"            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "createdByUserId"    TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "updatedByUserId"    TEXT;

CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");

-- ---------------------------------------------------------------------------
-- 3. Audit outcome and category
-- ---------------------------------------------------------------------------

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "outcome"  TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "category" TEXT;

CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_timestamp_idx" ON "AuditLog"("entity", "entityId", "timestamp");
CREATE INDEX IF NOT EXISTS "AuditLog_category_timestamp_idx" ON "AuditLog"("category", "timestamp");

-- ---------------------------------------------------------------------------
-- 4. Backfill — every existing account keeps exactly its current access
-- ---------------------------------------------------------------------------

-- One protected system role per code the application defines. Permissions for a system
-- role stay code-defined, so no RolePermission rows are created for them: there must not
-- be two mutable sources of truth for what a system role may do.
INSERT INTO "Role" ("id", "code", "name", "description", "isSystem", "status", "version", "createdAt", "updatedAt")
VALUES
  ('role_sys_super_admin', 'SUPER_ADMIN', 'Super Admin', 'Full access, including protected-role assignment and role permission administration.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
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
  ('role_sys_viewer', 'VIEWER', 'Viewer', 'Baseline read-only access.', true, 'ACTIVE', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- One assignment per existing account, matching the legacy column exactly. A user whose
-- legacy role code is not a known role gets no assignment and therefore no permissions —
-- the same deny-by-default result `permissionsFor()` already produces for that value.
INSERT INTO "UserRole" ("id", "userId", "roleId", "assignedAt", "reason")
SELECT
  'ur_backfill_' || u."id",
  u."id",
  r."id",
  CURRENT_TIMESTAMP,
  'Backfilled from User.role during the access-administration migration'
FROM "User" u
JOIN "Role" r ON r."code" = u."role"
ON CONFLICT ("userId", "roleId") DO NOTHING;

-- Existing accounts have never changed their password through the new flow.
UPDATE "User" SET "passwordChangedAt" = "createdAt" WHERE "passwordChangedAt" IS NULL;

-- Existing audit rows record actions that succeeded.
UPDATE "AuditLog" SET "outcome" = 'SUCCESS' WHERE "outcome" IS NULL;
