-- Persisted canonical classification on the current and history records.
--
-- Additive only: nullable columns and two indexes. Nothing is dropped, renamed or
-- retyped, and no existing row is rewritten.
--
-- Nullable is deliberate. A record projected before this existed has no classification,
-- and downstream code treats a null as unclassified — therefore not available and not
-- planning eligible — rather than as a permissive default. Backfilling a guess here
-- would be exactly the invented meaning this work exists to remove.

ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "holdState"                    TEXT;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "canonicalLifecycle"           TEXT;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "inventoryClass"               TEXT;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationAvailable"      BOOLEAN;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationPlanningEligible" BOOLEAN;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationReviewRequired" BOOLEAN;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationTerminal"       BOOLEAN;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationReasons"        TEXT;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationProfile"        TEXT;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationProfileVersion" INTEGER;
ALTER TABLE "LotMasterRecord"  ADD COLUMN IF NOT EXISTS "classificationState"          TEXT;

ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "holdState"                    TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "canonicalLifecycle"           TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "inventoryClass"               TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationAvailable"      BOOLEAN;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationPlanningEligible" BOOLEAN;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationReviewRequired" BOOLEAN;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationTerminal"       BOOLEAN;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationReasons"        TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationProfile"        TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationProfileVersion" INTEGER;
ALTER TABLE "LotHistoryRecord" ADD COLUMN IF NOT EXISTS "classificationState"          TEXT;

-- Matches the current-availability query the demand engine runs.
CREATE INDEX IF NOT EXISTS "LotMasterRecord_isCurrent_inventoryClass_idx" ON "LotMasterRecord"("isCurrent", "inventoryClass");
-- Supports "which records were classified by the profile version I am about to change".
CREATE INDEX IF NOT EXISTS "LotMasterRecord_classificationProfile_version_idx" ON "LotMasterRecord"("classificationProfile", "classificationProfileVersion");
