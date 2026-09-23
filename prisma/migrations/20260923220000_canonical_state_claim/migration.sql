-- One coordination resource over the canonical Fantasy records.
--
-- Synchronization held a sync lock; demand held a demand lock; neither knew about the
-- other. A sync therefore committed batch N+1 in the middle of a demand run's reads, so
-- one calculation could mix sales from before a batch with inventory from after it.
-- Both operations now claim this single row, which is the only place that exclusion can
-- be decided atomically across processes.
CREATE TABLE IF NOT EXISTS "CanonicalStateClaim" (
  "id"             TEXT         NOT NULL DEFAULT 'FANTASY_CANONICAL_STATE',
  "holder"         TEXT,
  "ownerToken"     TEXT,
  "claimedBy"      TEXT,
  "claimedAt"      TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "fencingVersion" INTEGER      NOT NULL DEFAULT 0,
  "lastForcedBy"   TEXT,
  "lastForcedAt"   TIMESTAMP(3),
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanonicalStateClaim_pkey" PRIMARY KEY ("id"),
  -- A claim is either fully held or fully free; a half-written claim is not a state.
  CONSTRAINT "CanonicalStateClaim_holder_consistent_check" CHECK (
    ("holder" IS NULL     AND "ownerToken" IS NULL     AND "expiresAt" IS NULL) OR
    ("holder" IS NOT NULL AND "ownerToken" IS NOT NULL AND "expiresAt" IS NOT NULL)
  ),
  CONSTRAINT "CanonicalStateClaim_holder_values_check" CHECK (
    "holder" IS NULL OR "holder" IN ('SYNC', 'DEMAND')
  )
);

-- The singleton exists from the start, so a claim is always an UPDATE and never races
-- two workers into inserting it.
INSERT INTO "CanonicalStateClaim" ("id", "fencingVersion", "updatedAt")
VALUES ('FANTASY_CANONICAL_STATE', 0, NOW())
ON CONFLICT ("id") DO NOTHING;

-- Which synchronization run a demand calculation was bound to.
--
-- Not a foreign key on purpose: demand history is permanent operational record, and a
-- retention policy later applied to IntegrationSyncRun must not be able to invalidate or
-- cascade into it. Existing runs stay NULL and report their source identity as
-- unavailable rather than receiving an invented one.
ALTER TABLE "DemandRun" ADD COLUMN IF NOT EXISTS "sourceSyncRunId" TEXT;

-- Snapshot selection asks "which demand runs came from this sync run".
CREATE INDEX IF NOT EXISTS "DemandRun_sourceSyncRunId_idx" ON "DemandRun" ("sourceSyncRunId");
