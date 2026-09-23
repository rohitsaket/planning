-- Reverses 20260923150000_canonical_classification_columns.
-- Destructive: dropping these columns discards the classification and the profile
-- version each record was classified under, making past classifications unreproducible.

DROP INDEX IF EXISTS "LotMasterRecord_classificationProfile_version_idx";
DROP INDEX IF EXISTS "LotMasterRecord_isCurrent_inventoryClass_idx";

ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationState";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationProfileVersion";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationProfile";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationReasons";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationTerminal";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationReviewRequired";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationPlanningEligible";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "classificationAvailable";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "inventoryClass";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "canonicalLifecycle";
ALTER TABLE "LotHistoryRecord" DROP COLUMN IF EXISTS "holdState";

ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationState";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationProfileVersion";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationProfile";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationReasons";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationTerminal";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationReviewRequired";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationPlanningEligible";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "classificationAvailable";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "inventoryClass";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "canonicalLifecycle";
ALTER TABLE "LotMasterRecord" DROP COLUMN IF EXISTS "holdState";
