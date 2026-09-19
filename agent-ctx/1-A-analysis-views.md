# Task 1-A — Analysis Views Batch

Agent: full-stack-developer (Analysis Views)

## What was done
Built 9 analysis view components under `src/components/diamond/views/`:
1. `sales-analysis-view.tsx` — Sales Analysis with dimension selector (10 dimensions) + window selector (7/30/60/90/180/365D), 3 KPIs (Pieces/Carats/Value), top-12 bar chart, sortable DataTable with mix %
2. `sales-trends-view.tsx` — Sales Trend Analysis with groupBy selector (shape/lab/weightBand/category), table with prev30/mid30/latest30/total90/total180/total365/trend badge/pctChange, ComposedChart (3 bars)
3. `customers-view.tsx` — Customer 360 with search + export, 13-column table, click-row opens detail Dialog with priority reason + buying breakdown + memo exposure
4. `orders-view.tsx` — Order Analysis, 12 columns, rose tint on overdue rows, status + priority badges, search + export + pagination
5. `country-view.tsx` — Country/Branch with InfoBanner (OPEN transfer rule), 6 KPIs (global aggregates), horizontal stacked bar chart, country DataTable
6. `polished-view.tsx` — Polished Stock with 8-dimension selector, totalPieces/totalCarats/distinct KPIs, aging buckets bar chart, dimension DataTable
7. `memo-view.tsx` — Memo with InfoBanner (does NOT reduce shortage), 4 KPIs, byCountry/byCustomer side-by-side tables, age buckets bar chart, full memo detail table (14 columns, pagination)
8. `excess-view.tsx` — Excess with InfoBanner (does NOT change shortage formula), 3 KPIs, bar chart (excess/available/target), category DataTable
9. `aging-view.tsx` — Stock Aging with 4 KPIs (Pieces/Carats/SlowMoving/SlowMoving%), aging bucket bar chart, bucket DataTable with % of pieces

## API contracts used
- `GET /api/analysis/sales?dimension=X&windowDays=Y` → `{ dimension, windowDays, totalPieces, totalValue, rows[{dimension,pieces,carats,value,avgPerCt,pct}] }`
- `GET /api/analysis/sales/trend?groupBy=X` → `{ groupBy, rows[{key,prev30,mid30,latest30,total90,total180,total365,trend,pctChange}] }`
- `GET /api/analysis/customers` → `{ rows[{id,customerCode,name,country,branch,accountOwner,businessPriority,priorityReason,pieces,carats,totalValue,avgPerCt,openOrders,memoExposure,lastPurchase}] }`
- `GET /api/analysis/orders` → `{ rows[{id,orderNumber,customerName,orderDate,requiredDate,promisedDate,status,priority,priorityReason,lines,qtyOrdered,qtyOutstanding,backorderQty,country,branch}] }`
- `GET /api/analysis/countries` → `{ rows[{country,physicalShortage,target,available,excess,wip,planCov,transferCandidates}], global:{target,available,shortage,excess,wip,planCov} }`
- `GET /api/analysis/polished?dimension=X` → `{ totalPieces, totalCarats, dimension, rows[{dimension,pieces,carats,value}], aging:{0-30,31-60,61-90,91-180,181-365,365+} }`
- `GET /api/analysis/memo` → `{ totalQty, totalValue, byCountry[{dimension,qty,value,avgAge}], byCustomer[...], ageBuckets:{0-30,31-60,61-90,91-180,180+}, rows[{id,lotId,memoDate,customerName,country,branch,shape,weight,lab,color,clarity,treatment,memoValueUsd,status,memoAgeDays}] }`
- `GET /api/analysis/excess` → `{ rows[{category,excessQty,available,target,shortage}], totalExcess, warning }`
- `GET /api/analysis/aging` → `{ buckets[{label,pieces,carats}], slowMoving, slowMovingPct }`

## Shared components used
- `KpiCard`, `PageHeader`/`Section`, `DataTable`/`Column`, `StatusBadge`/`Badge`, `EmptyState`/`InfoBanner`/`Money`/`NumberCell`

## Verification
- `npx eslint` on all 9 view files → 0 errors
- `bun run lint` → only pre-existing error in `app-shell.tsx:303` (from Task 0 — outside this batch's scope)
- All 9 files use "use client", wrap in `flex flex-col gap-3 p-3`, start with `PageHeader`, use `text-xs`/`text-[10px]` for compact enterprise ERP styling, use `tabular-nums` for numeric cells, use `StatusBadge` for statuses, `Badge` for priorities.

## Issues encountered
- The 9 `/api/analysis/*` endpoints currently return HTTP 500, but this is because `src/app/page.tsx` fails to compile due to missing view files from FUTURE agents (e.g., `planning-cases-view`, `planning-workbench-view`, `fantasy-polished-view`, `workbook-import-view`). Once those agents deliver their files, page.tsx will compile and the analysis APIs will return 200 (they returned 200 in the earlier dev.log segment when only DashboardView was imported).
- The 1 lint error in `app-shell.tsx:303` is from Task 0 (main scaffolding agent) — `useEffect(() => setMounted(true), [])` triggers `react-hooks/set-state-in-effect` rule. This is outside the Analysis Views batch's scope and was not introduced by this batch.
