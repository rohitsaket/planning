-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Office" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Office_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyDepartment" (
    "id" TEXT NOT NULL,
    "fantasyDeptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyLocation" (
    "id" TEXT NOT NULL,
    "fantasyLocId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyStatusMapping" (
    "id" TEXT NOT NULL,
    "fantasyStatus" TEXT NOT NULL,
    "planningClass" TEXT NOT NULL,
    "countsAvailable" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FantasyStatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "customerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "accountOwner" TEXT,
    "businessPriority" TEXT,
    "priorityReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRecord" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "lotStatusDb" TEXT NOT NULL,
    "qty" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "shape" TEXT NOT NULL,
    "weight" DECIMAL(65,30) NOT NULL,
    "weightBandId" TEXT,
    "color" TEXT,
    "clarity" TEXT,
    "labRaw" TEXT,
    "labNormalized" TEXT,
    "certificate" TEXT,
    "treatment" TEXT,
    "saleTotalUsd" DECIMAL(65,30),
    "customerId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "salesperson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoRecord" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "memoDate" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "weight" DECIMAL(65,30) NOT NULL,
    "labNormalized" TEXT,
    "color" TEXT,
    "clarity" TEXT,
    "treatment" TEXT,
    "memoValueUsd" DECIMAL(65,30),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "memoAgeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "requiredDate" TIMESTAMP(3),
    "promisedDate" TIMESTAMP(3),
    "branch" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "priorityReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "lab" TEXT,
    "shape" TEXT NOT NULL,
    "weight" DECIMAL(65,30),
    "weightBandId" TEXT,
    "color" TEXT,
    "clarity" TEXT,
    "treatment" TEXT,
    "qtyOrdered" INTEGER NOT NULL,
    "qtyAllocated" INTEGER NOT NULL DEFAULT 0,
    "qtyDelivered" INTEGER NOT NULL DEFAULT 0,
    "qtyOutstanding" INTEGER NOT NULL DEFAULT 0,
    "backorderQty" INTEGER NOT NULL DEFAULT 0,
    "specialRequirement" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolishedStone" (
    "id" TEXT NOT NULL,
    "fantasyLotId" TEXT NOT NULL,
    "fantasyDepartmentId" TEXT,
    "fantasyLocationId" TEXT,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "fantasyStatus" TEXT NOT NULL,
    "labRaw" TEXT,
    "labNormalized" TEXT,
    "shape" TEXT NOT NULL,
    "shapeNormalized" TEXT,
    "weight" DECIMAL(65,30) NOT NULL,
    "weightBandId" TEXT,
    "color" TEXT,
    "clarity" TEXT,
    "certificate" TEXT,
    "treatment" TEXT,
    "planningClass" TEXT NOT NULL DEFAULT 'PHYSICAL',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolishedStone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoughStone" (
    "id" TEXT NOT NULL,
    "fantasyRoughId" TEXT NOT NULL,
    "kapan" TEXT NOT NULL,
    "packet" TEXT NOT NULL,
    "stoneName" TEXT NOT NULL,
    "signer" TEXT,
    "stoneType" TEXT NOT NULL DEFAULT 'WHITE',
    "roughWeight" DECIMAL(65,30) NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "fantasyDepartmentId" TEXT,
    "fantasyLocationId" TEXT,
    "fantasyStatus" TEXT NOT NULL,
    "planningEligible" BOOLEAN NOT NULL DEFAULT true,
    "planningStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "parentRoughId" TEXT,
    "lastMovement" TIMESTAMP(3),
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoughStone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoughReservation" (
    "id" TEXT NOT NULL,
    "roughId" TEXT NOT NULL,
    "planningCaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SOFT_RESERVED',
    "reservedBy" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoughReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightBand" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minCt" DECIMAL(65,30) NOT NULL,
    "maxCt" DECIMAL(65,30) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabMapping" (
    "id" TEXT NOT NULL,
    "rawLab" TEXT NOT NULL,
    "normalizedLab" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShapeMapping" (
    "id" TEXT NOT NULL,
    "rawShape" TEXT NOT NULL,
    "normalizedShape" TEXT NOT NULL,
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShapeMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningCategory" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labNormalized" TEXT NOT NULL,
    "shape" TEXT NOT NULL,
    "weightBandId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandRun" (
    "id" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowDays" INTEGER NOT NULL DEFAULT 90,
    "ruleVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "totalShortage" INTEGER NOT NULL,
    "totalExcess" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandMetric" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "planningCategory" TEXT NOT NULL,
    "sales90d" INTEGER NOT NULL,
    "monthlyAverage" DECIMAL(65,30) NOT NULL,
    "unroundedTarget" DECIMAL(65,30) NOT NULL,
    "roundedTarget" INTEGER NOT NULL,
    "availableStock" INTEGER NOT NULL,
    "memoQty" INTEGER NOT NULL,
    "physicalShortage" INTEGER NOT NULL,
    "excessStock" INTEGER NOT NULL,
    "wipCoverage" INTEGER NOT NULL DEFAULT 0,
    "pipelineNeed" INTEGER NOT NULL,
    "approvedPlanCoverage" INTEGER NOT NULL DEFAULT 0,
    "remainingUnplanned" INTEGER NOT NULL,
    "forecastSignal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "customerName" TEXT,
    "salesOrderId" TEXT,
    "orderNumber" TEXT,
    "groupCode" TEXT NOT NULL,
    "companyCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "labNormalized" TEXT,
    "shape" TEXT,
    "weightBandId" TEXT,
    "colorGroup" TEXT,
    "clarityGroup" TEXT,
    "treatment" TEXT,
    "requiredQty" INTEGER NOT NULL,
    "physicalStockQty" INTEGER NOT NULL DEFAULT 0,
    "planningAvailableQty" INTEGER NOT NULL DEFAULT 0,
    "memoQty" INTEGER NOT NULL DEFAULT 0,
    "transferCoverage" INTEGER NOT NULL DEFAULT 0,
    "wipCoverage" INTEGER NOT NULL DEFAULT 0,
    "approvedPlanCoverage" INTEGER NOT NULL DEFAULT 0,
    "actualCoverage" INTEGER NOT NULL DEFAULT 0,
    "remainingUnplanned" INTEGER NOT NULL DEFAULT 0,
    "forecastQty" INTEGER NOT NULL DEFAULT 0,
    "requiredBy" TIMESTAMP(3),
    "createdDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ageDays" INTEGER NOT NULL DEFAULT 0,
    "daysRemaining" INTEGER,
    "daysOverdue" INTEGER,
    "customerPriority" TEXT,
    "orderPriority" TEXT,
    "requirementPriority" TEXT,
    "priorityReason" TEXT,
    "calculationRunId" TEXT,
    "businessRuleVersion" TEXT,
    "sourceRecords" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementAllocation" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "plannedPieceId" TEXT,
    "planOptionId" TEXT,
    "allocatedQty" INTEGER NOT NULL,
    "allocatedBy" TEXT NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'ALLOCATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningCase" (
    "id" TEXT NOT NULL,
    "caseCode" TEXT NOT NULL,
    "roughId" TEXT NOT NULL,
    "stoneName" TEXT NOT NULL,
    "kapan" TEXT NOT NULL,
    "packet" TEXT NOT NULL,
    "originalRoughWeight" DECIMAL(65,30) NOT NULL,
    "stoneType" TEXT NOT NULL DEFAULT 'WHITE',
    "planner" TEXT NOT NULL,
    "planningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "requirementContext" TEXT,
    "sourceFile" TEXT,
    "selectedOptionId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL,
    "planningCaseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "previousVersionId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "PlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanOption" (
    "id" TEXT NOT NULL,
    "optionCode" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "optionNumber" INTEGER NOT NULL,
    "expectedPieces" INTEGER NOT NULL,
    "expectedTotalWeight" DECIMAL(65,30) NOT NULL,
    "yieldPct" DECIMAL(65,30) NOT NULL,
    "matchingRequiredPieces" INTEGER NOT NULL DEFAULT 0,
    "requirementCoverage" INTEGER NOT NULL DEFAULT 0,
    "coveragePct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "nonRequiredPieces" INTEGER NOT NULL DEFAULT 0,
    "expectedColor" TEXT,
    "expectedClarity" TEXT,
    "certificationIntent" TEXT,
    "potentialExcess" INTEGER NOT NULL DEFAULT 0,
    "validationWarnings" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "selectedBy" TEXT,
    "selectedAt" TIMESTAMP(3),
    "approvalStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanOptionPiece" (
    "id" TEXT NOT NULL,
    "pieceCode" TEXT NOT NULL,
    "planOptionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "expectedShape" TEXT NOT NULL,
    "expectedWeight" DECIMAL(65,30) NOT NULL,
    "expectedColor" TEXT,
    "expectedClarity" TEXT,
    "expectedCategory" TEXT,
    "requirementAllocationId" TEXT,
    "certificationIntent" TEXT,
    "fantasyChildId" TEXT,
    "actualPolishedLotId" TEXT,
    "actualShape" TEXT,
    "actualWeight" DECIMAL(65,30),
    "actualCategory" TEXT,
    "fulfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanOptionPiece_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActualPolishedLink" (
    "id" TEXT NOT NULL,
    "plannedPieceId" TEXT,
    "fantasyPolishedLotId" TEXT NOT NULL,
    "actualShape" TEXT NOT NULL,
    "actualWeight" DECIMAL(65,30) NOT NULL,
    "actualCategory" TEXT,
    "actualYieldPct" DECIMAL(65,30),
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActualPolishedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanActualReconciliation" (
    "id" TEXT NOT NULL,
    "planOptionId" TEXT NOT NULL,
    "expectedPieces" INTEGER NOT NULL,
    "actualPieces" INTEGER NOT NULL DEFAULT 0,
    "expectedTotalWeight" DECIMAL(65,30) NOT NULL,
    "actualTotalWeight" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "plannedYieldPct" DECIMAL(65,30) NOT NULL,
    "actualYieldPct" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "yieldVariance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "expectedCoverage" INTEGER NOT NULL,
    "actualCoverage" INTEGER NOT NULL DEFAULT 0,
    "coverageVariance" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanActualReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastRun" (
    "id" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horizon30d" INTEGER NOT NULL,
    "horizon60d" INTEGER NOT NULL,
    "horizon90d" INTEGER NOT NULL,
    "metricsJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastPrediction" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "prediction30d" INTEGER NOT NULL,
    "prediction60d" INTEGER NOT NULL,
    "prediction90d" INTEGER NOT NULL,
    "confidence" DECIMAL(65,30) NOT NULL,
    "trend" TEXT NOT NULL,
    "stockoutRisk" TEXT,
    "stockoutDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "trainingPeriod" TEXT NOT NULL,
    "validationPeriod" TEXT,
    "metricsJson" TEXT,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRule" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "configuration" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" TEXT NOT NULL,
    "issueCode" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "recordId" TEXT,
    "rule" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedTo" TEXT,
    "resolution" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSyncRun" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_code_key" ON "Group"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Office_code_key" ON "Office"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyDepartment_fantasyDeptId_key" ON "FantasyDepartment"("fantasyDeptId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyLocation_fantasyLocId_key" ON "FantasyLocation"("fantasyLocId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyStatusMapping_fantasyStatus_key" ON "FantasyStatusMapping"("fantasyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_customerCode_key" ON "Customer"("customerCode");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRecord_lotId_key" ON "SalesRecord"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoRecord_lotId_key" ON "MemoRecord"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_orderNumber_key" ON "SalesOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PolishedStone_fantasyLotId_key" ON "PolishedStone"("fantasyLotId");

-- CreateIndex
CREATE UNIQUE INDEX "RoughStone_fantasyRoughId_key" ON "RoughStone"("fantasyRoughId");

-- CreateIndex
CREATE UNIQUE INDEX "WeightBand_code_key" ON "WeightBand"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LabMapping_rawLab_key" ON "LabMapping"("rawLab");

-- CreateIndex
CREATE UNIQUE INDEX "ShapeMapping_rawShape_key" ON "ShapeMapping"("rawShape");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningCategory_code_key" ON "PlanningCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_requirementCode_key" ON "Requirement"("requirementCode");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningCase_caseCode_key" ON "PlanningCase"("caseCode");

-- CreateIndex
CREATE UNIQUE INDEX "PlanOption_optionCode_key" ON "PlanOption"("optionCode");

-- CreateIndex
CREATE UNIQUE INDEX "PlanOptionPiece_pieceCode_key" ON "PlanOptionPiece"("pieceCode");

-- CreateIndex
CREATE UNIQUE INDEX "ModelVersion_modelName_key" ON "ModelVersion"("modelName");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRule_ruleId_key" ON "BusinessRule"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_code_key" ON "FeatureFlag"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityIssue_issueCode_key" ON "DataQualityIssue"("issueCode");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Office" ADD CONSTRAINT "Office_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FantasyLocation" ADD CONSTRAINT "FantasyLocation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "FantasyDepartment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecord" ADD CONSTRAINT "SalesRecord_weightBandId_fkey" FOREIGN KEY ("weightBandId") REFERENCES "WeightBand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecord" ADD CONSTRAINT "SalesRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoRecord" ADD CONSTRAINT "MemoRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_weightBandId_fkey" FOREIGN KEY ("weightBandId") REFERENCES "WeightBand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolishedStone" ADD CONSTRAINT "PolishedStone_weightBandId_fkey" FOREIGN KEY ("weightBandId") REFERENCES "WeightBand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoughReservation" ADD CONSTRAINT "RoughReservation_roughId_fkey" FOREIGN KEY ("roughId") REFERENCES "RoughStone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoughReservation" ADD CONSTRAINT "RoughReservation_planningCaseId_fkey" FOREIGN KEY ("planningCaseId") REFERENCES "PlanningCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningCategory" ADD CONSTRAINT "PlanningCategory_weightBandId_fkey" FOREIGN KEY ("weightBandId") REFERENCES "WeightBand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandMetric" ADD CONSTRAINT "DemandMetric_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DemandRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_weightBandId_fkey" FOREIGN KEY ("weightBandId") REFERENCES "WeightBand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAllocation" ADD CONSTRAINT "RequirementAllocation_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAllocation" ADD CONSTRAINT "RequirementAllocation_planOptionId_fkey" FOREIGN KEY ("planOptionId") REFERENCES "PlanOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningCase" ADD CONSTRAINT "PlanningCase_roughId_fkey" FOREIGN KEY ("roughId") REFERENCES "RoughStone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanVersion" ADD CONSTRAINT "PlanVersion_planningCaseId_fkey" FOREIGN KEY ("planningCaseId") REFERENCES "PlanningCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanOption" ADD CONSTRAINT "PlanOption_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanOptionPiece" ADD CONSTRAINT "PlanOptionPiece_planOptionId_fkey" FOREIGN KEY ("planOptionId") REFERENCES "PlanOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanActualReconciliation" ADD CONSTRAINT "PlanActualReconciliation_planOptionId_fkey" FOREIGN KEY ("planOptionId") REFERENCES "PlanOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastPrediction" ADD CONSTRAINT "ForecastPrediction_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ForecastRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

