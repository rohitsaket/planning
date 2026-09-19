# Task 5-B — Plan Comparison + Anomaly Detection Views

Agent: full-stack-developer
Task: Build Plan Comparison rich UI view + Anomaly Detection data science view (spec §47 + §61)

## Prior work read
- `/home/z/my-project/worklog.md` — confirmed task dependencies:
  - Round 0–4 built dashboard, 12 analysis views, customer 360, demand history, real XLSX parsing, saved views
  - Round 4 explicitly listed "Plan Comparison rich UI" (spec §47) and "Anomaly Detection view" (spec §61) as remaining items
- Existing planning API at `/api/planning/cases/[id]` returns nested versions → options → pieces. The new `/api/planning/compare/[caseId]` endpoint flattens this to a single options array with `versionNumber` back-references.
- Existing sales analysis API at `/api/analysis/sales/trend` shows the pattern for grouping by category with date windows. Anomaly endpoint reuses the lab|shape|weightBand category key.

## Files created

### APIs
1. `src/app/api/planning/compare/[caseId]/route.ts` — GET
   - Accepts Next.js 16 async params signature `params: Promise<{ caseId: string }>`
   - Loads planning case with `versions.options.pieces` (ordered), flattens options across all versions
   - Each option carries `versionNumber`, `versionStatus`, `versionReason` for back-reference
   - Computes summary KPIs: totalOptions, totalVersions, bestYield, bestCoverage, avgYield, avgCoverage, totalExpectedPieces, totalExcessPieces, withWarnings, selectedOptionCode
   - Returns the spec-defined comparison payload shape (caseId, caseCode, stoneName, stoneType, roughWeight, options[], summary{})

2. `src/app/api/analysis/anomalies/route.ts` — GET
   - Anchors "latest month" to the calendar month containing the most recent invoiced sale
   - Pulls 12 months of invoiced sales records (excluding the latest month)
   - Groups by planning category key `lab|shape|weightBandId` with a 12-month zero-filled skeleton
   - Baseline = oldest 11 months; observed = most recent month's count
   - Computes mean + std-dev over baseline; flags |z-score| > 2
   - Severity: HIGH (|z|>3), MEDIUM (|z|>2.5), LOW (|z|>2)
   - Type: SPIKE (z>2), DROP (z<-2)
   - deviation = (observed - expected) / expected
   - Resolves weightBandId → label for display
   - Returns `{ rows: [...], summary: { totalAnomalies, spikes, drops, highSeverity } }` plus window dates

### Views
3. `src/components/diamond/views/plan-comparison-view.tsx`
   - PageHeader "Plan Comparison" + subtitle
   - Case selector (shadcn Select) — fetches list from `/api/planning/cases`, shows caseCode + stoneName; auto-selects first case on load
   - InfoBanner: "OPEN rule BR-PLAN-SEL-001 — High Yield ≠ automatically best commercial plan"
   - 5-card KPI grid (icons + sparklines): Total Options (Layers/info), Best Yield (TrendingUp/success), Best Coverage (Target/info), Expected Pieces (Boxes/default), Excess Pieces (AlertTriangle/warning-or-success)
   - Comparison DataTable: 15 columns (Option Code + version, Exp Pieces, Total Wt, Yield%, Match Req, Coverage, Cov%, Non-Req, Excess, Color, Clarity, Cert Intent, Warnings, Selected, Approval). Color-coded yield (emerald≥12, sky≥8, amber≥4, rose<4) and coverage (emerald≥80, sky≥50, amber≥25, rose<25). Selected row highlighted with sky tint. Sortable, searchable, exportable CSV.
   - Top-3 detail cards (1-col mobile, 3-col desktop grid): for top-3 by yield, shows rank badge (gold/silver/bronze), option code + version, status badge, mini horizontal BarChart (yield vs coverage), 10-row attribute grid (yield, coverage, match req, coverage pcs, non-req, excess, color, clarity, cert, rough wt), validation warnings, pieces preview chips
   - Yield vs Coverage ScatterChart: X=yieldPct, Y=coveragePct, ZAxis for point size, ReferenceLine dashed, selected point in emerald with stroke, others in sky. Legend below.
   - Pieces breakdown: collapsible per option (shadcn Collapsible), shows piece-level table (sequence, code, shape, weight, color, clarity, category, cert intent, fulfilled badge)

4. `src/components/diamond/views/anomaly-detection-view.tsx`
   - PageHeader "Anomaly Detection" + subtitle, shows window dates in meta
   - InfoBanner (warning): "Advisory only. Never auto-trigger production orders based on anomalies."
   - 4-card KPI grid (icons + sparklines): Total Anomalies (AlertTriangle/warning-or-success), Spikes (TrendingUp/success), Drops (TrendingDown/critical), High Severity (AlertTriangle/critical-or-success)
   - ScatterChart: X=expected, Y=observed, ReferenceLine y=x (dashed) with label "y = x (expected)", points colored by severity (HIGH=rose, MEDIUM=amber, LOW=sky), stroke colored by type (SPIKE=emerald-dark, DROP=rose-dark). Tooltip shows category + severity + type + z-score. Legend with severity swatches.
   - Anomalies DataTable: 9 columns (Category [mono], Metric, Type [SPIKE/DROP badge with arrow icon], Observed, Expected, Deviation% [signed], Z-Score [color-coded], Severity [colored badge], Description, Recommended Action). Rows color-coded by severity (rose-tinted HIGH, amber-tinted MEDIUM, sky-tinted LOW). Sortable by zScore desc, searchable, exportable CSV.
   - Methodology section explaining the baseline / detection / classification / deviation computation

### Registry
5. `src/stores/nav-store.ts` — added `"planning-comparison"` and `"data-science-anomaly-detection"` to ViewId
6. `src/components/layout/app-shell.tsx` — added two nav items:
   - Planning group: `{ id: "planning-comparison", label: "Plan Comparison", icon: <Scale className="h-3.5 w-3.5" /> }`
   - Data Science group: `{ id: "data-science-anomaly-detection", label: "Anomaly Detection", icon: <AlertTriangle className="h-3.5 w-3.5" /> }`
7. `src/app/page.tsx` — added imports for `PlanComparisonView` + `AnomalyDetectionView`; registered both in VIEW_REGISTRY

## Verification
- `bun run lint` → exit 0, zero errors/warnings
- Dev server compiled cleanly (multiple ✓ Compiled in N ms messages, no ✗)
- API smoke tests:
  - `GET /api/planning/cases` → 200 with rows
  - `GET /api/planning/compare/{caseId}` → 200 with full flattened options array + summary block
  - `GET /api/analysis/anomalies` → 200 with detected anomalies (real seed data produced SPIKEs with z-scores up to 10.12 for GIA|Heart|3.10-3.49)
