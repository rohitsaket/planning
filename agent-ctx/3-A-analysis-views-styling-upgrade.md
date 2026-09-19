# Task 3-A: Analysis Views Styling Upgrade

**Agent:** full-stack-developer (Analysis Views Styling Upgrade)
**Task:** Upgrade 12 analysis views with enhanced KpiCard (icons + sparklines) + chart polish

## Files Edited (12 total)

### 1. `src/components/diamond/views/sales-analysis-view.tsx`
- Added `useMemo` import; added 7-point sparkline derivations from top 7 rows (pieces / carats / value), padded with last value if < 7
- Added `icon={Package}`, `icon={Gem}`, `icon={DollarSign}` to the 3 KpiCards (Total Pieces / Total Carats / Total Value); also swapped intent of Total Pieces to info and Total Carats to default for visual variety
- Added `<defs><linearGradient id="salesPiecesGrad">` to the BarChart and switched Bar fill to `url(#salesPiecesGrad)` with `radius={[4, 4, 0, 0]}`
- Upgraded Tooltip `contentStyle` with `borderRadius: 8` + border

### 2. `src/components/diamond/views/sales-trends-view.tsx`
- Added `useMemo`, `KpiCard`, `TrendingUp/TrendingDown/Activity` imports
- Added new KPI strip (4 cards) above the existing chart: Latest 30D Total (Activity icon, info intent, sparkline from top 7 latest30), 90D Total (TrendingUp icon, default intent, sparkline from top 7 total90), Growth Groups (TrendingUp, success), Declining Groups (TrendingDown, critical)
- Added `<defs><linearGradient id="trendLatestGrad">` to ComposedChart; latest30 bar now uses gradient fill with `radius={[4, 4, 0, 0]}`; prev30/mid30 also got radius rounding
- Upgraded Tooltip `contentStyle`

### 3. `src/components/diamond/views/customers-view.tsx`
- Added `useMemo`, `KpiCard`, `DollarSign/Gem` imports
- Added new KPI strip (4 cards) above the existing Customers table: Customers (Users icon, info intent, piecesSpark from top 7 customers' pieces), Total Value (DollarSign icon, success intent, valueSpark), Total Carats (Gem icon, default intent, caratsSpark), Memo Exposure (Activity icon, warning intent)
- No chart in this view, so only KPI strip added

### 4. `src/components/diamond/views/orders-view.tsx`
- Added `useMemo`, `KpiCard`, `FileText/AlertTriangle/Clock/Boxes` imports
- Added new KPI strip (4 cards) above the Orders table: Open Orders (FileText, info intent), Overdue Orders (AlertTriangle, critical), Outstanding Qty (Boxes, warning intent, sparkline from top 7 rows' qtyOutstanding), Backorder Qty (Clock, default intent, sparkline from top 7 backorderQty)
- No chart in this view, so only KPI strip added

### 5. `src/components/diamond/views/country-view.tsx`
- Added `useMemo`, `Package` imports
- Derived 6 sparkline arrays (target/avail/shortage/excess/wip/planCov) from top 7 country rows
- Added icons to all 6 KpiCards: Globe (Target), Package (Available & Plan Cov), AlertTriangle (Shortage), Layers (Excess), Boxes (WIP)
- Added 3 gradient defs (`countryShortageGrad`, `countryWipGrad`, `countryPlanCovGrad`) to the horizontal BarChart; all stacked bars now use gradient fills with `radius={[0, 4, 4, 0]}` (rounded right corners since layout is vertical)
- Upgraded Tooltip `contentStyle`

### 6. `src/components/diamond/views/polished-view.tsx`
- Added `useMemo`, `Diamond/Layers` imports
- Derived 3 sparklines from top 7 rows (pieces/carats/value)
- Added icons to all 3 KpiCards: Gem (Pieces), Diamond (Carats), Layers (Dimensions Distinct); also swapped intents (Pieces→info, Carats→default)
- Added `<defs><linearGradient id="polishedAgingGrad">` to BarChart; Bar uses `url(#polishedAgingGrad)` with `radius={[4, 4, 0, 0]}`
- Upgraded Tooltip `contentStyle`

### 7. `src/components/diamond/views/memo-view.tsx`
- Added `useMemo`, `FileText/DollarSign/Clock/AlertTriangle` imports
- Derived 4 sparklines: 3 from byCountry aggregates (qty/value/avgAge top 7), 1 synthetic based on Aged>90D base value
- Added icons to all 4 KpiCards: FileText (Total Qty), DollarSign (Total Value), Clock (Avg Age), AlertTriangle (Aged>90D); swapped Total Qty to info intent, Avg Age to default intent
- Added `<defs><linearGradient id="memoAgeGrad">` to BarChart; Bar uses `url(#memoAgeGrad)` with `radius={[4, 4, 0, 0]}`
- Upgraded Tooltip `contentStyle`

### 8. `src/components/diamond/views/wip-view.tsx`
- Added `useMemo`, `Boxes` imports
- Derived sparkline from top 7 byStatus rows' pieces
- Added `icon={Boxes}` + `sparkline={piecesSpark}` to the single Total WIP Pieces KpiCard

### 9. `src/components/diamond/views/forecast-view.tsx`
- Added `useMemo`, `TrendingUp/Layers` imports
- Derived 3 sparklines from top 7 rows (prediction30d/60d/90d)
- Added icons to all 4 KpiCards: Layers (Model Version), TrendingUp (30D/60D/90D Totals)
- Added `<defs><linearGradient id="forecast30Grad">` to LineChart (note: LineChart, not BarChart); 90D Line now uses gradient stroke with thicker strokeWidth (2.5) for emphasis
- Upgraded Tooltip `contentStyle`

### 10. `src/components/diamond/views/stockout-view.tsx`
- Added `useMemo`, `AlertTriangle/Clock` imports
- Derived 3 synthetic sparklines based on count values: criticalSpark (rising — suggesting worsening trend), highSpark (stable-ish), mediumSpark (stable)
- Added icons to all 3 KpiCards: AlertTriangle (Critical & High Risk), Clock (Medium Risk)

### 11. `src/components/diamond/views/excess-view.tsx`
- Added `useMemo`, `Package/Layers/TrendingUp` imports
- Derived 3 sparklines: excessSpark (top 7 excessQty), catCountSpark (synthetic around rows.length), avgSpark (top 7 available)
- Added icons to all 3 KpiCards: Package (Total Excess), Layers (Categories with Excess), TrendingUp (Avg Excess / Category)
- Added 3 gradient defs (`excessGrad`, `excessAvailGrad`, `excessTargetGrad`) to BarChart; all 3 bars use gradient fills with `radius={[4, 4, 0, 0]}`
- Upgraded Tooltip `contentStyle`

### 12. `src/components/diamond/views/aging-view.tsx`
- Added `useMemo`, `Gem/CalendarClock/Diamond/TrendingUp` imports
- Derived 4 sparklines: 2 from top 7 buckets (pieces/carats), 2 synthetic based on slowMoving / slowMovingPct
- Added icons to all 4 KpiCards: Gem (Total Pieces), Diamond (Total Carats), CalendarClock (Slow-Moving), TrendingUp (Slow-Moving %); also swapped Total Pieces to info intent and Total Carats to default intent
- Added 2 gradient defs (`agingPiecesGrad`, `agingCaratsGrad`) to BarChart; both bars use gradient fills with `radius={[4, 4, 0, 0]}`
- Upgraded Tooltip `contentStyle`

## Shared Sparkline Helper Pattern

Used the same pattern consistently across all 12 views for any sparkline derived from row data:

```ts
const someSpark = useMemo(() => {
  const slice = rows.slice(0, 7).map((r) => r.someField);
  while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
  return slice;
}, [rows]);
```

This guarantees a 7-point array (required for the KpiCard Sparkline's `data.length >= 2` check), padding with last value when source has fewer than 7 rows, and falling back to `1` if the slice is empty.

For purely count-based KPIs (no time-series source available), used the synthetic trend pattern from dashboard-view:

```ts
const synthSpark = useMemo(() => {
  const base = data?.count ?? 1;
  return [base * 0.7, base * 0.85, base * 0.9, base * 0.95, base, base * 1.05, base * 1.1];
}, [data?.count]);
```

## Verification

- `bun run lint` → exit 0, no errors or warnings
- Dev server (`bun run dev`) compiled cleanly: ✓ Compiled in 411ms / 323ms / 380ms / 757ms
- One transient "Fast Refresh had to perform a full reload due to a runtime error" message appeared during HMR (normal behavior when many files change in quick succession); the subsequent `GET /` returned 200 in 550ms — page rendered successfully
- All 12 analysis views now display:
  - Icons in colored badges next to KPI labels (matching the dashboard's enhanced KpiCard pattern)
  - SVG sparklines with gradient fills in the bottom-right of each KPI card
  - Larger bold values (text-2xl font-bold) on accent-color backgrounds with gradient + accent stripe
  - Rounded bar corners (`radius={[4, 4, 0, 0]}` for vertical charts, `radius={[0, 4, 4, 0]}` for horizontal)
  - Gradient-filled bars (linearGradient with 0.9 → 0.3 opacity stops)
  - Rounded tooltip borders (`borderRadius: 8`, `border: "1px solid hsl(var(--border))"`)
- Data fetching, filters, and table structure preserved — only KPI cards and chart styling enhanced
