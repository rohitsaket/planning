---
Task ID: 10-A
Agent: full-stack-developer (Demand Trace Mobile + Sparklines)
Task: Fix Demand Trace mobile responsive + wire remaining analysis view sparklines to real data

Work Log:
- Read /home/z/my-project/worklog.md (prior multi-agent build history) — noted Task 9-A wired sparklines for sales-analysis / customers / orders; Task 9-FINAL flagged Demand Trace mobile + remaining sparklines (polished/memo/wip) as outstanding
- Read current demand-trace-view.tsx (681 lines) — confirmed KPI grid was `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` (cramped at 375px), InfoBanner had a single long uncollapsible rule paragraph, 13-step vertical timeline rendered all 13 cards unconditionally, Four-Number grid was `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, category Select was `w-[280px]` (overflow on mobile)
- Verified DataTable component already wraps table body in `overflow-auto h-full` (line 152-153 of data-table.tsx) → horizontal scroll on the wide All Categories table is handled, no edit needed
- Verified polished API route only exposes aging bucket piece counts (no carats per bucket) → Total Carats must keep using real byDimension carats as a real-data fallback instead of the suggested aging-carats source

## Task 1 — Demand Trace mobile (demand-trace-view.tsx)
- Imports: added `useEffect` to React imports; added `Button` from `@/components/ui/button`; added `ChevronDown` + `ChevronUp` to lucide-react imports
- Added new state: `showFullRule`, `showAllSteps`, `isDesktop` (with `useEffect` + `window.matchMedia("(min-width: 768px)")` listener for responsive desktop detection)
- Built `fullRuleText` (concatenated rule string including optional forecast model) and `shortRuleText` (first sentence only) as constants
- InfoBanner — restructured into a flex column with three children:
  - `<span className="font-semibold">CONFIRMED rule {ruleVersion}.</span>` (always shown)
  - `<span className="md:hidden">` — short text + Show more/less toggle button (mobile only)
  - `<span className="hidden md:inline">{fullRuleText}</span>` (desktop only — always full text)
- KPI grid: changed `grid-cols-2 md:grid-cols-3 lg:grid-cols-5` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-5` (single column on phones, 2 on small tablets, 5 on desktop)
- Category selector Section actions wrapper: `flex items-center gap-2 flex-wrap` → `flex items-center gap-2 flex-wrap w-full sm:w-auto`; Input `w-[160px]` → `w-full sm:w-[160px]`; Select trigger `w-[280px]` → `w-full sm:w-[280px]` (both stack full-width on phones)
- Vertical timeline: render logic changed from `activeCat.steps.map((s, i) => ...)` to `(isDesktop || showAllSteps ? activeCat.steps : activeCat.steps.slice(0, 4)).map((s, i, arr) => ...)`; `isLast` recompute uses the visible slice length so the connector line correctly disappears after the last visible card
- Added a "Show all N steps / Show less" `Button` (variant="outline", size="sm") below the timeline — visible only on mobile (`!isDesktop`) and only when active category has more than 4 steps. Uses ChevronDown when collapsed, ChevronUp when expanded.
- Four Requirement Numbers grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` → `grid-cols-2 md:grid-cols-4` (2 columns on phones — fits 4 cards in 2 rows; 4 on desktop)
- Fixed an accidental `@lib/utils` import typo (should be `@/lib/utils`) caught by dev server module-not-found error

## Task 2a — Polished view sparklines (polished-view.tsx)
- Total Pieces: changed `piecesSpark` to use `data.aging` (6 buckets: 0-30, 31-60, 61-90, 91-180, 181-365, 365+) padded to 7 with the last value. Synthetic fallback `[3,5,4,6,8,7,9]` when aging data is missing.
- Total Carats: kept `caratsSpark` using top-7 byDimension carats (real data) — aging buckets only expose piece counts in the current API, so byDimension carats is the best real-data source. Added synthetic fallback when fewer than 2 rows.
- Dimensions Distinct: renamed `valueSpark` → `dimPiecesSpark` and changed `.value` → `.pieces` (top 7 dimension rows' piece counts). Wired `dimPiecesSpark` to the KpiCard. Synthetic fallback when fewer than 2 rows.
- KPI grid class left as `grid-cols-1 md:grid-cols-3` (already mobile-first)

## Task 2b — Memo view sparklines (memo-view.tsx)
- Total Qty: unchanged — `qtySpark` already uses top 7 byCountry qty (matches task spec)
- Total Value: unchanged — `valueSpark` already uses top 7 byCountry value (matches task spec)
- Avg Age: changed `avgAgeSpark` from `byCountry.slice(0,7).map(r => r.avgAge)` to use `filteredAgeBuckets` — 5 bucket counts (0-30, 31-60, 61-90, 91-180, 180+) padded to 7 with last value. Synthetic fallback when no buckets.
- Aged > 90D: changed `agedSpark` from synthetic `base * 0.85, base * 0.9, ...` interpolation to a real-data series `[filteredAgeBuckets["91-180"], filteredAgeBuckets["180+"]]` padded to 7 with last value — directly derived from ageBuckets per task spec ("sum of 91-180 + 180+"). Synthetic fallback when no buckets.

## Task 2c — WIP view sparkline (wip-view.tsx)
- Total WIP Pieces: changed `piecesSpark` from `data.byStatus` to `data.byShape` — top 7 shape piece counts, padded to 7. Per task spec, falls back to synthetic `[3,5,4,6,8,7,9]` when `byShape.length < 2` to satisfy the Sparkline component's `data.length >= 2` requirement.

## Verification
- `bun run lint` — clean, 0 errors, 0 warnings
- Dev server recompiled cleanly after each edit (✓ Compiled in 907ms / 223ms / 984ms in latest log entries)
- Earlier dev log module-not-found error for `@lib/utils` (typo) was resolved by the import fix to `@/lib/utils`

Stage Summary:
- 4 files edited:
  1. demand-trace-view.tsx — mobile responsive (collapsible InfoBanner rule, collapsible 13-step timeline showing 4 on mobile + Show all toggle, KPI grid 1-col phones, four-numbers grid 2-col phones, category Select full-width on mobile)
  2. polished-view.tsx — Total Pieces sparkline → aging buckets; Total Carats keeps real byDimension carats (aging has no carats); Dimensions Distinct → top 7 dimension pieces (renamed valueSpark → dimPiecesSpark)
  3. memo-view.tsx — Avg Age sparkline → 5 ageBuckets; Aged > 90D sparkline → derived from 91-180 + 180+ buckets (replaces synthetic interpolation)
  4. wip-view.tsx — Total WIP Pieces sparkline → byShape (was byStatus), with synthetic fallback when byShape < 2 entries
- All four views now expose real-data sparklines (with synthetic fallbacks where the source data is unavailable)
- Demand Trace mobile usability issues from VLM assessment (timeline cut off, KPI grid cramped, InfoBanner too long) all addressed
- Lint clean; dev server compiles successfully
