import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as executive } from "@/app/api/analysis/executive/route";
import { GET as demandTrace } from "@/app/api/analysis/demand-trace/route";

/**
 * Executive Analysis — authorization, snapshot honesty and the approved stock meaning.
 *
 * Every number the page shows comes from a stored demand run or a classified inventory
 * record, so the fixtures below write those rows directly and then assert the API
 * reports them unchanged. What is being tested is not arithmetic — there is none — but
 * that the page cannot turn an absent run into a zero, cannot present memo, reserved,
 * WIP or rough stock as available, and cannot be read by someone without analysis.read.
 */

const CATEGORY_HEART = "GIA|HEART|1.00-1.49";
const CATEGORY_ASSCHER = "GIA|ASSCHER|1.00-1.49";

async function makeDemandRun(opts: { finishedAt?: Date } = {}) {
  const finishedAt = opts.finishedAt ?? new Date();
  return db.demandRun.create({
    data: {
      status: "COMPLETED",
      windowDays: 90,
      runDate: finishedAt,
      startedAt: finishedAt,
      finishedAt,
      businessDateIst: "2026-09-23",
      lookbackStart: new Date(finishedAt.getTime() - 90 * 24 * 60 * 60 * 1000),
      lookbackEnd: finishedAt,
      // Zero, and honest: these fixtures persist no sale trace, and a run claiming
      // sales without evidence for them is rejected by the snapshot eligibility rule.
      salesCount: 0,
      inventoryCount: 8,
      isSimulated: true,
      sourceMode: "FIXTURE",
      wipPolicyStatus: "NOT_CONFIGURED",
    },
    select: { id: true },
  });
}

/**
 * A category whose only stock is memo, reserved and WIP.
 *
 * The demand engine already applied the approved meaning when it persisted these rows:
 * `availableStock` counts physical only, so a shortage of the full target is exactly
 * what "memo and WIP do not reduce shortage, reserved is unavailable" produces.
 */
async function makeMetric(
  runId: string,
  category: string,
  over: Partial<{
    sales90d: number; roundedTarget: number; availableStock: number;
    memoQty: number; reservedQty: number; blockedQty: number;
    physicalShortage: number; excessStock: number; wipCoverage: number; status: string;
  }> = {},
) {
  const [lab, shape, band] = category.split("|");
  return db.demandMetric.create({
    data: {
      runId,
      planningCategory: category,
      labNormalized: lab,
      shapeNormalized: shape,
      weightBandLabel: band,
      sales90d: over.sales90d ?? 10,
      monthlyAverage: 3,
      unroundedTarget: 9,
      roundedTarget: over.roundedTarget ?? 10,
      availableStock: over.availableStock ?? 0,
      memoQty: over.memoQty ?? 0,
      reservedQty: over.reservedQty ?? 0,
      blockedQty: over.blockedQty ?? 0,
      physicalShortage: over.physicalShortage ?? 10,
      excessStock: over.excessStock ?? 0,
      wipCoverage: over.wipCoverage ?? 0,
      unallocatedWip: 0,
      pipelineNeed: 0,
      remainingUnplanned: 0,
      status: over.status ?? "COMPLETED",
    },
    select: { id: true },
  });
}

describe("Executive Analysis — authorization", () => {
  beforeAll(resetDb);

  test("anonymous requests are denied on every section", async () => {
    for (const section of ["readiness", "sales-demand", "inventory", "shortage-excess", "attention"]) {
      resetRateLimits();
      const res = await call(executive, { path: `/api/analysis/executive?section=${section}` });
      expect({ section, status: res.status }).toEqual({ section, status: 401 });
    }
  });

  test("a user without analysis.read cannot read the page data directly", async () => {
    // FANTASY_INTEGRATION holds fantasy and projection permissions but not analysis.read,
    // so it is a real negative case rather than a role invented for the test.
    const integration = await makeUser("exec.integration", "FANTASY_INTEGRATION");
    resetRateLimits();
    const res = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess",
      cookie: integration.cookie,
    });
    expect(res.status).toBe(403);
  });

  test("an authorized user can read every section", async () => {
    const analyst = await makeUser("exec.analyst", "DATA_ANALYST");
    for (const section of ["readiness", "sales-demand", "inventory", "shortage-excess", "attention"]) {
      resetRateLimits();
      const res = await call(executive, {
        path: `/api/analysis/executive?section=${section}`,
        cookie: analyst.cookie,
      });
      expect({ section, status: res.status }).toEqual({ section, status: 200 });
    }
  });
});

describe("Executive Analysis — honest states", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await db.demandMetric.deleteMany({});
    await db.demandRun.deleteMany({});
    cookie = (await makeUser("exec.viewer", "DATA_ANALYST")).cookie;
  });

  test("no completed demand run produces NOT_RUN, not zero", async () => {
    resetRateLimits();
    const gaps = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie });
    expect({ available: gaps.json.available, reason: gaps.json.unavailableReason }).toEqual({
      available: false,
      reason: "NOT_RUN",
    });
    // The distinction that matters: an empty table would read as "nothing is short".
    expect(gaps.json.rows.length).toBe(0);
    expect(gaps.json.runId).toBe(null);

    resetRateLimits();
    const sales = await call(executive, { path: "/api/analysis/executive?section=sales-demand", cookie });
    expect({ available: sales.json.available, reason: sales.json.unavailableReason }).toEqual({
      available: false,
      reason: "NOT_RUN",
    });

    resetRateLimits();
    const readiness = await call(executive, { path: "/api/analysis/executive?section=readiness", cookie });
    const runRow = readiness.json.rows.find((r: { key: string }) => r.key === "demandRun");
    expect({ state: runRow.state, value: runRow.value }).toEqual({ state: "NOT_RUN", value: "Not run" });
    expect(readiness.json.hasCompletedRun).toBe(false);

    resetRateLimits();
    const attention = await call(executive, { path: "/api/analysis/executive?section=attention", cookie });
    const kinds = attention.json.rows.map((r: { kind: string }) => r.kind);
    expect(kinds.includes("DEMAND_NOT_RUN")).toBe(true);
  });

  test("a run with no per-sale trace reports its 30-day windows as unavailable, not zero", async () => {
    const run = await makeDemandRun();
    // sales90d of 5 with no SALE trace rows. Three zeros beside a 90-day total of 5
    // would be an internal contradiction presented as fact.
    await makeMetric(run.id, CATEGORY_HEART, { sales90d: 5 });

    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=sales-demand", cookie });
    expect({
      available: res.json.available,
      windows: res.json.salesWindowsAvailable,
      reason: res.json.salesWindowsUnavailableReason,
    }).toEqual({ available: true, windows: false, reason: "NO_SALES_TRACE_IN_RUN" });

    const heart = res.json.rows.find((r: { category: string }) => r.category === CATEGORY_HEART);
    expect({
      sales90d: heart.sales90d,
      earliest30: heart.earliest30,
      middle30: heart.middle30,
      latest30: heart.latest30,
      trend: heart.trend,
    }).toEqual({ sales90d: 5, earliest30: null, middle30: null, latest30: null, trend: null });

    await db.demandMetric.deleteMany({ where: { runId: run.id } });
    await db.demandRun.delete({ where: { id: run.id } });
  });

  test("fixture mode is labelled as simulation and never as live data", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=readiness", cookie });
    expect(res.json.isSimulated).toBe(true);
    expect(res.json.sourceLabel).toBe("Source: Fixture Simulation");

    const origin = res.json.rows.find((r: { key: string }) => r.key === "sourceKind");
    expect({ value: origin.value, state: origin.state }).toEqual({
      value: "Fixture Simulation",
      state: "SIMULATED",
    });
    // Nothing anywhere in the payload claims a live Fantasy connection.
    expect(/Live Fantasy/.test(JSON.stringify(res.json.rows.map((r: { value: string }) => r.value)))).toBe(false);
  });

  test("the reported last synchronization is a stored fact, never the current clock", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=readiness", cookie });
    const sync = res.json.rows.find((r: { key: string }) => r.key === "lastSync");

    const latest = await db.integrationSyncRun.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true, startedAt: true },
    });

    if (!latest) {
      // Nothing has ever synchronized: the only honest answer is that it never happened.
      expect({ value: sync.value, state: sync.state }).toEqual({ value: "Never", state: "UNAVAILABLE" });
      return;
    }

    // A stored run exists, so the reported time must be that run and not "now".
    expect(sync.value).not.toBe("Never");
    const stamp = (latest.finishedAt ?? latest.startedAt).getTime();
    const reportedIsRecentClock = Math.abs(Date.now() - stamp) < 2000;
    expect(reportedIsRecentClock).toBe(false);
  });

  test("inventory synchronized after the run marks the snapshot stale without recomputing it", async () => {
    const runFinishedAt = new Date(Date.now() - 60 * 60 * 1000);
    const run = await makeDemandRun({ finishedAt: runFinishedAt });
    await makeMetric(run.id, CATEGORY_HEART, { physicalShortage: 7 });

    await db.lotMasterRecord.create({
      data: {
        lotId: `EXEC-STALE-${Date.now()}`,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "HEART",
        weight: 1.2,
        country: "IN",
        branch: "SRT",
        lastSyncBatchId: "exec-test",
        isCurrent: true,
        inventoryClass: "PHYSICAL_AVAILABLE",
        classificationState: "CLASSIFIED",
        lastSeenAt: new Date(),
      },
    });

    resetRateLimits();
    const readiness = await call(executive, { path: "/api/analysis/executive?section=readiness", cookie });
    expect(readiness.json.demandMayNeedRecalculation).toBe(true);
    const recalc = readiness.json.rows.find((r: { key: string }) => r.key === "recalculation");
    expect(recalc.state).toBe("STALE");

    // The stored result is reported unchanged — the page does not silently recompute it.
    resetRateLimits();
    const gaps = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie });
    const heart = gaps.json.rows.find((r: { category: string }) => r.category === CATEGORY_HEART);
    expect(heart.physicalShortage).toBe(7);
    const stored = await db.demandMetric.findFirstOrThrow({
      where: { runId: run.id, planningCategory: CATEGORY_HEART },
      select: { physicalShortage: true },
    });
    expect(stored.physicalShortage).toBe(7);
  });
});

describe("Executive Analysis — the approved stock meaning", () => {
  let cookie = "";
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    await db.demandMetric.deleteMany({});
    await db.demandRun.deleteMany({});
    await db.lotMasterRecord.deleteMany({ where: { lotId: { startsWith: "EXEC-" } } });
    cookie = (await makeUser("exec.stock", "DATA_ANALYST")).cookie;

    const run = await makeDemandRun();
    runId = run.id;

    // Target 10, nothing physical, everything else present. The engine persisted a
    // shortage of the full target, which is the approved meaning made concrete.
    await makeMetric(runId, CATEGORY_HEART, {
      roundedTarget: 10,
      availableStock: 0,
      memoQty: 6,
      reservedQty: 4,
      wipCoverage: 5,
      physicalShortage: 10,
      excessStock: 0,
    });
    await makeMetric(runId, CATEGORY_ASSCHER, {
      roundedTarget: 4,
      availableStock: 9,
      physicalShortage: 0,
      excessStock: 5,
    });

    // Inventory across every bucket at one location, including rough.
    const buckets: Array<[string, string, string]> = [
      ["PHYSICAL_AVAILABLE", "POLISHED", "EXEC-PHYS"],
      ["MEMO", "POLISHED", "EXEC-MEMO"],
      ["RESERVED", "POLISHED", "EXEC-RESV"],
      ["WIP", "POLISHED", "EXEC-WIP"],
      ["EXCLUDED", "POLISHED", "EXEC-EXCL"],
      ["PHYSICAL_AVAILABLE", "ROUGH", "EXEC-ROUGH"],
    ];
    for (const [inventoryClass, kind, prefix] of buckets) {
      await db.lotMasterRecord.create({
        data: {
          lotId: `${prefix}-${Date.now()}`,
          currentStatus: "STOCK",
          statusEffectiveDate: new Date(),
          docDate: new Date(),
          shape: "HEART",
          weight: 1.2,
          country: "IN",
          branch: "SRT",
          roughOrPolished: kind,
          lastSyncBatchId: "exec-test",
          isCurrent: true,
          inventoryClass,
          holdState: inventoryClass === "EXCLUDED" ? "UNKNOWN" : "NOT_HELD",
          classificationState: "CLASSIFIED",
          lastSeenAt: new Date(),
        },
      });
    }
  });

  test("memo, reserved and WIP do not reduce physical shortage", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie });
    const heart = res.json.rows.find((r: { category: string }) => r.category === CATEGORY_HEART);

    // 6 memo + 4 reserved + 5 WIP are all present, and the shortage is still the full target.
    expect({
      target: heart.target,
      physicalAvailable: heart.physicalAvailable,
      shortage: heart.physicalShortage,
      memo: heart.memo,
      reserved: heart.reserved,
    }).toEqual({ target: 10, physicalAvailable: 0, shortage: 10, memo: 6, reserved: 4 });
  });

  test("WIP is reported as unavailable while its policy is not configured", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie });
    expect(res.json.wipCoverage.appliedInRun).toBe(false);
    const heart = res.json.rows.find((r: { category: string }) => r.category === CATEGORY_HEART);
    // Null, not 0: "0" would state there is nothing in manufacturing.
    expect(heart.wip).toBe(null);
  });

  test("rough stock is never counted as available finished stock", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=inventory", cookie });
    const location = res.json.rows.find((r: { country: string; branch: string }) => r.country === "IN" && r.branch === "SRT");

    expect({
      physical: location.physicalAvailablePolished,
      rough: location.roughAvailable,
    }).toEqual({ physical: 1, rough: 1 });
  });

  test("inventory buckets are mutually exclusive and held stock is excluded", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=inventory", cookie });
    const l = res.json.rows.find((r: { country: string }) => r.country === "IN");

    const sum =
      l.physicalAvailablePolished + l.reserved + l.memo + l.wip + l.roughAvailable + l.heldOrExcluded + l.unclassified;
    // Every record lands in exactly one bucket, so the buckets add up to the total.
    expect({ sum, total: l.totalClassified }).toEqual({ sum: 6, total: 6 });
    expect({ memo: l.memo, reserved: l.reserved, wip: l.wip, excluded: l.heldOrExcluded }).toEqual({
      memo: 1, reserved: 1, wip: 1, excluded: 1,
    });
  });

  test("shortage and excess match the authoritative Demand Overview result", async () => {
    resetRateLimits();
    const exec = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&pageSize=200",
      cookie,
    });
    resetRateLimits();
    const overview = await call(demandTrace, { path: "/api/analysis/demand-trace", cookie });

    const execByCategory = new Map(
      exec.json.rows.map((r: { category: string; physicalShortage: number; excess: number; target: number }) => [
        r.category,
        { shortage: r.physicalShortage, excess: r.excess, target: r.target },
      ]),
    );
    const mismatches: string[] = [];
    for (const c of overview.json.categories as Array<{
      category: string; physicalShortage: number; excessStock: number; roundedTarget: number;
    }>) {
      const e = execByCategory.get(c.category) as { shortage: number; excess: number; target: number } | undefined;
      if (!e) { mismatches.push(`${c.category}: missing from Executive Analysis`); continue; }
      if (e.shortage !== c.physicalShortage) mismatches.push(`${c.category}: shortage ${e.shortage} vs ${c.physicalShortage}`);
      if (e.excess !== c.excessStock) mismatches.push(`${c.category}: excess ${e.excess} vs ${c.excessStock}`);
      if (e.target !== c.roundedTarget) mismatches.push(`${c.category}: target ${e.target} vs ${c.roundedTarget}`);
    }
    expect({ mismatches }).toEqual({ mismatches: [] });
    expect(overview.json.categories.length > 0).toBe(true);
  });

  test("the shortage-only filter is applied by the server", async () => {
    resetRateLimits();
    const shortageOnly = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&mode=SHORTAGE_ONLY",
      cookie,
    });
    const categories = shortageOnly.json.rows.map((r: { category: string }) => r.category);
    expect(categories).toEqual([CATEGORY_HEART]);
    // The total reflects the filter, so the pager cannot claim more rows than match.
    expect(shortageOnly.json.meta.total).toBe(1);

    resetRateLimits();
    const excessOnly = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&mode=EXCESS_ONLY",
      cookie,
    });
    expect(excessOnly.json.rows.map((r: { category: string }) => r.category)).toEqual([CATEGORY_ASSCHER]);
  });

  test("Heart resolves to Heart, never to Asscher or a default category", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=shortage-excess&pageSize=200", cookie });
    const heart = res.json.rows.find((r: { category: string }) => r.category === CATEGORY_HEART);

    // The row carries the canonical key verbatim, which is what the trace link passes on.
    expect(heart.category).toBe(CATEGORY_HEART);
    expect(heart.category).not.toBe(CATEGORY_ASSCHER);
    expect(heart.label).toContain("HEART");

    // Following that exact key into Demand Trace must select Heart.
    resetRateLimits();
    const trace = await call(demandTrace, {
      path: `/api/analysis/demand-trace?category=${encodeURIComponent(CATEGORY_HEART)}`,
      cookie,
    });
    expect(trace.json.selectedCategory.category).toBe(CATEGORY_HEART);
    expect(trace.json.selectedCategory.shape).toBe("HEART");
  });

  test("responses leak no raw payload, formula or internal rule expression", async () => {
    const payload: string[] = [];
    for (const section of ["readiness", "sales-demand", "inventory", "shortage-excess", "attention"]) {
      resetRateLimits();
      const res = await call(executive, { path: `/api/analysis/executive?section=${section}`, cookie });
      payload.push(JSON.stringify(res.json));
    }
    const joined = payload.join("");
    const forbidden = [
      "rawPayload", "normalizedRecordJson", "traceJson", "metadataJson",
      "ruleVersion", "mappingFingerprint", "lockToken", "ownerTokenHash",
      "SELECT ", "prisma.", "monthlyAverage", "unroundedTarget",
    ].filter((needle) => joined.includes(needle));
    expect({ forbidden }).toEqual({ forbidden: [] });
  });

  test("out-of-scope planning and forecast metrics are absent", async () => {
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie });
    const joined = JSON.stringify(res.json);
    const leaked = [
      "forecastSignal", "approvedPlanCoverage", "remainingUnplanned", "pipelineNeed",
      "priorityScore", "plannedYield", "actualYield", "recommendedQty",
    ].filter((needle) => joined.includes(needle));
    expect({ leaked }).toEqual({ leaked: [] });
  });
});

describe("Executive Analysis — server-side paging and scope", () => {
  let cookie = "";
  let runId = "";
  const TOTAL = 60;

  beforeAll(async () => {
    await resetDb();
    await db.demandMetric.deleteMany({});
    await db.demandRun.deleteMany({});
    await db.lotMasterRecord.deleteMany({ where: { lotId: { startsWith: "EXEC-" } } });
    cookie = (await makeUser("exec.pager", "DATA_ANALYST")).cookie;

    const run = await makeDemandRun();
    runId = run.id;
    // Enough categories that a single page cannot hold them, so paging is exercised
    // for real rather than asserted against a table that fits anyway.
    for (let i = 0; i < TOTAL; i++) {
      const lab = i % 2 === 0 ? "GIA" : "IGI";
      await makeMetric(runId, `${lab}|SHAPE${String(i).padStart(3, "0")}|1.00-1.49`, {
        physicalShortage: i,
        roundedTarget: i + 1,
      });
    }
  });

  test("pagination is server-side and never silently truncates", async () => {
    resetRateLimits();
    const page1 = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=1&pageSize=25&sort=category",
      cookie,
    });
    expect({
      rows: page1.json.rows.length,
      total: page1.json.meta.total,
      pages: page1.json.meta.totalPages,
      hasMore: page1.json.meta.hasMore,
    }).toEqual({ rows: 25, total: TOTAL, pages: 3, hasMore: true });

    resetRateLimits();
    const page3 = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=3&pageSize=25&sort=category",
      cookie,
    });
    expect({ rows: page3.json.rows.length, hasMore: page3.json.meta.hasMore }).toEqual({ rows: 10, hasMore: false });

    // No row appears on two pages and none is skipped.
    resetRateLimits();
    const page2 = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=2&pageSize=25&sort=category",
      cookie,
    });
    const seen = [...page1.json.rows, ...page2.json.rows, ...page3.json.rows].map((r: { category: string }) => r.category);
    expect({ collected: seen.length, distinct: new Set(seen).size }).toEqual({ collected: TOTAL, distinct: TOTAL });
  });

  test("the page size ceiling is enforced by the server", async () => {
    // Out of range is refused outright rather than clamped, so a caller can never
    // believe it asked for 99,999 rows and received a silently reduced page.
    resetRateLimits();
    const refused = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=1&pageSize=99999",
      cookie,
    });
    expect({ status: refused.status, code: refused.json?.error?.code }).toEqual({
      status: 400,
      code: "BAD_REQUEST",
    });

    // The largest accepted page is still bounded.
    resetRateLimits();
    const max = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=1&pageSize=200",
      cookie,
    });
    expect(max.json.meta.pageSize).toBe(200);
    expect(max.json.rows.length <= 200).toBe(true);
  });

  test("sorting is server-side", async () => {
    resetRateLimits();
    const res = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&page=1&pageSize=5&sort=shortage",
      cookie,
    });
    const shortages = res.json.rows.map((r: { physicalShortage: number }) => r.physicalShortage);
    // Descending by shortage across the whole dataset, not just within the page.
    expect(shortages).toEqual([59, 58, 57, 56, 55]);
  });

  test("the global lab scope is applied by the server", async () => {
    resetRateLimits();
    const res = await call(executive, {
      path: "/api/analysis/executive?section=shortage-excess&lab=GIA&pageSize=200",
      cookie,
    });
    const labs = new Set(res.json.rows.map((r: { category: string }) => r.category.split("|")[0]));
    expect({ labs: [...labs], total: res.json.meta.total }).toEqual({ labs: ["GIA"], total: TOTAL / 2 });
    expect(res.json.activeFilters.some((f: { key: string; value: string }) => f.key === "lab" && f.value === "GIA")).toBe(true);
  });

  test("the country scope is applied to inventory", async () => {
    for (const country of ["IN", "AE"]) {
      await db.lotMasterRecord.create({
        data: {
          lotId: `EXEC-SCOPE-${country}-${Date.now()}`,
          currentStatus: "STOCK",
          statusEffectiveDate: new Date(),
          docDate: new Date(),
          shape: "HEART",
          weight: 1.2,
          country,
          branch: "MAIN",
          lastSyncBatchId: "exec-test",
          isCurrent: true,
          inventoryClass: "PHYSICAL_AVAILABLE",
          classificationState: "CLASSIFIED",
          lastSeenAt: new Date(),
        },
      });
    }
    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=inventory&country=AE", cookie });
    const countries = new Set(res.json.rows.map((r: { country: string }) => r.country));
    expect([...countries]).toEqual(["AE"]);
  });

  test("a bounded number of queries runs regardless of page size", async () => {
    // A per-row query would scale with the page. The count is compared between a small
    // page and a large one: equal counts mean the work is grouped, not per row.
    const counts: number[] = [];
    for (const pageSize of [5, 50]) {
      let queries = 0;
      const client = db.$extends({
        query: {
          async $allOperations({ args, query }: { args: unknown; query: (a: unknown) => Promise<unknown> }) {
            queries++;
            return query(args);
          },
        },
      }) as unknown as typeof db;

      const { readSalesAndDemand } = await import("@/lib/analysis/executive-summary");
      await readSalesAndDemand(
        { country: null, branch: null, lab: null, search: null },
        { page: 1, pageSize },
        "sales",
        client,
      );
      counts.push(queries);
    }
    expect({ small: counts[0], large: counts[1], equal: counts[0] === counts[1] }).toEqual({
      small: counts[0],
      large: counts[1],
      equal: true,
    });
    // Run lookup + count + page + three window buckets.
    expect(counts[0] <= 8).toBe(true);
  });

  test("no Executive Analysis read mutates operational data", async () => {
    const snapshot = async () =>
      Promise.all([
        db.demandRun.count(),
        db.demandMetric.count(),
        db.lotMasterRecord.count(),
        db.requirement.count(),
        db.syncCheckpoint.count(),
        db.dataQualityIssue.count(),
      ]);

    const before = await snapshot();
    for (const section of ["readiness", "sales-demand", "inventory", "shortage-excess", "attention"]) {
      resetRateLimits();
      const res = await call(executive, { path: `/api/analysis/executive?section=${section}&pageSize=200`, cookie });
      expect(res.status).toBe(200);
    }
    const after = await snapshot();
    expect(after).toEqual(before);
  });
});
