-- AlterTable
ALTER TABLE "DemandCalculationLock" ADD COLUMN IF NOT EXISTS "lockToken" TEXT,
ADD COLUMN IF NOT EXISTS "lockedByUserId" TEXT,
ADD COLUMN IF NOT EXISTS "previousOwner" TEXT,
ADD COLUMN IF NOT EXISTS "previousRunId" TEXT,
ADD COLUMN IF NOT EXISTS "previousLockedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "unlockReason" TEXT,
ADD COLUMN IF NOT EXISTS "unlockedBy" TEXT,
ADD COLUMN IF NOT EXISTS "unlockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DemandRun" ADD COLUMN IF NOT EXISTS "sourcePolicy" TEXT NOT NULL DEFAULT 'CANONICAL_FANTASY',
ADD COLUMN IF NOT EXISTS "mappingFingerprint" TEXT,
ADD COLUMN IF NOT EXISTS "lockToken" TEXT,
ADD COLUMN IF NOT EXISTS "planCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DemandMetricTraceItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "demandMetricId" TEXT,
    "planningCategory" TEXT NOT NULL,
    "traceType" TEXT NOT NULL,
    "lotId" TEXT,
    "sourceRecordId" TEXT,
    "eventKey" TEXT,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "weight" DECIMAL(65,30),
    "lab" TEXT,
    "shape" TEXT,
    "weightBand" TEXT,
    "wipStage" TEXT,
    "customerName" TEXT,
    "saleTotalUsd" DECIMAL(65,30),
    "docDate" TIMESTAMP(3),
    "reason" TEXT,
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "checkpoint" INTEGER,
    "batchId" TEXT,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandMetricTraceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandMetricTraceItem_runId_planningCategory_idx" ON "DemandMetricTraceItem"("runId", "planningCategory");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandMetricTraceItem_runId_traceType_idx" ON "DemandMetricTraceItem"("runId", "traceType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandMetricTraceItem_lotId_idx" ON "DemandMetricTraceItem"("lotId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DemandMetricTraceItem_eventKey_idx" ON "DemandMetricTraceItem"("eventKey");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DemandMetricTraceItem_runId_fkey'
  ) THEN
    ALTER TABLE "DemandMetricTraceItem" ADD CONSTRAINT "DemandMetricTraceItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DemandRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
