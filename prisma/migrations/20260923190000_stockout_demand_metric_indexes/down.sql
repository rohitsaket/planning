-- Reverses 20260923190000_stockout_demand_metric_indexes.
--
-- Dropping these indexes removes only a read optimization. No data is affected, and the
-- queries still return identical results — more slowly on a large run.
DROP INDEX IF EXISTS "DemandMetric_runId_physicalShortage_idx";
DROP INDEX IF EXISTS "DemandMetric_runId_planningCategory_idx";
