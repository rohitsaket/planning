-- Fantasy shadow projection: structurally isolated canonical projection tables.
--
-- Additive only. No existing table is altered, no column is dropped or retyped, and
-- neither LotMasterRecord nor LotHistoryRecord is touched: the canonical records gain no
-- discriminator, no nullable projection column and no foreign key. Nothing here changes
-- what any existing query returns.
--
-- The CHECK constraint on FantasyProjectionRun.mode is the point of this migration.
-- Shadow projection must never become authoritative by accident, so the database itself
-- refuses the value 'ACTIVE' rather than trusting application code to withhold it. A bug,
-- a mis-ordered deployment or a direct psql session all fail the same way.
--
-- References to FantasyRawBatch and FantasyRawRow are plain id columns, not foreign keys,
-- so raw source payloads cannot be pulled through a projection include.
-- AlterTable

-- CreateTable
CREATE TABLE "FantasyProjectionRun" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceBatchId" TEXT,
    "contractVersion" TEXT NOT NULL,
    "encodingVersion" TEXT,
    "effectiveSourceState" TEXT NOT NULL,
    "classificationProfile" TEXT,
    "classificationProfileVersion" INTEGER,
    "identityPolicyVersion" INTEGER NOT NULL,
    "measurementPolicy" TEXT NOT NULL DEFAULT 'STRICT_ACTUAL_ONLY',
    "quantitySemantics" TEXT NOT NULL,
    "weightUnit" TEXT NOT NULL,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "candidatesProjected" INTEGER NOT NULL DEFAULT 0,
    "candidatesQuarantined" INTEGER NOT NULL DEFAULT 0,
    "candidatesReviewRequired" INTEGER NOT NULL DEFAULT 0,
    "diagnosticsJson" TEXT,
    "activationBlockedReason" TEXT NOT NULL DEFAULT 'ACTIVATION_NOT_IMPLEMENTED',
    "requestedByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyProjectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FantasyProjectionCandidate" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceBatchId" TEXT,
    "sourceRowId" TEXT,
    "sourceRowNumber" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "projectionIdentityKey" TEXT NOT NULL,
    "identityPolicyVersion" INTEGER NOT NULL,
    "sourceCompanyId" TEXT,
    "legacyLotId" TEXT,
    "lotName" TEXT,
    "certificateNumber" TEXT,
    "certificateId" TEXT,
    "documentId" TEXT,
    "documentDateRaw" TEXT,
    "allocationAccountId" TEXT,
    "allocationDateRaw" TEXT,
    "processName" TEXT,
    "departmentAccountName" TEXT,
    "previousDepartmentAccountName" TEXT,
    "lotStatusRaw" TEXT,
    "onHoldRaw" TEXT,
    "holdState" TEXT,
    "canonicalLifecycle" TEXT,
    "inventoryClass" TEXT,
    "classificationAvailable" BOOLEAN,
    "classificationPlanningEligible" BOOLEAN,
    "classificationReviewRequired" BOOLEAN,
    "classificationTerminal" BOOLEAN,
    "classificationReasons" TEXT,
    "classificationProfile" TEXT,
    "classificationProfileVersion" INTEGER,
    "classificationState" TEXT,
    "actualShape" TEXT,
    "actualColor" TEXT,
    "actualClarity" TEXT,
    "actualLabName" TEXT,
    "actualCut" TEXT,
    "actualPolish" TEXT,
    "actualSymmetry" TEXT,
    "actualFluorescence" TEXT,
    "actualTable" TEXT,
    "actualDepth" TEXT,
    "actualRatio" TEXT,
    "actualTone" TEXT,
    "actualFancyColor" TEXT,
    "actualWeight" DECIMAL(65,30),
    "actualWeightState" TEXT,
    "estimatedShapeId" TEXT,
    "estimatedColorId" TEXT,
    "estimatedClarityId" TEXT,
    "estimatedShapeIdState" TEXT,
    "estimatedColorIdState" TEXT,
    "estimatedClarityIdState" TEXT,
    "estimatedWeight" DECIMAL(65,30),
    "estimatedWeightState" TEXT,
    "weightDivergence" DECIMAL(65,30),
    "shapeProvenance" TEXT NOT NULL DEFAULT 'NONE',
    "colorProvenance" TEXT NOT NULL DEFAULT 'NONE',
    "clarityProvenance" TEXT NOT NULL DEFAULT 'NONE',
    "weightProvenance" TEXT NOT NULL DEFAULT 'NONE',
    "estimationMethod" TEXT NOT NULL DEFAULT 'NOT_ESTIMATED',
    "containsEstimatedValues" BOOLEAN NOT NULL DEFAULT false,
    "eligibleForConfirmedShortage" BOOLEAN NOT NULL DEFAULT false,
    "quantityRawValue" DECIMAL(65,30),
    "quantityState" TEXT NOT NULL,
    "quantityPieces" INTEGER,
    "quantitySemantics" TEXT NOT NULL,
    "weightUnit" TEXT NOT NULL,
    "weightUsableCarats" DECIMAL(65,30),
    "averageWeight" DECIMAL(65,30),
    "originalWeight" DECIMAL(65,30),
    "totalDiamondWeight" DECIMAL(65,30),
    "metalWeight" DECIMAL(65,30),
    "metWeight" DECIMAL(65,30),
    "secondaryWeightStatesJson" TEXT,
    "unconfirmedDimensionsJson" TEXT,
    "metalId" TEXT,
    "metalColorRaw" TEXT,
    "itemName" TEXT,
    "structureReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    "structureRiskCodes" TEXT,
    "candidateState" TEXT NOT NULL,
    "reviewReasonCodes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyProjectionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FantasyProjectionRun_mode_status_idx" ON "FantasyProjectionRun"("mode", "status");

-- CreateIndex
CREATE INDEX "FantasyProjectionRun_sourceBatchId_idx" ON "FantasyProjectionRun"("sourceBatchId");

-- CreateIndex
CREATE INDEX "FantasyProjectionRun_startedAt_idx" ON "FantasyProjectionRun"("startedAt");

-- CreateIndex
CREATE INDEX "FantasyProjectionRun_classificationProfile_classificationPr_idx" ON "FantasyProjectionRun"("classificationProfile", "classificationProfileVersion");

-- CreateIndex
CREATE INDEX "FantasyProjectionCandidate_runId_candidateState_idx" ON "FantasyProjectionCandidate"("runId", "candidateState");

-- CreateIndex
CREATE INDEX "FantasyProjectionCandidate_projectionIdentityKey_idx" ON "FantasyProjectionCandidate"("projectionIdentityKey");

-- CreateIndex
CREATE INDEX "FantasyProjectionCandidate_legacyLotId_idx" ON "FantasyProjectionCandidate"("legacyLotId");

-- CreateIndex
CREATE INDEX "FantasyProjectionCandidate_runId_inventoryClass_idx" ON "FantasyProjectionCandidate"("runId", "inventoryClass");

-- CreateIndex
CREATE INDEX "FantasyProjectionCandidate_rowHash_idx" ON "FantasyProjectionCandidate"("rowHash");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyProjectionCandidate_runId_sourceRowNumber_key" ON "FantasyProjectionCandidate"("runId", "sourceRowNumber");

-- AddForeignKey
ALTER TABLE "FantasyProjectionCandidate" ADD CONSTRAINT "FantasyProjectionCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FantasyProjectionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "FantasyRawBatch_sourceMode_contractVersion_providerBatchId_batc" RENAME TO "FantasyRawBatch_sourceMode_contractVersion_providerBatchId__key";

-- RenameIndex
ALTER INDEX "LotMasterRecord_classificationProfile_version_idx" RENAME TO "LotMasterRecord_classificationProfile_classificationProfile_idx";


-- The isolation guarantee, enforced by the database rather than by application code.
-- Only DRY_RUN and SHADOW exist. Promotion to an authoritative projection is separate,
-- deliberate work that has not been designed or built; until it is, ACTIVE is not a
-- value this table can hold.
ALTER TABLE "FantasyProjectionRun"
  ADD CONSTRAINT "FantasyProjectionRun_mode_check"
  CHECK ("mode" IN ('DRY_RUN', 'SHADOW'));

-- Candidates are immutable once written. No application path updates them, and a
-- corrected projection is a new run so the two remain comparable.
ALTER TABLE "FantasyProjectionCandidate"
  ADD CONSTRAINT "FantasyProjectionCandidate_state_check"
  CHECK ("candidateState" IN ('PROJECTED', 'REVIEW_REQUIRED', 'QUARANTINED'));
