-- Canonical category classification.
--
-- The planning category (Lab | Shape | Weight Band) was decided twice: once by the
-- synchronizer onto the canonical record, and again by the demand calculation from the
-- raw columns using whatever the mapping tables held at run time. The two could disagree,
-- and a committed run could be retroactively re-categorised by editing a mapping row.
--
-- These columns hold the decision made at projection time. Every one is nullable and
-- every one defaults to NULL, so existing rows are untouched and are read as "not yet
-- classified" — which the consumers treat as requiring review, never as approved.

ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryLabState"        TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryShapeState"      TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryWeightBandState" TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryState"           TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryKey"             TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "categoryReviewReasons"   TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "weightBandId"            TEXT;
ALTER TABLE "LotMasterRecord" ADD COLUMN "weightBandLabel"         TEXT;

-- Matches the reads: demand groups by the approved key, and the review surfaces filter
-- on the state.
CREATE INDEX "LotMasterRecord_categoryKey_idx"   ON "LotMasterRecord"("categoryKey");
CREATE INDEX "LotMasterRecord_categoryState_idx" ON "LotMasterRecord"("categoryState");

-- The same decision on the immutable history, so a committed demand run keeps the
-- classification snapshot it used. Additive and nullable: existing versions are untouched
-- and read as "not yet classified", which consumers treat as requiring review.
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryLabState"        TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryShapeState"      TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryWeightBandState" TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryState"           TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryKey"             TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "categoryReviewReasons"   TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "weightBandId"            TEXT;
ALTER TABLE "LotHistoryRecord" ADD COLUMN "weightBandLabel"         TEXT;
