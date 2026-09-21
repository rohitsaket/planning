-- Manual rollback (Prisma does not run this automatically).
-- Drops every access request permanently. Accounts already provisioned from an
-- approved request are NOT affected — they are ordinary User rows.
-- Afterwards delete this migration's row from "_prisma_migrations".
BEGIN;
DROP INDEX IF EXISTS "AccessRequest_status_createdAt_idx";
DROP INDEX IF EXISTS "AccessRequest_pendingKey_key";
DROP TABLE IF EXISTS "AccessRequest";
COMMIT;
