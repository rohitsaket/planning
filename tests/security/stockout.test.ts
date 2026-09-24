import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import { GET as stockoutExport, } from "@/app/api/analysis/stockout/export/route";
import { GET as demandTrace } from "@/app/api/analysis/demand-trace/route";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { STOCKOUT_EXPORT_ROW_LIMIT, readStockoutCategories, EMPTY_STOCKOUT_FILTERS } from "@/lib/analysis/stockout";
import { navHash, parseNavHash } from "@/stores/nav-store";

/**
 * Stockout Risk.
 *
 * The page under test answers one question — which categories have confirmed demand that
 * available finished polished stock does not cover — and it must answer it with the
 * figure the demand engine stored, not one it derives itself. The page it replaced read
 * forecast predictions, subtracted them from available stock inside the route handler
 * and ranked the result CRITICAL / HIGH / MEDIUM, so it could not agree with Demand
 * Overview even in principle.
 *
 * Every assertion runs against the real service or the real route handler.
 */

const BATCH = "STOCKOUT-TEST";
/** The canonical key of the shortage category the fixture creates, resolved per suite. */
let heartCategory = "";
const BASE = new Date("2026-09-20T06:00:00.000Z");
const CRLF = "\r\n";

async function makeSale(o: {
  lotId: string; shape: string; docDate: Date; weight?: number; lab?: string;
}) {
  const { lotId, shape, docDate, weight = 1.2, lab = "GIA" } = o;
  await db.lotMasterRecord.upsert({
    where: { lotId },
    create: {
      lotId, currentStatus: "SOLD", statusEffectiveDate: docDate, docDate,
      shape, shapeNormalized: shape, weight, labRaw: lab, labNormalized: lab, quantity: 1,
      country: "IN", branch: "SRT", lastSyncBatchId: BATCH, isCurrent: true,
      sourceType: "FIXTURE", isSimulated: true, removalReason: "EXPLICIT_SALE", currentVersion: 1,
    },
    update: {},
  });
  await db.lotHistoryRecord.create({
    data: {
      lotId, version: 1, status: "SOLD", docDate, statusEffectiveDate: docDate,
      shape, shapeNormalized: shape, weight, labRaw: lab, labNormalized: lab, quantity: 1,
      country: "IN", branch: "SRT", syncBatchId: BATCH, checkpoint: 1,
      isCurrent: true, isSimulated: true, removalReason: "EXPLICIT_SALE",
    },
  });
}

/**
 * A canonical stock record, carrying the classification the demand engine reads.
 *
 * `inventoryClass`, `classificationState`, `holdState` and `canonicalLifecycle` are what
 * decide whether a lot is physically available; a record without them is unclassified
 * and correctly counts as nothing.
 */
async function makeLot(o: {
  lotId: string; shape: string; inventoryClass: string;
  currentStatus?: string; isCurrent?: boolean; lab?: string;
}) {
  const { lotId, shape, inventoryClass, currentStatus = "STOCK", isCurrent = true, lab = "GIA" } = o;
  await db.lotMasterRecord.create({
    data: {
      lotId, currentStatus, statusEffectiveDate: BASE, docDate: BASE,
      shape, shapeNormalized: shape, weight: 1.2, labRaw: lab, labNormalized: lab, quantity: 1,
      country: "IN", branch: "SRT", lastSyncBatchId: BATCH, isCurrent,
      roughOrPolished: "POLISHED", sourceType: "FIXTURE", isSimulated: true,
      inventoryClass, classificationState: "CLASSIFIED", holdState: "NOT_HELD",
      canonicalLifecycle: "AVAILABLE", firstSeenAt: BASE, lastSeenAt: BASE,
      currentVersion: 1,
    },
  });
}

const makeStock = (lotId: string, shape: string) =>
  makeLot({ lotId, shape, inventoryClass: "PHYSICAL_AVAILABLE" });

async function ensureMappings() {
  await db.labMapping.upsert({ where: { rawLab: "GIA" }, create: { rawLab: "GIA", normalizedLab: "GIA", active: true }, update: { active: true } });
  for (const shape of ["HEART", "ASSCHER", "ROUND"]) {
    await db.shapeMapping.upsert({
      where: { rawShape: shape },
      create: { rawShape: shape, normalizedShape: shape, active: true },
      update: { normalizedShape: shape, active: true },
    });
  }
  await db.weightBand.upsert({
    where: { code: "SO-B110" },
    create: { code: "SO-B110", label: "1.10-1.49", minCt: 1.1, maxCt: 1.49, sortOrder: 1, active: true },
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

/** Sales in two shapes plus one covered shape, so shortage and coverage both occur. */
async function seedRun(): Promise<string> {
  await clearFixtures();
  await ensureMappings();

  // HEART: 4 sales, no stock → shortage, out of stock.
  for (let i = 0; i < 4; i++) {
    await makeSale({ lotId: `${BATCH}-H${i}`, shape: "HEART", docDate: new Date(BASE.getTime() - (5 + i * 10) * 86_400_000) });
  }
  // ASSCHER: 2 sales, 1 available piece → shortage but not out of stock.
  for (let i = 0; i < 2; i++) {
    await makeSale({ lotId: `${BATCH}-A${i}`, shape: "ASSCHER", docDate: new Date(BASE.getTime() - (6 + i * 12) * 86_400_000) });
  }
  await makeStock(`${BATCH}-A-STOCK`, "ASSCHER");
  // ROUND: 1 sale, plenty of stock → covered.
  await makeSale({ lotId: `${BATCH}-R0`, shape: "ROUND", docDate: new Date(BASE.getTime() - 7 * 86_400_000) });
  for (let i = 0; i < 6; i++) await makeStock(`${BATCH}-R-STOCK-${i}`, "ROUND");

  // Stock that must never reach physical availability.
  await makeLot({ lotId: `${BATCH}-H-MEMO`, shape: "HEART", inventoryClass: "MEMO", currentStatus: "MEMO" });
  await makeLot({ lotId: `${BATCH}-H-RESERVED`, shape: "HEART", inventoryClass: "RESERVED" });
  await makeLot({ lotId: `${BATCH}-H-SOLD`, shape: "HEART", inventoryClass: "PHYSICAL_AVAILABLE", currentStatus: "SOLD", isCurrent: false });

  const run = await runDemandCalculation({ actor: "stockout-test", windowDays: 90, referenceDate: BASE });
  return run.runId;
}

describe("stockout reads the stored demand result", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.analyst", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
    const heart = await db.demandMetric.findFirst({ where: { runId, planningCategory: { contains: "HEART", mode: "insensitive" } } });
    heartCategory = heart!.planningCategory;
  });

  // This suite writes canonical lot records, which other suites count globally. They are
  // removed again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);

  test("every published figure equals the value the demand engine persisted", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=200`,
      cookie,
    });
    expect(res.status).toBe(200);

    const stored = await db.demandMetric.findMany({ where: { runId } });
    const byCategory = new Map(stored.map((m) => [m.planningCategory, m]));
    expect(res.json.rows.length).toBe(stored.length);

    for (const row of res.json.rows as Array<Record<string, number | string>>) {
      const m = byCategory.get(row.categoryId as string);
      expect(m !== undefined).toBe(true);
      expect({
        sales90d: row.sales90d,
        target: row.targetQuantity,
        available: row.physicalAvailable,
        shortage: row.physicalShortage,
        memo: row.memoQuantity,
      }).toEqual({
        sales90d: m!.sales90d,
        target: m!.roundedTarget,
        available: m!.availableStock,
        shortage: m!.physicalShortage,
        memo: m!.memoQty,
      });
      // WIP is reported beside the shortage, never inside it.
      expect(row.wipQuantity).toBe(m!.wipCoverage + m!.unallocatedWip);
    }
  });

  test("agrees with Demand Overview for the same run and category", async () => {
    resetRateLimits();
    const trace = await call(demandTrace, { path: `/api/analysis/demand-trace?runId=${runId}`, cookie });
    expect(trace.status).toBe(200);

    resetRateLimits();
    const so = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=200`,
      cookie,
    });

    const traceByCategory = new Map(
      (trace.json.categories as Array<Record<string, unknown>>).map((c) => [c.category ?? c.categoryId, c]),
    );
    let compared = 0;
    for (const row of so.json.rows as Array<Record<string, number | string>>) {
      const t = traceByCategory.get(row.categoryId as string) as Record<string, number> | undefined;
      if (!t) continue;
      compared++;
      expect({ shortage: row.physicalShortage, target: row.targetQuantity, available: row.physicalAvailable }).toEqual({
        shortage: t.physicalShortage,
        target: t.roundedTarget ?? t.target,
        available: t.availableStock ?? t.physicalAvailable,
      });
    }
    // The comparison must not pass vacuously.
    expect(compared > 0).toBe(true);
  });

  test("memo and non-current stock never become physical availability", async () => {
    // The category was seeded with four sales, a memo piece, a reserved piece and a sold
    // piece, and no available stock. None of those three is availability, so the engine
    // recorded none, and the shortage is the whole target.
    const heart = await db.demandMetric.findFirst({ where: { runId, planningCategory: heartCategory } });
    expect(heart !== null).toBe(true);
    expect(heart!.availableStock).toBe(0);
    expect(heart!.physicalShortage).toBe(heart!.roundedTarget);
  });

  test("memo, reserved, blocked and WIP are published beside the shortage, never inside it", async () => {
    // Seeded directly so each figure is known: a page that folded any of them into
    // availability, or deducted any of them from the shortage, would not return these.
    const category = `${BATCH}|SIDE-BY-SIDE|1.10-1.49`;
    await db.demandMetric.create({
      data: {
        runId, planningCategory: category, labNormalized: "GIA",
        shapeNormalized: "SIDE-BY-SIDE", weightBandLabel: "1.10-1.49",
        sales90d: 20, monthlyAverage: 7, unroundedTarget: 14, roundedTarget: 14,
        availableStock: 2, memoQty: 5, reservedQty: 3, blockedQty: 1,
        wipCoverage: 4, unallocatedWip: 2, physicalShortage: 12, excessStock: 0,
        pipelineNeed: 0, remainingUnplanned: 0,
      },
    });

    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&search=SIDE-BY-SIDE`,
      cookie,
    });
    const row = (res.json.rows as Array<Record<string, number>>)[0];
    expect({
      available: row.physicalAvailable,
      memo: row.memoQuantity,
      wip: row.wipQuantity,
      shortage: row.physicalShortage,
      target: row.targetQuantity,
    }).toEqual({
      available: 2,     // memo, reserved and blocked are not added to it
      memo: 5,          // reported, never deducted
      wip: 6,           // eligible plus unallocated, reported separately
      shortage: 12,     // exactly as stored: WIP did not reduce it
      target: 14,
    });

    // The detail view keeps them separate too.
    resetRateLimits();
    const detail = await call(stockout, {
      path: `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent(category)}`,
      cookie,
    });
    expect({
      reserved: detail.json.detail.reservedQuantity,
      blocked: detail.json.detail.blockedQuantity,
      shortage: detail.json.detail.physicalShortage,
    }).toEqual({ reserved: 3, blocked: 1, shortage: 12 });
  });

  test("the page reports the stored shortage even when it differs from target minus available", async () => {
    // A row whose shortage does not equal target - available. A page that recomputed
    // would report 9; a page that reads reports 4. This is the whole contract.
    const category = `${BATCH}|READ-NOT-RECOMPUTE|1.10-1.49`;
    await db.demandMetric.create({
      data: {
        runId, planningCategory: category, labNormalized: "GIA",
        shapeNormalized: "READ-NOT-RECOMPUTE", weightBandLabel: "1.10-1.49",
        sales90d: 12, monthlyAverage: 4, unroundedTarget: 10, roundedTarget: 10,
        availableStock: 1, physicalShortage: 4, excessStock: 0,
        pipelineNeed: 0, remainingUnplanned: 0,
      },
    });

    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&search=READ-NOT-RECOMPUTE`,
      cookie,
    });
    const row = (res.json.rows as Array<Record<string, number>>)[0];
    expect({ target: row.targetQuantity, available: row.physicalAvailable, shortage: row.physicalShortage }).toEqual({
      target: 10, available: 1, shortage: 4,
    });
  });

  test("a record count is never reported as a piece quantity", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent(heartCategory)}`,
      cookie,
    });
    const d = res.json.detail;
    expect(d.found).toBe(true);
    // Lots contributing and pieces available are different measures and both present.
    expect(typeof d.contributingStockLots).toBe("number");
    expect(typeof d.physicalAvailable).toBe("number");
    // The three segments sum to the confirmed 90-day quantity.
    const summed = (d.segments as Array<{ quantity: number }>).reduce((s, x) => s + x.quantity, 0);
    expect(summed).toBe(d.sales90d);
  });

  test("opening the page writes nothing", async () => {
    const snapshot = async () =>
      Promise.all([
        db.demandRun.count(), db.demandMetric.count(), db.demandMetricTraceItem.count(),
        db.lotMasterRecord.count(), db.lotHistoryRecord.count(),
      ]);
    const before = await snapshot();
    for (const section of ["status", "categories", "detail"]) {
      resetRateLimits();
      const path =
        section === "detail"
          ? `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent(heartCategory)}`
          : `/api/analysis/stockout?section=${section}&runId=${runId}`;
      expect((await call(stockout, { path, cookie })).status).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  test("no rule identifier, fingerprint, batch key or formula reaches the browser", async () => {
    const payloads: string[] = [];
    for (const path of [
      `section=status&runId=${runId}`,
      `section=categories&runId=${runId}&shortageOnly=false`,
      `section=detail&runId=${runId}&category=${encodeURIComponent(heartCategory)}`,
    ]) {
      resetRateLimits();
      payloads.push(JSON.stringify((await call(stockout, { path: `/api/analysis/stockout?${path}`, cookie })).json));
    }
    const joined = payloads.join("");
    for (const leaked of [
      "mappingFingerprint", "mappingVersion", "ruleVersion", "ruleId", "lastBatchId",
      "checkpoint", "sourcePolicy", "CANONICAL_FANTASY", "DEMAND-V", "BR-WIP-001",
      "MAX(0", "traceJson", "DemandMetric", "LotMasterRecord", "SELECT ",
      "CRITICAL", "stockoutRisk", "prediction90d",
    ]) {
      expect({ leaked, present: joined.includes(leaked) }).toEqual({ leaked, present: false });
    }
  });
});

describe("stockout states are decided from stored values", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.states", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
    const heart = await db.demandMetric.findFirst({ where: { runId, planningCategory: { contains: "HEART" } } });
    heartCategory = heart!.planningCategory;
  });

  // Canonical lot records are counted globally by other suites; they are removed
  // again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);

  test("every row's state is exactly what its stored figures imply", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=200`,
      cookie,
    });
    const stored = new Map(
      (await db.demandMetric.findMany({ where: { runId } })).map((m) => [m.planningCategory, m]),
    );

    expect((res.json.rows as unknown[]).length > 0).toBe(true);
    for (const row of res.json.rows as Array<Record<string, string | number>>) {
      const m = stored.get(String(row.categoryId))!;
      const flagged = m.status === "REVIEW_REQUIRED" || m.status === "BLOCKED_BY_DATA_QUALITY";
      const expected = flagged
        ? "REVIEW_REQUIRED"
        : m.roundedTarget > 0 && m.availableStock === 0 ? "OUT_OF_STOCK"
        : m.physicalShortage > 0 ? "SHORTAGE"
        : m.excessStock > 0 ? "EXCESS"
        : "COVERED";
      expect({ category: row.categoryId, state: row.stockoutState }).toEqual({ category: row.categoryId, state: expected });
    }
  });

  test("each unflagged outcome is decided from its own stored figures", async () => {
    // Seeded directly, one row per outcome, so every branch is exercised deterministically
    // rather than depending on what the engine happened to classify.
    const cases: Array<[string, { roundedTarget: number; availableStock: number; physicalShortage: number; excessStock: number }, string]> = [
      ["OUT", { roundedTarget: 6, availableStock: 0, physicalShortage: 6, excessStock: 0 }, "OUT_OF_STOCK"],
      ["SHORT", { roundedTarget: 6, availableStock: 2, physicalShortage: 4, excessStock: 0 }, "SHORTAGE"],
      ["COVER", { roundedTarget: 6, availableStock: 6, physicalShortage: 0, excessStock: 0 }, "COVERED"],
      ["OVER", { roundedTarget: 6, availableStock: 9, physicalShortage: 0, excessStock: 3 }, "EXCESS"],
    ];
    for (const [name, figures, _expected] of cases) {
      await db.demandMetric.create({
        data: {
          runId, planningCategory: `${BATCH}|STATE-${name}|1.10-1.49`, labNormalized: "GIA",
          shapeNormalized: `STATE-${name}`, weightBandLabel: "1.10-1.49",
          sales90d: 10, monthlyAverage: 3, unroundedTarget: figures.roundedTarget,
          pipelineNeed: 0, remainingUnplanned: 0, ...figures,
        },
      });
    }

    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&search=STATE-&pageSize=50`,
      cookie,
    });
    const byCategory = new Map(
      (res.json.rows as Array<Record<string, string>>).map((r) => [r.categoryId, r.stockoutState]),
    );
    for (const [name, , expected] of cases) {
      expect({ name, state: byCategory.get(`${BATCH}|STATE-${name}|1.10-1.49`) }).toEqual({ name, state: expected });
    }
  });

  test("a flagged category is never given a shortage verdict its figures cannot support", async () => {
    const category = `${BATCH}|FLAGGED|1.10-1.49`;
    await db.demandMetric.create({
      data: {
        runId, planningCategory: category, labNormalized: "GIA", shapeNormalized: "FLAGGED",
        weightBandLabel: "1.10-1.49", sales90d: 5, monthlyAverage: 2, unroundedTarget: 4,
        roundedTarget: 4, availableStock: 0, physicalShortage: 4, excessStock: 0,
        pipelineNeed: 0, remainingUnplanned: 0, status: "REVIEW_REQUIRED",
      },
    });
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&search=FLAGGED`,
      cookie,
    });
    const row = (res.json.rows as Array<Record<string, string>>)[0];
    expect({ state: row.stockoutState, dataState: row.dataState }).toEqual({
      state: "REVIEW_REQUIRED", dataState: "REVIEW_REQUIRED",
    });

    // And it is excluded from the authoritative totals rather than summed into them.
    resetRateLimits();
    const totals = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=200`,
      cookie,
    });
    expect(totals.json.totals.categoriesRequiringReview > 0).toBe(true);
  });

  test("no invented risk ranking survives", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false`,
      cookie,
    });
    const payload = JSON.stringify(res.json);
    for (const invented of ["CRITICAL", "HIGH", "MEDIUM", "stockoutRisk", "confidence"]) {
      expect(payload.includes(invented)).toBe(false);
    }
  });

  test("shortage-only is the default and is user-changeable", async () => {
    resetRateLimits();
    const dflt = await call(stockout, { path: `/api/analysis/stockout?section=categories&runId=${runId}`, cookie });
    resetRateLimits();
    const all = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false`,
      cookie,
    });
    expect(dflt.json.paging.total <= all.json.paging.total).toBe(true);
    for (const r of dflt.json.rows as Array<{ physicalShortage: number }>) {
      expect(r.physicalShortage > 0).toBe(true);
    }
  });

  test("an unrecognized state filter is refused rather than silently ignored", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&stockoutState=CATASTROPHIC`,
      cookie,
    });
    expect(res.status).toBe(400);
  });

  test("the status panel reports the source, window and scope limits honestly", async () => {
    resetRateLimits();
    const res = await call(stockout, { path: `/api/analysis/stockout?section=status&runId=${runId}`, cookie });
    expect(res.json.hasRun).toBe(true);
    expect(res.json.sourceState).toBe("SIMULATION");
    expect(res.json.sourceLabel).toBe("Fixture Simulation");
    expect(res.json.periodLabel).toBe("Past 90 days (IST)");
    // Country-level shortage is not claimed.
    expect(res.json.countryScopeSupported).toBe(false);
    expect(typeof res.json.countryScopeNotice).toBe("string");
  });
});

describe("no usable demand run", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.empty", "ANALYSIS_MANAGER")).cookie;
    await clearFixtures();
  });

  test("reports NOT RUN rather than zero stockouts", async () => {
    resetRateLimits();
    const status = await call(stockout, { path: "/api/analysis/stockout?section=status", cookie });
    expect(status.json.hasRun).toBe(false);
    expect(status.json.unavailableMessage).toBe(
      "No completed 90-day demand calculation is available. Stockout risk cannot be determined.",
    );

    resetRateLimits();
    const rows = await call(stockout, { path: "/api/analysis/stockout?section=categories", cookie });
    expect(rows.json.available).toBe(false);
    expect(rows.json.rows).toEqual([]);
    // No fabricated totals.
    expect(rows.json.totals).toBe(undefined);
  });

  test("the export refuses rather than producing an empty file that looks complete", async () => {
    resetRateLimits();
    const res = await call(stockoutExport, { path: "/api/analysis/stockout/export", cookie });
    expect(res.status).toBe(409);
  });
});

describe("category navigation carries the exact key", () => {
  let cookie = "";
  let runId = "";
  let asscherCategory = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.nav", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
    const heart = await db.demandMetric.findFirst({ where: { runId, planningCategory: { contains: "HEART" } } });
    const asscher = await db.demandMetric.findFirst({ where: { runId, planningCategory: { contains: "ASSCHER" } } });
    heartCategory = heart!.planningCategory;
    asscherCategory = asscher!.planningCategory;
  });

  // Canonical lot records are counted globally by other suites; they are removed
  // again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);

  test("Heart opens Heart and Asscher opens Asscher — the defect this replaces", () => {
    for (const category of [heartCategory, asscherCategory]) {
      const hash = navHash("analysis-stockout", null, { runId, category, malformed: false });
      const parsed = parseNavHash(hash);
      expect(parsed?.view).toBe("analysis-stockout");
      expect(parsed?.trace?.category).toBe(category);
      expect(parsed?.trace?.runId).toBe(runId);
    }
    // And the two are genuinely different keys, so the check is not vacuous.
    expect(heartCategory === asscherCategory).toBe(false);
  });

  test("a category containing punctuation and separators survives the round trip", () => {
    const awkward = "GIA|HEART|1.70-1.99";
    const parsed = parseNavHash(navHash("analysis-stockout", null, { runId: null, category: awkward, malformed: false }));
    expect(parsed?.trace?.category).toBe(awkward);
  });

  test("an over-long category is reported malformed rather than truncated into another key", () => {
    const parsed = parseNavHash(`#analysis-stockout?category=${encodeURIComponent("X".repeat(201))}`);
    expect(parsed?.trace?.malformed).toBe(true);
    expect(parsed?.trace?.category).toBe(null);
  });

  test("the API returns that exact category, never the first row", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent(asscherCategory)}`,
      cookie,
    });
    expect(res.json.detail.found).toBe(true);
    expect(res.json.detail.categoryId).toBe(asscherCategory);
  });

  test("a category absent from the selected run says so instead of substituting one", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent("GIA|NOT_A_SHAPE|9.99-9.99")}`,
      cookie,
    });
    expect(res.status).toBe(200);
    expect(res.json.detail.found).toBe(false);
    expect(res.json.detail.message).toBe("This category is not part of the selected demand calculation.");
  });

  test("a named run is honoured and never replaced by the latest", async () => {
    // A second, newer run exists; the link still resolves to the run it named.
    const newer = await runDemandCalculation({ actor: "stockout-test-2", windowDays: 90, referenceDate: BASE });
    expect(newer.runId === runId).toBe(false);

    resetRateLimits();
    const res = await call(stockout, { path: `/api/analysis/stockout?section=status&runId=${runId}`, cookie });
    expect(res.json.runId).toBe(runId);
  });

  test("a detail request with no category is refused", async () => {
    resetRateLimits();
    expect((await call(stockout, { path: `/api/analysis/stockout?section=detail&runId=${runId}`, cookie })).status).toBe(400);
  });
});

describe("server-side paging, sorting and filtering", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.page", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();

    // Enough categories to page through several times.
    const rows = Array.from({ length: 120 }, (_, i) => ({
      runId,
      planningCategory: `GIA|BULK${String(i).padStart(3, "0")}|1.10-1.49`,
      labNormalized: "GIA",
      shapeNormalized: `BULK${String(i).padStart(3, "0")}`,
      weightBandLabel: "1.10-1.49",
      sales90d: i,
      monthlyAverage: i / 3,
      unroundedTarget: i,
      roundedTarget: i + 5,
      availableStock: i % 7,
      physicalShortage: Math.max(0, i + 5 - (i % 7)),
      excessStock: 0,
      pipelineNeed: 0,
      remainingUnplanned: 0,
    }));
    await db.demandMetric.createMany({ data: rows });
  });

  // Canonical lot records are counted globally by other suites; they are removed
  // again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);

  test("traverses every page exactly once, with no duplicate and no omission", async () => {
    const seen: string[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      resetRateLimits();
      const res = await call(stockout, {
        path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&page=${page}&pageSize=25`,
        cookie,
      });
      total = res.json.paging.total;
      seen.push(...(res.json.rows as Array<{ categoryId: string }>).map((r) => r.categoryId));
      if (!res.json.paging.hasMore) break;
      page++;
      expect(page < 50).toBe(true);
    }
    expect(seen.length).toBe(total);
    expect(new Set(seen).size).toBe(total);
  });

  test("ordering is deterministic across repeated reads", async () => {
    const read = async () => {
      resetRateLimits();
      const res = await call(stockout, {
        path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=60&sort=physicalShortage&dir=desc`,
        cookie,
      });
      return (res.json.rows as Array<{ categoryId: string; physicalShortage: number }>).map((r) => r.categoryId);
    };
    expect(await read()).toEqual(await read());
  });

  test("the default sort really is shortage descending", async () => {
    resetRateLimits();
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&pageSize=60`,
      cookie,
    });
    const values = (res.json.rows as Array<{ physicalShortage: number }>).map((r) => r.physicalShortage);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  test("filters are applied by the server, not by the browser", async () => {
    resetRateLimits();
    const filtered = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&search=BULK01&pageSize=200`,
      cookie,
    });
    const rows = filtered.json.rows as Array<{ categoryId: string }>;
    expect(rows.length > 0).toBe(true);
    for (const r of rows) expect(r.categoryId.includes("BULK01")).toBe(true);
    expect(filtered.json.paging.total).toBe(rows.length);
  });

  test("totals are computed across every match, not the visible page", async () => {
    resetRateLimits();
    const page1 = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=5`,
      cookie,
    });
    const stored = await db.demandMetric.aggregate({
      where: { runId, status: { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] } },
      _sum: { physicalShortage: true },
    });
    expect(page1.json.rows.length).toBe(5);
    expect(page1.json.totals.totalPhysicalShortage).toBe(stored._sum.physicalShortage ?? 0);
  });

  test("the service and the route agree, so the route adds no arithmetic", async () => {
    const direct = await readStockoutCategories(
      runId,
      { ...EMPTY_STOCKOUT_FILTERS, shortageOnly: false },
      { page: 1, pageSize: 10 },
      { key: "physicalShortage", dir: "desc" },
    );
    resetRateLimits();
    const viaRoute = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=10`,
      cookie,
    });
    expect(viaRoute.json.rows).toEqual(JSON.parse(JSON.stringify(direct.rows)));
    expect(viaRoute.json.totals).toEqual(JSON.parse(JSON.stringify(direct.totals)));
  });
});

describe("authorization", () => {
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    runId = await seedRun();
  });

  // Canonical lot records are counted globally by other suites; they are removed
  // again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);

  test("an anonymous caller is denied on every section and on the export", async () => {
    for (const section of ["status", "categories", "detail"]) {
      resetRateLimits();
      expect((await call(stockout, { path: `/api/analysis/stockout?section=${section}` })).status).toBe(401);
    }
    resetRateLimits();
    expect((await call(stockoutExport, { path: "/api/analysis/stockout/export" })).status).toBe(401);
  });

  test("a signed-in user without analysis.read is denied", async () => {
    // FANTASY_INTEGRATION holds sync permissions but no analysis access.
    const { cookie } = await makeUser("so.denied", "FANTASY_INTEGRATION");
    resetRateLimits();
    expect((await call(stockout, { path: "/api/analysis/stockout?section=categories", cookie })).status).toBe(403);
  });

  test("an ordinary analyst may read but may not export", async () => {
    // VIEWER holds analysis.read and no export permission.
    const { cookie } = await makeUser("so.viewer", "VIEWER");
    resetRateLimits();
    expect((await call(stockout, { path: `/api/analysis/stockout?section=categories&runId=${runId}`, cookie })).status).toBe(200);
    resetRateLimits();
    expect((await call(stockoutExport, { path: `/api/analysis/stockout/export?runId=${runId}`, cookie })).status).toBe(403);
  });

  test("an export-authorized analyst may export", async () => {
    const { cookie } = await makeUser("so.exporter", "ANALYSIS_MANAGER");
    resetRateLimits();
    const res = await fetchExport(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    expect(res.status).toBe(200);
  });

  test("record-level evidence is not served by this page at all", async () => {
    // Demand Trace owns record-level evidence and enforces demand.trace itself. This page
    // exposes no lot, customer or sale record, so it cannot leak one.
    const { cookie } = await makeUser("so.norecords", "VIEWER");
    resetRateLimits();
    const heart = await db.demandMetric.findFirst({ where: { runId, planningCategory: { contains: "HEART" } } });
    const res = await call(stockout, {
      path: `/api/analysis/stockout?section=detail&runId=${runId}&category=${encodeURIComponent(heart!.planningCategory)}`,
      cookie,
    });
    const payload = JSON.stringify(res.json);
    for (const leaked of ["customerName", "customerCode", "lotId", "sourceRecordId", "certificate", "saleTotalUsd"]) {
      expect(payload.includes(leaked)).toBe(false);
    }
  });
});

describe("export", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("so.export", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
    // A category name a spreadsheet would execute if it were written through unescaped.
    await db.demandMetric.create({
      data: {
        runId, planningCategory: "=cmd|'/c calc'!A1", labNormalized: "GIA",
        shapeNormalized: "=cmd|'/c calc'!A1", weightBandLabel: "1.10-1.49",
        sales90d: 3, monthlyAverage: 1, unroundedTarget: 2, roundedTarget: 2,
        availableStock: 0, physicalShortage: 2, excessStock: 0, pipelineNeed: 0, remainingUnplanned: 0,
      },
    });

  // Canonical lot records are counted globally by other suites; they are removed
  // again so a later suite is not measuring this one's fixture.
  afterAll(clearFixtures);
  });

  test("publishes exactly the approved header row", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    const header = text.split(CRLF).find((l) => l.startsWith('"Category"')) ?? "";
    expect(header).toBe(
      ["Category", "Lab", "Shape", "Weight Band", "Confirmed Sales 90D", "Target Quantity",
       "Physical Available", "Physical Shortage", "Memo Advisory", "WIP Separate",
       "Stockout State", "Data State"].map((h) => `"${h}"`).join(","),
    );
  });

  test("carries no rule identifier, fingerprint, batch key or internal id", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    for (const leaked of [
      "mappingFingerprint", "ruleVersion", "DEMAND-V", "lastBatchId", "Checkpoint",
      "sourcePolicy", "CANONICAL_FANTASY", "DemandMetric", "runId",
    ]) {
      expect({ leaked, present: text.includes(leaked) }).toEqual({ leaked, present: false });
    }
  });

  test("neutralizes a value a spreadsheet would execute", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    expect(text.includes(`"'=cmd|'/c calc'!A1"`)).toBe(true);
    expect(text.includes(`"=cmd`)).toBe(false);
  });

  test("declares its source state and row counts rather than implying completeness", async () => {
    resetRateLimits();
    const res = await fetchExport(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    expect(res.headers.get("x-stockout-export-truncated")).toBe("false");
    expect(res.headers.get("x-stockout-export-limit")).toBe(String(STOCKOUT_EXPORT_ROW_LIMIT));
    expect(res.headers.get("x-stockout-export-simulated")).toBe("true");
    expect(Number(res.headers.get("x-stockout-export-rows"))).toBe(Number(res.headers.get("x-stockout-export-total")));

    resetRateLimits();
    const text = await exportText(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    expect(text.includes("SIMULATED / TEST FIXTURE DATA")).toBe(true);
    expect(text.includes("SOURCE: Fixture Simulation")).toBe(true);
  });

  test("applies the same filters as the table", async () => {
    resetRateLimits();
    const all = await exportText(`/api/analysis/stockout/export?runId=${runId}&shortageOnly=false`, cookie);
    resetRateLimits();
    const scoped = await exportText(`/api/analysis/stockout/export?runId=${runId}&shortageOnly=false&search=HEART`, cookie);
    const dataLines = (t: string) => t.split(CRLF).filter((l) => l.startsWith('"GIA|'));
    expect(dataLines(scoped).length < dataLines(all).length).toBe(true);
    for (const line of dataLines(scoped)) expect(line.includes("HEART")).toBe(true);
  });

  test("uses a safe filename built from fixed parts", async () => {
    resetRateLimits();
    const res = await fetchExport(`/api/analysis/stockout/export?runId=${runId}`, cookie);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(/^attachment; filename="stockout-(simulated-)?\d{4}-\d{2}-\d{2}\.csv"$/.test(disposition)).toBe(true);
  });

  test("records the export in the audit trail without row contents", async () => {
    resetRateLimits();
    await exportText(`/api/analysis/stockout/export?runId=${runId}&search=HEART`, cookie);
    const entry = await db.auditLog.findFirst({
      where: { action: "STOCKOUT_ANALYSIS_EXPORTED" },
      orderBy: { timestamp: "desc" },
    });
    expect(entry !== null).toBe(true);
    expect(entry?.reason?.includes("search=HEART")).toBe(true);
    // Counts and scope only — never a category's figures or a lot.
    expect(entry?.reason?.includes("cmd|")).toBe(false);
  });
});

/** The export returns CSV, not JSON, so these two helpers read the raw body. */
async function fetchExport(path: string, cookie: string): Promise<Response> {
  return stockoutExport(
    new Request(`http://localhost:3000${path}`, { headers: { cookie } }),
    { params: Promise.resolve({}) },
  );
}

async function exportText(path: string, cookie: string): Promise<string> {
  return (await fetchExport(path, cookie)).text();
}
