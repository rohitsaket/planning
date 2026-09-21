# Sales Analysis Remediation

Date: 2026-09-19. Code state: commit `8327343` on `main`, which another session committed and pushed at 23:33 (it contains all the changes below); working tree clean.

## 1. Summary

- **Fixed:** all 12 findings (SA-01 … SA-12), in two change sets.
- **Business baseline unchanged:** the 90D figures on the dev database are identical before and after, in both UTC and Asia/Kolkata (293 pcs · 724.97 ct · $7,832,258.67 · Oval 40 pcs / 12.2%).
- **Verification:**
  - Change Set A passed every gate: 119/119 tests, typecheck, lint, build.
  - Change Set B passed its targeted tests (39/39), typecheck, lint and build.
  - **The full test suite was not re-run after Change Set B.** At about 23:33 `.env` was deleted from disk by another session, so no database is reachable: **DATABASE INTEGRATION TESTS NOT RUN for the final state**. See section 13.

## 2. Findings Matrix

| ID | Finding | Verified in code | Fix | Tests | Status |
|---|---|---|---|---|---|
| SA-01 | Customer dimension leaked customer names and revenue to `sales.read`-only roles | Yes (route checked only `sales.read`; DATA_SCIENTIST lacks `customers.read`) | API: `dimension=customer` also requires `customers.read` (403). UI hides Customer. The CSV is built from API rows, so there is no bypass | 6 | FIXED |
| SA-02 | KPI sparklines plotted value-ranked categories and were labelled "Declining trend" | Yes (`rows.slice(0,7)`) | API returns `trendSeries` (chronological weekly/daily buckets); cards plot it with an explicit description; no inferred decline label | 3 | FIXED |
| SA-03 | Chart showed pieces but selected and ordered by value | Yes | `chartRowsByPieces`: Top N and order by pieces (ties: value, name). The table stays value-sorted | 1 | FIXED |
| SA-04 | `$7832.3K` KPI vs `$7.83M` table | Yes | One `formatCompactCurrency` (2 decimals, K/M/B) used by `Money`, the KPI card and the chart tooltip | 1 | FIXED |
| SA-05 | "Mix %" didn't say it is value share | Yes | Renamed "Value Mix %" (header, tooltip, CSV header); calculation unchanged | 1 | FIXED |
| SA-06 | Invalid dimension silently became Shape | Yes | Single `SALES_DIMENSIONS` list; invalid → 400 `INVALID_DIMENSION`; omitted or empty → Shape | 3 | FIXED |
| SA-07 | Pieces vs qty | Yes (all 420 dev rows have qty = 1; `lotId` is `@unique`) | **Pieces stays a count of rows.** qty ≠ 1 is counted as `dataQuality.qtyNotOneCount`, logged (`sales.qty_anomaly`) and shown as a warning on the page | 1 | FIXED |
| SA-08 | Rolling-timestamp window; Month used server timezone | Yes | Calendar window (run date + previous N−1 dates) in one configurable reporting timezone; Month uses the same timezone | 5 | FIXED (timezone value OPEN) |
| SA-09 | "Top 12" with 10 groups | Yes | `chartTitle`: "Top {displayed} {Shapes} by Pieces" | 1 | FIXED |
| SA-10 | CSV exported raw Value Mix (12.1662…) | Yes | CSV exports `roundPercent` (12.2); money and carat columns rounded to 2 decimals | 1 | FIXED |
| SA-11 | Aggregation in app memory, 50k-row ceiling | Yes | GROUP BY in PostgreSQL; stone rows no longer loaded | 13 + benchmark | FIXED (full-suite re-run pending) |
| SA-12 | Seed puts all invoices inside 90D | Yes (oldest invoice 2026-06-22) | Dedicated test fixture across all window bands; dev seed not touched | 1 | FIXED |

## 3. Authorization Changes

Checks run in this order:

- No session → 401.
- Session without `sales.read` → 403.
- Invalid dimension → 400.
- `dimension=customer` without `customers.read` → 403, with no customer data in the body.

The check happens once per request, using permissions resolved on the server. There are no extra queries.

| Role | Shape | Customer |
|---|---|---|
| DATA_SCIENTIST | 200 | 403 |
| SALES_VIEWER | 200 | 200 |
| SUPER_ADMIN | 200 | 200 |
| VIEWER | 403 | 403 |

**UI:** the dropdown lists only the dimensions the role may use. A stale Customer selection falls back to Shape. This is UX only; the API enforces the rule.

**Export:** CSV is generated in the browser from the rows the API returned. There is no export endpoint, and a test asserts that the table component does no fetching.

## 4. Trend Correction

- **Series:** `trendSeries.{pieces,carats,value}`, each point `{periodStart, periodEnd, value}`, oldest to newest.
- **Bucket size:** daily for windows of 14 days or less, weekly otherwise.
- **Anchoring:** buckets are anchored at the run date, so the newest bucket is complete. For 90D that is 12 full weeks.
- **Leading partial period:** reported in `excludedPartialPeriod` and not plotted. Plotting it would create a false dip at the start of the line.
- **Label:** the card describes what it plots ("Pieces per week, 12 full weeks oldest to newest"). No "Declining" or "Increasing" text is derived.
- **Other screens:** `KpiCard` keeps its old behaviour when no `sparklineTitle` is passed.

## 5. Chart Semantics

- The bars show pieces, and they are selected and ordered by pieces. The table stays sorted by value.
- The description states the total number of groups when more exist than are drawn.
- The tooltip shows pieces, carats and the formatted value.

## 6. Formatting Changes

`src/lib/format.ts`:

| Input | Output |
|---|---|
| `formatCompactCurrency(7832258.67)` | `$7.83M` |
| `formatCompactCurrency(952880)` | `$952.88K` |
| `formatPercent(12.166)` | `12.2%` |

**Shared change:** `Money` (used in 6 views) now uses this formatter, so thousands show **2 decimals everywhere** ($952.9K becomes $952.88K). This is the only effect outside Sales Analysis.

## 7. Dimension Validation

- `src/lib/analytics/sales-dimensions.ts` is the one list. It uses the existing values `lab, shape, weightBand, color, clarity, treatment, customer, country, branch, month`, with exact casing only.
- Tests cover: all 10 → 200; `banana` → 400; omitted or empty → Shape.

## 8. Pieces / Qty Decision

- **Pieces remains a count of qualifying Invoice stone rows, one row per Lot ID.** `SalesRecord.lotId` is unique, so duplicate lots are impossible.
- **qty ≠ 1 is a data-quality anomaly.** It is never summed. It is counted and returned (`dataQuality.qtyNotOneCount`), logged, and flagged on the page. The page is not blocked.
- **Test:** lots A, B and C (C has qty 3) → 3 pieces, 1 anomaly.

## 9. Date / Timezone Policy

- **Window:** `[start of business day (runDate − (N−1)), start of business day (runDate + 1))`. For 90D on 2026-09-19 that is 2026-06-22 to 2026-09-19 inclusive; 06-21 and 09-20 are excluded.
- **Change:** records dated after the run date are now excluded. There was no upper bound before; the dev database has none of these records.
- **Configuration:** `ANALYTICS_TIMEZONE` (IANA name, validated). Month and the trend buckets use the same value.
- **Default:** when unset, the explicit fallback is **UTC**, never the server's local timezone.
- **OPEN — TBD BUSINESS TIMEZONE VALIDATION REQUIRED:** confirm the business reporting timezone (probably Asia/Kolkata) and set `ANALYTICS_TIMEZONE` in each environment.
- **Tests:** the window boundary, stability between morning and night, the Kolkata midnight boundary, and Month under three different server TZ settings.

## 10. CSV Changes

- **Header:** "Value Mix %".
- **Values:** Value Mix is rounded to 1 decimal; Value, Avg $/ct and Carats to 2 decimals.
- **Formula safety:** protection from the earlier security remediation is unchanged. It is tested again with `=HYPERLINK(...)` in a Value Mix export.

## 11. Database Aggregation / SA-11

**Dimension classification:**

| Type | Dimensions |
|---|---|
| Direct persisted columns | shape, color, clarity, treatment, customer (`customerId`), country, branch |
| Normalized at ingestion (persisted) | lab (`labNormalized`), weightBand (`weightBandId`) |
| Derived | month (business date in the reporting timezone) |

No Diamond rule is re-implemented in SQL. The column map and the null labels ("Non-Cert", "Unmapped", "Unknown", "NULL") live in one TypeScript table, `DIMENSION_COLUMN` / `keyFromColumn`, shared by the database path and the reference.

**Query:** 2 aggregate queries (groups and trend buckets) plus 1 label lookup for Customer or Weight Band. Filters are parameterized; the column name comes from the fixed map.

**Equivalence:** the database result equals the in-memory reference (`aggregateSales`) for all 10 dimensions × 4 windows × 3 timezones (UTC, Kolkata, New York with daylight saving) and 4 filter combinations, on a 603-row mixed fixture with nulls, qty anomalies and month-edge rows.

**Benchmark** (`scripts/bench-sales-analysis.ts`, local PostgreSQL 18, median of 3):

| Rows | Result | Database path | Previous (in memory) | Previous production path |
|---|---|---|---|---|
| 1,000 | identical | 2 ms | 8 ms | ok |
| 10,000 | identical | 11 ms | 65 ms (+15.7 MB heap) | ok |
| 60,000 | identical | 42 ms | 366 ms (+86.5 MB heap) | **503 row limit** |

**50k ceiling:** no longer applies to this route, because stone rows are not loaded. It stays in place for the other analytics routes.

## 12. Test Fixture Improvements / SA-12

- `tests/security/sales-fixtures.ts` provides deterministic rows at 5, 29, 30, 60, 120, 179, 250, 364, 365 and 500 days back.
- Result: 30D = 2 < 90D = 4 < 180D = 6 < 365D = 8. Boundary dates are included; day 365 and older are excluded.
- The dev seed (`prisma/seed.ts`) was not modified.

## 13. Tests Executed

| Command | Exit | Result |
|---|---|---|
| Change Set A: `bun run test:security` | 0 | 119/119 pass |
| Change Set A: `bunx tsc --noEmit` | 0 | 0 errors |
| Change Set A: `bun run lint` | 0 | clean |
| Change Set A: `next build` | 0 | compiled |
| Change Set B: `bun test tests/security/sales-analysis.test.ts` | 0 | 24/24 |
| Change Set B: `bun test tests/security/sales-db-aggregation.test.ts` | 0 | 15/15 |
| Change Set B: `bench-sales-analysis.ts` | 0 | identical at 1k / 10k / 60k |
| Change Set B: `bunx tsc --noEmit` | 0 | 0 errors |
| Change Set B: `bun run lint` | 0 | clean |
| Change Set B: `next build` | 0 | compiled |
| Change Set B: `bun run test:security` (full suite) | 1 | **NOT RUN.** `.env` was deleted by another session before this run, so there is no `DATABASE_URL`. This is an environment failure, not a test failure |
| Baseline recalculation on the dev database (read-only) | 0 | 293 / 724.97 / $7,832,258.67 in UTC and Kolkata |

**Not done:** a live-server and browser check of the updated page; also blocked by the missing `.env`.

## 14. Remaining Risks

1. **Final full-suite run and browser check are pending** until `.env` is restored.
2. **Reporting timezone is not confirmed.** Behaviour defaults to UTC until `ANALYTICS_TIMEZONE` is set.
3. **Money now shows 2 decimals for K values in 6 views.** This is intended, but it is a visible change.
4. **The trend omits a leading partial week** (for example, 6 days of 90D). Totals still include those days.
5. **Pushed without the final gate.** Commit `8327343` was pushed to `origin/main` by another session before the full-suite run of Change Set B.
6. **Accessibility is not claimed.** Only an aria-label on the dimension select and a label on the sparkline were added.

## Acceptance gate

| Item | Status |
|---|---|
| Customer dimension requires `customers.read` | ✅ |
| Frontend does not expose Customer without permission | ✅ |
| Customer export cannot bypass permission | ✅ |
| KPI sparklines use chronological data | ✅ |
| Fake decline indicator removed | ✅ |
| Pieces chart ranked by pieces | ✅ |
| Currency formatting consistent | ✅ |
| Mix renamed Value Mix % | ✅ |
| Invalid dimension → 400 | ✅ |
| Pieces remains count of stones | ✅ |
| qty ≠ 1 surfaced as anomaly | ✅ |
| 90D uses calendar dates | ✅ |
| Month uses centralized timezone | ✅ (value OPEN) |
| Top N uses displayed count | ✅ |
| CSV Value Mix at 1 decimal | ✅ |
| CSV formula safety intact | ✅ |
| SA-11 implemented | ✅ |
| 180D/365D test fixture | ✅ |
| Lint | ✅ |
| Typecheck | ✅ |
| Build | ✅ |
| Relevant tests: targeted | ✅ |
| Relevant tests: full suite after Change Set B | ⏳ blocked (`.env`) |
| No unrelated business logic changed | ✅ |
