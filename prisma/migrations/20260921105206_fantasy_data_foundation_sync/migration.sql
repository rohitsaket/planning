-- AlterTable
ALTER TABLE "IntegrationSyncRun" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "dqIssuesCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "endingCheckpoint" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorSummary" TEXT,
ADD COLUMN     "historyVersionsCreated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isSimulated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recordsReceived" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recordsRejected" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recordsRemoved" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "recordsUnchanged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceCutoff" TIMESTAMP(3),
ADD COLUMN     "sourceMode" TEXT NOT NULL DEFAULT 'FIXTURE',
ADD COLUMN     "startingCheckpoint" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "triggeredBy" TEXT,
ADD COLUMN     "triggeredByUserId" TEXT;

-- CreateTable
CREATE TABLE "SyncCheckpoint" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'FANTASY',
    "mode" TEXT NOT NULL DEFAULT 'FIXTURE',
    "currentCheckpoint" INTEGER NOT NULL DEFAULT 0,
    "lastBatchId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotMasterRecord" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'FIXTURE',
    "entityType" TEXT NOT NULL DEFAULT 'POLISHED',
    "currentStatus" TEXT NOT NULL,
    "previousStatus" TEXT,
    "statusEffectiveDate" TIMESTAMP(3) NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "shape" TEXT NOT NULL,
    "shapeNormalized" TEXT,
    "weight" DECIMAL(65,30) NOT NULL,
    "color" TEXT,
    "clarity" TEXT,
    "labRaw" TEXT,
    "labNormalized" TEXT,
    "certificate" TEXT,
    "treatment" TEXT,
    "saleTotalUsd" DECIMAL(65,30),
    "customerId" TEXT,
    "customerCode" TEXT,
    "customerName" TEXT,
    "departmentId" TEXT,
    "departmentName" TEXT,
    "locationId" TEXT,
    "locationName" TEXT,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "roughOrPolished" TEXT NOT NULL DEFAULT 'POLISHED',
    "wipStage" TEXT,
    "parentRoughId" TEXT,
    "kapan" TEXT,
    "stoneName" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "removalReason" TEXT,
    "removedFromLiveAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "lastSyncBatchId" TEXT NOT NULL,
    "checkpoint" INTEGER NOT NULL DEFAULT 1,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotMasterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotHistoryRecord" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "statusEffectiveDate" TIMESTAMP(3) NOT NULL,
    "shape" TEXT NOT NULL,
    "weight" DECIMAL(65,30) NOT NULL,
    "color" TEXT,
    "clarity" TEXT,
    "labNormalized" TEXT,
    "saleTotalUsd" DECIMAL(65,30),
    "customerName" TEXT,
    "departmentName" TEXT,
    "locationName" TEXT,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "wipStage" TEXT,
    "isCurrent" BOOLEAN NOT NULL,
    "removalReason" TEXT,
    "changeReason" TEXT,
    "syncBatchId" TEXT NOT NULL,
    "checkpoint" INTEGER NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotHistoryRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncCheckpoint_source_key" ON "SyncCheckpoint"("source");

-- CreateIndex
CREATE UNIQUE INDEX "LotMasterRecord_lotId_key" ON "LotMasterRecord"("lotId");

-- CreateIndex
CREATE INDEX "LotMasterRecord_isCurrent_idx" ON "LotMasterRecord"("isCurrent");

-- CreateIndex
CREATE INDEX "LotMasterRecord_currentStatus_idx" ON "LotMasterRecord"("currentStatus");

-- CreateIndex
CREATE INDEX "LotMasterRecord_shapeNormalized_idx" ON "LotMasterRecord"("shapeNormalized");

-- CreateIndex
CREATE INDEX "LotMasterRecord_labNormalized_idx" ON "LotMasterRecord"("labNormalized");

-- CreateIndex
CREATE INDEX "LotMasterRecord_country_branch_idx" ON "LotMasterRecord"("country", "branch");

-- CreateIndex
CREATE INDEX "LotMasterRecord_lastSeenAt_idx" ON "LotMasterRecord"("lastSeenAt");

-- CreateIndex
CREATE INDEX "LotMasterRecord_checkpoint_idx" ON "LotMasterRecord"("checkpoint");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_lotId_idx" ON "LotHistoryRecord"("lotId");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_syncBatchId_idx" ON "LotHistoryRecord"("syncBatchId");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_checkpoint_idx" ON "LotHistoryRecord"("checkpoint");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_status_idx" ON "LotHistoryRecord"("status");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_recordedAt_idx" ON "LotHistoryRecord"("recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LotHistoryRecord_lotId_version_key" ON "LotHistoryRecord"("lotId", "version");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_startedAt_idx" ON "IntegrationSyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_status_idx" ON "IntegrationSyncRun"("status");

-- CreateIndex
CREATE INDEX "IntegrationSyncRun_batchId_idx" ON "IntegrationSyncRun"("batchId");

-- AddForeignKey
ALTER TABLE "LotHistoryRecord" ADD CONSTRAINT "LotHistoryRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotMasterRecord"("lotId") ON DELETE CASCADE ON UPDATE CASCADE;
