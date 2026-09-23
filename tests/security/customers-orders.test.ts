import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as customersOrders } from "@/app/api/analysis/customers-orders/route";
import { GET as orderAvailability } from "@/app/api/analysis/customers-orders/orders/route";
import { resolveSalesSnapshot } from "@/lib/analytics/sales-history";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import {
  EMPTY_CUSTOMER_FILTERS,
  readCustomerSummary,
  resolveOrderSourceState,
  UNIDENTIFIED_CUSTOMER_KEY,
} from "@/lib/analysis/customers-orders";

/**
 * Customers and Orders.
 *
 * The page attributes sales the confirmed-sales policy already admitted; it never
 * re-decides what a sale is. These tests therefore assert attribution, identity and
 * authorization — and that the order tab reports the absence of a source rather than
 * dressing seeded rows as Fantasy data.
 */

const BATCH = "CO-TEST";

async function makeSale(opts: {
  lotId: string; customerCode: string | null; customerName?: string | null;
  docDate: Date; weight?: number; shape?: string; country?: string; branch?: string;
}) {
  const { lotId, customerCode, customerName = null, docDate, weight = 1.2, shape = "ROUND", country = "IN", branch = "SRT" } = opts;
  await db.lotMasterRecord.upsert({
    where: { lotId },
    create: {
      lotId, currentStatus: "SOLD", statusEffectiveDate: docDate, docDate,
      shape, weight, labNormalized: "GIA", quantity: 1, country, branch,
      lastSyncBatchId: BATCH, isCurrent: true, sourceType: "FIXTURE", isSimulated: true,
      removalReason: "EXPLICIT_SALE", customerCode, customerName, currentVersion: 1,
    },
    update: { customerCode, customerName },
  });
  await db.lotHistoryRecord.create({
    data: {
      lotId, version: 1, status: "SOLD", docDate, statusEffectiveDate: docDate,
      shape, weight, labNormalized: "GIA", quantity: 1, country, branch,
      syncBatchId: BATCH, checkpoint: 1, isCurrent: true, isSimulated: true,
      removalReason: "EXPLICIT_SALE", customerName,
    },
  });
}

/**
 * The approved mappings the demand run needs to resolve a category.
 *
 * Without these every sale is quarantined as unmapped and the trace holds no included
 * SALE row — which would make the attribution assertions below pass vacuously against
 * two empty sets. Seeding them exercises the real category path rather than bypassing it.
 */
async function ensureCategoryMappings() {
  await db.labMapping.upsert({
    where: { rawLab: "GIA" }, create: { rawLab: "GIA", normalizedLab: "GIA", active: true }, update: { active: true },
  });
  await db.shapeMapping.upsert({
    where: { rawShape: "ROUND" }, create: { rawShape: "ROUND", normalizedShape: "ROUND", active: true }, update: { normalizedShape: "ROUND", active: true },
  });
  await db.weightBand.upsert({
    where: { code: "CO-B110" },
    create: { code: "CO-B110", label: "1.10-1.49", minCt: 1.1, maxCt: 1.49, sortOrder: 1, active: true },
    update: { active: true },
  });
}

async function clearFixtures() {
  await db.demandMetricTraceItem.deleteMany({});
  await db.demandMetric.deleteMany({});
  await db.demandRun.deleteMany({});
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Customers and Orders — authorization", () => {
  beforeAll(async () => { await resetDb(); await clearFixtures(); });

  test("anonymous requests are denied on every section", async () => {
    for (const section of ["summary", "customers", "customer-detail"]) {
      resetRateLimits();
      const res = await call(customersOrders, { path: `/api/analysis/customers-orders?section=${section}` });
      expect({ section, status: res.status }).toEqual({ section, status: 401 });
    }
    resetRateLimits();
    expect((await call(orderAvailability, { path: "/api/analysis/customers-orders/orders" })).status).toBe(401);
  });

  test("a user without customers.read is denied", async () => {
    // PLANNER holds planning permissions but no customer access — a real negative case.
    const planner = await makeUser("co.planner", "PLANNER");
    resetRateLimits();
    const res = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers", cookie: planner.cookie,
    });
    expect(res.status).toBe(403);
  });

  test("a user holding both permissions reaches both sections", async () => {
    const analyst = await makeUser("co.analyst", "DATA_ANALYST");
    resetRateLimits();
    expect((await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers", cookie: analyst.cookie,
    })).status).toBe(200);

    resetRateLimits();
    expect((await call(orderAvailability, {
      path: "/api/analysis/customers-orders/orders", cookie: analyst.cookie,
    })).status).toBe(200);
  });

  test("an authorized analyst can read every customer section", async () => {
    const analyst = await makeUser("co.reader", "ANALYSIS_MANAGER");
    for (const section of ["summary", "customers"]) {
      resetRateLimits();
      const res = await call(customersOrders, {
        path: `/api/analysis/customers-orders?section=${section}`, cookie: analyst.cookie,
      });
      expect({ section, status: res.status }).toEqual({ section, status: 200 });
    }
  });
});

describe("Customers and Orders — order source", () => {
  let cookie = "";
  beforeAll(async () => { await resetDb(); cookie = (await makeUser("co.orders", "DATA_ANALYST")).cookie; });

  test("Fantasy supplies no order entity, and the page says so", async () => {
    const source = await resolveOrderSourceState();
    expect({ state: source.state, reasonCode: source.reasonCode }).toEqual({
      state: "NOT_CONFIGURED",
      reasonCode: "FANTASY_ORDER_ENTITY_NOT_SUPPLIED",
    });
    // Nothing is claimed as available.
    expect(source.fieldsAvailable).toEqual([]);
    for (const field of ["REQUESTED_QUANTITY", "REQUIRED_DATE", "FULFILMENT_STATUS", "BACKORDER_STATE", "CANCELLATION"]) {
      expect(source.fieldsUnavailable.includes(field)).toBe(true);
    }
  });

  test("the service still sees the seeded rows, so their exclusion is a decision not an accident", async () => {
    // This is the server-side consumer of the internal capability structure: it proves
    // the seeded SalesOrder rows exist and are deliberately kept out of reporting.
    const seeded = await db.salesOrder.count();
    const source = await resolveOrderSourceState();
    expect(source.seededOrderCount).toBe(seeded);
    expect(source.state).toBe("NOT_CONFIGURED");
  });

  test("the browser receives the state and nothing about the database behind it", async () => {
    resetRateLimits();
    const res = await call(orderAvailability, { path: "/api/analysis/customers-orders/orders", cookie });

    expect({ available: res.json.available, rows: res.json.rows.length }).toEqual({ available: false, rows: 0 });
    expect(res.json.state).toBe("NOT_CONFIGURED");
    // Exactly the approved fields, nothing more.
    expect(Object.keys(res.json).sort()).toEqual(["available", "message", "nextStep", "rows", "state"]);

    const payload = JSON.stringify(res.json);
    for (const internal of [
      "seededOrderCount", "seededOrderLineCount", "fieldsAvailable", "fieldsUnavailable",
      "FANTASY_ORDER_ENTITY_NOT_SUPPLIED", "reasonCode", "ORDER_IDENTITY",
      "REQUESTED_QUANTITY", "FULFILLED_QUANTITY", "SalesOrder", "orderNumber",
      "requiredDate", "promisedDate",
    ]) {
      expect(payload.includes(internal)).toBe(false);
    }
  });

  test("an invoice is never reported as an open order", async () => {
    await clearFixtures();
    await ensureCategoryMappings();
    await makeSale({ lotId: `${BATCH}-INV`, customerCode: "CUST-A", docDate: new Date(Date.now() - 5 * 86_400_000) });
    await runDemandCalculation({ actor: "co-test", actorUserId: null, windowDays: 90, sourcePolicy: "CANONICAL_FANTASY" });

    resetRateLimits();
    const orders = await call(orderAvailability, { path: "/api/analysis/customers-orders/orders", cookie });
    // The sale exists and is counted as a sale; the orders tab still reports no orders.
    expect(orders.json.rows.length).toBe(0);
    expect(orders.json.available).toBe(false);

    resetRateLimits();
    const customers = await call(customersOrders, { path: "/api/analysis/customers-orders?section=customers", cookie });
    expect(customers.json.totals.confirmedQuantity >= 1).toBe(true);
  });
});

describe("Customers and Orders — customer attribution", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureCategoryMappings();
    cookie = (await makeUser("co.attrib", "ANALYSIS_MANAGER")).cookie;
    const day = 86_400_000;

    // Two distinct customers sharing a NAME but holding different codes.
    await makeSale({ lotId: `${BATCH}-A1`, customerCode: "CUST-A", customerName: "Shared Name Ltd", docDate: new Date(Date.now() - 5 * day) });
    await makeSale({ lotId: `${BATCH}-B1`, customerCode: "CUST-B", customerName: "Shared Name Ltd", docDate: new Date(Date.now() - 6 * day) });
    // A sale with no customer identity at all.
    await makeSale({ lotId: `${BATCH}-N1`, customerCode: null, customerName: null, docDate: new Date(Date.now() - 7 * day) });
    // A second sale for CUST-A in an earlier 30-day window.
    await makeSale({ lotId: `${BATCH}-A2`, customerCode: "CUST-A", customerName: "Shared Name Ltd", docDate: new Date(Date.now() - 40 * day) });

    const run = await runDemandCalculation({ actor: "co-test", actorUserId: null, windowDays: 90, sourcePolicy: "CANONICAL_FANTASY" });
    runId = run.runId;
  });

  test("customers sharing a name but holding different codes are never merged", async () => {
    const summary = await readCustomerSummary(EMPTY_CUSTOMER_FILTERS, { page: 1, pageSize: 50 }, { key: "customerCode", dir: "asc" }, true);
    const codes = (summary?.rows ?? []).map((r) => r.customerCode).filter(Boolean).sort();
    expect(codes).toEqual(["CUST-A", "CUST-B"]);

    const a = summary!.rows.find((r) => r.customerCode === "CUST-A")!;
    const b = summary!.rows.find((r) => r.customerCode === "CUST-B")!;
    // Both carry the same display name; neither absorbed the other's sales.
    expect({ aName: a.customerName, bName: b.customerName }).toEqual({
      aName: "Shared Name Ltd", bName: "Shared Name Ltd",
    });
    expect(a.customerKey).not.toBe(b.customerKey);
    expect(b.saleRecordCount).toBe(1);
  });

  test("sales with no customer identity form one explicit bucket", async () => {
    const summary = await readCustomerSummary(EMPTY_CUSTOMER_FILTERS, { page: 1, pageSize: 50 }, { key: "customerCode", dir: "asc" }, true);
    const missing = summary!.rows.find((r) => r.customerKey === UNIDENTIFIED_CUSTOMER_KEY);
    expect(missing !== undefined).toBe(true);
    expect({ identity: missing!.identitySource, state: missing!.dataState }).toEqual({
      identity: "MISSING", state: "IDENTITY_MISSING",
    });
    // Reported, not silently dropped and not merged into a named customer.
    expect(missing!.saleRecordCount >= 1).toBe(true);
  });

  test("customer totals reconcile with the snapshot's SALE trace", async () => {
    const snap = await resolveSalesSnapshot();
    const trace = await db.$queryRaw<Array<{ q: number; w: number; n: number }>>`
      SELECT COALESCE(SUM("quantity"),0)::float8 AS q, COALESCE(SUM("weight"),0)::float8 AS w, COUNT(*)::int AS n
      FROM "DemandMetricTraceItem"
      WHERE "runId" = ${snap!.id} AND "traceType" = 'SALE' AND "isIncluded" = TRUE`;

    const summary = await readCustomerSummary(EMPTY_CUSTOMER_FILTERS, { page: 1, pageSize: 200 }, { key: "confirmedQuantity", dir: "desc" }, true);
    // Including the unidentified bucket, customer totals must equal the snapshot total.
    expect({
      qty: summary!.totals.confirmedQuantity,
      records: summary!.totals.saleRecordCount,
    }).toEqual({ qty: trace[0].q, records: trace[0].n });
    expect(Math.abs(summary!.totals.measuredWeight - trace[0].w) < 0.000001).toBe(true);
  });

  test("quantity, weight and record count stay separate measures", async () => {
    const summary = await readCustomerSummary(EMPTY_CUSTOMER_FILTERS, { page: 1, pageSize: 50 }, { key: "confirmedQuantity", dir: "desc" }, true);
    const a = summary!.rows.find((r) => r.customerCode === "CUST-A")!;
    // Two records, two pieces, 2.4 ct — three figures that must not be interchangeable.
    expect({ records: a.saleRecordCount, qty: a.confirmedQuantity }).toEqual({ records: 2, qty: 2 });
    expect(a.measuredWeight).toBe(2.4);
    expect(a.measuredWeight).not.toBe(a.saleRecordCount);
  });

  test("the three 30-day windows sum to the confirmed quantity", async () => {
    const summary = await readCustomerSummary(EMPTY_CUSTOMER_FILTERS, { page: 1, pageSize: 50 }, { key: "confirmedQuantity", dir: "desc" }, true);
    for (const r of summary!.rows) {
      const windowed = r.previous30Quantity + r.middle30Quantity + r.latest30Quantity;
      expect({ customer: r.customerKey, windowed }).toEqual({ customer: r.customerKey, windowed: r.confirmedQuantity });
    }
    // Windows are anchored to the snapshot's IST business date and are contiguous.
    const w = summary!.windows;
    expect(w.map((x) => x.key)).toEqual(["previous30", "middle30", "latest30"]);
    expect(w[2].endDate).toBe(summary!.businessDateIst);
  });

  test("every customer sale record exists in the selected authoritative trace", async () => {
    const snap = await resolveSalesSnapshot();
    resetRateLimits();
    const detail = await call(customersOrders, {
      path: `/api/analysis/customers-orders?section=customer-detail&customerKey=CUST-A&pageSize=50`, cookie,
    });
    expect(detail.status).toBe(200);

    const traceIds = new Set(
      (await db.demandMetricTraceItem.findMany({
        where: { runId: snap!.id, traceType: "SALE", isIncluded: true }, select: { id: true },
      })).map((t) => t.id),
    );
    const detailIds = (detail.json.records as Array<{ recordId: string }>).map((r) => r.recordId);
    expect({ notInTrace: detailIds.filter((id) => !traceIds.has(id)) }).toEqual({ notInTrace: [] });
    expect(detail.json.snapshotId).toBe(snap!.id);
  });

  test("category contribution carries the exact canonical category identity", async () => {
    resetRateLimits();
    const detail = await call(customersOrders, {
      path: `/api/analysis/customers-orders?section=customer-detail&customerKey=CUST-A`, cookie,
    });
    const categories = detail.json.categories as Array<{ categoryId: string; lab: string; shape: string; weightBand: string }>;
    expect(categories.length >= 1).toBe(true);
    for (const c of categories) {
      // The id is the canonical key, and its parts agree with it — not display text.
      expect(c.categoryId).toBe(`${c.lab}|${c.shape}|${c.weightBand}`);
      const metric = await db.demandMetric.findFirst({ where: { runId, planningCategory: c.categoryId }, select: { id: true } });
      expect(metric !== null).toBe(true);
    }
  });

  test("filters are applied by the server", async () => {
    resetRateLimits();
    const filtered = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers&customerSearch=CUST-B&pageSize=50", cookie,
    });
    const codes = (filtered.json.rows as Array<{ customerCode: string | null }>).map((r) => r.customerCode);
    expect(codes).toEqual(["CUST-B"]);
    expect(filtered.json.paging.total).toBe(1);
    expect(filtered.json.activeFilters.some((f: { key: string }) => f.key === "customerSearch")).toBe(true);

    resetRateLimits();
    const byCountry = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers&country=NOWHERE&pageSize=50", cookie,
    });
    expect({ rows: byCountry.json.rows.length, total: byCountry.json.paging.total }).toEqual({ rows: 0, total: 0 });

    resetRateLimits();
    const badState = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers&dataState=NONSENSE", cookie,
    });
    // Refused, never silently defaulted.
    expect(badState.status).toBe(400);
  });

  test("pagination is server-side with real totals and no silent truncation", async () => {
    resetRateLimits();
    const page1 = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers&page=1&pageSize=1&sort=customerCode&dir=asc", cookie,
    });
    expect({ rows: page1.json.rows.length, total: page1.json.paging.total, hasMore: page1.json.paging.hasMore })
      .toEqual({ rows: 1, total: 3, hasMore: true });

    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      resetRateLimits();
      const res = await call(customersOrders, {
        path: `/api/analysis/customers-orders?section=customers&page=${page}&pageSize=1&sort=customerCode&dir=asc`, cookie,
      });
      for (const r of res.json.rows as Array<{ customerKey: string }>) seen.add(r.customerKey);
    }
    // Every customer reachable exactly once across the pages.
    expect(seen.size).toBe(3);

    resetRateLimits();
    const over = await call(customersOrders, {
      path: "/api/analysis/customers-orders?section=customers&pageSize=99999", cookie,
    });
    expect(over.status).toBe(400);
  });

  test("the fixture snapshot is labelled simulated on this page too", async () => {
    resetRateLimits();
    const summary = await call(customersOrders, { path: "/api/analysis/customers-orders?section=summary", cookie });
    expect(summary.json.sourceState).toBe("SIMULATION");
    expect(summary.json.sourceLabel).toBe("Fixture Simulation");
    // Provenance and completeness are separate dimensions. Whatever the identity
    // coverage turns out to be, it must not make a simulated snapshot read as live, and
    // the two are reported as distinct fields rather than one blended badge.
    expect(["COMPLETE", "PARTIAL", "UNKNOWN"].includes(summary.json.identityCompleteness)).toBe(true);
    expect(summary.json.sourceState).toBe("SIMULATION");
    // Usability is its own dimension too: this fixture run completed REVIEW_REQUIRED,
    // which is reported as INCOMPLETE without changing what the source is.
    const run = await resolveSalesSnapshot();
    expect(summary.json.snapshotState).toBe(run?.status === "REVIEW_REQUIRED" ? "INCOMPLETE" : "AVAILABLE");
    // No legacy blended state survives.
    expect(JSON.stringify(summary.json).includes("CURRENT")).toBe(false);
  });

  test("no raw payload, remark or internal identifier leaks", async () => {
    const payloads: string[] = [];
    for (const path of [
      "section=summary", "section=customers&pageSize=50",
      "section=customer-detail&customerKey=CUST-A",
    ]) {
      resetRateLimits();
      const res = await call(customersOrders, { path: `/api/analysis/customers-orders?${path}`, cookie });
      payloads.push(JSON.stringify(res.json));
    }
    const joined = payloads.join("");
    const leaked = [
      "rawPayloadJson", "normalizedRecordJson", "metadataJson", "traceJson",
      "remark", "Remark", "lockToken", "mappingFingerprint", "SELECT ", "prisma.",
    ].filter((n) => joined.includes(n));
    expect({ leaked }).toEqual({ leaked: [] });
  });

  test("reading the page performs no writes", async () => {
    const snapshot = async () =>
      Promise.all([
        db.lotMasterRecord.count(), db.lotHistoryRecord.count(), db.demandRun.count(),
        db.demandMetric.count(), db.demandMetricTraceItem.count(),
        db.salesOrder.count(), db.salesOrderLine.count(), db.customer.count(),
      ]);
    const before = await snapshot();
    for (const path of ["section=summary", "section=customers", "section=customer-detail&customerKey=CUST-A"]) {
      resetRateLimits();
      const res = await call(customersOrders, { path: `/api/analysis/customers-orders?${path}`, cookie });
      expect(res.status).toBe(200);
    }
    resetRateLimits();
    expect((await call(orderAvailability, { path: "/api/analysis/customers-orders/orders", cookie })).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});

describe("Customers and Orders — no snapshot", () => {
  let cookie = "";
  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    cookie = (await makeUser("co.empty", "DATA_ANALYST")).cookie;
  });

  test("no compatible sales snapshot yields NOT RUN, never zeros", async () => {
    resetRateLimits();
    const customers = await call(customersOrders, { path: "/api/analysis/customers-orders?section=customers", cookie });
    expect({ available: customers.json.available, reason: customers.json.unavailableReason }).toEqual({
      available: false, reason: "NOT_RUN",
    });

    resetRateLimits();
    const summary = await call(customersOrders, { path: "/api/analysis/customers-orders?section=summary", cookie });
    expect(summary.json.hasSnapshot).toBe(false);
    // Null, not 0 — nothing has been counted.
    expect(summary.json.recordsWithIdentity).toBe(null);
    expect(summary.json.recordsMissingIdentity).toBe(null);
    expect(summary.json.snapshotState).toBe("UNAVAILABLE");
    expect(summary.json.snapshotWarning).toBe(
      "Customer activity is unavailable because no completed 90-day sales snapshot exists.",
    );
  });
});
