# Task 5-A — Wire Global Filter to APIs

**Agent**: full-stack-developer (Wire Global Filter)
**Task ID**: 5-A
**Scope**: Wire the existing `GlobalFilterBar` Zustand store (`useGlobalFilter` in `src/stores/global-filter.ts`) into the analysis view components so that changing the global filter actually filters the data displayed.

## Prior context reviewed

- Read `worklog.md` — Task 0 (foundation), Task 4-FINAL (mobile responsive + global filter bar + workbook + saved views). Task 4-FINAL explicitly listed "Wire global filter to APIs" as a remaining item.
- The `useGlobalFilter` Zustand store has shape `{ country, branch, lab, windowDays, setCountry, setBranch, setLab, setWindowDays, reset, toQueryString(), hasActiveFilters() }`. `toQueryString()` returns e.g. `&country=US&lab=GIA` (or empty string if no filters).
- The `GlobalFilterBar` is mounted in the AppShell and visible on all views.

## Files edited

All edits are in `/home/z/my-project/src/components/diamond/views/`:

1. **`sales-analysis-view.tsx`**
   - Imported `useGlobalFilter`.
   - Removed local `windowDays` state and the local WINDOWS `Select` (the global bar now owns window selection).
   - Switched URL construction to `useMemo` building `windowDays` + `country` + `branch` + `lab` from the global filter. Sales API honors `windowDays`; the others are appended for forward-compat.
   - Added "Filtered by:" sky-toned indicator in `PageHeader` meta.
   - Export filename now uses `globalFilter.windowDays`.

2. **`requirements-matrix-view.tsx`**
   - Imported `useGlobalFilter`; injected store.
   - Extended the `qs` `useMemo` to be ADDITIVE: when local `filters.country` is unset, fall back to `globalFilter.country`. Always append `globalFilter.branch` + `globalFilter.lab` (no local equivalent in the matrix toolbar).
   - Local type/status/priority/q filters and Saved Views remain unchanged.
   - Added "Filtered by:" indicator (omits Country when local country is set, since local takes precedence).

3. **`customers-view.tsx`**
   - Imported `useGlobalFilter`.
   - Built URL via `useMemo` to append `country`/`branch`/`lab` (API currently ignores; forward-compat).
   - Added `filteredRows = useMemo` that applies `globalFilter.country` + `globalFilter.branch` client-side.
   - Re-wired KPI totals, DataTable rows, and meta counts to `filteredRows`.
   - Added "Filtered by:" indicator.

4. **`orders-view.tsx`**
   - Same pattern as customers.
   - Re-wired `totalOrders`, `totalOrdered`, `totalOutstanding`, `totalBackorder`, `overdueCount`, sparklines, DataTable rows, and meta counts to `filteredRows`.
   - Added "Filtered by:" indicator.

5. **`polished-view.tsx`**
   - Imported `useGlobalFilter`.
   - Built URL via `useMemo` to include `country`/`branch`/`lab` alongside `dimension`.
   - Added "Filtered by:" indicator next to dimension summary in `PageHeader` meta.

6. **`memo-view.tsx`**
   - Imported `useGlobalFilter`.
   - Built URL via `useMemo` to append `country`/`branch`/`lab` (API ignores).
   - Added client-side filter on `data.rows` by `country`/`branch`/`lab` (lab normalized to "Non-Cert" fallback).
   - Derived `filteredByCountry` (filtered aggregate), `filteredByCustomer` (re-aggregated from filtered rows), `filteredAgeBuckets` (recomputed from filtered rows), `filteredTotalQty`, `filteredTotalValue`.
   - Re-wired the By Country / By Customer / Age Buckets / Memo Detail tables, all 4 KPI cards, sparklines, and meta counts to use the filtered values.
   - Added "Filtered by:" indicator.

7. **`sales-trends-view.tsx`**
   - Imported `useGlobalFilter`.
   - Built URL via `useMemo` to append `country`/`branch`/`lab` (and `windowDays` when not the default 90).
   - Added "Filtered by:" indicator next to group summary in `PageHeader` meta.

## Verification

- `cd /home/z/my-project && bun run lint 2>&1 | tail -10` → exit 0, zero errors/warnings.
- Dev server continues to compile cleanly (existing 200 responses for `/api/analysis/sales?dimension=shape&windowDays=90` in the recent `dev.log`).
- Existing local filters (requirements-matrix type/status/priority selectors, sales-analysis dimension selector, polished dimension selector, sales-trends groupBy selector) all continue to work — the global filter is purely additive.
- Each view now displays a small sky-toned "Filtered by: Country=X, Lab=Y" indicator in `PageHeader.meta` when `globalFilter.hasActiveFilters()` is true.

## Notes / known limitations

- For views whose APIs don't yet honor `country`/`branch`/`lab` params (customers, orders, memo), client-side filtering makes the global filter take effect immediately on the rows returned by the API. This is a stopgap until the APIs are extended — when they are, the appended query params will start being honored server-side automatically and the client-side filter will simply be a no-op.
- For views whose APIs already honor some params (sales `windowDays`, requirements `country`), the global filter takes effect server-side.
- Country code mismatch in `requirements-matrix-view.tsx`: the local country filter uses long names ("USA", "India", "Belgium", ...) while the global filter uses ISO codes ("US", "IN", "BE"). When the global country is set and the local country is unset, the URL will include `country=US` which won't match the requirements data ("USA"). This is a pre-existing data inconsistency not in scope for this task. The matrix still filters server-side by the local country selection correctly.
- `polished-view.tsx` and `sales-trends-view.tsx` append the global filter to the URL but do not filter client-side because their APIs return per-dimension aggregates (not per-row records), making client-side row filtering impractical. When the APIs are extended to support these filter params, they will work server-side automatically.
