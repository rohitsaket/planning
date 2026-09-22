-- Demand & Inventory hardening: WIP coverage policy provenance on each run, plus
-- indexes for the query patterns introduced by server-side pagination and
-- database-side aggregation. Additive and backward compatible: no data is moved,
-- no column is dropped, and existing rows keep working with the defaults below.

-- 1. Provenance of the WIP coverage policy (BR-WIP-001) that was in force for a run.
--    Historical runs pre-dating this column are recorded as NOT_CONFIGURED, which is
--    what they were: no confirmed rule existed, so no WIP was deducted knowingly.
ALTER TABLE "DemandRun" ADD COLUMN IF NOT EXISTS "wipPolicyStatus" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';
ALTER TABLE "DemandRun" ADD COLUMN IF NOT EXISTS "wipRuleVersion" TEXT;
ALTER TABLE "DemandRun" ADD COLUMN IF NOT EXISTS "wipEligibleStages" TEXT;

-- 2. Customer 360 list: filtered, value-ranked, server-paginated.
CREATE INDEX IF NOT EXISTS "Customer_country_branch_idx" ON "Customer"("country", "branch");
CREATE INDEX IF NOT EXISTS "Customer_name_idx" ON "Customer"("name");

-- 3. Sales aggregates per customer and per rolling window.
CREATE INDEX IF NOT EXISTS "SalesRecord_customerId_lotStatusDb_docDate_idx" ON "SalesRecord"("customerId", "lotStatusDb", "docDate");
CREATE INDEX IF NOT EXISTS "SalesRecord_lotStatusDb_docDate_idx" ON "SalesRecord"("lotStatusDb", "docDate");
CREATE INDEX IF NOT EXISTS "SalesRecord_country_branch_idx" ON "SalesRecord"("country", "branch");

-- 4. Memo exposure aggregates and paged memo detail.
CREATE INDEX IF NOT EXISTS "MemoRecord_customerId_status_idx" ON "MemoRecord"("customerId", "status");
CREATE INDEX IF NOT EXISTS "MemoRecord_country_branch_status_idx" ON "MemoRecord"("country", "branch", "status");
CREATE INDEX IF NOT EXISTS "MemoRecord_memoDate_idx" ON "MemoRecord"("memoDate");

-- 5. Sales order paging and open-order counts.
CREATE INDEX IF NOT EXISTS "SalesOrder_customerId_status_idx" ON "SalesOrder"("customerId", "status");
CREATE INDEX IF NOT EXISTS "SalesOrder_country_branch_status_idx" ON "SalesOrder"("country", "branch", "status");
CREATE INDEX IF NOT EXISTS "SalesOrder_orderDate_idx" ON "SalesOrder"("orderDate");

-- 6. Polished availability grouping, global filters and aging buckets.
CREATE INDEX IF NOT EXISTS "PolishedStone_country_branch_idx" ON "PolishedStone"("country", "branch");
CREATE INDEX IF NOT EXISTS "PolishedStone_planningClass_idx" ON "PolishedStone"("planningClass");
CREATE INDEX IF NOT EXISTS "PolishedStone_labNormalized_idx" ON "PolishedStone"("labNormalized");
CREATE INDEX IF NOT EXISTS "PolishedStone_lastUpdated_idx" ON "PolishedStone"("lastUpdated");

-- 7. Country + category position grouping.
CREATE INDEX IF NOT EXISTS "Requirement_country_branch_idx" ON "Requirement"("country", "branch");
CREATE INDEX IF NOT EXISTS "Requirement_status_idx" ON "Requirement"("status");
CREATE INDEX IF NOT EXISTS "Requirement_labNormalized_shape_weightBandId_idx" ON "Requirement"("labNormalized", "shape", "weightBandId");

-- 8. Current manufacturing WIP lookup used by the shared WIP classifier.
CREATE INDEX IF NOT EXISTS "LotMasterRecord_isCurrent_roughOrPolished_idx" ON "LotMasterRecord"("isCurrent", "roughOrPolished");
CREATE INDEX IF NOT EXISTS "LotMasterRecord_isCurrent_entityType_idx" ON "LotMasterRecord"("isCurrent", "entityType");
