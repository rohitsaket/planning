/**
 * SALES ANALYSIS & TRENDS — behavioural and authorization suite.
 *
 * Every assertion below goes through the real route handler, against a real database,
 * over a snapshot produced by the real demand calculation from real canonical lifecycle
 * records. Nothing here is asserted against a reconstructed array.
 */

import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import {
  BULK_LOT_COUNT,
  CATEGORY_A,
  CATEGORY_B,
  cleanupSalesWorld,
  cutoffIst,
  ensureWorld,
  invalidateWorld,
  lot,
  recordSuccessfulSync,
  resetSalesWorld,
  runSnapshot,
  seedMappings,
  sold,
} from "./sales-fixtures";
import { GET as salesRoute } from "@/app/api/analysis/sales/route";
import { GET as trendRoute } from "@/app/api/analysis/sales/trend/route";
import { GET as movementRoute } from "@/app/api/analysis/sales/movement/route";
import { GET as contributionRoute } from "@/app/api/analysis/sales/contribution/route";
import { GET as recordsRoute } from "@/app/api/analysis/sales/records/route";
import { GET as exportRoute } from "@/app/api/analysis/sales/export/route";
import { permissionsFor } from "@/lib/auth/permissions";
import { salesWindows } from "@/lib/analytics/sales-history";
import { contributionsAllowed, SALES_WINDOW_SIZE_DAYS } from "@/lib/analytics/sales-history-contract";

type User = Awaited<ReturnType<typeof makeUser>>;
let admin: User, analyst: User, scientist: User, salesViewer: User, viewer: User;

const SUMMARY = "/api/analysis/sales";

const get = (handler: Parameters<typeof call>[0], path: string, user?: User) =>
  call(handler, { path, cookie: user?.cookie });

/** The category row for one category id, from a page sized to hold every category. */
async function categoryRow(user: User, categoryId: string, extra = "") {
  const r = await get(salesRoute, `${SUMMARY}?pageSize=200${extra}`, user);
  expect(r.status).toBe(200);
  return r.json.rows.find((x: { categoryId: string }) => x.categoryId === categoryId);
}

beforeAll(async () => {
  await resetDb();
  admin = await makeUser("sales.root", "SUPER_ADMIN");
  analyst = await makeUser("sales.analyst", "DATA_ANALYST");
  scientist = await makeUser("sales.scientist", "DATA_SCIENTIST");
  salesViewer = await makeUser("sales.viewer", "SALES_VIEWER");
  viewer = await makeUser("sales.plain", "VIEWER");
});

// ---------------------------------------------------------------------------

describe("SH-01 authorization is enforced on the server for every route", () => {
  beforeAll(() => ensureWorld("core"));
  const routes: Array<[string, Parameters<typeof call>[0], string]> = [
    ["summary", salesRoute, SUMMARY],
    ["trend", trendRoute, "/api/analysis/sales/trend"],
    ["movement", movementRoute, "/api/analysis/sales/movement"],
    ["contribution", contributionRoute, "/api/analysis/sales/contribution"],
    ["records", recordsRoute, "/api/analysis/sales/records"],
  ];

  test("anonymous callers receive 401 on every sales route", async () => {
    for (const [name, handler, path] of routes) {
      expect({ name, status: (await get(handler, path)).status }).toEqual({ name, status: 401 });
    }
    expect((await get(exportRoute, "/api/analysis/sales/export")).status).toBe(401);
  });

  test("a signed-in user without sales.read receives 403 on every sales route", async () => {
    expect(permissionsFor("VIEWER")).not.toContain("sales.read");
    for (const [name, handler, path] of routes) {
      expect({ name, status: (await get(handler, path, viewer)).status }).toEqual({ name, status: 403 });
    }
  });

  test("an authorized analyst can read every sales route", async () => {
    for (const [name, handler, path] of routes) {
      expect({ name, status: (await get(handler, path, analyst)).status }).toEqual({ name, status: 200 });
    }
  });

  test("customer contribution requires customers.read on top of sales.read", async () => {
    expect(permissionsFor("DATA_SCIENTIST")).toContain("sales.read");
    expect(permissionsFor("DATA_SCIENTIST")).not.toContain("customers.read");
    const denied = await get(contributionRoute, "/api/analysis/sales/contribution?dimension=customer", scientist);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.json)).not.toContain("Alpha Diamonds");

    const allowed = await get(contributionRoute, "/api/analysis/sales/contribution?dimension=customer", admin);
    expect(allowed.status).toBe(200);
    expect(allowed.json.rows.map((r: { label: string }) => r.label)).toContain("Alpha Diamonds");
  });

  test("a customer filter is refused rather than silently ignored", async () => {
    // Quietly dropping the parameter would answer a different question from the one asked.
    expect((await get(salesRoute, `${SUMMARY}?customerCode=C-IN`, scientist)).status).toBe(403);
    expect((await get(salesRoute, `${SUMMARY}?customerCode=C-IN`, admin)).status).toBe(200);
  });

  test("supporting records expose customer identity only to customers.read", async () => {
    const withoutPermission = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", scientist);
    expect(withoutPermission.status).toBe(200);
    expect(withoutPermission.json.rows.length).toBeGreaterThan(0);
    expect(Object.keys(withoutPermission.json.rows[0])).not.toContain("customerName");
    expect(JSON.stringify(withoutPermission.json)).not.toContain("Alpha Diamonds");

    const withPermission = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", salesViewer);
    expect(JSON.stringify(withPermission.json)).toContain("Alpha Diamonds");
  });

  test("the browser control set matches the server decision", () => {
    expect(contributionsAllowed(permissionsFor("DATA_SCIENTIST"))).not.toContain("customer");
    expect(contributionsAllowed(permissionsFor("SALES_VIEWER"))).toContain("customer");
  });
});

// ---------------------------------------------------------------------------

describe("SH-02 the IST window is exact, and the three 30-day windows tile it", () => {
  beforeAll(() => ensureWorld("core"));

  test("the three windows do not overlap and leave no gap across the 90 days", async () => {
    const summary = await get(salesRoute, SUMMARY, admin);
    const cutoff = summary.json.readiness.snapshot.salesCutoffIst;
    const windows = salesWindows(cutoff);
    expect(windows.map((w) => w.key)).toEqual(["previous30", "middle30", "latest30"]);

    const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    for (const w of windows) expect(day(w.endDate) - day(w.startDate) + 1).toBe(SALES_WINDOW_SIZE_DAYS);
    // Each window starts the day after the previous one ends: no overlap, no gap.
    expect(day(windows[1].startDate) - day(windows[0].endDate)).toBe(1);
    expect(day(windows[2].startDate) - day(windows[1].endDate)).toBe(1);
    expect(windows[2].endDate).toBe(cutoff);
    expect(day(windows[2].endDate) - day(windows[0].startDate) + 1).toBe(90);
    // The snapshot's own cutoff is the one authority; nothing is recomputed from "now".
    expect(cutoff).toBe(cutoffIst());
  });

  test("month and year boundaries do not shift a window edge", () => {
    for (const cutoff of ["2027-01-15", "2026-03-01", "2026-12-31", "2028-02-29"]) {
      const w = salesWindows(cutoff);
      const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
      expect(day(w[2].endDate) - day(w[0].startDate) + 1).toBe(90);
      expect(day(w[1].startDate) - day(w[0].endDate)).toBe(1);
      expect(day(w[2].startDate) - day(w[1].endDate)).toBe(1);
    }
  });

  test("the window edges include and exclude the exact business dates they should", async () => {
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const lots: string[] = records.json.rows.map((r: { lotId: string }) => r.lotId);
    // 23:00 IST on the cutoff date is the last included instant.
    expect(lots).toContain("SA-EDGE-IN");
    // The first included business date of the window is D-89, at its very start.
    expect(lots).toContain("SA-A-7");
    // One hour before the window opens, and any instant after the cutoff day ends.
    expect(lots).not.toContain("SA-EDGE-BEFORE");
    expect(lots).not.toContain("SA-EDGE-AFTER");
  });

  test("each sale lands in exactly one of the three windows", async () => {
    const a = await categoryRow(admin, CATEGORY_A);
    expect(a.previous30Quantity + a.middle30Quantity + a.latest30Quantity).toBe(a.total90Quantity);
    const b = await categoryRow(admin, CATEGORY_B);
    expect(b.previous30Quantity + b.middle30Quantity + b.latest30Quantity).toBe(b.total90Quantity);
  });
});

// ---------------------------------------------------------------------------

describe("SH-03 only confirmed sales are counted", () => {
  beforeAll(() => ensureWorld("core"));

  test("memo, reservation, transfer, work in progress, stock and open orders never appear", async () => {
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const lots: string[] = records.json.rows.map((r: { lotId: string }) => r.lotId);
    for (const excluded of ["SA-MEMO", "SA-RESERVED", "SA-TRANSFER", "SA-WIP", "SA-STOCK"]) {
      expect({ excluded, present: lots.includes(excluded) }).toEqual({ excluded, present: false });
    }
    // The open order exists and is deliberately absent from every sales figure.
    expect(await db.salesOrderLine.count({ where: { qtyOutstanding: { gt: 0 } } })).toBe(1);
    const summary = await get(salesRoute, `${SUMMARY}?pageSize=200`, admin);
    const quantity = summary.json.rows.reduce((s: number, r: { total90Quantity: number }) => s + r.total90Quantity, 0);
    expect(quantity).toBe(summary.json.totals.confirmedQuantity);
    // 25 ordered pieces would be impossible to miss if an open order had leaked in.
    expect(quantity).toBeLessThan(25);
  });

  test("one business sale reported twice by the lifecycle is counted once", async () => {
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const dedup = records.json.rows.filter((r: { lotId: string }) => r.lotId === "SA-DEDUP");
    expect(dedup).toHaveLength(1);
    expect(dedup[0].confirmedQuantity).toBe(1);
  });

  test("a genuine second sale episode is counted separately", async () => {
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const episode = records.json.rows.filter((r: { lotId: string }) => r.lotId === "SA-EPISODE");
    expect(episode).toHaveLength(2);
    // The two episodes fall in different 30-day windows, so they are visible separately.
    expect(new Set(episode.map((r: { docDate: string }) => r.docDate)).size).toBe(2);
  });

  test("the snapshot holds no duplicate lifecycle events at all", async () => {
    const readiness = (await get(salesRoute, SUMMARY, admin)).json.readiness;
    expect(readiness.duplicateLifecycleEvents).toBe(0);
    expect(readiness.eligibleSalesRecords).toBeGreaterThan(0);
  });

  test("an invoice later cancelled is reported exactly as the centralized policy recorded it", async () => {
    // The page applies no reversal rule of its own: it reports the sale events the demand
    // calculation admitted, and the snapshot is the authority on what those are.
    const snapshot = await db.demandRun.findFirst({ orderBy: { runDate: "desc" }, select: { id: true } });
    const traced = await db.demandMetricTraceItem.count({
      where: { runId: snapshot!.id, traceType: "SALE", isIncluded: true, lotId: "SA-CANCEL" },
    });
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const shown = records.json.rows.filter((r: { lotId: string }) => r.lotId === "SA-CANCEL").length;
    expect(shown).toBe(traced);
  });
});

// ---------------------------------------------------------------------------

describe("SH-04 quantity, weight and record count stay three different figures", () => {
  beforeAll(() => ensureWorld("core"));

  test("a three-piece sale contributes three to quantity and one to the record count", async () => {
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const qty = records.json.rows.filter((r: { lotId: string }) => r.lotId === "SA-A-QTY");
    expect(qty).toHaveLength(1);
    expect(qty[0].confirmedQuantity).toBe(3);
  });

  test("the category summary never equates record count with piece quantity", async () => {
    const a = await categoryRow(admin, CATEGORY_A);
    expect(a.total90Quantity).toBeGreaterThan(a.recordCount);
    expect(a.total90Weight).toBeGreaterThan(0);
    // Weight is a measurement, quantity is a count: they are reported side by side and
    // never summed into one figure.
    expect(a.total90Weight).not.toBe(a.total90Quantity);
  });

  test("readiness reports quantity confirmation as its own figure", async () => {
    const readiness = (await get(salesRoute, SUMMARY, admin)).json.readiness;
    // Quantity semantics are decided by the centralized policy before the snapshot is
    // written; this page reports what that produced and converts nothing itself.
    expect(readiness.recordsWithUnconfirmedQuantity).toBe(0);
    expect(readiness.eligibleConfirmedQuantity).toBeGreaterThan(readiness.eligibleSalesRecords);
  });
});

// ---------------------------------------------------------------------------

describe("SH-05 readiness states are honest", () => {
  test("no completed snapshot reports NOT RUN and shows nothing in its place", async () => {
    invalidateWorld();
    process.env.FANTASY_SOURCE_MODE = "FIXTURE";
    await resetSalesWorld();
    await seedMappings();
    const r = await get(salesRoute, SUMMARY, admin);
    expect(r.status).toBe(200);
    expect(r.json.readiness.state).toBe("NOT_RUN");
    expect(r.json.readiness.snapshot.snapshotId).toBeNull();
    expect(r.json.readiness.eligibleSalesRecords).toBeNull();
    expect(r.json.rows).toHaveLength(0);
    expect(r.json.totals.confirmedQuantity).toBe(0);
    // Every other surface refuses to invent a figure too.
    expect((await get(trendRoute, "/api/analysis/sales/trend", admin)).json.available).toBe(false);
    expect((await get(movementRoute, "/api/analysis/sales/movement", admin)).json.available).toBe(false);
    expect((await get(exportRoute, "/api/analysis/sales/export", admin)).status).toBe(409);
  });

  test("a fixture snapshot is labelled SIMULATED and never as a live connection", async () => {
    await resetSalesWorld();
    await seedMappings();
    await recordSuccessfulSync();
    await lot(sold("SA-SIM-1", 3));
    await runSnapshot();
    invalidateWorld();

    const readiness = (await get(salesRoute, SUMMARY, admin)).json.readiness;
    expect(readiness.state).toBe("SIMULATED");
    expect(readiness.snapshot.isSimulated).toBe(true);
    expect(readiness.snapshot.sourceState).toBe("FIXTURE_SIMULATION");
    expect(readiness.explanation).toMatch(/simulation fixtures/i);
    expect(readiness.lastSuccessfulSyncAt).toBeDefined();
    expect(readiness.historyCoverageStart).toBeDefined();
    expect(readiness.snapshot.approvedWindowLayout).toBe(true);
  });

  test("records the policy could not attribute to a category are reported, not absorbed", async () => {
    await ensureWorld("quality");
    const readiness = (await get(salesRoute, SUMMARY, admin)).json.readiness;
    expect(readiness.state).toBe("INCOMPLETE");
    expect(readiness.recordsBlockedByMissingCategory).toBeGreaterThan(0);
    expect(readiness.excludedRecords).toBeGreaterThan(0);

    // The blocked sale contributes to no category total.
    const records = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    const lots: string[] = records.json.rows.map((r: { lotId: string }) => r.lotId);
    expect(lots).toContain("SAQ-OK");
    expect(lots).not.toContain("SAQ-UNMAPPED");
  });

  test("a snapshot outside the approved window layout says so instead of showing three windows", async () => {
    await resetSalesWorld();
    await seedMappings();
    await lot(sold("SA-W30-1", 3));
    await runSnapshot(30);
    invalidateWorld();

    const summary = await get(salesRoute, SUMMARY, admin);
    expect(summary.json.readiness.snapshot.windowDays).toBe(30);
    expect(summary.json.readiness.snapshot.approvedWindowLayout).toBe(false);
    expect(summary.json.readiness.snapshot.windows).toHaveLength(0);
    const movement = await get(movementRoute, "/api/analysis/sales/movement", admin);
    expect(movement.json.available).toBe(false);
    expect(movement.json.rows).toHaveLength(0);
    expect((await get(trendRoute, "/api/analysis/sales/trend?interval=window30", admin)).json.available).toBe(false);
    // A calendar interval is still meaningful and is offered rather than refused.
    expect((await get(trendRoute, "/api/analysis/sales/trend?interval=day", admin)).json.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("SH-06 category normalization matches the demand snapshot exactly", () => {
  beforeAll(() => ensureWorld("core"));

  test("every category shown is a category the demand run itself produced", async () => {
    const snapshot = await db.demandRun.findFirst({ orderBy: { runDate: "desc" }, select: { id: true } });
    const metrics = await db.demandMetric.findMany({ where: { runId: snapshot!.id }, select: { planningCategory: true } });
    const known = new Set(metrics.map((m) => m.planningCategory));
    const rows = (await get(salesRoute, `${SUMMARY}?pageSize=200`, admin)).json.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect({ c: r.categoryId, known: known.has(r.categoryId) }).toEqual({ c: r.categoryId, known: true });
  });

  test("the category identity is lab, shape and weight band, and its parts agree with it", async () => {
    const a = await categoryRow(admin, CATEGORY_A);
    expect([a.lab, a.shape, a.weightBand].join("|")).toBe(a.categoryId);
    expect(a.dataState).toBe("CONFIRMED");
  });
});

// ---------------------------------------------------------------------------

describe("SH-07 filters, sorting and paging are server-side and consistent", () => {
  beforeAll(() => ensureWorld("core"));

  test("country and lab filters narrow the totals, the records and the contribution alike", async () => {
    const all = await get(salesRoute, `${SUMMARY}?pageSize=200`, admin);
    const be = await get(salesRoute, `${SUMMARY}?pageSize=200&country=BE`, admin);
    expect(be.json.totals.confirmedQuantity).toBeGreaterThan(0);
    expect(be.json.totals.confirmedQuantity).toBeLessThan(all.json.totals.confirmedQuantity);

    const beRecords = await get(recordsRoute, "/api/analysis/sales/records?pageSize=200&country=BE", admin);
    expect(beRecords.json.paging.total).toBe(be.json.totals.recordCount);
    for (const r of beRecords.json.rows) expect(r.country).toBe("BE");

    const beContribution = await get(contributionRoute, "/api/analysis/sales/contribution?dimension=country&country=BE", admin);
    expect(beContribution.json.rows).toHaveLength(1);
    expect(beContribution.json.rows[0].confirmedQuantity).toBe(be.json.totals.confirmedQuantity);

    const igi = await get(salesRoute, `${SUMMARY}?pageSize=200&lab=IGI`, admin);
    expect(igi.json.rows.map((r: { lab: string }) => r.lab)).toEqual(["IGI"]);
  });

  test("an exact category drill-down returns only that category's records", async () => {
    const a = await categoryRow(admin, CATEGORY_A);
    const drill = await get(recordsRoute, `/api/analysis/sales/records?pageSize=200&categoryId=${encodeURIComponent(CATEGORY_A)}`, admin);
    expect(drill.json.paging.total).toBe(a.recordCount);
    for (const r of drill.json.rows) expect(r.categoryId).toBe(CATEGORY_A);
    const quantity = drill.json.rows.reduce((s: number, r: { confirmedQuantity: number }) => s + r.confirmedQuantity, 0);
    expect(quantity).toBe(a.total90Quantity);
  });

  test("an unsupported filter or sort value is refused, never silently defaulted", async () => {
    expect((await get(salesRoute, `${SUMMARY}?sortKey=drop`, admin)).status).toBe(400);
    expect((await get(salesRoute, `${SUMMARY}?sortDir=sideways`, admin)).status).toBe(400);
    expect((await get(salesRoute, `${SUMMARY}?trend=Excellent`, admin)).status).toBe(400);
    expect((await get(salesRoute, `${SUMMARY}?dataState=FINE`, admin)).status).toBe(400);
    expect((await get(trendRoute, "/api/analysis/sales/trend?interval=fortnight", admin)).status).toBe(400);
    expect((await get(contributionRoute, "/api/analysis/sales/contribution?dimension=salesperson", admin)).status).toBe(400);
  });

  test("a trend filter selects categories by the shared trend rule", async () => {
    const b = await categoryRow(admin, CATEGORY_B);
    // Category B sold only in the latest window, so the shared rule calls it New Demand.
    expect(b.trend).toBe("New Demand");
    const filtered = await get(salesRoute, `${SUMMARY}?pageSize=200&trend=New%20Demand`, admin);
    expect(filtered.json.rows.map((r: { categoryId: string }) => r.categoryId)).toContain(CATEGORY_B);
    for (const r of filtered.json.rows) expect(r.trend).toBe("New Demand");
  });
});

// ---------------------------------------------------------------------------

describe("SH-08 trend and movement stay descriptive", () => {
  beforeAll(() => ensureWorld("core"));

  test("a zero earlier window yields no percentage at all", async () => {
    const movement = await get(movementRoute, "/api/analysis/sales/movement?pageSize=200", admin);
    expect(movement.json.available).toBe(true);
    const b = movement.json.rows.find((r: { categoryId: string }) => r.categoryId === CATEGORY_B);
    expect(b.previous30Quantity).toBe(0);
    expect(b.latest30Quantity).toBeGreaterThan(0);
    expect(b.percentChange).toBeNull();
    expect(b.comparability).toBe("NOT_COMPARABLE");
    expect(b.absoluteChange).toBe(b.latest30Quantity);
  });

  test("a valid denominator yields a percentage consistent with the two windows", async () => {
    const movement = await get(movementRoute, "/api/analysis/sales/movement?pageSize=200", admin);
    const a = movement.json.rows.find((r: { categoryId: string }) => r.categoryId === CATEGORY_A);
    expect(a.comparability).toBe("COMPARABLE");
    expect(a.absoluteChange).toBe(a.latest30Quantity - a.previous30Quantity);
    expect(a.percentChange).toBeCloseTo(((a.latest30Quantity - a.previous30Quantity) / a.previous30Quantity) * 100, 1);
  });

  test("no sales surface offers a forecast, a priority or a reorder quantity", async () => {
    const payloads = [
      JSON.stringify((await get(salesRoute, `${SUMMARY}?pageSize=200`, admin)).json),
      JSON.stringify((await get(trendRoute, "/api/analysis/sales/trend", admin)).json),
      JSON.stringify((await get(movementRoute, "/api/analysis/sales/movement?pageSize=200", admin)).json),
    ];
    for (const body of payloads) {
      for (const forbidden of ["forecast", "priority", "reorder", "predicted", "recommend", "planCoverage", "pipelineNeed", "shortage"]) {
        expect({ forbidden, present: body.toLowerCase().includes(forbidden.toLowerCase()) }).toEqual({ forbidden, present: false });
      }
    }
  });

  test("the period trend adds up to the same confirmed quantity as the summary", async () => {
    const summary = await get(salesRoute, `${SUMMARY}?pageSize=200`, admin);
    for (const interval of ["day", "week", "window30"]) {
      const trend = await get(trendRoute, `/api/analysis/sales/trend?interval=${interval}`, admin);
      const total = trend.json.rows.reduce((s: number, r: { confirmedQuantity: number }) => s + r.confirmedQuantity, 0);
      const records = trend.json.rows.reduce((s: number, r: { recordCount: number }) => s + r.recordCount, 0);
      expect({ interval, total }).toEqual({ interval, total: summary.json.totals.confirmedQuantity });
      expect({ interval, records }).toEqual({ interval, records: summary.json.totals.recordCount });
    }
  });
});

// ---------------------------------------------------------------------------

describe("SH-09 nothing internal leaks to the browser", () => {
  beforeAll(() => ensureWorld("quality"));

  test("no payload carries stored reasons, batch identifiers, raw source data or query text", async () => {
    const bodies = [
      JSON.stringify((await get(salesRoute, `${SUMMARY}?pageSize=200`, admin)).json),
      JSON.stringify((await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin)).json),
      JSON.stringify((await get(movementRoute, "/api/analysis/sales/movement?pageSize=200", admin)).json),
      JSON.stringify((await get(contributionRoute, "/api/analysis/sales/contribution?dimension=branch", admin)).json),
      JSON.stringify((await get(trendRoute, "/api/analysis/sales/trend", admin)).json),
    ];
    const banned = [
      "Unapproved planning mapping",
      "metadataJson",
      "syncBatchId",
      "SA-B1",
      "DemandMetricTraceItem",
      "SELECT ",
      "planningCategory",
      "traceType",
      "lotStatusDb",
      "removalReason",
      "EXPLICIT_SALE",
    ];
    for (const body of bodies) {
      for (const needle of banned) {
        expect({ needle, present: body.includes(needle) }).toEqual({ needle, present: false });
      }
    }
  });

  test("supporting records carry only allowlisted business fields", async () => {
    const r = await get(recordsRoute, "/api/analysis/sales/records?pageSize=5", admin);
    const allowed = new Set([
      "recordId", "lotId", "docDate", "lifecycle", "categoryId", "confirmedQuantity", "measuredWeight",
      "country", "branch", "customerCode", "customerName", "sourceState", "dataState",
    ]);
    for (const row of r.json.rows) {
      for (const key of Object.keys(row)) expect({ key, allowed: allowed.has(key) }).toEqual({ key, allowed: true });
    }
  });
});

// ---------------------------------------------------------------------------

describe("SH-10 export is separately authorized, bounded and spreadsheet-safe", () => {
  beforeAll(() => ensureWorld("quality"));

  const exportCsv = async (user: User, query = "") => {
    const res = await exportRoute(
      new Request(`http://localhost:3000/api/analysis/sales/export${query}`, { headers: { cookie: user.cookie } }),
      { params: Promise.resolve({}) },
    );
    return { status: res.status, headers: res.headers, text: await res.text() };
  };

  test("reading sales on screen does not imply exporting them", async () => {
    expect(permissionsFor("SALES_VIEWER")).toContain("sales.read");
    expect(permissionsFor("SALES_VIEWER")).not.toContain("sales.export");
    expect((await exportCsv(salesViewer)).status).toBe(403);
    expect((await exportCsv(scientist)).status).toBe(200);
  });

  test("a value a spreadsheet would execute is neutralised", async () => {
    const csv = await exportCsv(admin);
    expect(csv.status).toBe(200);
    // The fixture contains an approved shape whose value begins with a formula trigger.
    expect(csv.text).toContain("=CMD");
    expect(csv.text).toContain(`"'=CMD"`);
    for (const line of csv.text.split("\r\n").slice(1)) {
      for (const cell of line.split(",")) {
        expect({ cell, unsafe: /^"[=+@]/.test(cell) }).toEqual({ cell, unsafe: false });
      }
    }
  });

  test("the export uses the same filters as the screen and states its own limits", async () => {
    const filtered = await exportCsv(admin, "?lab=GIA&sortKey=category&sortDir=asc");
    const screen = await get(salesRoute, `${SUMMARY}?pageSize=200&lab=GIA&sortKey=category&sortDir=asc`, admin);
    expect(filtered.text.split("\r\n").length - 1).toBe(screen.json.paging.total);
    expect(filtered.headers.get("x-sales-export-total")).toBe(String(screen.json.paging.total));
    expect(filtered.headers.get("x-sales-export-truncated")).toBe("false");
    expect(Number(filtered.headers.get("x-sales-export-limit"))).toBeGreaterThan(0);
  });

  test("every export leaves an audit record naming the authenticated actor", async () => {
    await db.auditLog.deleteMany({ where: { action: "SALES_ANALYSIS_EXPORTED" } });
    await exportCsv(analyst);
    const rows = await db.auditLog.findMany({ where: { action: "SALES_ANALYSIS_EXPORTED" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(analyst.user.id);
    expect(rows[0].entity).toBe("DemandRun");
  });
});

// ---------------------------------------------------------------------------

describe("SH-11 reading sales changes nothing", () => {
  beforeAll(() => ensureWorld("core"));

  test("no sales, inventory or demand record is created, altered or removed by a read", async () => {
    const census = async () => ({
      runs: await db.demandRun.count(),
      metrics: await db.demandMetric.count(),
      trace: await db.demandMetricTraceItem.count(),
      masters: await db.lotMasterRecord.count(),
      history: await db.lotHistoryRecord.count(),
      issues: await db.dataQualityIssue.count(),
      orders: await db.salesOrderLine.count(),
      updatedAt: (await db.lotMasterRecord.findMany({ select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 }))[0]?.updatedAt ?? null,
    });

    const before = await census();
    for (const path of [
      `${SUMMARY}?pageSize=200`,
      `${SUMMARY}?country=BE`,
    ]) await get(salesRoute, path, admin);
    await get(trendRoute, "/api/analysis/sales/trend?interval=day", admin);
    await get(movementRoute, "/api/analysis/sales/movement?pageSize=200", admin);
    await get(contributionRoute, "/api/analysis/sales/contribution?dimension=customer", admin);
    await get(recordsRoute, "/api/analysis/sales/records?pageSize=200", admin);
    expect(await census()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------

describe("SH-12 large data is paged, never silently shortened", () => {
  beforeAll(() => ensureWorld("bulk"));
  afterAll(cleanupSalesWorld);

  test("every confirmed record is reachable through stable paging, with no gap or repeat", async () => {
    const first = await get(recordsRoute, "/api/analysis/sales/records?pageSize=50&sortKey=docDate&sortDir=desc", admin);
    expect(first.json.paging.total).toBe(BULK_LOT_COUNT);
    expect(first.json.paging.hasMore).toBe(true);

    const seen = new Set<string>();
    const pages = Math.ceil(BULK_LOT_COUNT / 50);
    for (let page = 1; page <= pages; page++) {
      const r = await get(recordsRoute, `/api/analysis/sales/records?pageSize=50&page=${page}&sortKey=docDate&sortDir=desc`, admin);
      expect({ page, total: r.json.paging.total }).toEqual({ page, total: BULK_LOT_COUNT });
      for (const row of r.json.rows) seen.add(row.recordId);
    }
    expect(seen.size).toBe(BULK_LOT_COUNT);
  });

  test("repeating a page returns the same rows in the same order", async () => {
    const url = "/api/analysis/sales/records?pageSize=25&page=4&sortKey=quantity&sortDir=desc";
    const a = await get(recordsRoute, url, admin);
    const b = await get(recordsRoute, url, admin);
    expect(a.json.rows.map((r: { recordId: string }) => r.recordId)).toEqual(b.json.rows.map((r: { recordId: string }) => r.recordId));
  });

  test("server-side sorting orders the whole result, not the loaded page", async () => {
    const desc = await get(salesRoute, `${SUMMARY}?pageSize=3&sortKey=total90&sortDir=desc`, admin);
    const asc = await get(salesRoute, `${SUMMARY}?pageSize=3&sortKey=total90&sortDir=asc`, admin);
    expect(desc.json.paging.total).toBeGreaterThan(3);
    expect(desc.json.rows[0].total90Quantity).toBeGreaterThanOrEqual(asc.json.rows[0].total90Quantity);
    const quantities = desc.json.rows.map((r: { total90Quantity: number }) => r.total90Quantity);
    expect(quantities).toEqual([...quantities].sort((x, y) => y - x));
  });

  test("the reported totals are the real totals, and a page is not mistaken for them", async () => {
    const page = await get(salesRoute, `${SUMMARY}?pageSize=2`, admin);
    const everything = await get(salesRoute, `${SUMMARY}?pageSize=200`, admin);
    expect(page.json.rows).toHaveLength(2);
    expect(page.json.paging.total).toBe(everything.json.paging.total);
    expect(page.json.totals.confirmedQuantity).toBe(everything.json.totals.confirmedQuantity);
    expect(page.json.totals.confirmedQuantity).toBe(BULK_LOT_COUNT);
  });
});
