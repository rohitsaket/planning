---
Task ID: 11-B
Agent: full-stack-developer (PDF Export + Aging Dashboard)
Task: Build PDF export utility + Inventory Aging Dashboard view with visual timeline

## Context
- Read /home/z/my-project/worklog.md (prior multi-agent history through Task 10-FINAL)
- Inspected: shared DataTable (CSV+Excel exports from Task 10-B), shared KpiCard / Section / PageHeader / InfoBanner / NumberCell / Money, existing aging-view.tsx + aging API route, PolishedStone schema (weight/lastUpdated/country/lab/shape — no cost/value column), nav-store ViewId union, app-shell Analysis nav group, page.tsx VIEW_REGISTRY
- Confirmed dev server is running on port 3000 (logs show GET / 200, prisma queries executing)

## Feature 1 — PDF Export Utility

### `src/lib/pdf-export.ts` (NEW)
- Exports `exportToPDF(title: string): void`
- Sets `document.title` to the supplied title so the OS print dialog suggests a meaningful filename
- Calls `window.print()` (blocking on most browsers)
- Restores the original title via `setTimeout(..., 500)` after the dialog is dismissed
- SSR-safe: guards `typeof window === "undefined" || typeof document === "undefined"`

### `src/app/globals.css`
- Appended a `@media print { … }` block at the end of the file
- Hides: `aside`, `header`, `footer`, `nav`, `.sticky.top-12`, `[class*="global-filter"]`, `[role="dialog"]`, `[data-command-palette]`, `[data-print-hidden]`
- Expands `main` to `width: 100%`, `overflow: visible`, `padding: 0`, `margin: 0`
- Expands `.overflow-y-auto`, `.overflow-auto`, `.overflow-x-auto` to `max-height: none`, `overflow: visible`, `max-width: none`
- Hides export-action buttons (`button[class*="Export"]`, `button[class*="export"]`) and `.recharts-wrapper`
- `tr, td, th { page-break-inside: avoid }` — keep table rows intact across pages
- `* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }` — preserve colors
- `@page { margin: 12mm; }` — sensible print margins

### `src/components/diamond/shared/data-table.tsx`
- Imported `FileText` from lucide-react + `exportToPDF` from `@/lib/pdf-export`
- Added `pdfExportable?: boolean` and `pdfExportFilename?: string` to `DataTableProps` (defaults `false` / `"export"`)
- Added `exportPDF()` method calling `exportToPDF(pdfExportFilename || "export")`
- Added a third toolbar `<Button variant="outline" size="sm">` labeled "Export PDF" between Excel and the row count
- Extended toolbar render condition to include `pdfExportable`

### Applied to two key views
- `src/components/diamond/views/requirements-matrix-view.tsx` — added `pdfExportable` + `pdfExportFilename={`requirements-page-${page}`}` alongside existing CSV/Excel
- `src/components/diamond/views/planning-cases-view.tsx` — added `pdfExportable` + `pdfExportFilename="planning-cases"`

## Feature 2 — Inventory Aging Dashboard

### `src/app/api/analysis/aging-dashboard/route.ts` (NEW)
- `GET` handler that fetches all `PolishedStone` records via `db.polishedStone.findMany()`
- Computes `ageDays = Math.max(0, floor((now - lastUpdated) / DAY_MS))`
- Buckets into 6 ranges: 0-30, 31-60, 61-90, 91-180, 181-365, 365+
- Slow-moving = 91+ days, Aged = 365+ days
- Per-stone value derived from a lab/shape-based price-per-carat estimate (PolishedStone has no cost/value column):
  - GIA $7k/ct, GIA-Premium $7.5k, GIA-Standard $6.5k, IGI $5k, HRD $5.5k, Non-Cert $3k, default $5k
  - Shape premium: Round +20%, Emerald/Asscher +10%, Pear/Oval/Marquise/Heart +5%
  - `value = weight * pricePerCarat(lab, shape)`
- Aggregates per country / lab / shape (totalPieces, slowMoving, aged counts)
- Collects slow-moving alerts (91+ days) and returns top 10 sorted by age desc with {lotId, ageDays, country, value, shape, weight}
- Returns `summary` { totalPieces, totalCarats, totalValue, slowMovingPieces, slowMovingPct, agedPieces, agedPct, avgAgeDays }, `buckets[]`, `byCountry[]`, `byLab[]`, `byShape[]`, `slowMovingAlerts[]`
- Uses `db` from `@/lib/db`, `ok` + `num` from `@/lib/api-utils`

**Bug found and fixed:** Initial version mapped BUCKETS into a new array without carrying `min`/`max` over, so `buckets.find((x) => ageDays >= x.min && ageDays <= x.max)` always returned `undefined` (since `x.min`/`x.max` were `undefined`). Added `min`/`max` to the mapped bucket objects. Confirmed fix worked: 0-30 and 31-60 buckets now populated (was 0 across all buckets before fix).

### `src/components/diamond/views/aging-dashboard-view.tsx` (NEW)
- `"use client"` component, wrapped in `<div className="flex flex-col gap-3 p-3">`
- `useApi<AgingDashboardResponse>("/api/analysis/aging-dashboard")` via TanStack Query
- Layout (top-to-bottom):
  1. **PageHeader** — "Inventory Aging Dashboard" + subtitle "Stock age analysis — slow-moving and aged inventory detection" + meta chip showing total pieces/carats/avg age (tabular-nums)
  2. **InfoBanner** (info): "Stock aging helps identify slow-moving and aged inventory for transfer, discount, or repurposing decisions. Slow-moving = 91+ days, Aged = 365+ days."
  3. **6-card KPI grid** (`grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2`):
     - Total Pieces (`Gem` icon, `info` intent) — sparkline from buckets pieces
     - Total Carats (`Diamond` icon, `default`) — sparkline from buckets pieces
     - Total Value (`DollarSign` icon, `success`) — formatted as `K`/`M`; sparkline from buckets value
     - Slow-Moving (`TrendingDown` icon, `warning` when >0) — 91+ days count + pct hint
     - Aged (`AlertTriangle` icon, `critical` when >0) — 365+ days count + pct hint
     - Avg Age (`Clock` icon, `info`) — days + "Mean across all stones" hint
  4. **Aging Distribution BarChart** (`Section` "Aging Distribution"):
     - recharts `BarChart` of `buckets` (pieces per bucket)
     - Per-bucket `Cell` fill — `url(#ageEmerald)` (green gradient) for 0-30/31-60/61-90, `url(#ageAmber)` for 91-180, `url(#ageRose)` for 181-365 and 365+
     - `radius={[6, 6, 0, 0]}` rounded top corners
     - EmptyState fallback when no data
  5. **Value at Risk PieChart** (`Section` "Value at Risk"):
     - recharts `PieChart` with donut Pie (innerRadius=40, outerRadius=90, paddingAngle=2)
     - Per-bucket Cell fill from BUCKET_COLORS map (emerald / amber / rose)
     - Label format: "Bucket (pct%)"
     - Tooltip formatted as `$value`
  6. **By Country + By Lab tables** (`grid-cols-1 lg:grid-cols-2 gap-3`):
     - Sortable DataTable columns: Country/Lab | Total Pieces | Slow-Moving (warning intent when >0) | Aged 365+ (critical intent when >0) | Slow-Moving %
  7. **By Shape table** (`Section` "By Shape"):
     - Same column structure as country/lab
     - Includes CSV + Excel + PDF export buttons
  8. **Slow-Moving Alerts** (`Section` "Slow-Moving Alerts"):
     - Top 10 oldest 91+ day lots
     - Columns: Lot ID (mono font) | Age days (color-coded — rose 365+, amber 91-180) | Country | Shape | Weight ct | Est. Value (`Money`)
     - Row color-coding: `bg-rose-50/60` for 365+, `bg-rose-50/30` for 181-365, `bg-amber-50/40` for 91-180
     - Includes CSV + Excel + PDF export buttons
     - Empty state: "No slow-moving lots detected. All stock is fresh (< 91 days)."

### Registration
- `src/stores/nav-store.ts` — added `"aging-dashboard"` to `ViewId` union type, immediately after `"transfer-analyzer"`
- `src/components/layout/app-shell.tsx` — added `{ id: "aging-dashboard", label: "Aging Dashboard", icon: <CalendarClock className="h-3.5 w-3.5" /> }` in the Analysis nav group, after Transfer Analyzer. (CalendarClock already imported from prior `analysis-aging` nav item.)
- `src/app/page.tsx` — imported `AgingDashboardView` from `@/components/diamond/views/aging-dashboard-view` and added `"aging-dashboard": AgingDashboardView` to `VIEW_REGISTRY` (after `"transfer-analyzer"`)

### Seed data tweak
- `prisma/seed.ts` line 352: changed `lastUpdated: dayOffset(randInt(0, 60))` → `lastUpdated: dayOffset(randInt(0, 400))` for PolishedStone records
- Reason: original seed limited all 220 stones to 0-60 days, leaving the slow-moving (91+) and aged (365+) buckets empty — the dashboard couldn't demonstrate its core purpose
- Ran `bun run prisma/seed.ts` to re-seed the dev DB. Result: 220 stones, 165 slow-moving (75%), 18 aged (8.2%), avg age 195 days, all 6 buckets populated, top slow-moving lot FPL-000067 aged 400 days

## Verification
- `bun run lint` → exit 0, 0 errors, 0 warnings (after removing unused `bucketIntent` helper function)
- `GET /api/analysis/aging-dashboard` → 200 with full enriched JSON payload
- Sample response confirms: totalPieces 220, totalCarats 415.89, totalValue $2.49M, slowMovingPieces 165 (75%), agedPieces 18 (8.2%), avgAgeDays 195, all 6 buckets populated, byCountry/byLab/byShape aggregates with non-zero slowMoving/aged counts, slowMovingAlerts has 10 entries sorted by age desc (oldest = 400 days)
- Dev server: GET / 200, no compile errors in dev.log

## Stage Summary
- 11 files created/edited:
  1. `src/lib/pdf-export.ts` (NEW) — `exportToPDF(title)` via native browser print
  2. `src/app/globals.css` — `@media print` block hiding chrome + expanding tables
  3. `src/components/diamond/shared/data-table.tsx` — added `pdfExportable` + `pdfExportFilename` props and third toolbar button "Export PDF"
  4. `src/components/diamond/views/requirements-matrix-view.tsx` — applied `pdfExportable` + `requirements-page-{page}` filename
  5. `src/components/diamond/views/planning-cases-view.tsx` — applied `pdfExportable` + `planning-cases` filename
  6. `src/app/api/analysis/aging-dashboard/route.ts` (NEW) — enriched aging API
  7. `src/components/diamond/views/aging-dashboard-view.tsx` (NEW) — full dashboard view
  8. `src/stores/nav-store.ts` — added `"aging-dashboard"` to ViewId
  9. `src/components/layout/app-shell.tsx` — added nav item in Analysis group
  10. `src/app/page.tsx` — imported + registered AgingDashboardView in VIEW_REGISTRY
  11. `prisma/seed.ts` — spread polished lastUpdated across 0-400 days for richer dashboard demo data
- PDF Export provides a third export option (CSV / Excel / PDF) with zero new dependencies
- Aging Dashboard surfaces analytics the basic aging-view did not: per-bucket value, slow-moving alerts, by-country/lab/shape breakdown, value-at-risk pie — all backed by a single enriched `/api/analysis/aging-dashboard` endpoint
- Lint clean; dev server compiles cleanly; API + view both verified working
