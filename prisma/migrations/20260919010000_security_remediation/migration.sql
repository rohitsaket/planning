-- Security remediation — additive only. No table is dropped or rewritten.
-- PRECONDITION: run `bun scripts/check-migration-preconditions.ts` first. The two unique
-- indexes below fail (and the whole migration rolls back) if duplicate rows exist.
-- ROLLBACK: see down.sql in this folder.

-- Identity
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit: server-derived identity columns
ALTER TABLE "AuditLog"
    ADD COLUMN "actorUserId" TEXT,
    ADD COLUMN "actorRole" TEXT,
    ADD COLUMN "requestId" TEXT,
    ADD COLUMN "sessionId" TEXT,
    ADD COLUMN "sourceIp" TEXT;
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- Rough reservation: at most one ACTIVE reservation per rough stone
ALTER TABLE "RoughReservation"
    ADD COLUMN "activeRoughKey" TEXT,
    ADD COLUMN "reservedByUserId" TEXT;
UPDATE "RoughReservation" SET "activeRoughKey" = "roughId" WHERE "status" IN ('RESERVED', 'SOFT_RESERVED') AND "releasedAt" IS NULL;
CREATE UNIQUE INDEX "RoughReservation_activeRoughKey_key" ON "RoughReservation"("activeRoughKey");

-- Plan versions: one row per (case, version number)
CREATE UNIQUE INDEX "PlanVersion_planningCaseId_versionNumber_key" ON "PlanVersion"("planningCaseId", "versionNumber");
