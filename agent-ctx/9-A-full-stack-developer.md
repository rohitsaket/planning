# Task 9-A — Mobile Fixes (Yield Prediction) + Plan Comparison Auto-Select + Sparkline Wiring

## Files Edited
1. `src/components/diamond/views/yield-prediction-view.tsx` — mobile KPI stacking + overflow-x-auto wrappers
2. `src/components/diamond/views/plan-comparison-view.tsx` — auto-select latest case + Latest badge
3. `src/components/diamond/views/sales-analysis-view.tsx` — verified (already real-data sparklines)
4. `src/components/diamond/views/customers-view.tsx` — added top-level KPI grid with real-data sparklines
5. `src/components/diamond/views/orders-view.tsx` — wired Open Orders + Overdue Orders sparklines to real data

## Task 1 — Yield Prediction Mobile KPI Stacking
- KPI grid changed from `grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2`. On a 375px phone the KPI cards now stack into a single column with much larger touch targets and font sizes.
- Methodology 3-card grid and 4-card grid now both carry `overflow-x-auto` so any narrow content scrolls horizontally instead of wrapping awkwardly.
- Historical Plan-vs-Actual chart (`ComposedChart`) wrapped with `overflow-x-auto` outer + `min-w-[600px]` inner — chart now scrolls horizontally on phones when many reconciliations squeeze bars together.
- Prediction Interval chart (`BarChart` with `ErrorBar`) given the same treatment so the ±1σ error bars and angled X-axis labels remain readable on mobile.
- Predictions + Historical tables already inherit horizontal scroll via the shared `DataTable` component (`overflow-auto h-full`), so no further work needed there.

## Task 2 — Plan Comparison Auto-Select Latest Case
- Replaced `const effectiveCaseId = selectedCaseId ?? caseList[0]?.id ?? null;` with a `useMemo`-based `latestCase` that sorts `caseList` client-side by `planningDate || updatedAt` descending and picks the first. Falls back to first case naturally if no dates present.
- Added `updatedAt?: string` to the `CaseListItem` interface for forward-compat — the `/api/planning/cases` route currently returns only `planningDate` (server already sorts desc by `planningDate`), but the client sort guarantees correctness even if the server ordering changes.
- Added a small `<Badge variant="info">` with a `Clock` icon and "Latest" text next to the most-recent case in the dropdown (`SelectItem`). The badge appears for the case that matches `latestCase?.id`, making the auto-selected entry visible at a glance.
- Added `Clock` to the `lucide-react` imports.

## Task 3 — Wire Sparklines to Real Data

### 3a. sales-analysis-view.tsx — VERIFIED, no change
- KPI sparklines already derive from real data via `rows.slice(0, 7).map(r => r.pieces|carats|value)` (lines 67-81 of the file). No edits required.

### 3b. customers-view.tsx — ADDED top-level KPI grid
- The main `CustomersView` previously had no top-level KPI cards (only the detail dialog had KPIs, and those already used real timeline data). Added a 4-card KPI grid above the customers table.
- Each sparkline derives 7 points from the top 7 customers (sorted by `totalValue` descending):
  - **Total Customers** → `r.pieces` of top 7 customers
  - **Total Value** → `r.totalValue` of top 7 customers
  - **Total Carats** → `r.carats` of top 7 customers
  - **Memo Exposure** → `r.memoExposure` of top 7 customers
- Synthetic fallback array `[3, 5, 4, 6, 8, 7, 9]` used when no customer rows exist.
- Grid uses `grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2` for responsive single-column on phones (same pattern as yield-prediction fix).
- Added `totalCaratsAll` aggregator (existing `totalPieces`, `totalValue`, `totalMemo` reused).

### 3c. orders-view.tsx — wired Open + Overdue sparklines
- Previously only **Outstanding Qty** and **Backorder Qty** had sparklines (real data). Added:
  - **Open Orders** → counts orders grouped by `status`, takes top 7 status counts. Synthetic fallback `[3,5,4,6,8,7,9]`.
  - **Overdue Orders** → takes `qtyOutstanding` of the top 7 overdue orders (overdue-volume proxy). Synthetic fallback `[2,3,4,2,5,3,4]`.
- Grid upgraded from `grid-cols-2 md:grid-cols-4` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2` so KPIs stack on phones.

## Verification
- `bun run lint` passes cleanly (0 errors, 0 warnings).
- Dev server compiles without errors — `/api/analysis/demand-trace` and `/` continue to return 200.

## Patterns Used
- Real-data sparkline pattern (matches dashboard-view.tsx):
  ```tsx
  const sparkline = useMemo(() => {
    if (rows.length === 0) return [3,5,4,6,8,7,9]; // synthetic fallback
    const slice = rows.slice(0, 7).map(r => r.field);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length-1] : 0);
    return slice;
  }, [rows]);
  ```
- Mobile-first KPI grid: `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-N gap-2`
- Chart mobile horizontal scroll: `<div className="h-80 overflow-x-auto"><div className="h-full min-w-[600px]">{chart}</div></div>`
