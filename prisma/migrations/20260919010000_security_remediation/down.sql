-- Manual rollback for 20260919010000_security_remediation (Prisma does not run this automatically).
-- Users and sessions are lost. Afterwards: DELETE FROM "_prisma_migrations" WHERE migration_name = '20260919010000_security_remediation';
BEGIN;
DROP INDEX "PlanVersion_planningCaseId_versionNumber_key";
DROP INDEX "RoughReservation_activeRoughKey_key";
ALTER TABLE "RoughReservation" DROP COLUMN "activeRoughKey", DROP COLUMN "reservedByUserId";
DROP INDEX "AuditLog_timestamp_idx";
DROP INDEX "AuditLog_actorUserId_idx";
ALTER TABLE "AuditLog" DROP COLUMN "actorUserId", DROP COLUMN "actorRole", DROP COLUMN "requestId", DROP COLUMN "sessionId", DROP COLUMN "sourceIp";
DROP TABLE "Session";
DROP TABLE "User";
COMMIT;
