-- Reverses 20260922120000_demand_inventory_wip_policy.
-- Dropping the indexes is safe; dropping the three DemandRun columns discards the
-- record of which WIP policy each historical run applied, so it is deliberate and
-- listed last.

DROP INDEX IF EXISTS "LotMasterRecord_isCurrent_entityType_idx";
DROP INDEX IF EXISTS "LotMasterRecord_isCurrent_roughOrPolished_idx";

DROP INDEX IF EXISTS "Requirement_labNormalized_shape_weightBandId_idx";
DROP INDEX IF EXISTS "Requirement_status_idx";
DROP INDEX IF EXISTS "Requirement_country_branch_idx";

DROP INDEX IF EXISTS "PolishedStone_lastUpdated_idx";
DROP INDEX IF EXISTS "PolishedStone_labNormalized_idx";
DROP INDEX IF EXISTS "PolishedStone_planningClass_idx";
DROP INDEX IF EXISTS "PolishedStone_country_branch_idx";

DROP INDEX IF EXISTS "SalesOrder_orderDate_idx";
DROP INDEX IF EXISTS "SalesOrder_country_branch_status_idx";
DROP INDEX IF EXISTS "SalesOrder_customerId_status_idx";

DROP INDEX IF EXISTS "MemoRecord_memoDate_idx";
DROP INDEX IF EXISTS "MemoRecord_country_branch_status_idx";
DROP INDEX IF EXISTS "MemoRecord_customerId_status_idx";

DROP INDEX IF EXISTS "SalesRecord_country_branch_idx";
DROP INDEX IF EXISTS "SalesRecord_lotStatusDb_docDate_idx";
DROP INDEX IF EXISTS "SalesRecord_customerId_lotStatusDb_docDate_idx";

DROP INDEX IF EXISTS "Customer_name_idx";
DROP INDEX IF EXISTS "Customer_country_branch_idx";

ALTER TABLE "DemandRun" DROP COLUMN IF EXISTS "wipEligibleStages";
ALTER TABLE "DemandRun" DROP COLUMN IF EXISTS "wipRuleVersion";
ALTER TABLE "DemandRun" DROP COLUMN IF EXISTS "wipPolicyStatus";
