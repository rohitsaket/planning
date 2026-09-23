/**
 * SALES ANALYSIS — DATABASE AGGREGATION AND DEMAND PARITY.
 *
 * Two questions, both answered against real data:
 *
 *  1. Does the database aggregation the page relies on agree with an independent reading
 *     of the same persisted sale rows?
 *  2. Does the confirmed 90-day quantity this page reports equal the sales input the
 *     demand result was calculated from — exactly, category by category?
 *
 * The second is the whole justification for reading the demand run's persisted sale
 * trace instead of re-deciding eligibility here, so it is asserted rather than assumed.
 */

import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { BULK_LOT_COUNT, cleanupSalesWorld, ensureWorld } from "./sales-fixtures";
import { GET as salesRoute } from "@/app/api/analysis/sales/route";
import { GET as trendRoute } from "@/app/api/analysis/sales/trend/route";
import { GET as contributionRoute } from "@/app/api/analysis/sales/contribution/route";
import { GET as recordsRoute } from "@/app/api/analysis/sales/records/route";
import { getISTDateString } from "@/lib/fantasy/time";

type User = Awaited<ReturnType<typeof makeUser>>;
let admin: User;

const SUMMARY = "/api/analysis/sales";
const get = (handler: Parameters<typeof call>[0], path: string) => call(handler, { path, cookie: admin.cookie });

/** The snapshot the page is reading, and its persisted sale rows. */
async function snapshotRows() {
  const run = await db.demandRun.findFirst({
    where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] }, finishedAt: { not: null } },
    orderBy: [{ runDate: "desc" }, { finishedAt: "desc" }],
  });
  const rows = await db.demandMetricTraceItem.findMany({
    where: { runId: run!.id, traceType: "SALE", isIncluded: true },
    select: { planningCategory: true, quantity: true, weight: true, docDate: true, lotId: true },
  });
  return { run: run!, rows };
}

/** Independent per-category aggregate of the same rows, computed outside the database. */
function referenceByCategory(rows: Awaited<ReturnType<typeof snapshotRows>>["rows"], cutoffIst: string) {
  const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const cutoff = dayOf(cutoffIst);
  const acc = new Map<string, { quantity: number; weight: number; records: number; windows: [number, number, number] }>();
  for (const r of rows) {
    if (!r.docDate) continue;
    const ist = getISTDateString(r.docDate);
    const back = cutoff - dayOf(ist);
    if (back < 0) continue;
    const cur = acc.get(r.planningCategory) ?? { quantity: 0, weight: 0, records: 0, windows: [0, 0, 0] as [number, number, number] };
    cur.quantity += Number(r.quantity);
    cur.weight += Number(r.weight ?? 0);
    cur.records += 1;
    const idx = Math.floor(back / 30);
    if (idx >= 0 && idx <= 2) cur.windows[idx] += Number(r.quantity);
    acc.set(r.planningCategory, cur);
  }
  return acc;
}

beforeAll(async () => {
  await resetDb();
  admin = await makeUser("sales.agg.root", "SUPER_ADMIN");
});

describe("SA-AGG database aggregation equals an independent reading of the same rows", () => {
  beforeAll(() => ensureWorld("core"));

  test("category quantities, weights, record counts and window splits all agree", async () => {
    const { run, rows } = await snapshotRows();
    const reference = referenceByCategory(rows, run.businessDateIst!);
    const served = (await get(salesRoute, `${SUMMARY}?pageSize=200`)).json.rows;

    expect(served.length).toBe(reference.size);
    for (const r of served) {
      const expected = reference.get(r.categoryId)!;
      expect({
        c: r.categoryId,
        quantity: r.total90Quantity,
        weight: Math.round(r.total90Weight * 1e4),
        records: r.recordCount,
        windows: [r.previous30Quantity, r.middle30Quantity, r.latest30Quantity],
      }).toEqual({
        c: r.categoryId,
        quantity: expected.quantity,
        weight: Math.round(expected.weight * 1e4),
        records: expected.records,
        // The reference indexes windows from the newest; the page names them.
        windows: [expected.windows[2], expected.windows[1], expected.windows[0]],
      });
    }
  });

  test("contribution by country and by branch reconciles with the same totals", async () => {
    const summary = await get(salesRoute, `${SUMMARY}?pageSize=200`);
    for (const dimension of ["country", "branch", "customer"]) {
      const c = await get(contributionRoute, `/api/analysis/sales/contribution?dimension=${dimension}&pageSize=200`);
      const quantity = c.json.rows.reduce((s: number, r: { confirmedQuantity: number }) => s + r.confirmedQuantity, 0);
      const records = c.json.rows.reduce((s: number, r: { recordCount: number }) => s + r.recordCount, 0);
      expect({ dimension, quantity }).toEqual({ dimension, quantity: summary.json.totals.confirmedQuantity });
      expect({ dimension, records }).toEqual({ dimension, records: summary.json.totals.recordCount });
    }
  });

  test("the supporting records reconcile with the aggregate they sit behind", async () => {
    const summary = await get(salesRoute, `${SUMMARY}?pageSize=200`);
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200");
    expect(records.json.paging.total).toBe(summary.json.totals.recordCount);
    const quantity = records.json.rows.reduce((s: number, r: { confirmedQuantity: number }) => s + r.confirmedQuantity, 0);
    expect(quantity).toBe(summary.json.totals.confirmedQuantity);
  });
});

describe("SA-PARITY the 90-day confirmed quantity equals the demand sales input", () => {
  beforeAll(() => ensureWorld("core"));

  test("every category matches the demand metric it was calculated into", async () => {
    const { run } = await snapshotRows();
    const metrics = await db.demandMetric.findMany({
      where: { runId: run.id, sales90d: { gt: 0 } },
      select: { planningCategory: true, sales90d: true },
    });
    expect(metrics.length).toBeGreaterThan(0);

    const served: Record<string, number> = {};
    for (const r of (await get(salesRoute, `${SUMMARY}?pageSize=200`)).json.rows) served[r.categoryId] = r.total90Quantity;

    for (const m of metrics) {
      expect({ c: m.planningCategory, qty: served[m.planningCategory] }).toEqual({ c: m.planningCategory, qty: m.sales90d });
    }
    const demandTotal = metrics.reduce((s, m) => s + m.sales90d, 0);
    const pageTotal = (await get(salesRoute, `${SUMMARY}?pageSize=200`)).json.totals.confirmedQuantity;
    expect(pageTotal).toBe(demandTotal);
  });

  test("the page reports the same window the demand run used, and says which run", async () => {
    const { run } = await snapshotRows();
    const readiness = (await get(salesRoute, SUMMARY)).json.readiness;
    expect(readiness.snapshot.snapshotId).toBe(run.id);
    expect(readiness.snapshot.salesCutoffIst).toBe(run.businessDateIst);
    expect(readiness.snapshot.windowDays).toBe(run.windowDays);
    expect(readiness.snapshot.lookbackStartUtc).toBe(run.lookbackStart!.toISOString());
    expect(readiness.snapshot.lookbackEndUtc).toBe(run.lookbackEnd!.toISOString());
    // The run's own sale count is the eligibility policy's answer; the page adds nothing.
    expect(readiness.eligibleSalesRecords).toBe(run.salesCount);
  });

  test("records the policy quarantined are absent from the page and from the demand input alike", async () => {
    await ensureWorld("quality");
    const { run } = await snapshotRows();
    const summary = await get(salesRoute, `${SUMMARY}?pageSize=200`);
    const metrics = await db.demandMetric.findMany({ where: { runId: run.id, sales90d: { gt: 0 } }, select: { planningCategory: true, sales90d: true } });
    const demandTotal = metrics.reduce((s, m) => s + m.sales90d, 0);
    expect(summary.json.totals.confirmedQuantity).toBe(demandTotal);
    // The quarantined sale reached neither side, and the page reports it as blocked
    // rather than absorbing it into a category.
    expect(summary.json.readiness.eligibleSalesRecords).toBeLessThan(run.salesCount);
    expect(summary.json.readiness.recordsBlockedByMissingCategory).toBeGreaterThan(0);
  });
});

describe("SA-SCALE aggregation stays correct at volume", () => {
  beforeAll(() => ensureWorld("bulk"));
  afterAll(cleanupSalesWorld);

  test("hundreds of sales across many categories still reconcile exactly", async () => {
    const { run, rows } = await snapshotRows();
    expect(rows.length).toBe(BULK_LOT_COUNT);

    const reference = referenceByCategory(rows, run.businessDateIst!);
    const served = (await get(salesRoute, `${SUMMARY}?pageSize=200`)).json;
    expect(served.paging.total).toBe(reference.size);
    expect(served.totals.recordCount).toBe(BULK_LOT_COUNT);
    expect(served.totals.confirmedQuantity).toBe([...reference.values()].reduce((s, v) => s + v.quantity, 0));

    for (const r of served.rows) {
      const expected = reference.get(r.categoryId)!;
      expect({ c: r.categoryId, q: r.total90Quantity, n: r.recordCount }).toEqual({ c: r.categoryId, q: expected.quantity, n: expected.records });
    }
  });

  test("the day-level trend covers the whole window without losing a record", async () => {
    const trend = await get(trendRoute, "/api/analysis/sales/trend?interval=day");
    const records = trend.json.rows.reduce((s: number, r: { recordCount: number }) => s + r.recordCount, 0);
    expect(records).toBe(BULK_LOT_COUNT);
    // Days are returned oldest to newest, each exactly once.
    const keys = trend.json.rows.map((r: { periodKey: string }) => r.periodKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([...keys].sort());
  });
});
