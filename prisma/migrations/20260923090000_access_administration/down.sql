-- Reverses 20260923090000_access_administration.
--
-- Destructive: dropping these tables discards role assignments and role permission
-- history, which are security records. Only run it during a deliberate rollback, and only
-- while `User.role` is still populated — it is, because this migration never stopped
-- writing it, so principal resolution falls back to the legacy column cleanly.

ALTER TABLE "UserRole"       DROP CONSTRAINT IF EXISTS "UserRole_roleId_fkey";
ALTER TABLE "UserRole"       DROP CONSTRAINT IF EXISTS "UserRole_userId_fkey";
ALTER TABLE "RolePermission" DROP CONSTRAINT IF EXISTS "RolePermission_roleId_fkey";

DROP TABLE IF EXISTS "UserRole";
DROP TABLE IF EXISTS "RolePermission";
DROP TABLE IF EXISTS "Role";

DROP INDEX IF EXISTS "AuditLog_category_timestamp_idx";
DROP INDEX IF EXISTS "AuditLog_entity_entityId_timestamp_idx";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "category";
ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "outcome";

DROP INDEX IF EXISTS "User_status_idx";
ALTER TABLE "User" DROP COLUMN IF EXISTS "updatedByUserId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "createdByUserId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "version";
ALTER TABLE "User" DROP COLUMN IF EXISTS "deactivatedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "suspendedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordChangedAt";
ALTER TABLE "User" DROP COLUMN IF EXISTS "mustChangePassword";
