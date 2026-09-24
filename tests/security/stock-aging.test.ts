import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { Prisma } from "@prisma/client";
import { GET as aging } from "@/app/api/analysis/aging/route";
import { GET as agingDashboard } from "@/app/api/analysis/aging-dashboard/route";
import { GET as transferCandidates } from "@/app/api/analysis/transfer-candidates/route";
import {
  AGING_LOCATION_MAX,
  EMPTY_AGING_FILTERS,
  readAgingLots,
  readAgingSummary,
} from "@/lib/analysis/stock-aging";
import { INVENTORY_BUCKETS, type InventoryBucket } from "@/lib/analysis/bucket-vocabulary";

/**
 * Stock Aging, the Aging Dashboard and Transfer distribution.
 *
 * Three pages, one service. What is under test is not arithmetic — there is almost none —
 * but that the figures describe the whole filtered result rather than the page on screen,
 * that one rule decides both the row flag and the count of flagged rows, and that a
 * drill-down from the dashboard actually filters the page it opens.
 *
 * Every assertion crosses the real handler or the real service. None of them constructs a
 * result and checks its own arithmetic.
 */

const BATCH = "AGING-TEST";
const SCOPED = { ...EMPTY_AGING_FILTERS, search: BATCH };

/**
 * A record for each bucket, built from the classification inputs the derivation reads.
 * The bucket is never written to the database — it is derived — so these are the inputs
 * that produce it.
 */
const BUCKET_INPUTS: Record<InventoryBucket, {
  inventoryClass: string | null;
  classificationState: string | null;
  holdState: string | null;
  roughOrPolished: string;
}> = {
  PHYSICAL_AVAILABLE_POLISHED: { inventoryClass: "PHYSICAL_AVAILABLE", classificationState: "CLASSIFIED", holdState: "NOT_HELD", roughOrPolished: "POLISHED" },
  RESERVED_POLISHED: { inventoryClass: "RESERVED", classificationState: "CLASSIFIED", holdState: "NOT_HELD", roughOrPolished: "POLISHED" },
  MEMO_POLISHED: { inventoryClass: "MEMO", classificationState: "CLASSIFIED", holdState: "NOT_HELD", roughOrPolished: "POLISHED" },
  MANUFACTURING_WIP: { inventoryClass: "WIP", classificationState: "CLASSIFIED", holdState: "NOT_HELD", roughOrPolished: "WIP" },
  ROUGH_AVAILABLE: { inventoryClass: "PHYSICAL_AVAILABLE", classificationState: "CLASSIFIED", holdState: "NOT_HELD", roughOrPolished: "ROUGH" },
  HELD_OR_EXCLUDED: { inventoryClass: "PHYSICAL_AVAILABLE", classificationState: "CLASSIFIED", holdState: "HELD", roughOrPolished: "POLISHED" },
  REVIEW_REQUIRED: { inventoryClass: null, classificationState: null, holdState: "NOT_HELD", roughOrPolished: "POLISHED" },
};

interface LotSpec {
  lotId: string;
  bucket: InventoryBucket;
  quantity?: number | null;
  quantityProvenance?: string | null;
  country?: string;
  branch?: string;
  canonicalLifecycle?: string | null;
  isCurrent?: boolean;
}

async function makeLots(specs: LotSpec[]) {
  await db.lotMasterRecord.createMany({
    data: specs.map((s) => {
      const c = BUCKET_INPUTS[s.bucket];
      return {
        lotId: s.lotId,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: new Prisma.Decimal(1.5),
        labNormalized: "GIA",
        quantity: s.quantity === undefined ? new Prisma.Decimal(1) : s.quantity === null ? new Prisma.Decimal(0) : new Prisma.Decimal(s.quantity),
        quantityProvenance: s.quantityProvenance ?? null,
        country: s.country ?? "IN",
        branch: s.branch ?? "SRT",
        lastSyncBatchId: BATCH,
        isCurrent: s.isCurrent ?? true,
        roughOrPolished: c.roughOrPolished,
        sourceType: "FIXTURE",
        isSimulated: true,
        inventoryClass: c.inventoryClass,
        classificationState: c.classificationState,
        holdState: c.holdState,
        canonicalLifecycle: s.canonicalLifecycle === undefined ? "AVAILABLE" : s.canonicalLifecycle,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      };
    }),
  });
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Stock Aging — authorization", () => {
  beforeAll(async () => { await resetDb(); await clearFixtures(); });

  test("anonymous requests are denied on every surface", async () => {
    for (const [name, handler, path] of [
      ["aging lots", aging, "/api/analysis/aging?section=lots"],
      ["aging summary", aging, "/api/analysis/aging?section=summary"],
      ["dashboard", agingDashboard, "/api/analysis/aging-dashboard"],
      ["transfer", transferCandidates, "/api/analysis/transfer-candidates"],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { path });
      expect({ name, status: res.status }).toEqual({ name, status: 401 });
    }
  });

  test("a signed-in user without analysis.read is denied", async () => {
    const integration = await makeUser("aging.integration", "FANTASY_INTEGRATION");
    resetRateLimits();
    const res = await call(aging, { path: "/api/analysis/aging?section=lots", cookie: integration.cookie });
    expect(res.status).toBe(403);
  });

  test("an authorized analyst may read every surface", async () => {
    const analyst = await makeUser("aging.analyst", "DATA_ANALYST");
    for (const [name, handler, path] of [
      ["aging lots", aging, "/api/analysis/aging?section=lots"],
      ["aging summary", aging, "/api/analysis/aging?section=summary"],
      ["dashboard", agingDashboard, "/api/analysis/aging-dashboard"],
      ["transfer", transferCandidates, "/api/analysis/transfer-candidates"],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { path, cookie: analyst.cookie });
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
    }
  });
});

describe("Stock Aging — totals cover the whole result, not the page", () => {
  // Three full pages at the page size used below, plus a remainder, so paging is real.
  const PAGE_SIZE = 10;
  const TOTAL = 35;

  beforeAll(async () => {
    await clearFixtures();
    await makeLots(
      Array.from({ length: TOTAL }, (_, i) => ({
        lotId: `${BATCH}-P-${String(i).padStart(3, "0")}`,
        bucket: "PHYSICAL_AVAILABLE_POLISHED" as InventoryBucket,
        quantity: 2,
      })),
    );
  });

  test("moving between pages changes the rows and nothing else", async () => {
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => readAgingLots(SCOPED, { page, pageSize: PAGE_SIZE })),
    );

    // The rows differ page to page — otherwise the rest of this test proves nothing.
    const firstIds = pages.map((p) => p.rows[0]?.lotId);
    expect(new Set(firstIds).size).toBe(4);
    expect(pages.map((p) => p.rows.length)).toEqual([10, 10, 10, 5]);

    // Every headline figure is identical on every page.
    const totals = pages.map((p) => p.totals);
    for (const t of totals) {
      expect(t).toEqual(totals[0]);
    }
  });

  test("the confirmed quantity is the whole set, not one page of it", async () => {
    const page1 = await readAgingLots(SCOPED, { page: 1, pageSize: PAGE_SIZE });
    const onPage = page1.rows.reduce((s, r) => s + (r.confirmedQuantity ?? 0), 0);
    // 35 lots x 2 pieces. A page-scoped sum would report 20.
    expect(page1.totals.confirmedQuantity).toBe(TOTAL * 2);
    expect(onPage).toBe(PAGE_SIZE * 2);
    expect(page1.totals.confirmedQuantity === onPage).toBe(false);
  });

  test("the handler reports the same whole-result totals as the service", async () => {
    const analyst = await makeUser("aging.totals", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&page=3&pageSize=${PAGE_SIZE}`,
      cookie: analyst.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.json.totals.currentLots).toBe(TOTAL);
    expect(res.json.totals.confirmedQuantity).toBe(TOTAL * 2);
    expect(res.json.paging.page).toBe(3);
  });
});

describe("Stock Aging — one review rule for the flag and the count", () => {
  beforeAll(async () => {
    await clearFixtures();
    await makeLots([
      // Classified, countable quantity: confirmed.
      { lotId: `${BATCH}-R-OK`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 3 },
      // Classified, but the quantity is not countable: needs review.
      { lotId: `${BATCH}-R-QTY`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 3, quantityProvenance: "MISSING" },
      // Countable quantity, but never classified: needs review.
      { lotId: `${BATCH}-R-CLS`, bucket: "REVIEW_REQUIRED", quantity: 3 },
      // Neither: needs review, and is counted once.
      { lotId: `${BATCH}-R-BOTH`, bucket: "REVIEW_REQUIRED", quantity: 3, quantityProvenance: "INVALID" },
    ]);
  });

  test("the number of flagged rows equals the reported review total", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    const flagged = result.rows.filter((r) => r.dataState === "REVIEW_REQUIRED").length;
    expect({ flagged, reported: result.totals.lotsNeedingReview }).toEqual({ flagged: 3, reported: 3 });
  });

  test("a record with an unconfirmed quantity is flagged even when it is classified", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    const row = result.rows.find((r) => r.lotId === `${BATCH}-R-QTY`)!;
    expect({ state: row.dataState, qty: row.confirmedQuantity }).toEqual({ state: "REVIEW_REQUIRED", qty: null });
  });

  test("an unclassified record is flagged even when its quantity is countable", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    const row = result.rows.find((r) => r.lotId === `${BATCH}-R-CLS`)!;
    expect({ state: row.dataState, qty: row.confirmedQuantity }).toEqual({ state: "REVIEW_REQUIRED", qty: 3 });
  });

  test("an unconfirmed quantity contributes nothing to the total and is never assumed to be one", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    // Only the two countable records contribute: 3 + 3.
    expect(result.totals.confirmedQuantity).toBe(6);
  });
});

describe("Stock Aging — the dashboard drill-down opens the rows it summarizes", () => {
  beforeAll(async () => {
    await clearFixtures();
    // A different number of lots per bucket, so a filter that does nothing is visible.
    const specs: LotSpec[] = [];
    INVENTORY_BUCKETS.forEach((bucket, i) => {
      for (let n = 0; n <= i; n++) {
        specs.push({ lotId: `${BATCH}-B-${bucket}-${n}`, bucket, quantity: 1 });
      }
    });
    await makeLots(specs);
  });

  test("the summary groups by the derived bucket, not by the raw classification column", async () => {
    const summary = await readAgingSummary(SCOPED);
    const keys = summary.byBucket.map((b) => b.key).sort();
    expect(keys).toEqual([...INVENTORY_BUCKETS].sort());
  });

  test("every bucket key the dashboard emits is accepted by the Stock Aging route", async () => {
    const analyst = await makeUser("aging.drill", "DATA_ANALYST");
    resetRateLimits();
    const dash = await call(agingDashboard, { path: `/api/analysis/aging-dashboard?search=${BATCH}`, cookie: analyst.cookie });
    expect(dash.status).toBe(200);

    const outcomes: Array<{ key: string; status: number }> = [];
    for (const row of dash.json.byBucket as Array<{ key: string }>) {
      resetRateLimits();
      const res = await call(aging, {
        path: `/api/analysis/aging?section=lots&search=${BATCH}&bucket=${encodeURIComponent(row.key)}`,
        cookie: analyst.cookie,
      });
      outcomes.push({ key: row.key, status: res.status });
    }
    expect(outcomes.filter((o) => o.status !== 200)).toEqual([]);
    expect(outcomes.length).toBe(INVENTORY_BUCKETS.length);
  });

  test("each bucket filter returns exactly the lots that bucket summarized", async () => {
    const summary = await readAgingSummary(SCOPED);
    const byKey = new Map(summary.byBucket.map((b) => [b.key, b]));

    const mismatches: string[] = [];
    for (const bucket of INVENTORY_BUCKETS) {
      const filtered = await readAgingLots({ ...SCOPED, bucket }, { page: 1, pageSize: 100 });
      const summarized = byKey.get(bucket)?.lotCount ?? 0;
      if (filtered.totals.currentLots !== summarized || summarized === 0) {
        mismatches.push(`${bucket}: filtered=${filtered.totals.currentLots} summarized=${summarized}`);
      }
      // And the rows that came back really are in that bucket.
      const wrong = filtered.rows.filter((r) => r.bucket !== bucket).map((r) => r.lotId);
      if (wrong.length) mismatches.push(`${bucket}: rows in other buckets ${wrong.join(",")}`);
    }
    expect(mismatches).toEqual([]);
  });

  test("a raw inventoryClass value is refused rather than silently matching nothing", async () => {
    const analyst = await makeUser("aging.raw", "DATA_ANALYST");
    const outcomes: Array<{ raw: string; status: number }> = [];
    for (const raw of ["PHYSICAL_AVAILABLE", "MEMO", "RESERVED", "WIP", "EXCLUDED", "UNCLASSIFIED"]) {
      resetRateLimits();
      const res = await call(aging, {
        path: `/api/analysis/aging?section=lots&bucket=${raw}`,
        cookie: analyst.cookie,
      });
      outcomes.push({ raw, status: res.status });
    }
    expect(outcomes.filter((o) => o.status !== 400)).toEqual([]);
  });

  test("the bucket filter genuinely narrows the result", async () => {
    const all = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    const one = await readAgingLots({ ...SCOPED, bucket: "MEMO_POLISHED" }, { page: 1, pageSize: 100 });
    expect(one.totals.currentLots < all.totals.currentLots).toBe(true);
    expect(one.totals.currentLots > 0).toBe(true);
  });
});

describe("Stock Aging — the summary aggregates in the database", () => {
  // Enough lots that reading them all into memory to add them up would be the defect.
  const TOTAL = 240;

  beforeAll(async () => {
    await clearFixtures();
    await makeLots(
      Array.from({ length: TOTAL }, (_, i) => ({
        lotId: `${BATCH}-S-${String(i).padStart(4, "0")}`,
        bucket: (i % 2 === 0 ? "PHYSICAL_AVAILABLE_POLISHED" : "MEMO_POLISHED") as InventoryBucket,
        quantity: 1,
        country: i % 3 === 0 ? "IN" : "US",
        branch: `BR-${i % 5}`,
      })),
    );
  });

  test("the summary reads no row-level result set", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/lib/analysis/stock-aging.ts", "utf8");
    // A comment claiming a query is bounded is not evidence; the absence of the call is.
    expect(/lotMasterRecord\s*\.\s*findMany/.test(source)).toBe(false);
    expect(/lotMasterRecord\s*\.\s*groupBy/.test(source)).toBe(false);
  });

  test("the grouped totals add up to the whole filtered set", async () => {
    const summary = await readAgingSummary(SCOPED);
    const bucketLots = summary.byBucket.reduce((s, b) => s + b.lotCount, 0);
    const bucketQty = summary.byBucket.reduce((s, b) => s + b.confirmedQuantity, 0);
    expect({ currentLots: summary.currentLots, bucketLots, bucketQty })
      .toEqual({ currentLots: TOTAL, bucketLots: TOTAL, bucketQty: TOTAL });
  });

  test("the location distribution states how many locations exist", async () => {
    const summary = await readAgingSummary(SCOPED);
    // 2 countries x 5 branches, but only the combinations the data actually produced.
    expect(summary.locations.total).toBe(summary.byLocation.length);
    expect(summary.locations.truncated).toBe(false);
    expect(summary.locations.limit).toBe(AGING_LOCATION_MAX);
    const locationLots = summary.byLocation.reduce((s, l) => s + l.lotCount, 0);
    expect(locationLots).toBe(TOTAL);
  });

  test("the lot page stays bounded however large the page is asked to be", async () => {
    const huge = await readAgingLots(SCOPED, { page: 1, pageSize: 100_000 });
    expect(huge.rows.length <= 200).toBe(true);
    expect(huge.totals.currentLots).toBe(TOTAL);
  });
});

describe("Stock Aging — history is not stock", () => {
  beforeAll(async () => {
    await clearFixtures();
    await makeLots([
      { lotId: `${BATCH}-H-LIVE`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1 },
      // Still published by the feed, but sold. It is history, not inventory.
      { lotId: `${BATCH}-H-SOLD`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1, canonicalLifecycle: "SOLD" },
      { lotId: `${BATCH}-H-CLOSED`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1, canonicalLifecycle: "CLOSED" },
      { lotId: `${BATCH}-H-MOVED`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1, canonicalLifecycle: "TRANSFERRED" },
      // No longer in the feed at all.
      { lotId: `${BATCH}-H-GONE`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1, isCurrent: false },
      // Lifecycle unknown: still shown, because unknown is not evidence of departure.
      { lotId: `${BATCH}-H-UNK`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1, canonicalLifecycle: null },
    ]);
  });

  test("sold, closed, transferred and withdrawn records are excluded from current stock", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 100 });
    const ids = result.rows.map((r) => r.lotId).sort();
    expect(ids).toEqual([`${BATCH}-H-LIVE`, `${BATCH}-H-UNK`]);
    expect(result.totals.currentLots).toBe(2);
  });
});

describe("Stock Aging — no age is reported", () => {
  beforeAll(async () => {
    await clearFixtures();
    await makeLots([{ lotId: `${BATCH}-A-1`, bucket: "PHYSICAL_AVAILABLE_POLISHED", quantity: 1 }]);
  });

  test("the service states that the anchor is unconfirmed and returns no age", async () => {
    const result = await readAgingLots(SCOPED, { page: 1, pageSize: 10 });
    expect(result.availability).toBe("ANCHOR_NOT_CONFIRMED");
    expect(result.unavailableMessage !== null).toBe(true);
    const row = result.rows[0] as unknown as Record<string, unknown>;
    for (const forbidden of ["ageDays", "agingStartDateIst", "ageBand", "daysInStock"]) {
      expect({ field: forbidden, present: forbidden in row }).toEqual({ field: forbidden, present: false });
    }
  });

  test("the dashboard reports the same availability as the lot page", async () => {
    const [lots, summary] = await Promise.all([
      readAgingLots(SCOPED, { page: 1, pageSize: 10 }),
      readAgingSummary(SCOPED),
    ]);
    expect(summary.availability).toBe(lots.availability);
    expect(summary.unavailableMessage).toBe(lots.unavailableMessage);
  });

  test("the transfer surface still makes no recommendation", async () => {
    const analyst = await makeUser("aging.transfer", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(transferCandidates, { path: `/api/analysis/transfer-candidates?search=${BATCH}`, cookie: analyst.cookie });
    expect(res.status).toBe(200);
    expect(res.json.recommendationsAvailable).toBe(false);
    expect(res.json.candidates).toEqual([]);
  });
});
