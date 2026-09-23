import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as excess } from "@/app/api/analysis/excess/route";
import { GET as excessExport } from "@/app/api/analysis/excess/export/route";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import { GET as demandTrace } from "@/app/api/analysis/demand-trace/route";
import { EXCESS_EXPORT_ROW_LIMIT, EMPTY_EXCESS_FILTERS, readExcessCategories } from "@/lib/analysis/excess";
import { navHash, parseNavHash } from "@/stores/nav-store";

/**
 * Excess Stock.
 *
 * The page answers the factual counterpart of Stockout Risk, and must answer it with
 * the figure the demand engine stored. The page it replaces read the latest usable run
 * directly rather than through the authoritative selector, returned every category in
 * one unpaged response, and shipped the shortage and excess formulas in a `warning`
 * field — so it could disagree with Demand Overview about the same category.
 *
 * Every assertion runs against the real service or the real route handler.
 */

const BATCH = "EXCESS-TEST";
const BASE = new Date("2026-09-20T06:00:00.000Z");
const CRLF = "\r\n";

async function makeLot(o: {
  lotId: string; shape: string; inventoryClass: string;
  currentStatus?: string; isCurrent?: boolean;
}) {
  const { lotId, shape, inventoryClass, currentStatus = "STOCK", isCurrent = true } = o;
  await db.lotMasterRecord.create({
    data: {
      lotId, currentStatus, statusEffectiveDate: BASE, docDate: BASE,
      shape, shapeNormalized: shape, weight: 1.2, labNormalized: "GIA", quantity: 1,
      country: "IN", branch: "SRT", lastSyncBatchId: BATCH, isCurrent,
      roughOrPolished: "POLISHED", sourceType: "FIXTURE", isSimulated: true,
      inventoryClass, classificationState: "CLASSIFIED", holdState: "NOT_HELD",
      canonicalLifecycle: "AVAILABLE", firstSeenAt: BASE, lastSeenAt: BASE, currentVersion: 1,
    },
  });
}

async function makeSale(lotId: string, shape: string, docDate: Date) {
  await db.lotMasterRecord.upsert({
    where: { lotId },
    create: {
      lotId, currentStatus: "SOLD", statusEffectiveDate: docDate, docDate,
      shape, shapeNormalized: shape, weight: 1.2, labNormalized: "GIA", quantity: 1,
      country: "IN", branch: "SRT", lastSyncBatchId: BATCH, isCurrent: true,
      sourceType: "FIXTURE", isSimulated: true, removalReason: "EXPLICIT_SALE", currentVersion: 1,
    },
    update: {},
  });
  await db.lotHistoryRecord.create({
    data: {
      lotId, version: 1, status: "SOLD", docDate, statusEffectiveDate: docDate,
      shape, shapeNormalized: shape, weight: 1.2, labNormalized: "GIA", quantity: 1,
      country: "IN", branch: "SRT", syncBatchId: BATCH, checkpoint: 1,
      isCurrent: true, isSimulated: true, removalReason: "EXPLICIT_SALE",
    },
  });
}

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
    where: { code: "EX-B110" },
    create: { code: "EX-B110", label: "1.10-1.49", minCt: 1.1, maxCt: 1.49, sortOrder: 1, active: true },
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

/** One run built directly, so every figure under test is known exactly. */
async function seedRun(): Promise<string> {
  await clearFixtures();
  await ensureMappings();

  const run = await db.demandRun.create({
    data: {
      status: "COMPLETED", windowDays: 90, ruleVersion: "DEMAND-V1",
      sourcePolicy: "CANONICAL_FANTASY", businessDateIst: "2026-09-20",
      lookbackStart: new Date(BASE.getTime() - 89 * 86_400_000), lookbackEnd: BASE,
      startedAt: BASE, finishedAt: BASE, isSimulated: true, actor: "excess-test",
    },
  });

  const rows = [
    // Excess: available above target.
    { cat: "GIA|HEART|1.10-1.49", shape: "HEART", sales: 6, target: 4, avail: 11, excess: 7, short: 0, memo: 2, wip: 3 },
    // Below target: a shortage, no excess.
    { cat: "GIA|ASSCHER|1.10-1.49", shape: "ASSCHER", sales: 9, target: 6, avail: 2, excess: 0, short: 4, memo: 0, wip: 0 },
    // Exactly at target.
    { cat: "GIA|ROUND|1.10-1.49", shape: "ROUND", sales: 3, target: 2, avail: 2, excess: 0, short: 0, memo: 0, wip: 0 },
  ];
  for (const r of rows) {
    await db.demandMetric.create({
      data: {
        runId: run.id, planningCategory: r.cat, labNormalized: "GIA",
        shapeNormalized: r.shape, weightBandLabel: "1.10-1.49",
        sales90d: r.sales, monthlyAverage: r.sales / 3, unroundedTarget: r.target,
        roundedTarget: r.target, availableStock: r.avail, excessStock: r.excess,
        physicalShortage: r.short, memoQty: r.memo, wipCoverage: r.wip, unallocatedWip: 0,
        pipelineNeed: 0, remainingUnplanned: 0,
      },
    });
    // One confirmed sale trace row, so "latest confirmed sale" has a real source.
    await db.demandMetricTraceItem.create({
      data: {
        runId: run.id, planningCategory: r.cat, traceType: "SALE",
        lotId: `${BATCH}-${r.shape}`, quantity: 1, isIncluded: true,
        docDate: new Date(BASE.getTime() - 5 * 86_400_000),
      },
    });
  }
  return run.id;
}

describe("excess reads the stored demand result", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("ex.analyst", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
  });

  test("every published figure equals the value the demand engine persisted", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&pageSize=200`,
      cookie,
    });
    expect(res.status).toBe(200);

    const stored = new Map((await db.demandMetric.findMany({ where: { runId } })).map((m) => [m.planningCategory, m]));
    expect(res.json.rows.length).toBe(stored.size);

    for (const row of res.json.rows as Array<Record<string, number | string>>) {
      const m = stored.get(String(row.categoryId))!;
      expect({
        sales90d: row.sales90d,
        target: row.targetQuantity,
        available: row.physicalAvailable,
        excess: row.excessQuantity,
        memo: row.memoQuantity,
      }).toEqual({
        sales90d: m.sales90d,
        target: m.roundedTarget,
        available: m.availableStock,
        excess: m.excessStock,
        memo: m.memoQty,
      });
      // WIP is reported beside the excess, never inside it.
      expect(row.wipQuantity).toBe(m.wipCoverage + m.unallocatedWip);
    }
  });

  test("agrees with Stockout and Demand Overview for the same run and category", async () => {
    resetRateLimits();
    const ex = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&pageSize=200`,
      cookie,
    });
    resetRateLimits();
    const so = await call(stockout, {
      path: `/api/analysis/stockout?section=categories&runId=${runId}&shortageOnly=false&pageSize=200`,
      cookie,
    });
    resetRateLimits();
    const trace = await call(demandTrace, { path: `/api/analysis/demand-trace?runId=${runId}`, cookie });

    const byStockout = new Map(
      (so.json.rows as Array<Record<string, number | string>>).map((r) => [String(r.categoryId), r]),
    );
    const byTrace = new Map(
      (trace.json.categories as Array<Record<string, unknown>>).map((c) => [String(c.category ?? c.categoryId), c]),
    );

    let compared = 0;
    for (const row of ex.json.rows as Array<Record<string, number | string>>) {
      const s = byStockout.get(String(row.categoryId));
      const t = byTrace.get(String(row.categoryId)) as Record<string, number> | undefined;
      if (!s) continue;
      compared++;
      // The three pages are three views of one stored row.
      expect({ target: row.targetQuantity, available: row.physicalAvailable }).toEqual({
        target: s.targetQuantity,
        available: s.physicalAvailable,
      });
      if (t) {
        expect(row.targetQuantity).toBe(t.roundedTarget ?? t.target);
        expect(row.excessQuantity).toBe(t.excessStock ?? row.excessQuantity);
      }
    }
    expect(compared > 0).toBe(true);
  });

  test("the state of every row is exactly what its stored figures imply", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&pageSize=200`,
      cookie,
    });
    const stored = new Map((await db.demandMetric.findMany({ where: { runId } })).map((m) => [m.planningCategory, m]));

    for (const row of res.json.rows as Array<Record<string, string>>) {
      const m = stored.get(row.categoryId)!;
      const flagged = m.status === "REVIEW_REQUIRED" || m.status === "BLOCKED_BY_DATA_QUALITY";
      const expected = flagged ? "REVIEW_REQUIRED"
        : m.excessStock > 0 ? "EXCESS"
        : m.roundedTarget === 0 ? "NO_TARGET"
        : m.physicalShortage > 0 ? "BELOW_TARGET"
        : "AT_TARGET";
      expect({ c: row.categoryId, state: row.excessState }).toEqual({ c: row.categoryId, state: expected });
    }
  });

  test("excess-only is the default view and is user-changeable", async () => {
    resetRateLimits();
    const dflt = await call(excess, { path: `/api/analysis/excess?section=categories&runId=${runId}`, cookie });
    for (const r of dflt.json.rows as Array<{ excessQuantity: number }>) expect(r.excessQuantity > 0).toBe(true);
    expect(dflt.json.paging.total).toBe(1);

    resetRateLimits();
    const all = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false`,
      cookie,
    });
    expect(all.json.paging.total).toBe(3);
  });

  test("totals are computed across every match, not the visible page", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&pageSize=1`,
      cookie,
    });
    expect(res.json.rows.length).toBe(1);
    const sums = await db.demandMetric.aggregate({
      where: { runId, status: { notIn: ["REVIEW_REQUIRED", "BLOCKED_BY_DATA_QUALITY"] } },
      _sum: { excessStock: true, availableStock: true, roundedTarget: true },
    });
    expect({
      excess: res.json.totals.totalExcessQuantity,
      available: res.json.totals.totalPhysicalAvailable,
      target: res.json.totals.totalTargetQuantity,
    }).toEqual({
      excess: sums._sum.excessStock ?? 0,
      available: sums._sum.availableStock ?? 0,
      target: sums._sum.roundedTarget ?? 0,
    });
  });

  test("memo and WIP are reported beside the excess, never inside it", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&search=HEART`,
      cookie,
    });
    const row = (res.json.rows as Array<Record<string, number>>)[0];
    // A page that folded memo or WIP into availability or excess would not return these.
    expect({ available: row.physicalAvailable, excess: row.excessQuantity, memo: row.memoQuantity, wip: row.wipQuantity }).toEqual({
      available: 11, excess: 7, memo: 2, wip: 3,
    });
  });

  test("the service and the route agree, so the route adds no arithmetic", async () => {
    const direct = await readExcessCategories(
      runId,
      { ...EMPTY_EXCESS_FILTERS, excessOnly: false },
      { page: 1, pageSize: 10 },
      { key: "excess", dir: "desc" },
    );
    resetRateLimits();
    const viaRoute = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&pageSize=10`,
      cookie,
    });
    expect(viaRoute.json.rows).toEqual(JSON.parse(JSON.stringify(direct.rows)));
    expect(viaRoute.json.totals).toEqual(JSON.parse(JSON.stringify(direct.totals)));
  });

  test("opening the page writes nothing", async () => {
    const snapshot = async () =>
      Promise.all([db.demandRun.count(), db.demandMetric.count(), db.demandMetricTraceItem.count()]);
    const before = await snapshot();
    for (const section of ["status", "categories"]) {
      resetRateLimits();
      expect((await call(excess, { path: `/api/analysis/excess?section=${section}&runId=${runId}`, cookie })).status).toBe(200);
    }
    expect(await snapshot()).toEqual(before);
  });

  test("no rule identifier, fingerprint, batch key or formula reaches the browser", async () => {
    const payloads: string[] = [];
    for (const path of [`section=status&runId=${runId}`, `section=categories&runId=${runId}&excessOnly=false`]) {
      resetRateLimits();
      payloads.push(JSON.stringify((await call(excess, { path: `/api/analysis/excess?${path}`, cookie })).json));
    }
    const joined = payloads.join("");
    for (const leaked of [
      "mappingFingerprint", "mappingVersion", "ruleVersion", "ruleId", "lastBatchId",
      "checkpoint", "sourcePolicy", "CANONICAL_FANTASY", "DEMAND-V", "MAX(0",
      "traceJson", "DemandMetric", "PolishedStone", "SELECT ", "warning",
    ]) {
      expect({ leaked, present: joined.includes(leaked) }).toEqual({ leaked, present: false });
    }
  });
});

describe("excess navigation carries the exact category", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("ex.nav", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
  });

  test("Heart opens Heart and Asscher opens Asscher through the shared hash contract", () => {
    for (const category of ["GIA|HEART|1.10-1.49", "GIA|ASSCHER|1.10-1.49"]) {
      const parsed = parseNavHash(navHash("analysis-excess", null, { runId, category, malformed: false }));
      expect(parsed?.view).toBe("analysis-excess");
      expect(parsed?.trace?.category).toBe(category);
      expect(parsed?.trace?.runId).toBe(runId);
    }
  });

  test("a named run is honoured and never replaced by the latest", async () => {
    const newer = await db.demandRun.create({
      data: {
        status: "COMPLETED", windowDays: 90, ruleVersion: "DEMAND-V1",
        sourcePolicy: "CANONICAL_FANTASY", businessDateIst: "2026-09-21",
        lookbackStart: BASE, lookbackEnd: BASE, startedAt: new Date(), finishedAt: new Date(),
        isSimulated: true, actor: "later",
      },
    });
    expect(newer.id === runId).toBe(false);

    resetRateLimits();
    const res = await call(excess, { path: `/api/analysis/excess?section=status&runId=${runId}`, cookie });
    expect(res.json.runId).toBe(runId);
  });

  test("a search for one category never falls back to the first row", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessOnly=false&search=ASSCHER`,
      cookie,
    });
    const rows = res.json.rows as Array<{ categoryId: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].categoryId).toBe("GIA|ASSCHER|1.10-1.49");
  });

  test("an unrecognized state filter is refused rather than silently ignored", async () => {
    resetRateLimits();
    const res = await call(excess, {
      path: `/api/analysis/excess?section=categories&runId=${runId}&excessState=ENORMOUS`,
      cookie,
    });
    expect(res.status).toBe(400);
  });
});

describe("no usable demand run", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("ex.empty", "ANALYSIS_MANAGER")).cookie;
    await clearFixtures();
  });

  test("reports NOT RUN rather than a table of zeros", async () => {
    resetRateLimits();
    const status = await call(excess, { path: "/api/analysis/excess?section=status", cookie });
    expect(status.json.hasRun).toBe(false);

    resetRateLimits();
    const rows = await call(excess, { path: "/api/analysis/excess?section=categories", cookie });
    expect(rows.json.available).toBe(false);
    expect(rows.json.rows).toEqual([]);
    // No fabricated totals.
    expect(rows.json.totals).toBe(undefined);
  });

  test("the export refuses rather than producing an empty file that looks complete", async () => {
    resetRateLimits();
    expect((await call(excessExport, { path: "/api/analysis/excess/export", cookie })).status).toBe(409);
  });
});

describe("excess authorization and export", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("ex.export", "ANALYSIS_MANAGER")).cookie;
    runId = await seedRun();
    // A category name a spreadsheet would execute if written through unescaped.
    await db.demandMetric.create({
      data: {
        runId, planningCategory: "=cmd|'/c calc'!A1", labNormalized: "GIA",
        shapeNormalized: "=cmd|'/c calc'!A1", weightBandLabel: "1.10-1.49",
        sales90d: 1, monthlyAverage: 1, unroundedTarget: 1, roundedTarget: 1,
        availableStock: 9, excessStock: 8, physicalShortage: 0,
        pipelineNeed: 0, remainingUnplanned: 0,
      },
    });
  });

  test("anonymous and unauthorized callers are refused", async () => {
    for (const section of ["status", "categories"]) {
      resetRateLimits();
      expect((await call(excess, { path: `/api/analysis/excess?section=${section}` })).status).toBe(401);
    }
    resetRateLimits();
    expect((await call(excessExport, { path: "/api/analysis/excess/export" })).status).toBe(401);

    // FANTASY_INTEGRATION holds sync permissions but no analysis access.
    const denied = (await makeUser("ex.denied", "FANTASY_INTEGRATION")).cookie;
    resetRateLimits();
    expect((await call(excess, { path: "/api/analysis/excess?section=categories", cookie: denied })).status).toBe(403);
  });

  test("an ordinary analyst may read but may not export", async () => {
    // VIEWER holds analysis.read and no export permission.
    const viewer = (await makeUser("ex.viewer", "VIEWER")).cookie;
    resetRateLimits();
    expect((await call(excess, { path: `/api/analysis/excess?section=categories&runId=${runId}`, cookie: viewer })).status).toBe(200);
    resetRateLimits();
    expect((await call(excessExport, { path: `/api/analysis/excess/export?runId=${runId}`, cookie: viewer })).status).toBe(403);
  });

  test("the export publishes exactly the approved header row", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/excess/export?runId=${runId}`, cookie);
    const header = text.split(CRLF).find((l) => l.startsWith('"Category"')) ?? "";
    expect(header).toBe(
      ["Category", "Lab", "Shape", "Weight Band", "Confirmed Sales 90D", "Target Quantity",
       "Physical Available", "Excess Quantity", "Memo Advisory", "WIP Separate",
       "Latest Confirmed Sale (IST)", "Excess State", "Data State"].map((h) => `"${h}"`).join(","),
    );
  });

  test("the export neutralizes a value a spreadsheet would execute", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/excess/export?runId=${runId}`, cookie);
    expect(text.includes(`"'=cmd|'/c calc'!A1"`)).toBe(true);
    expect(text.includes(`"=cmd`)).toBe(false);
  });

  test("the export declares its source state and row counts", async () => {
    resetRateLimits();
    const res = await fetchExport(`/api/analysis/excess/export?runId=${runId}`, cookie);
    expect(res.headers.get("x-excess-export-truncated")).toBe("false");
    expect(res.headers.get("x-excess-export-limit")).toBe(String(EXCESS_EXPORT_ROW_LIMIT));
    expect(res.headers.get("x-excess-export-simulated")).toBe("true");
    expect(Number(res.headers.get("x-excess-export-rows"))).toBe(Number(res.headers.get("x-excess-export-total")));
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(/^attachment; filename="excess-stock-(simulated-)?\d{4}-\d{2}-\d{2}\.csv"$/.test(disposition)).toBe(true);
  });

  test("the export carries no technical metadata", async () => {
    resetRateLimits();
    const text = await exportText(`/api/analysis/excess/export?runId=${runId}`, cookie);
    for (const leaked of ["mappingFingerprint", "ruleVersion", "DEMAND-V", "lastBatchId", "Checkpoint", "sourcePolicy", "DemandMetric", "runId"]) {
      expect({ leaked, present: text.includes(leaked) }).toEqual({ leaked, present: false });
    }
  });

  test("the export uses the same filters as the table", async () => {
    resetRateLimits();
    const all = await exportText(`/api/analysis/excess/export?runId=${runId}&excessOnly=false`, cookie);
    resetRateLimits();
    const scoped = await exportText(`/api/analysis/excess/export?runId=${runId}&excessOnly=false&search=HEART`, cookie);
    const dataLines = (t: string) => t.split(CRLF).filter((l) => l.startsWith('"GIA|'));
    expect(dataLines(scoped).length < dataLines(all).length).toBe(true);
    for (const line of dataLines(scoped)) expect(line.includes("HEART")).toBe(true);
  });

  test("the export is audited without row contents", async () => {
    resetRateLimits();
    await exportText(`/api/analysis/excess/export?runId=${runId}&search=HEART`, cookie);
    const entry = await db.auditLog.findFirst({
      where: { action: "EXCESS_ANALYSIS_EXPORTED" },
      orderBy: { timestamp: "desc" },
    });
    expect(entry !== null).toBe(true);
    expect(entry?.reason?.includes("search=HEART")).toBe(true);
    expect(entry?.reason?.includes("cmd|")).toBe(false);
  });
});

/** The export returns CSV, not JSON, so these two helpers read the raw body. */
async function fetchExport(path: string, cookie: string): Promise<Response> {
  return excessExport(
    new Request(`http://localhost:3000${path}`, { headers: { cookie } }),
    { params: Promise.resolve({}) },
  );
}

async function exportText(path: string, cookie: string): Promise<string> {
  return (await fetchExport(path, cookie)).text();
}
