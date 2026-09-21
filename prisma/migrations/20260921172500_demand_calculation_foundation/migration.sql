-- CreateTable
CREATE TABLE "DemandCalculationLock" (
    "id" TEXT NOT NULL DEFAULT 'DEMAND_CALCULATION',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "runId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandCalculationLock_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "DemandRun" ADD COLUMN     "actor" TEXT,
ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "businessDateIst" TEXT,
ADD COLUMN     "checkpoint" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "durationMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorSummary" TEXT,
ADD COLUMN     "excludedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "inventoryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isSimulated" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastBatchId" TEXT,
ADD COLUMN     "lookbackEnd" TIMESTAMP(3),
ADD COLUMN     "lookbackStart" TIMESTAMP(3),
ADD COLUMN     "mappingVersion" TEXT,
ADD COLUMN     "salesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sourceCutoff" TIMESTAMP(3),
ADD COLUMN     "sourceMode" TEXT NOT NULL DEFAULT 'FIXTURE',
ADD COLUMN     "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "wipCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "ruleVersion" SET DEFAULT 'DEMAND-V1',
ALTER COLUMN "totalShortage" SET DEFAULT 0,
ALTER COLUMN "totalExcess" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "DemandMetric" ADD COLUMN     "blockedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "labNormalized" TEXT,
ADD COLUMN     "reservedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shapeNormalized" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "traceJson" TEXT,
ADD COLUMN     "unallocatedWip" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "weightBandCode" TEXT,
ADD COLUMN     "weightBandLabel" TEXT;

-- DropForeignKey
ALTER TABLE "DemandMetric" DROP CONSTRAINT IF EXISTS "DemandMetric_runId_fkey";

-- AddForeignKey
ALTER TABLE "DemandMetric" ADD CONSTRAINT "DemandMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DemandRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DemandRun_runDate_idx" ON "DemandRun"("runDate");

-- CreateIndex
CREATE INDEX "DemandRun_status_idx" ON "DemandRun"("status");

-- CreateIndex
CREATE INDEX "DemandMetric_runId_idx" ON "DemandMetric"("runId");

-- CreateIndex
CREATE INDEX "DemandMetric_planningCategory_idx" ON "DemandMetric"("planningCategory");
