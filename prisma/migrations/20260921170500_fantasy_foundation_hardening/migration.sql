-- AlterTable
ALTER TABLE "DataQualityIssue" ADD COLUMN     "affectedField" TEXT,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "checkpoint" INTEGER,
ADD COLUMN     "downstreamImpact" TEXT,
ADD COLUMN     "normalizedValue" TEXT,
ADD COLUMN     "rawValue" TEXT,
ADD COLUMN     "syncRunId" TEXT;

-- AlterTable
ALTER TABLE "LotMasterRecord" ADD COLUMN     "sourceRecordId" TEXT;

-- AlterTable
ALTER TABLE "LotHistoryRecord" ADD COLUMN     "certificate" TEXT,
ADD COLUMN     "customerCode" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "kapan" TEXT,
ADD COLUMN     "labRaw" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "parentRoughId" TEXT,
ADD COLUMN     "previousStatus" TEXT,
ADD COLUMN     "quantity" DECIMAL(65,30) NOT NULL DEFAULT 1,
ADD COLUMN     "roughOrPolished" TEXT NOT NULL DEFAULT 'POLISHED',
ADD COLUMN     "shapeNormalized" TEXT,
ADD COLUMN     "sourceRecordId" TEXT,
ADD COLUMN     "stoneName" TEXT,
ADD COLUMN     "treatment" TEXT;

-- DropForeignKey
ALTER TABLE "LotHistoryRecord" DROP CONSTRAINT IF EXISTS "LotHistoryRecord_lotId_fkey";

-- AddForeignKey with RESTRICT
ALTER TABLE "LotHistoryRecord" ADD CONSTRAINT "LotHistoryRecord_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotMasterRecord"("lotId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "DataQualityIssue_source_status_idx" ON "DataQualityIssue"("source", "status");
CREATE INDEX "DataQualityIssue_batchId_idx" ON "DataQualityIssue"("batchId");
CREATE INDEX "DataQualityIssue_rule_idx" ON "DataQualityIssue"("rule");
CREATE INDEX "DataQualityIssue_recordId_idx" ON "DataQualityIssue"("recordId");

-- CreateIndex
CREATE INDEX "LotMasterRecord_sourceRecordId_idx" ON "LotMasterRecord"("sourceRecordId");

-- CreateIndex
CREATE INDEX "LotHistoryRecord_sourceRecordId_idx" ON "LotHistoryRecord"("sourceRecordId");
