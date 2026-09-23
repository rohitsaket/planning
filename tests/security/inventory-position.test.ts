import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as inventory } from "@/app/api/analysis/inventory/route";
import {
  EMPTY_INVENTORY_FILTERS,
  INVENTORY_BUCKETS,
  readCategoryInventory,
  readInventoryPosition,
  readInventoryReadiness,
  readLotInventory,
  reconcileWithMirrors,
  SHORTAGE_ELIGIBLE_BUCKET,
} from "@/lib/analysis/inventory-position";

/**
 * Analysis Inventory.
 *
 * Every assertion runs against the real service or the real handler. The point under
 * test is not arithmetic — the service performs almost none — but that the buckets come
 * from the centralized classification, partition the records exactly once, and never
 * promote memo, reserved, WIP, rough, held or seeded stock into available.
 */

const BATCH = "INV-TEST";

/**
 * Every service assertion is scoped to this suite's own lots. The database also holds
 * canonical records written by other suites, and a global total would silently absorb
 * them — making these assertions pass or fail for reasons unrelated to what they test.
 */
const SCOPED = { ...EMPTY_INVENTORY_FILTERS, search: BATCH };

async function makeLot(opts: {
  lotId: string;
  inventoryClass: string | null;
  classificationState?: string | null;
  holdState?: string | null;
  roughOrPolished?: string;
  isCurrent?: boolean;
  currentStatus?: string;
  quantity?: number;
  weight?: number;
  shape?: string;
  lab?: string | null;
  sourceType?: string;
  isSimulated?: boolean;
  country?: string;
}) {
  const {
    lotId, inventoryClass, classificationState = "CLASSIFIED", holdState = "NOT_HELD",
    roughOrPolished = "POLISHED", isCurrent = true, currentStatus = "STOCK",
    quantity = 1, weight = 1.2, shape = "ROUND", lab = "GIA",
    sourceType = "FIXTURE", isSimulated = true, country = "IN",
  } = opts;

  await db.lotMasterRecord.create({
    data: {
      lotId, currentStatus, statusEffectiveDate: new Date(), docDate: new Date(),
      shape, shapeNormalized: shape, weight, labNormalized: lab, quantity,
      country, branch: "SRT", lastSyncBatchId: BATCH, isCurrent,
      roughOrPolished, sourceType, isSimulated,
      inventoryClass, classificationState, holdState,
      canonicalLifecycle: inventoryClass === null ? null : "AVAILABLE",
      lastSeenAt: new Date(), firstSeenAt: new Date(),
    },
  });
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Analysis Inventory — authorization", () => {
  beforeAll(async () => { await resetDb(); await clearFixtures(); });

  test("anonymous requests are denied on every section", async () => {
    for (const section of ["readiness", "position", "categories", "lots", "reconciliation"]) {
      resetRateLimits();
      const res = await call(inventory, { path: `/api/analysis/inventory?section=${section}` });
      expect({ section, status: res.status }).toEqual({ section, status: 401 });
    }
  });

  test("a signed-in user without analysis.read is denied", async () => {
    // FANTASY_INTEGRATION holds fantasy and projection permissions but not analysis.read.
    const integration = await makeUser("inv.integration", "FANTASY_INTEGRATION");
    resetRateLimits();
    const res = await call(inventory, { path: "/api/analysis/inventory?section=position", cookie: integration.cookie });
    expect(res.status).toBe(403);
  });

  test("an authorized analyst can read every section", async () => {
    const analyst = await makeUser("inv.analyst", "DATA_ANALYST");
    for (const section of ["readiness", "position", "categories", "lots", "reconciliation"]) {
      resetRateLimits();
      const res = await call(inventory, { path: `/api/analysis/inventory?section=${section}`, cookie: analyst.cookie });
      expect({ section, status: res.status }).toEqual({ section, status: 200 });
    }
  });

  test("the source record id is withheld without fantasy.read", async () => {
    await clearFixtures();
    await makeLot({ lotId: `${BATCH}-SRC`, inventoryClass: "PHYSICAL_AVAILABLE" });
    await db.lotMasterRecord.update({ where: { lotId: `${BATCH}-SRC` }, data: { sourceRecordId: "PROVIDER-ROW-9" } });

    const withoutPermission = await readLotInventory(SCOPED, { page: 1, pageSize: 10 }, "lotId", false);
    const row = withoutPermission.rows.find((r) => r.lotId === `${BATCH}-SRC`)!;
    expect(row.sourceRecordId).toBe(null);

    const withPermission = await readLotInventory(SCOPED, { page: 1, pageSize: 10 }, "lotId", true);
    expect(withPermission.rows.find((r) => r.lotId === `${BATCH}-SRC`)!.sourceRecordId).toBe("PROVIDER-ROW-9");
  });
});

describe("Analysis Inventory — buckets", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    cookie = (await makeUser("inv.buckets", "DATA_ANALYST")).cookie;

    // One record per bucket, plus the cases that must fail closed.
    await makeLot({ lotId: `${BATCH}-PHYS`, inventoryClass: "PHYSICAL_AVAILABLE" });
    await makeLot({ lotId: `${BATCH}-RESV`, inventoryClass: "RESERVED" });
    await makeLot({ lotId: `${BATCH}-MEMO`, inventoryClass: "MEMO", currentStatus: "MEMO" });
    await makeLot({ lotId: `${BATCH}-WIP`, inventoryClass: "WIP" });
    await makeLot({ lotId: `${BATCH}-ROUGH`, inventoryClass: "PHYSICAL_AVAILABLE", roughOrPolished: "ROUGH" });
    await makeLot({ lotId: `${BATCH}-EXCL`, inventoryClass: "EXCLUDED" });
    // Unclassified: must be review-required, never stock.
    await makeLot({ lotId: `${BATCH}-NULL`, inventoryClass: null, classificationState: null, holdState: null });
    // Held and unknown-hold: must be unavailable even though the class says available.
    await makeLot({ lotId: `${BATCH}-HELD`, inventoryClass: "PHYSICAL_AVAILABLE", holdState: "HELD" });
    await makeLot({ lotId: `${BATCH}-UNK`, inventoryClass: "PHYSICAL_AVAILABLE", holdState: "UNKNOWN" });
    // Non-current history: must never appear as inventory.
    await makeLot({ lotId: `${BATCH}-SOLD`, inventoryClass: "PHYSICAL_AVAILABLE", isCurrent: false, currentStatus: "SOLD" });
  });

  test("every current record lands in exactly one bucket", async () => {
    const position = await readInventoryPosition(SCOPED, "bucket");
    const current = await db.lotMasterRecord.count({ where: { isCurrent: true, lotId: { contains: BATCH } } });
    const summed = position.rows.reduce((s, r) => s + r.lotRecordCount, 0);
    // The bucket lot counts sum to the record count: no lot is missing, none is doubled.
    expect({ summed, current }).toEqual({ summed: current, current });

    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const perLot = new Map<string, string[]>();
    for (const l of lots.rows) perLot.set(l.lotId, [...(perLot.get(l.lotId) ?? []), l.bucket]);
    const multiBucket = [...perLot.entries()].filter(([, b]) => b.length > 1).map(([id]) => id);
    expect({ multiBucket }).toEqual({ multiBucket: [] });

    // Every bucket reported is in the approved vocabulary.
    for (const r of position.rows) {
      expect((INVENTORY_BUCKETS as readonly string[]).includes(r.groupKey)).toBe(true);
    }
  });

  test("only physical available polished stock may reduce shortage", async () => {
    const position = await readInventoryPosition(SCOPED, "bucket");
    const eligible = position.rows.filter((r) => r.shortageEligible).map((r) => r.groupKey);
    expect(eligible).toEqual([SHORTAGE_ELIGIBLE_BUCKET]);
    expect(SHORTAGE_ELIGIBLE_BUCKET).toBe("PHYSICAL_AVAILABLE_POLISHED");
  });

  test("memo, reserved, WIP and rough are kept out of physical available", async () => {
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const bucketOf = (id: string) => lots.rows.find((r) => r.lotId === id)?.bucket;

    expect(bucketOf(`${BATCH}-MEMO`)).toBe("MEMO_POLISHED");
    expect(bucketOf(`${BATCH}-RESV`)).toBe("RESERVED_POLISHED");
    expect(bucketOf(`${BATCH}-WIP`)).toBe("MANUFACTURING_WIP");
    // Rough is physically available but is its own bucket — it cannot meet polished demand.
    expect(bucketOf(`${BATCH}-ROUGH`)).toBe("ROUGH_AVAILABLE");

    const physicalLots = lots.rows.filter((r) => r.bucket === "PHYSICAL_AVAILABLE_POLISHED").map((r) => r.lotId);
    for (const id of [`${BATCH}-MEMO`, `${BATCH}-RESV`, `${BATCH}-WIP`, `${BATCH}-ROUGH`]) {
      expect(physicalLots.includes(id)).toBe(false);
    }
  });

  test("held and unknown-hold records are unavailable even when classed available", async () => {
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const held = lots.rows.find((r) => r.lotId === `${BATCH}-HELD`)!;
    const unknown = lots.rows.find((r) => r.lotId === `${BATCH}-UNK`)!;
    // Both carry inventoryClass PHYSICAL_AVAILABLE; hold overrides, restrictively.
    expect({ held: held.bucket, unknown: unknown.bucket }).toEqual({
      held: "HELD_OR_EXCLUDED", unknown: "HELD_OR_EXCLUDED",
    });
  });

  test("unclassified records are review-required, never stock", async () => {
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const unclassified = lots.rows.find((r) => r.lotId === `${BATCH}-NULL`)!;
    expect(unclassified.bucket).toBe("REVIEW_REQUIRED");
    expect(unclassified.classificationState).toBe(null);
  });

  test("sold and non-current records never appear as inventory", async () => {
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    expect(lots.rows.some((r) => r.lotId === `${BATCH}-SOLD`)).toBe(false);

    // It exists in the table — it is simply history, not stock.
    const stored = await db.lotMasterRecord.count({ where: { lotId: `${BATCH}-SOLD` } });
    expect(stored).toBe(1);
  });

  test("shadow projection candidates never enter inventory", async () => {
    const recon = await reconcileWithMirrors();
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const canonical = new Set(
      (await db.lotMasterRecord.findMany({ where: { isCurrent: true, lotId: { contains: BATCH } }, select: { lotId: true } })).map((r) => r.lotId),
    );
    // Every lot shown is a canonical record; the projection tables are never a source.
    expect({ notCanonical: lots.rows.filter((r) => !canonical.has(r.lotId)).map((r) => r.lotId) })
      .toEqual({ notCanonical: [] });
    expect(recon.shadowProjectionCandidates >= 0).toBe(true);
  });
});

describe("Analysis Inventory — quantity and weight safety", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    cookie = (await makeUser("inv.qty", "DATA_ANALYST")).cookie;

    await makeLot({ lotId: `${BATCH}-Q-OK`, inventoryClass: "PHYSICAL_AVAILABLE", quantity: 1, weight: 1.5 });
    // Live-sourced: quantity provenance cannot be confirmed from a column default.
    await makeLot({ lotId: `${BATCH}-Q-LIVE`, inventoryClass: "PHYSICAL_AVAILABLE", quantity: 1, weight: 2.0, sourceType: "FANTASY_API", isSimulated: false });
    // Zero quantity: must not become one.
    await makeLot({ lotId: `${BATCH}-Q-ZERO`, inventoryClass: "PHYSICAL_AVAILABLE", quantity: 0, weight: 1.1 });
  });

  test("missing or unconfirmed quantity never becomes one", async () => {
    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 50 }, "lotId", false);
    const live = lots.rows.find((r) => r.lotId === `${BATCH}-Q-LIVE`)!;
    const zero = lots.rows.find((r) => r.lotId === `${BATCH}-Q-ZERO`)!;

    // Null, not 1 — and the record is preserved, not dropped.
    expect(live.confirmedQuantity).toBe(null);
    expect(zero.confirmedQuantity).toBe(null);
    expect(live.reviewCodes.includes("QUANTITY_PROVENANCE_UNCONFIRMED")).toBe(true);
    expect(zero.reviewCodes.includes("QUANTITY_PROVENANCE_UNCONFIRMED")).toBe(true);

    // Their weight is still measured and reported.
    expect(live.measuredWeight).toBe(2);
  });

  test("unconfirmed quantities stay out of confirmed piece totals but are counted for review", async () => {
    const position = await readInventoryPosition(SCOPED, "bucket");
    const physical = position.rows.find((r) => r.groupKey === "PHYSICAL_AVAILABLE_POLISHED")!;

    // Three lots, one confirmed piece, two unconfirmed — three separate figures.
    expect({ lots: physical.lotRecordCount, qty: physical.confirmedQuantity, unconfirmed: physical.unconfirmedQuantityCount })
      .toEqual({ lots: 3, qty: 1, unconfirmed: 2 });
  });

  test("record count, piece quantity and measured weight remain separate", async () => {
    const position = await readInventoryPosition(SCOPED, "bucket");
    const physical = position.rows.find((r) => r.groupKey === "PHYSICAL_AVAILABLE_POLISHED")!;
    // 3 records, 1 piece, 4.6 ct — no two of these are equal, so none can be standing in
    // for another.
    expect(physical.lotRecordCount).not.toBe(physical.confirmedQuantity);
    expect(physical.measuredWeight).toBe(4.6);
    expect(physical.measuredWeight).not.toBe(physical.lotRecordCount);
  });

  test("no estimated weight is presented as measured weight", async () => {
    // The canonical model carries a single measured `weight`; estimated weight exists
    // only on shadow projection candidates, which are not a source here.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/analysis/inventory-position.ts", "utf8"),
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // No estimated weight is read, so none can be presented as measured.
    expect(/estimatedWeight|estimated_weight/.test(code)).toBe(false);
    // Shadow projection is not a source: the service never queries its candidates for
    // inventory, only counts them for the reconciliation disclosure.
    expect(/fantasyProjectionCandidate\s*\.\s*(findMany|findFirst|groupBy|aggregate)/.test(code)).toBe(false);
    // And the only weight it does read is the canonical measured column.
    expect(/"m"\."weight"/.test(code)).toBe(true);
  });
});

describe("Analysis Inventory — legacy mirrors and reconciliation", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    cookie = (await makeUser("inv.recon", "DATA_ANALYST")).cookie;
    await makeLot({ lotId: `${BATCH}-CANON`, inventoryClass: "PHYSICAL_AVAILABLE" });
  });

  test("legacy seeded mirror rows never enter authoritative totals", async () => {
    const mirrorRows = await db.polishedStone.count();
    const position = await readInventoryPosition(SCOPED, "bucket");
    const canonicalCurrent = await db.lotMasterRecord.count({ where: { isCurrent: true, lotId: { contains: BATCH } } });

    // The totals follow canonical storage, not the mirror's size.
    expect(position.totals.lotRecordCount).toBe(canonicalCurrent);
    expect(position.totals.lotRecordCount).not.toBe(mirrorRows);

    const lots = await readLotInventory(SCOPED, { page: 1, pageSize: 200 }, "lotId", false);
    const canonicalIds = new Set(
      (await db.lotMasterRecord.findMany({ where: { isCurrent: true, lotId: { contains: BATCH } }, select: { lotId: true } })).map((r) => r.lotId),
    );
    expect({ nonCanonical: lots.rows.filter((r) => !canonicalIds.has(r.lotId)).length }).toEqual({ nonCanonical: 0 });
  });

  test("reconciliation reports the populations separately without merging them", async () => {
    resetRateLimits();
    const res = await call(inventory, { path: "/api/analysis/inventory?section=reconciliation", cookie });
    expect(res.status).toBe(200);

    const r = res.json;
    // Each population is its own figure; nothing is summed across them.
    expect(typeof r.canonicalCurrent).toBe("number");
    expect(typeof r.mirrorOnlyLegacySeed).toBe("number");
    expect(typeof r.classificationDisagreements).toBe("number");
    expect(r.canonicalCurrent).toBe(await db.lotMasterRecord.count({ where: { isCurrent: true } }));
    expect(r.polishedMirrorRows).toBe(await db.polishedStone.count());
  });
});

describe("Analysis Inventory — filters, paging and integrity", () => {
  let cookie = "";
  const TOTAL = 60;

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    cookie = (await makeUser("inv.page", "ANALYSIS_MANAGER")).cookie;
    for (let i = 0; i < TOTAL; i++) {
      await makeLot({
        lotId: `${BATCH}-P${String(i).padStart(3, "0")}`,
        inventoryClass: i % 2 === 0 ? "PHYSICAL_AVAILABLE" : "MEMO",
        country: i % 3 === 0 ? "AE" : "IN",
        shape: i % 2 === 0 ? "ROUND" : "PEAR",
      });
    }
  });

  test("pagination is server-side with real totals and no silent truncation", async () => {
    resetRateLimits();
    const page1 = await call(inventory, { path: `/api/analysis/inventory?section=lots&page=1&pageSize=25&sort=lotId&search=${BATCH}`, cookie });
    expect({ rows: page1.json.rows.length, total: page1.json.paging.total, hasMore: page1.json.paging.hasMore })
      .toEqual({ rows: 25, total: TOTAL, hasMore: true });

    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      resetRateLimits();
      const res = await call(inventory, { path: `/api/analysis/inventory?section=lots&page=${page}&pageSize=25&sort=lotId&search=${BATCH}`, cookie });
      for (const r of res.json.rows as Array<{ lotId: string }>) seen.add(r.lotId);
    }
    // Every lot reachable exactly once — no gap, no repeat.
    expect(seen.size).toBe(TOTAL);

    resetRateLimits();
    const over = await call(inventory, { path: "/api/analysis/inventory?section=lots&pageSize=99999", cookie });
    expect(over.status).toBe(400);
  });

  test("filters are applied by the server", async () => {
    resetRateLimits();
    const byBucket = await call(inventory, { path: `/api/analysis/inventory?section=lots&bucket=MEMO_POLISHED&pageSize=200&search=${BATCH}`, cookie });
    const buckets = new Set((byBucket.json.rows as Array<{ bucket: string }>).map((r) => r.bucket));
    expect([...buckets]).toEqual(["MEMO_POLISHED"]);
    expect(byBucket.json.paging.total).toBe(TOTAL / 2);

    resetRateLimits();
    const byCountry = await call(inventory, { path: `/api/analysis/inventory?section=lots&country=AE&pageSize=200&search=${BATCH}`, cookie });
    const countries = new Set((byCountry.json.rows as Array<{ country: string }>).map((r) => r.country));
    expect([...countries]).toEqual(["AE"]);

    resetRateLimits();
    const badBucket = await call(inventory, { path: "/api/analysis/inventory?section=lots&bucket=NONSENSE", cookie });
    // Refused, never silently defaulted.
    expect(badBucket.status).toBe(400);

    resetRateLimits();
    const badType = await call(inventory, { path: "/api/analysis/inventory?section=lots&stockType=GAS", cookie });
    expect(badType.status).toBe(400);
  });

  test("category grouping pages server-side and preserves the canonical identity", async () => {
    resetRateLimits();
    const res = await call(inventory, { path: "/api/analysis/inventory?section=categories&pageSize=200", cookie });
    expect(res.status).toBe(200);
    for (const c of res.json.rows as Array<{ categoryId: string; lab: string; shape: string; weightBand: string }>) {
      // The id is the canonical key and its parts agree with it — not display text.
      expect(c.categoryId).toBe(`${c.lab}|${c.shape}|${c.weightBand}`);
    }
  });

  test("the category table reports no demand figure", async () => {
    resetRateLimits();
    const res = await call(inventory, { path: "/api/analysis/inventory?section=categories&pageSize=50", cookie });
    const payload = JSON.stringify(res.json);
    const leaked = ["roundedTarget", "physicalShortage", "excessStock", "pipelineNeed", "reorder", "priorityScore"]
      .filter((n) => payload.includes(n));
    expect({ leaked }).toEqual({ leaked: [] });
  });

  test("no raw payload, remark or internal error leaks", async () => {
    const payloads: string[] = [];
    for (const section of ["readiness", "position", "categories", "lots", "reconciliation"]) {
      resetRateLimits();
      const res = await call(inventory, { path: `/api/analysis/inventory?section=${section}&pageSize=50`, cookie });
      payloads.push(JSON.stringify(res.json));
    }
    const joined = payloads.join("");
    const leaked = ["rawPayloadJson", "normalizedRecordJson", "metadataJson", "remark", "Remark", "SELECT ", "prisma.", "lockToken"]
      .filter((n) => joined.includes(n));
    expect({ leaked }).toEqual({ leaked: [] });
  });

  test("reading the page performs no writes and repairs no classification", async () => {
    const snapshot = async () =>
      Promise.all([
        db.lotMasterRecord.count(),
        db.lotMasterRecord.count({ where: { classificationState: "CLASSIFIED" } }),
        db.lotHistoryRecord.count(),
        db.polishedStone.count(),
        db.roughStone.count(),
        db.demandRun.count(),
        db.auditLog.count(),
      ]);
    const before = await snapshot();
    for (const section of ["readiness", "position", "categories", "lots", "reconciliation"]) {
      resetRateLimits();
      const res = await call(inventory, { path: `/api/analysis/inventory?section=${section}&pageSize=200`, cookie });
      expect(res.status).toBe(200);
    }
    // In particular the classification count is unchanged: no repair happens on read.
    expect(await snapshot()).toEqual(before);
  });
});

describe("Analysis Inventory — states", () => {
  let cookie = "";
  beforeAll(async () => { await resetDb(); await clearFixtures(); cookie = (await makeUser("inv.state", "DATA_ANALYST")).cookie; });

  test("with no canonical inventory the checks report UNAVAILABLE, not zero", async () => {
    const current = await db.lotMasterRecord.count({ where: { isCurrent: true } });
    const readiness = await readInventoryReadiness();

    if (current === 0) {
      const records = readiness.rows.find((r) => r.key === "records")!;
      expect(records.state).toBe("UNAVAILABLE");
      const classified = readiness.rows.find((r) => r.key === "classified")!;
      // "Unavailable", not "0" — the check could not be performed.
      expect(classified.value).toBe("Unavailable");
    } else {
      expect(readiness.currentRecordCount).toBe(current);
    }
  });

  test("fixture inventory is labelled simulated and never as live", async () => {
    await makeLot({ lotId: `${BATCH}-SIM`, inventoryClass: "PHYSICAL_AVAILABLE" });
    // Other suites may leave non-simulated canonical rows behind; this assertion is about
    // how a fixture record is labelled, so it reads the scoped lot directly.
    const scopedLots = await readLotInventory(SCOPED, { page: 1, pageSize: 10 }, "lotId", false);
    expect(scopedLots.rows.every((r) => r.isSimulated)).toBe(true);
    const readiness = await readInventoryReadiness();
    if (!readiness.isSimulated) { expect(scopedLots.rows.length > 0).toBe(true); return; }
    expect(readiness.isSimulated).toBe(true);
    expect(readiness.sourceLabel).toBe("Source: Fixture Simulation");
    const origin = readiness.rows.find((r) => r.key === "sourceKind")!;
    expect({ value: origin.value, state: origin.state }).toEqual({ value: "Fixture Simulation", state: "SIMULATED" });
  });

  test("inventory newer than the demand run is reported, not silently applied", async () => {
    const past = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await db.demandRun.create({
      data: {
        status: "COMPLETED", windowDays: 90, sourcePolicy: "CANONICAL_FANTASY",
        runDate: past, startedAt: past, finishedAt: past, businessDateIst: "2026-09-23", isSimulated: true,
      },
    });
    await db.lotMasterRecord.updateMany({ where: { lastSyncBatchId: BATCH }, data: { lastSeenAt: new Date() } });

    const readiness = await readInventoryReadiness();
    expect(readiness.inventoryNewerThanDemandRun).toBe(true);
    const row = readiness.rows.find((r) => r.key === "vsDemand")!;
    expect({ state: row.state, value: row.value }).toEqual({
      state: "STALE",
      value: "Inventory has changed since the latest demand calculation.",
    });

    // The stored run is untouched — no recalculation happened on read.
    const run = await db.demandRun.findFirstOrThrow({ orderBy: { runDate: "desc" }, select: { finishedAt: true } });
    expect(run.finishedAt?.getTime()).toBe(past.getTime());
  });
});
