-- Access requests (self-service registration) — additive only. No existing table is
-- touched, so there is no precondition check and no risk to current accounts.
-- A row here is a REQUEST, never an account: it carries no password and no role.
-- ROLLBACK: see down.sql in this folder.

CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "department" TEXT,
    "justification" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "pendingKey" TEXT,
    "createdUserId" TEXT,
    "reviewedBy" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "sourceIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- NULL-as-decided idiom (same as RoughReservation.activeRoughKey): PostgreSQL treats
-- NULLs as distinct, so any number of decided requests coexist while at most one
-- PENDING request may exist per username.
CREATE UNIQUE INDEX "AccessRequest_pendingKey_key" ON "AccessRequest"("pendingKey");
CREATE INDEX "AccessRequest_status_createdAt_idx" ON "AccessRequest"("status", "createdAt");
