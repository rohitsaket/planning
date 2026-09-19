import { beforeAll, describe, expect, test } from "bun:test";
import { db, resetDb } from "./helpers";
import { customer, resetSales, sales, type SaleInput } from "./sales-fixtures";
import { aggregateSales, getSalesAnalysis, loadLabels, loadSalesFactRows, type SalesFilters } from "@/lib/analytics/sales-analysis";
import { SALES_DIMENSIONS } from "@/lib/analytics/sales-dimensions";
import { addDays, businessWindow } from "@/lib/analytics/reporting-date";

const NOW = new Date("2026-09-19T10:00:00Z");

// Deterministic pseudo-random fixture (no Math.random): nulls, qty anomalies, month edges, all statuses.
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

async function mixedFixture() {
  await resetSales();
  const bands = await Promise.all(["1.00-1.49", "1.50-1.99"].map((label, i) => db.weightBand.upsert({ where: { code: `T-WB-${i}` }, create: { code: `T-WB-${i}`, label, minCt: 1 + i * 0.5, maxCt: 1.49 + i * 0.5, sortOrder: 90 + i }, update: {} })));
  const custs = [await customer("M1", "Alpha"), await customer("M2", "Beta"), await customer("M3", "Gamma", "BE", "ANT")];
  const rnd = lcg(42);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const rows: SaleInput[] = [];
  for (let i = 0; i < 600; i++) {
    const daysAgo = Math.floor(rnd() * 420);
    const minutes = Math.floor(rnd() * 1440);
    const c = pick(custs);
    rows.push({
      docDate: new Date(NOW.getTime() - daysAgo * 86_400_000 - minutes * 60_000),
      status: pick(["Invoice", "Invoice", "Invoice", "Memo", "Stock"] as const),
      shape: pick(["Round", "Oval", "Pear", "Emerald"]),
      weight: Math.round((1 + rnd() * 3) * 100) / 100,
      value: rnd() < 0.05 ? null : Math.round(rnd() * 5_000_000) / 100,
      qty: rnd() < 0.02 ? 2 : 1,
      lab: pick(["GIA", "IGI", null]),
      country: c === custs[2] ? "BE" : "IN",
      branch: c === custs[2] ? "ANT" : pick(["SRT", "MUM"]),
      customerId: c.id,
      weightBandId: pick([bands[0].id, bands[1].id, null]),
      color: pick(["D", "E", null]),
    });
  }
  // Month-boundary rows that land in different months depending on the reporting timezone.
  rows.push({ docDate: "2026-08-31T20:00:00Z" }, { docDate: "2026-07-31T23:30:00Z" }, { docDate: "2026-09-01T00:30:00Z" });
  await sales(custs[0].id, rows);
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;
function normalise(r: Awaited<ReturnType<typeof getSalesAnalysis>>) {
  return {
    ...r,
    totalCarats: round(r.totalCarats),
    totalValue: round(r.totalValue, 4),
    rows: r.rows.map((x) => ({ ...x, carats: round(x.carats), value: round(x.value, 4), avgPerCt: round(x.avgPerCt, 4), pct: round(x.pct, 6) })).sort((a, b) => a.dimension.localeCompare(b.dimension)),
    trendSeries: { ...r.trendSeries, carats: r.trendSeries.carats.map((p) => ({ ...p, value: round(p.value) })), value: r.trendSeries.value.map((p) => ({ ...p, value: round(p.value, 4) })) },
  };
}

async function reference(f: SalesFilters) {
  const window = businessWindow(f.now, f.windowDays, f.timezone);
  return aggregateSales(await loadSalesFactRows(f, window), f, window, await loadLabels(f.dimension));
}

beforeAll(async () => {
  await resetDb();
  await mixedFixture();
});

describe("SA-11 database aggregation equals the in-memory reference", () => {
  for (const tz of ["UTC", "Asia/Kolkata", "America/New_York"]) {
    for (const windowDays of [7, 30, 90, 365]) {
      test(`all 10 dimensions · ${windowDays}D · ${tz}`, async () => {
        for (const d of SALES_DIMENSIONS) {
          const f: SalesFilters = { dimension: d.value, windowDays, now: NOW, timezone: tz };
          expect({ d: d.value, r: normalise(await getSalesAnalysis(f)) }).toEqual({ d: d.value, r: normalise(await reference(f)) });
        }
      });
    }
  }
  test("with country / branch / lab filters", async () => {
    for (const filt of [{ country: "IN" }, { branch: "MUM" }, { lab: "GIA" }, { country: "BE", lab: "IGI" }]) {
      const f: SalesFilters = { dimension: "shape", windowDays: 180, now: NOW, timezone: "UTC", ...filt };
      expect(normalise(await getSalesAnalysis(f))).toEqual(normalise(await reference(f)));
    }
  });
  test("qty anomalies and null handling are identical", async () => {
    const f: SalesFilters = { dimension: "lab", windowDays: 365, now: NOW, timezone: "UTC" };
    const db1 = await getSalesAnalysis(f);
    expect(db1.dataQuality.qtyNotOneCount).toBe((await reference(f)).dataQuality.qtyNotOneCount);
    expect(db1.dataQuality.qtyNotOneCount).toBeGreaterThan(0);
    expect(db1.rows.map((r) => r.dimension)).toContain("Non-Cert");
  });
});

describe("SA-12 window fixture: 30D < 90D < 180D < 365D", () => {
  test("records in each band make every window strictly larger", async () => {
    await resetSales();
    const c = await customer("W1", "Windows");
    const w = businessWindow(NOW, 1, "UTC");
    const at = (daysBack: number) => `${addDays(w.endDate, -daysBack)}T12:00:00Z`;
    await sales(c.id, [
      { docDate: at(5), value: 100 }, // inside 30D
      { docDate: at(29), value: 100 }, // last date of 30D
      { docDate: at(30), value: 100 }, // first date outside 30D, inside 90D
      { docDate: at(60), value: 100 }, // 31–90D
      { docDate: at(120), value: 100 }, // 91–180D
      { docDate: at(179), value: 100 }, // last date of 180D
      { docDate: at(250), value: 100 }, // 181–365D
      { docDate: at(364), value: 100 }, // last date of 365D
      { docDate: at(365), value: 100 }, // older than 365D — never counted
      { docDate: at(500), value: 100 },
    ]);
    const pieces: Record<number, number> = {};
    for (const d of [30, 90, 180, 365]) pieces[d] = (await getSalesAnalysis({ dimension: "shape", windowDays: d, now: NOW, timezone: "UTC" })).totalPieces;
    expect(pieces).toEqual({ 30: 2, 90: 4, 180: 6, 365: 8 });
    expect(pieces[30] < pieces[90] && pieces[90] < pieces[180] && pieces[180] < pieces[365]).toBe(true);
  });
});
