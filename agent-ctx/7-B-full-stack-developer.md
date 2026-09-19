# Task 7-B — Stockout Projection Chart + WIP Pipeline Viz + Apply Skeletons

## Files Edited
1. `src/components/diamond/views/dashboard-view.tsx` — added PageSkeleton (isLoading && !kpi) + KpiGridSkeleton fallbacks per KPI group
2. `src/components/diamond/views/requirements-matrix-view.tsx` — TableSkeleton (rows=10, cols=8) replaces DataTable while loading
3. `src/components/diamond/views/planning-workbench-view.tsx` — TableSkeleton (rows=5, cols=4) in each of 3 panels while loading
4. `src/components/diamond/views/plan-comparison-view.tsx` — TableSkeleton (rows=6, cols=8) + ChartSkeleton between case selector and data block while loading
5. `src/components/diamond/views/anomaly-detection-view.tsx` — KpiGridSkeleton (count=4) + ChartSkeleton + TableSkeleton (rows=6, cols=7) while loading
6. `src/components/diamond/views/yield-prediction-view.tsx` — KpiGridSkeleton (count=6) + ChartSkeleton + TableSkeleton (rows=5, cols=8) while loading
7. `src/components/diamond/views/stockout-view.tsx` — added ComposedChart with Bar+Line+ReferenceLine for top-8 risk categories, color-coded by stockoutRisk, with zero-line and reorder-threshold (y=5) reference lines; also added loading skeleton branch
8. `src/components/diamond/views/wip-view.tsx` — added 4-stage horizontal WIP pipeline (Approved Plans → Pieces in WIP → Expected Output → Actual Output) with icons, proportional bars, ChevronRight connectors, and BR-WIP-001 OPEN-rule legend

## Verification
- `bun run lint` passes cleanly (0 errors, 0 warnings)
- Dev server compiles successfully; existing dashboard view shows GET / 200 responses

## Patterns Used
- `import { KpiGridSkeleton, TableSkeleton, ChartSkeleton, PageSkeleton } from "@/components/diamond/shared/skeleton";`
- Conditional: `{isLoading && !data ? <Skeleton…/> : <RealContent/>}`
- For full-page wrap: `if (isLoading && !kpi) return <PageSkeleton …/>` followed by `<>…</>`
