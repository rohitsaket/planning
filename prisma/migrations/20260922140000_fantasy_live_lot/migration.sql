-- CreateTable
CREATE TABLE "FantasyLiveLot" (
    "id" TEXT NOT NULL,
    "sourceRecordKey" TEXT NOT NULL,
    "metalId" TEXT,
    "metalWeight" DECIMAL(18,6),
    "previousDepartmentAccountName" TEXT,
    "processName" TEXT,
    "remark" TEXT,
    "qty" DECIMAL(18,6),
    "lotId" TEXT,
    "lotName" TEXT,
    "onHold" BOOLEAN,
    "lotStatusDb" TEXT,
    "shape" TEXT,
    "color" TEXT,
    "clarity" TEXT,
    "size" TEXT,
    "weight" DECIMAL(18,6),
    "labName" TEXT,
    "certificateNo" TEXT,
    "cut" TEXT,
    "polish" TEXT,
    "symmetry" TEXT,
    "fluorescence" TEXT,
    "m1" DECIMAL(12,4),
    "m2" DECIMAL(12,4),
    "m3" DECIMAL(12,4),
    "tablePercent" DECIMAL(10,4),
    "depthPercent" DECIMAL(10,4),
    "ratio" DECIMAL(10,4),
    "tone" TEXT,
    "departmentAccountName" TEXT,
    "estimatedClarityId" TEXT,
    "estimatedColorId" TEXT,
    "averageWeight" DECIMAL(18,6),
    "allocationDate" TIMESTAMP(3),
    "allocationAccountId" TEXT,
    "certificateId" TEXT,
    "companyId" TEXT,
    "docId" TEXT,
    "estimatedShapeId" TEXT,
    "estimatedWeight" DECIMAL(18,6),
    "fancyColor" TEXT,
    "metalColor" TEXT,
    "metalWgt" DECIMAL(18,6),
    "originalWeight" DECIMAL(18,6),
    "totalDiamondWeight" DECIMAL(18,6),
    "docDate" TIMESTAMP(3),
    "itemName" TEXT,
    "sourcePayload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "mappingWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceActive" BOOLEAN NOT NULL DEFAULT true,
    "staleSince" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyLiveLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FantasyLiveLot_sourceRecordKey_key" ON "FantasyLiveLot"("sourceRecordKey");
CREATE INDEX "FantasyLiveLot_lotId_idx" ON "FantasyLiveLot"("lotId");
CREATE INDEX "FantasyLiveLot_certificateNo_idx" ON "FantasyLiveLot"("certificateNo");
CREATE INDEX "FantasyLiveLot_docId_idx" ON "FantasyLiveLot"("docId");
CREATE INDEX "FantasyLiveLot_metalId_idx" ON "FantasyLiveLot"("metalId");
CREATE INDEX "FantasyLiveLot_companyId_idx" ON "FantasyLiveLot"("companyId");
CREATE INDEX "FantasyLiveLot_processName_idx" ON "FantasyLiveLot"("processName");
CREATE INDEX "FantasyLiveLot_departmentAccountName_idx" ON "FantasyLiveLot"("departmentAccountName");
CREATE INDEX "FantasyLiveLot_lotStatusDb_idx" ON "FantasyLiveLot"("lotStatusDb");
CREATE INDEX "FantasyLiveLot_shape_idx" ON "FantasyLiveLot"("shape");
CREATE INDEX "FantasyLiveLot_labName_idx" ON "FantasyLiveLot"("labName");
CREATE INDEX "FantasyLiveLot_docDate_idx" ON "FantasyLiveLot"("docDate");
CREATE INDEX "FantasyLiveLot_lastSeenAt_idx" ON "FantasyLiveLot"("lastSeenAt");
CREATE INDEX "FantasyLiveLot_sourceActive_idx" ON "FantasyLiveLot"("sourceActive");
