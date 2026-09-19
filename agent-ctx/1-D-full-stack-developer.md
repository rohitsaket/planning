# Task 1-D — Admin + Data Quality + Data Science + Reports Views

Agent: full-stack-developer (Admin + DQ + DS + Reports Views)
Task: Build admin, data quality, data science, and reports view components (13 files)

## Files Written
All under `/home/z/my-project/src/components/diamond/views/`:

1. `wip-view.tsx` — WIP Analysis (BR-WIP-001 OPEN rule, eligibility flags, byStatus/byDept/byShape/byCategory tables)
2. `forecast-view.tsx` — Forecast Analysis (advisory notice, horizon KPIs, prediction table with confidence progress bar, trend/stockout badges, line chart for 30/60/90 horizon)
3. `stockout-view.tsx` — Stockout Risk Analysis (critical/high/medium KPIs, projected columns color-coded red ≤0 / amber ≤10 / green >10)
4. `data-quality-view.tsx` — Data Quality Issues (entity/severity/status filters, severity KPIs, "Blocking issues must prevent the relevant operation" InfoBanner, search + export)
5. `forecast-models-view.tsx` — Forecast Models + Runs (two tables with parsed JSON metrics MAE/WAPE/RMSE/BIAS, governance banner, metrics formula cards)
6. `reports-view.tsx` — Reports Library (5 report type cards: summary/sales-by-category/critical-requirements/yield-variance/weight-bands-config with switchable rendering)
7. `business-rules-view.tsx` — Business Rules admin (CONFIRMED/PROPOSED/OPEN/DEPRECATED KPIs, inline StatusChangeForm per row, "OPEN RULES MUST NOT BE INVENTED" InfoBanner)
8. `weight-bands-view.tsx` — Weight Bands admin (24 bands with range visualization, "Confirmed analytical scope starts at 1.00 ct" InfoBanner)
9. `lab-mappings-view.tsx` — Lab Mapping admin (raw→normalized table, confirmed GIA mapping rule InfoBanner)
10. `shape-mappings-view.tsx` — Shape Mapping admin (searchable table, trimmed/case-insensitive comparison InfoBanner)
11. `audit-log-view.tsx` — Audit Log (entity/action/actor filters, append-only InfoBanner, search + export)
12. `feature-flags-view.tsx` — Feature Flags admin (Switch toggle per flag with mutation + toast + query invalidation, OPEN rules InfoBanner for FF_COLOR_DIMENSION/CLARITY/TREATMENT/FORECAST_AUTO_ORDER/PLANNER_SELF_APPROVE/TRANSFER_AUTO)
13. `users-view.tsx` — Users & Roles (15 suggested role badges, 16 granular permissions, placeholder users table empty state)

## Patterns Used
- All views `"use client"`, wrapped in `<div className="flex flex-col gap-3 p-3">`
- Each starts with `<PageHeader title="..." subtitle="..." />`
- Shared components: `KpiCard`, `DataTable`, `Section`, `PageHeader`, `StatusBadge`, `Badge`, `Pill`, `EmptyState`, `InfoBanner`, `Metric`, `NumberCell`, `Money`
- API client: `useApi<T>(url)`, `apiPost<T>(url, body)`
- Mutations: `useMutation` + `useQueryClient` invalidateQueries + `sonner` toast
- `DataTable` features used: `searchable`, `searchFn`, `exportable`, `exportFilename`, `sortable`, `sortValue`, `sticky`, `align`, `maxHeight`
- `recharts` LineChart for forecast predictions
- `Progress` (shadcn) for forecast confidence
- `Switch` (shadcn) for feature flag toggles
- `Select`, `Input` (shadcn) for filters

## Lint Status
- All 13 view files pass `eslint` with zero errors / zero warnings (verified via `npx eslint src/components/diamond/views/` — exit 0)
- Removed unused imports during cleanup: `Boxes/Layers/Shapes/Tag` (wip), `TrendingUp/AlertTriangle/Brain/Calendar` (forecast), `apiFetch/FileSpreadsheet` (reports), `UsersIcon/EmptyState` (users), `severityVariant` (data-quality)
- Pre-existing lint error in `src/components/layout/app-shell.tsx:303` (`react-hooks/set-state-in-effect`) is from Task 0's theme-toggle and is NOT introduced by Task 1-D — left untouched

## Stage Summary
- 13 view components complete and lint-clean
- All views follow the established style from `dashboard-view.tsx`
- All InfoBanners carry the required OPEN rule / governance text verbatim
- All mutations (business rules status change, feature flag toggle) write audit entries through existing API routes
- Reports view supports all 5 required report types with switchable rendering
- Users view is a properly-marked stub noting IdP integration requirement
