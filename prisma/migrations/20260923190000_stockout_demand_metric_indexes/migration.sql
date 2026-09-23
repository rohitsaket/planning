-- Stockout Risk reads one run's stored demand metrics, filters and orders by the stored
-- physical shortage, and looks a single category up inside a run. Both indexes are
-- additive: they change no column, no constraint and no stored value.
--
-- CONCURRENTLY is deliberately not used. Prisma runs each migration inside a transaction,
-- which CONCURRENTLY cannot join, and DemandMetric is written only by a demand run.
CREATE INDEX IF NOT EXISTS "DemandMetric_runId_physicalShortage_idx"
  ON "DemandMetric" ("runId", "physicalShortage");

CREATE INDEX IF NOT EXISTS "DemandMetric_runId_planningCategory_idx"
  ON "DemandMetric" ("runId", "planningCategory");
