-- Reverses 20260923210000_sync_lock_owner_token.
--
-- Dropping these restores the unsafe release: any caller could clear any held lock, and
-- a crashed worker would hold it indefinitely.
ALTER TABLE "SyncCheckpoint" DROP COLUMN IF EXISTS "lockExpiresAt";
ALTER TABLE "SyncCheckpoint" DROP COLUMN IF EXISTS "lockToken";
