-- Phase 3A: Fantasy raw ingestion staging.
--
-- Additive only: two new tables, their indexes and one uniqueness constraint. No
-- existing table, column, index or constraint is altered, renamed or dropped, so
-- current synchronization, demand, planning and history behaviour is untouched.
--
-- Identity note: uniqueness is built from ingestion metadata (source mode, contract
-- version, provider batch id, content hash) and surrogate ids. No Fantasy business
-- field is used as a key, because the scope and granularity of Lot ID, Doc ID,
-- certificate, company, metal and allocation identifiers are not confirmed.

CREATE TABLE IF NOT EXISTS "FantasyRawBatch" (
    "id" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "encodingVersion" TEXT NOT NULL,
    "sourceMode" TEXT NOT NULL,
    "providerBatchId" TEXT NOT NULL,
    "batchHash" TEXT NOT NULL,
    "headersJson" TEXT NOT NULL,
    "cursorKind" TEXT NOT NULL,
    "cursorTokenHash" TEXT,
    "providerMetadataJson" TEXT,
    "processingMode" TEXT NOT NULL DEFAULT 'PERSIST',
    "status" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "processingCompletedAt" TIMESTAMP(3),
    "rowsReceived" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsQuarantined" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "rowsWithDrift" INTEGER NOT NULL DEFAULT 0,
    "diagnosticsJson" TEXT,
    "conflictsWithBatchId" TEXT,
    "integrationSyncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyRawBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FantasyRawRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "encodingVersion" TEXT NOT NULL,
    "rawPayloadJson" TEXT NOT NULL,
    "normalizedRecordJson" TEXT,
    "rowHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "diagnosticsJson" TEXT,
    "quarantineReasonCodes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyRawRow_pkey" PRIMARY KEY ("id")
);

-- Exact-replay key: the same content, under the same provider batch id, contract and
-- source mode, can only be stored once. This is what makes concurrent submission of an
-- identical batch resolve to a single stored ingestion.
CREATE UNIQUE INDEX IF NOT EXISTS "FantasyRawBatch_sourceMode_contractVersion_providerBatchId_batchHash_key"
    ON "FantasyRawBatch"("sourceMode", "contractVersion", "providerBatchId", "batchHash");

CREATE INDEX IF NOT EXISTS "FantasyRawBatch_providerBatchId_idx" ON "FantasyRawBatch"("providerBatchId");
CREATE INDEX IF NOT EXISTS "FantasyRawBatch_status_idx" ON "FantasyRawBatch"("status");
CREATE INDEX IF NOT EXISTS "FantasyRawBatch_createdAt_idx" ON "FantasyRawBatch"("createdAt");
CREATE INDEX IF NOT EXISTS "FantasyRawBatch_contractVersion_sourceMode_idx" ON "FantasyRawBatch"("contractVersion", "sourceMode");
CREATE INDEX IF NOT EXISTS "FantasyRawBatch_batchHash_idx" ON "FantasyRawBatch"("batchHash");

-- One stored row per source position within a batch.
CREATE UNIQUE INDEX IF NOT EXISTS "FantasyRawRow_batchId_sourceRowNumber_key"
    ON "FantasyRawRow"("batchId", "sourceRowNumber");

CREATE INDEX IF NOT EXISTS "FantasyRawRow_batchId_outcome_idx" ON "FantasyRawRow"("batchId", "outcome");
CREATE INDEX IF NOT EXISTS "FantasyRawRow_rowHash_idx" ON "FantasyRawRow"("rowHash");

-- Raw rows belong to their batch and are removed with it. Staging data only: no
-- operational or approval history is reachable through this relation.
ALTER TABLE "FantasyRawRow"
    ADD CONSTRAINT "FantasyRawRow_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "FantasyRawBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
