-- Owner-token synchronization lock.
--
-- The lock was claimed atomically but released unconditionally: `unlockSynchronization`
-- and the failure path both cleared it without proving ownership, so one worker could
-- release another worker's lock mid-run. The demand lock already used a token; this
-- brings synchronization to the same standard.
--
-- Additive: two nullable columns. An existing held lock has no token, which the release
-- path treats as a legacy claim that only an authorized unlock may clear.
ALTER TABLE "SyncCheckpoint" ADD COLUMN IF NOT EXISTS "lockToken"     TEXT;
ALTER TABLE "SyncCheckpoint" ADD COLUMN IF NOT EXISTS "lockExpiresAt" TIMESTAMP(3);
