import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { call, makeUser, resetDb } from "./helpers";
import { customer, repeat, resetSales, sales } from "./sales-fixtures";
import { GET as salesRoute } from "@/app/api/analysis/sales/route";
import { getSalesAnalysis, parseSalesDimension, type SalesFilters } from "@/lib/analytics/sales-analysis";
import { chartRowsByPieces, chartTitle, dimensionsAllowed, SALES_DIMENSIONS } from "@/lib/analytics/sales-dimensions";
import { analyticsTimeZone, businessWindow, businessMonth } from "@/lib/analytics/reporting-date";
import { formatCompactCurrency, formatPercent, roundPercent } from "@/lib/format";
import { toCsv, type CsvColumn } from "@/lib/csv-export";
import { permissionsFor } from "@/lib/auth/permissions";

const ROOT = path.resolve(import.meta.dir, "../..");
const NOW = new Date("2026-09-19T10:00:00Z");
const run = (o: Partial<SalesFilters> = {}) =>
  getSalesAnalysis({ dimension: "shape", windowDays: 90, now: NOW, timezone: "UTC", ...o });
const byName = <T extends { dimension: string }>(rows: T[], name: string) => rows.find((r) => r.dimension === name)!;

let admin: Awaited<ReturnType<typeof makeUser>>, scientist: typeof admin, viewer: typeof admin, salesViewer: typeof admin;
let c1: { id: string }, c2: { id: string };

beforeAll(async () => {
  await resetDb();
  admin = await makeUser("sa.root", "SUPER_ADMIN");
  scientist = await makeUser("sa.scientist", "DATA_SCIENTIST");
  viewer = await makeUser("sa.viewer", "VIEWER");
  salesViewer = await makeUser("sa.salesviewer", "SALES_VIEWER");
});
beforeEach(async () => {
  await resetSales();
  c1 = await customer("C1", "Alpha Diamonds");
  c2 = await customer("C2", "Beta Jewels");
});

describe("SA-01 authorization", () => {
  beforeEach(() => sales(c1.id, [{ docDate: "2026-09-10T12:00:00Z" }]));
  test("anonymous → 401", async () => {
    expect((await call(salesRoute, { path: "/api/analysis/sales" })).status).toBe(401);
  });
  test("authenticated without sales.read (Viewer) → 403", async () => {
    expect(permissionsFor("VIEWER")).not.toContain("sales.read");
    expect((await call(salesRoute, { cookie: viewer.cookie, path: "/api/analysis/sales" })).status).toBe(403);
  });
  test("Data Scientist (sales.read, no customers.read): Shape → 200, Customer → 403", async () => {
    expect(permissionsFor("DATA_SCIENTIST")).toContain("sales.read");
    expect(permissionsFor("DATA_SCIENTIST")).not.toContain("customers.read");
    expect((await call(salesRoute, { cookie: scientist.cookie, path: "/api/analysis/sales?dimension=shape" })).status).toBe(200);
    const r = await call(salesRoute, { cookie: scientist.cookie, path: "/api/analysis/sales?dimension=customer" });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.json)).not.toContain("Alpha Diamonds");
  });
  test("Super Admin and Sales Viewer (both permissions) → Customer 200 with names", async () => {
    for (const u of [admin, salesViewer]) {
      const r = await call(salesRoute, { cookie: u.cookie, path: "/api/analysis/sales?dimension=customer" });
      expect(r.status).toBe(200);
      expect(r.json.rows[0].dimension).toBe("Alpha Diamonds");
    }
  });
  test("frontend dimension list hides Customer without customers.read", () => {
    expect(dimensionsAllowed(permissionsFor("DATA_SCIENTIST")).map((d) => d.value)).not.toContain("customer");
    expect(dimensionsAllowed(permissionsFor("SUPER_ADMIN")).map((d) => d.value)).toContain("customer");
  });
  test("CSV export has no server path of its own: it serialises rows the API already authorised", () => {
    const table = readFileSync(path.join(ROOT, "src/components/diamond/shared/data-table.tsx"), "utf8");
    expect(table).not.toMatch(/\bfetch\(|apiFetch|useApi/);
    const view = readFileSync(path.join(ROOT, "src/components/diamond/views/sales-analysis-view.tsx"), "utf8");
    expect(view).toContain("rows={rows}");
  });
});

describe("SA-06 dimension validation", () => {
  beforeEach(() => sales(c1.id, [{ docDate: "2026-09-10T12:00:00Z" }]));
  test("all 10 supported dimensions → 200", async () => {
    expect(SALES_DIMENSIONS.length).toBe(10);
    for (const d of SALES_DIMENSIONS) {
      const r = await call(salesRoute, { cookie: admin.cookie, path: `/api/analysis/sales?dimension=${d.value}` });
      expect({ d: d.value, s: r.status }).toEqual({ d: d.value, s: 200 });
      expect(r.json.dimension).toBe(d.value);
    }
  });
  test("dimension=banana → 400 INVALID_DIMENSION, no silent fallback", async () => {
    const r = await call(salesRoute, { cookie: admin.cookie, path: "/api/analysis/sales?dimension=banana" });
    expect([r.status, r.json.error.code]).toEqual([400, "INVALID_DIMENSION"]);
    expect(() => parseSalesDimension("Shape")).toThrow(); // exact repository casing only
  });
  test("omitted or empty dimension → default Shape", async () => {
    for (const p of ["/api/analysis/sales", "/api/analysis/sales?dimension="]) {
      const r = await call(salesRoute, { cookie: admin.cookie, path: p });
      expect([r.status, r.json.dimension]).toEqual([200, "shape"]);
    }
  });
});

describe("calculations (unchanged business rules)", () => {
  beforeEach(() =>
    sales(c1.id, [
      { docDate: "2026-09-18T08:00:00Z", shape: "Oval", weight: 2, value: 20000 },
      { docDate: "2026-09-01T08:00:00Z", shape: "Oval", weight: 1, value: 13000 },
      { docDate: "2026-08-15T08:00:00Z", shape: "Round", weight: 1.5, value: 12000 },
      { docDate: "2026-09-10T08:00:00Z", shape: "Round", weight: 1, value: null }, // null value counts 0
      { docDate: "2026-09-10T08:00:00Z", shape: "Oval", status: "Memo", weight: 9, value: 99999 },
      { docDate: "2026-09-10T08:00:00Z", shape: "Oval", status: "Stock", weight: 9, value: 99999 },
      { docDate: "2026-09-10T08:00:00Z", shape: "Pear", country: "BE", weight: 1, value: 5000 },
      { docDate: "2026-09-10T08:00:00Z", shape: "Pear", branch: "MUM", lab: "IGI", weight: 1, value: 5000 },
    ]),
  );
  test("totals, weighted Avg $/ct, value-based mix; Memo/Stock excluded", async () => {
    const r = await run();
    expect([r.totalPieces, r.totalCarats, r.totalValue]).toEqual([6, 7.5, 55000]);
    const oval = byName(r.rows, "Oval");
    expect([oval.pieces, oval.carats, oval.value]).toEqual([2, 3, 33000]);
    expect(oval.avgPerCt).toBeCloseTo(11000, 6); // 33000 / 3, not the mean of per-stone prices
    expect(oval.pct).toBeCloseTo((33000 / 55000) * 100, 9);
    const round = byName(r.rows, "Round");
    expect([round.pieces, round.value]).toEqual([2, 12000]);
    expect(r.rows.map((x) => x.dimension)).toEqual(["Oval", "Round", "Pear"]); // table sorted by value
  });
  test("country, branch and lab filters exclude mismatches", async () => {
    expect((await run({ country: "IN" })).totalPieces).toBe(5);
    expect((await run({ branch: "SRT" })).totalPieces).toBe(5);
    expect((await run({ lab: "GIA" })).totalPieces).toBe(5);
    expect((await run({ country: "BE" })).totalValue).toBe(5000);
  });
});

describe("SA-07 pieces = stone rows; qty ≠ 1 is a data-quality anomaly", () => {
  test("A qty1 + B qty1 → 2; add C qty3 → 3 pieces (not 5), anomaly count 1", async () => {
    await sales(c1.id, [{ docDate: "2026-09-10T08:00:00Z" }, { docDate: "2026-09-10T08:00:00Z" }]);
    expect((await run()).totalPieces).toBe(2);
    expect((await run()).dataQuality.qtyNotOneCount).toBe(0);
    await sales(c1.id, [{ docDate: "2026-09-10T08:00:00Z", qty: 3 }]);
    const r = await run();
    expect(r.totalPieces).toBe(3);
    expect(r.trendSeries.pieces.reduce((s, p) => s + p.value, 0)).toBeLessThanOrEqual(3);
    expect(r.dataQuality.qtyNotOneCount).toBe(1);
  });
});

describe("SA-08 calendar-date window and reporting timezone", () => {
  test("90D = run date + previous 89 dates: 2026-06-22 included, 2026-06-21 excluded", async () => {
    const w = businessWindow(NOW, 90, "UTC");
    expect([w.startDate, w.endDate]).toEqual(["2026-06-22", "2026-09-19"]);
    await sales(c1.id, [
      { docDate: "2026-06-22T00:00:00Z", shape: "In" },
      { docDate: "2026-06-21T23:59:59Z", shape: "Out" },
      { docDate: "2026-09-19T23:59:59Z", shape: "RunDayLate" },
      { docDate: "2026-09-20T00:00:00Z", shape: "Tomorrow" },
    ]);
    const names = (await run()).rows.map((r) => r.dimension).sort();
    expect(names).toEqual(["In", "RunDayLate"]);
  });
  test("results do not drift during the run day (morning vs night give the same window)", async () => {
    await sales(c1.id, [{ docDate: "2026-06-22T05:00:00Z" }]);
    const morning = await run({ now: new Date("2026-09-19T00:00:01Z") });
    const night = await run({ now: new Date("2026-09-19T23:59:59Z") });
    expect(morning.totalPieces).toBe(1);
    expect(night.totalPieces).toBe(1);
  });
  test("midnight boundary follows the reporting timezone (Asia/Kolkata example)", async () => {
    const now = new Date("2026-09-19T20:00:00Z"); // 01:30 on 2026-09-20 in Kolkata
    await sales(c1.id, [
      { docDate: "2026-09-19T18:29:59Z", shape: "PrevDay" }, // 23:59:59 IST on 09-19
      { docDate: "2026-09-19T18:30:00Z", shape: "RunDay" }, // 00:00:00 IST on 09-20
    ]);
    const ist = await run({ now, windowDays: 1, timezone: "Asia/Kolkata" });
    expect(ist.window.endDate).toBe("2026-09-20");
    expect(ist.rows.map((r) => r.dimension)).toEqual(["RunDay"]);
    const utc = await run({ now, windowDays: 1, timezone: "UTC" });
    expect(utc.rows.map((r) => r.dimension).sort()).toEqual(["PrevDay", "RunDay"]);
  });
  test("Month uses the reporting timezone, independent of the server TZ", async () => {
    await sales(c1.id, [{ docDate: "2026-08-31T20:00:00Z" }]); // Aug in UTC, Sep 1 in Kolkata
    const saved = process.env.TZ;
    try {
      for (const serverTz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
        process.env.TZ = serverTz;
        expect((await run({ dimension: "month", timezone: "UTC" })).rows[0].dimension).toBe("2026-08");
        expect((await run({ dimension: "month", timezone: "Asia/Kolkata" })).rows[0].dimension).toBe("2026-09");
      }
    } finally {
      process.env.TZ = saved;
    }
    expect(businessMonth(new Date("2026-08-31T20:00:00Z"), "Asia/Kolkata")).toBe("2026-09");
  });
  test("ANALYTICS_TIMEZONE: default UTC (explicit), valid override honoured, invalid rejected", () => {
    const saved = process.env.ANALYTICS_TIMEZONE;
    try {
      delete process.env.ANALYTICS_TIMEZONE;
      expect(analyticsTimeZone()).toBe("UTC");
      process.env.ANALYTICS_TIMEZONE = "Asia/Kolkata";
      expect(analyticsTimeZone()).toBe("Asia/Kolkata");
      process.env.ANALYTICS_TIMEZONE = "Not/AZone";
      expect(() => analyticsTimeZone()).toThrow();
    } finally {
      if (saved === undefined) delete process.env.ANALYTICS_TIMEZONE;
      else process.env.ANALYTICS_TIMEZONE = saved;
    }
  });
});

describe("SA-02 chronological KPI trends", () => {
  test("weekly buckets 10, 20, 30 for pieces, carats and value — not ranked categories", async () => {
    // 21D window → 3 full weeks ending on the run date: 08-30..09-05, 09-06..09-12, 09-13..09-19
    await sales(c1.id, [
      ...repeat(10, { docDate: "2026-09-01T08:00:00Z", shape: "Big", weight: 1, value: 100 }),
      ...repeat(20, { docDate: "2026-09-08T08:00:00Z", shape: "Mid", weight: 1, value: 100 }),
      ...repeat(30, { docDate: "2026-09-15T08:00:00Z", shape: "Small", weight: 1, value: 100 }),
    ]);
    const r = await run({ windowDays: 21 });
    expect(r.trendSeries.bucketDays).toBe(7);
    expect(r.trendSeries.pieces.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(r.trendSeries.carats.map((p) => p.value)).toEqual([10, 20, 30]);
    expect(r.trendSeries.value.map((p) => p.value)).toEqual([1000, 2000, 3000]);
    expect(r.trendSeries.pieces.map((p) => [p.periodStart, p.periodEnd])).toEqual([
      ["2026-08-30", "2026-09-05"], ["2026-09-06", "2026-09-12"], ["2026-09-13", "2026-09-19"],
    ]);
    // Value-ranked groups would read 30, 20, 10 — the old "declining" artefact.
    expect(r.rows.map((x) => x.pieces)).toEqual([30, 20, 10]);
    expect(r.trendSeries.excludedPartialPeriod).toBeNull();
  });
  test("90D: 12 full weeks plotted, the leading 6-day partial period reported not plotted; daily buckets ≤ 14D", async () => {
    const r = await run();
    expect(r.trendSeries.pieces.length).toBe(12);
    expect(r.trendSeries.excludedPartialPeriod).toEqual({ startDate: "2026-06-22", endDate: "2026-06-27" });
    expect(r.trendSeries.pieces.at(-1)).toMatchObject({ periodStart: "2026-09-13", periodEnd: "2026-09-19" });
    expect((await run({ windowDays: 7 })).trendSeries).toMatchObject({ bucketDays: 1 });
  });
  test("the page no longer derives sparklines from grouped rows, and states what the line shows", () => {
    const view = readFileSync(path.join(ROOT, "src/components/diamond/views/sales-analysis-view.tsx"), "utf8");
    expect(view).not.toMatch(/rows\.slice\(0, 7\)/);
    expect(view).toContain("trend?.pieces");
    expect(view).toContain("sparklineTitle=");
  });
});

describe("SA-03 / SA-09 chart ranking and title", () => {
  test("pieces chart ranks by pieces: A (50 pcs, $100) outranks B (20 pcs, $1000)", () => {
    const rows = [{ dimension: "B", pieces: 20, value: 1000 }, { dimension: "A", pieces: 50, value: 100 }];
    expect(chartRowsByPieces(rows).map((r) => r.dimension)).toEqual(["A", "B"]);
  });
  test("Top N uses the displayed count: 10 groups → Top 10, 15 groups → Top 12", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => ({ dimension: `S${i}`, pieces: i, value: n - i }));
    expect(chartTitle("shape", chartRowsByPieces(make(10)).length)).toBe("Top 10 Shapes by Pieces");
    const top = chartRowsByPieces(make(15));
    expect(chartTitle("shape", top.length)).toBe("Top 12 Shapes by Pieces");
    expect(top[0].dimension).toBe("S14"); // highest pieces, lowest value
    expect(chartTitle("customer", 1)).toBe("Top 1 Customer by Pieces");
  });
});

describe("SA-04 / SA-05 / SA-10 formatting and CSV", () => {
  test("one compact currency formatter", () => {
    expect(formatCompactCurrency(7_832_258.67)).toBe("$7.83M");
    expect(formatCompactCurrency(952_880)).toBe("$952.88K");
    expect(formatCompactCurrency(10_023.14)).toBe("$10.02K");
    expect(formatCompactCurrency(950)).toBe("$950");
    expect(formatCompactCurrency(-2_500)).toBe("-$2.50K");
    const money = readFileSync(path.join(ROOT, "src/components/diamond/shared/empty-state.tsx"), "utf8");
    expect(money).toContain("formatCompactCurrency(value)");
    expect(money).not.toMatch(/toFixed\(1\)\}K/);
  });
  test("Value Mix: UI 12.2%, CSV 12.2, header renamed, formula safety intact", () => {
    expect(formatPercent(12.166435)).toBe("12.2%");
    expect(roundPercent(12.166435)).toBe(12.2);
    const cols: CsvColumn<{ dimension: string; pct: number }>[] = [
      { key: "dimension", header: "Dimension", cell: () => ({ $$typeof: Symbol.for("react.element") }) },
      { key: "pct", header: "Value Mix %", cell: () => ({ $$typeof: Symbol.for("react.element") }), exportValue: (r) => roundPercent(r.pct) },
    ];
    const csv = toCsv(cols, [{ dimension: "=HYPERLINK(\"http://x\")", pct: 12.166435 }]).split("\r\n");
    expect(csv[0]).toBe('"Dimension","Value Mix %"');
    expect(csv[1]).toBe(`"'=HYPERLINK(""http://x"")",12.2`);
    const view = readFileSync(path.join(ROOT, "src/components/diamond/views/sales-analysis-view.tsx"), "utf8");
    expect(view).toContain('header: "Value Mix %"');
    expect(view).not.toContain('header: "Mix %"');
  });
});

