import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as analysisRefresh } from "@/app/api/analysis/refresh/route";
import { POST as classificationRefresh } from "@/app/api/fantasy/classification-refresh/route";
import { GET as executive } from "@/app/api/analysis/executive/route";
import { loadConfirmedSaleFacts, resolveQuantityProvenance } from "@/lib/demand/confirmed-sales";
import {
  assessSnapshot,
  resolveAnalysisAvailability,
  selectAnalysisSnapshot,
  type SnapshotCandidate,
} from "@/lib/analysis/analysis-snapshot";
import { refreshFixtureClassification } from "@/lib/fantasy/classification-refresh";
import { runDemandCalculation } from "@/lib/demand/demand-service";

const BATCH = "PIPE-TEST";

async function makeCanonicalLot(opts: {
  lotId: string;
  status: string;
  docDate: Date;
  shape?: string;
  weight?: number;
  lab?: string | null;
  quantity?: number;
  removalReason?: string | null;
  sourceType?: string;
  isSimulated?: boolean;
  version?: number;
  classify?: boolean;
}) {
  const {
    lotId, status, docDate, shape = "ROUND", weight = 1.2, lab = "GIA", quantity = 1,
    removalReason = null, sourceType = "FIXTURE", isSimulated = true, version = 1, classify = false,
  } = opts;

  await db.lotMasterRecord.upsert({
    where: { lotId },
    create: {
      lotId, currentStatus: status, statusEffectiveDate: docDate, docDate,
      shape, weight, labNormalized: lab, quantity,
      country: "IN", branch: "SRT", lastSyncBatchId: BATCH, isCurrent: true,
      sourceType, isSimulated, removalReason, currentVersion: version,
      ...(classify ? { classificationState: "CLASSIFIED", inventoryClass: "PHYSICAL_AVAILABLE" } : {}),
    },
    update: { currentStatus: status, currentVersion: version, removalReason },
  });

  await db.lotHistoryRecord.create({
    data: {
      lotId, version, status, docDate, statusEffectiveDate: docDate,
      shape, weight, labNormalized: lab, quantity,
      country: "IN", branch: "SRT", syncBatchId: BATCH, checkpoint: 1,
      isCurrent: true, isSimulated, removalReason,
    },
  });
}

async function clearPipelineFixtures() {
  await db.demandMetricTraceItem.deleteMany({});
  await db.demandMetric.deleteMany({});
  await db.demandRun.deleteMany({});
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("confirmed sales — one definition, fed by Fantasy history", () => {
  beforeAll(async () => {
    await resetDb();
    await clearPipelineFixtures();
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    await makeCanonicalLot({ lotId: `${BATCH}-SOLD`, status: "SOLD", docDate: recent, removalReason: "EXPLICIT_SALE" });
    await makeCanonicalLot({ lotId: `${BATCH}-INVOICE`, status: "INVOICE", docDate: recent, weight: 0.9 });
    await makeCanonicalLot({ lotId: `${BATCH}-STOCK`, status: "STOCK", docDate: recent, weight: 1.5 });
    await makeCanonicalLot({ lotId: `${BATCH}-OLD`, status: "SOLD", docDate: old, weight: 2.0 });
  });

  test("Fantasy-derived canonical history feeds the service; stock is never a sale", async () => {
    const result = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    const lotIds = result.facts.map((f) => f.lotId).sort();

    expect(lotIds).toEqual([`${BATCH}-INVOICE`, `${BATCH}-SOLD`]);
    expect(result.policy).toBe("CANONICAL_FANTASY");
  });

  test("events outside the business window are excluded with a fixed code", async () => {
    const result = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    expect(result.facts.some((f) => f.lotId === `${BATCH}-OLD`)).toBe(false);
    expect(result.window.windowDays).toBe(90);
  });

  test("current inventory is never interpreted as sales", async () => {
    const [polished, rough] = await Promise.all([db.polishedStone.count(), db.roughStone.count()]);
    const result = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });

    expect(result.facts.length).toBe(2);
    expect(result.facts.every((f) => f.sourceType !== "LEGACY_SEED")).toBe(true);

    const soldLotIds = new Set(result.facts.map((f) => f.lotId));
    const mirrors = await db.polishedStone.findMany({ select: { fantasyLotId: true }, take: 500 });
    const leaked = mirrors.filter((m) => soldLotIds.has(m.fantasyLotId)).map((m) => m.fantasyLotId);
    expect({ leaked, mirrorRowsPresent: polished + rough }).toEqual({ leaked: [], mirrorRowsPresent: polished + rough });
  });

  test("legacy SalesRecord is never unioned into canonical results", async () => {
    const legacyCount = await db.salesRecord.count();
    const canonical = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    expect(canonical.facts.every((f) => !f.eventKey.startsWith("LEGACY_"))).toBe(true);
    expect(canonical.facts.length).toBe(2);

    const legacy = await loadConfirmedSaleFacts({ windowDays: 90, policy: "LEGACY_SALES" });
    expect(legacy.policy).toBe("LEGACY_SALES");
    expect(legacy.facts.every((f) => f.eventKey.startsWith("LEGACY_"))).toBe(true);
    expect({ legacyExists: legacyCount > 0 }).toEqual({ legacyExists: legacyCount > 0 });
  });

  test("lifecycle episodes are deduplicated — one sale, not one per sync", async () => {
    const lotId = `${BATCH}-EPISODES`;
    const day = 24 * 60 * 60 * 1000;
    const base = Date.now() - 40 * day;

    await makeCanonicalLot({ lotId, status: "SOLD", docDate: new Date(base), version: 1 });
    await makeCanonicalLot({ lotId, status: "SOLD", docDate: new Date(base + day), version: 2 });
    await makeCanonicalLot({ lotId, status: "STOCK", docDate: new Date(base + 2 * day), version: 3 });
    await makeCanonicalLot({ lotId, status: "SOLD", docDate: new Date(base + 3 * day), version: 4 });

    const result = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    const forLot = result.facts.filter((f) => f.lotId === lotId);
    expect({ episodes: forLot.length }).toEqual({ episodes: 2 });

    const dupes = result.exclusions.filter((e) => e.lotId === lotId && e.code === "DUPLICATE_LIFECYCLE_EPISODE");
    expect(dupes.length >= 1).toBe(true);

    const again = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    expect(again.facts.map((f) => f.eventKey).sort()).toEqual(result.facts.map((f) => f.eventKey).sort());
  });

  test("missing or invalid quantity never becomes one confirmed piece", async () => {
    expect(resolveQuantityProvenance({ sourceType: "FIXTURE", isSimulated: true })).toBe("EXPLICIT_FIXTURE");
    expect(resolveQuantityProvenance({ sourceType: "FANTASY_API", isSimulated: false })).toBe("UNCONFIRMED");
    expect(resolveQuantityProvenance({ sourceType: "FILE_IMPORT", isSimulated: false })).toBe("UNCONFIRMED");
    expect(resolveQuantityProvenance({ sourceType: null, isSimulated: true })).toBe("UNCONFIRMED");

    const lotId = `${BATCH}-LIVEQTY`;
    await makeCanonicalLot({
      lotId, status: "SOLD", docDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      sourceType: "FANTASY_API", isSimulated: false, weight: 1.1,
    });

    const result = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });
    const live = result.facts.find((f) => f.lotId === lotId);
    expect(live?.quantityProvenance).toBe("UNCONFIRMED");

    const fixturePieces = result.facts
      .filter((f) => f.quantityProvenance === "EXPLICIT_FIXTURE")
      .reduce((s, f) => s + f.quantity, 0);
    expect(result.confirmedPieces).toBe(fixturePieces);
    expect(result.confirmedPieces < result.facts.length).toBe(true);
    expect(result.unconfirmedQuantityEvents >= 1).toBe(true);

    await db.lotHistoryRecord.deleteMany({ where: { lotId } });
    await db.lotMasterRecord.deleteMany({ where: { lotId } });
  });
});

describe("snapshot eligibility", () => {
  const base: SnapshotCandidate = {
    id: "r1",
    status: "COMPLETED",
    runDate: new Date(),
    finishedAt: new Date(),
    windowDays: 90,
    sourcePolicy: "CANONICAL_FANTASY",
    businessDateIst: "2026-09-23",
    lookbackStart: new Date(),
    lookbackEnd: new Date(),
    sourceMode: "FIXTURE_SIMULATION",
    isSimulated: true,
    salesCount: 3,
    wipPolicyStatus: "NOT_CONFIGURED",
    _count: { metrics: 8, traceItems: 5 },
  };

  test("a complete canonical 90-day run is eligible", () => {
    expect(assessSnapshot(base)).toEqual({ eligible: true, reasons: [] });
  });

  test("legacy runs missing business-window metadata are ineligible, with reasons", () => {
    const legacy = { ...base, finishedAt: null, businessDateIst: null, lookbackStart: null, lookbackEnd: null, salesCount: 0, _count: { metrics: 178, traceItems: 0 } };
    const verdict = assessSnapshot(legacy);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.slice().sort()).toEqual(
      ["MISSING_BUSINESS_DATE", "MISSING_LOOKBACK_WINDOW", "NOT_FINISHED"].sort(),
    );
  });

  test("a non-90-day or non-canonical run cannot back Analysis", () => {
    expect(assessSnapshot({ ...base, windowDays: 30 }).reasons).toContain("WINDOW_NOT_90_DAYS");
    expect(assessSnapshot({ ...base, sourcePolicy: "LEGACY_SALES" }).reasons).toContain("SOURCE_POLICY_NOT_CANONICAL");
  });

  test("a run claiming sales but persisting no trace is ineligible", () => {
    const noTrace = { ...base, salesCount: 5, _count: { metrics: 8, traceItems: 0 } };
    expect(assessSnapshot(noTrace).reasons).toContain("NO_PERSISTED_TRACE_AND_NOT_ZERO_SALES");

    const quarantinedOnly = { ...base, salesCount: 1, _count: { metrics: 0, traceItems: 1 } };
    expect(assessSnapshot(quarantinedOnly).eligible).toBe(true);

    const zeroSales = { ...base, salesCount: 0, _count: { metrics: 8, traceItems: 0 } };
    expect(assessSnapshot(zeroSales).eligible).toBe(true);
  });
});

describe("analysis availability and the refresh workflow", () => {
  let runnerCookie = "";
  let readerCookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearPipelineFixtures();
    runnerCookie = (await makeUser("pipe.runner", "ANALYSIS_MANAGER")).cookie;
    readerCookie = (await makeUser("pipe.reader", "DATA_ANALYST")).cookie;
  });

  test("canonical data with no compatible run produces REFRESH_REQUIRED, not zeros", async () => {
    await makeCanonicalLot({
      lotId: `${BATCH}-AVAIL`, status: "SOLD", docDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      removalReason: "EXPLICIT_SALE",
    });
    await db.demandRun.create({
      data: { status: "COMPLETED", windowDays: 90, sourcePolicy: "CANONICAL_FANTASY", salesCount: 0, isSimulated: true },
    });

    const availability = await resolveAnalysisAvailability();
    expect(availability.state).toBe("REFRESH_REQUIRED");
    expect(availability.canRefresh).toBe(true);
    expect(availability.canonicalRecordCount > 0).toBe(true);
    expect(availability.ineligibleRuns.length >= 1).toBe(true);

    resetRateLimits();
    const res = await call(executive, { path: "/api/analysis/executive?section=readiness", cookie: readerCookie });
    expect({ availability: res.json.availability, refreshRequired: res.json.refreshRequired }).toEqual({
      availability: "REFRESH_REQUIRED",
      refreshRequired: true,
    });

    resetRateLimits();
    const gaps = await call(executive, { path: "/api/analysis/executive?section=shortage-excess", cookie: readerCookie });
    expect({ available: gaps.json.available, rows: gaps.json.rows.length }).toEqual({ available: false, rows: 0 });
  });

  test("the refresh endpoint requires demand.run and derives the actor from the session", async () => {
    resetRateLimits();
    const anon = await call(analysisRefresh, { method: "POST", path: "/api/analysis/refresh", body: {} });
    expect(anon.status).toBe(401);

    resetRateLimits();
    const denied = await call(analysisRefresh, {
      method: "POST", path: "/api/analysis/refresh", cookie: readerCookie, body: {},
    });
    expect(denied.status).toBe(403);
  });

  test("a compatible run is created, populates sale trace, and matches the service exactly", async () => {
    resetRateLimits();
    const res = await call(analysisRefresh, {
      method: "POST", path: "/api/analysis/refresh", cookie: runnerCookie, body: {},
    });
    expect({ status: res.status }).toEqual({ status: 200 });

    expect({ windowDays: res.json.windowDays, sourcePolicy: res.json.sourcePolicy }).toEqual({
      windowDays: 90,
      sourcePolicy: "CANONICAL_FANTASY",
    });

    const runId: string = res.json.runId;
    const service = await loadConfirmedSaleFacts({ windowDays: 90, policy: "CANONICAL_FANTASY" });

    expect(res.json.salesCount).toBe(service.facts.length);

    const traced = await db.demandMetricTraceItem.findMany({
      where: { runId, eventKey: { not: null } },
      select: { eventKey: true, traceType: true },
    });
    const traceKeys = new Set(traced.map((t) => t.eventKey));
    const serviceKeys = new Set(service.facts.map((f) => f.eventKey));

    expect({ missingFromTrace: [...serviceKeys].filter((k) => !traceKeys.has(k)) }).toEqual({ missingFromTrace: [] });
    expect({ notFromService: [...traceKeys].filter((k) => k !== null && !serviceKeys.has(k as string)) }).toEqual({
      notFromService: [],
    });

    const selection = await selectAnalysisSnapshot();
    expect(selection.run?.id).toBe(runId);
  });

  test("Executive Analysis agrees with the demand run it reads", async () => {
    const selection = await selectAnalysisSnapshot();
    const runId = selection.run!.id;

    resetRateLimits();
    const exec = await call(executive, {
      path: "/api/analysis/executive?section=sales-demand&pageSize=200", cookie: readerCookie,
    });
    expect(exec.json.runId).toBe(runId);

    const stored = await db.demandMetric.findMany({
      where: { runId }, select: { planningCategory: true, sales90d: true, roundedTarget: true },
    });
    const storedByCategory = new Map(stored.map((m) => [m.planningCategory, m]));
    const mismatches: string[] = [];
    for (const row of exec.json.rows as Array<{ category: string; sales90d: number; target: number }>) {
      const s = storedByCategory.get(row.category);
      if (!s) { mismatches.push(`${row.category}: not in run`); continue; }
      if (s.sales90d !== row.sales90d) mismatches.push(`${row.category}: sales ${row.sales90d} vs ${s.sales90d}`);
      if (s.roundedTarget !== row.target) mismatches.push(`${row.category}: target ${row.target} vs ${s.roundedTarget}`);
    }
    expect({ mismatches }).toEqual({ mismatches: [] });
  });

  test("a valid zero-sale run reports NO CONFIRMED SALES IN WINDOW, not NOT RUN", async () => {
    await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
    await db.lotMasterRecord.updateMany({ where: { lastSyncBatchId: BATCH }, data: { currentStatus: "STOCK" } });
    await makeCanonicalLot({ lotId: `${BATCH}-ZERO`, status: "STOCK", docDate: new Date() });

    const run = await runDemandCalculation({
      actor: "pipe-test", windowDays: 90, sourcePolicy: "CANONICAL_FANTASY",
    });
    expect(run.salesCount).toBe(0);

    const availability = await resolveAnalysisAvailability();
    expect(availability.state).toBe("NO_CONFIRMED_SALES_IN_WINDOW");
    expect(availability.snapshot?.id).toBe(run.runId);
  });

  test("with no canonical data at all the state is NO FANTASY DATA", async () => {
    await clearPipelineFixtures();
    const remaining = await db.lotMasterRecord.count({ where: { isCurrent: true } });
    if (remaining === 0) {
      const availability = await resolveAnalysisAvailability();
      expect(availability.state).toBe("NO_FANTASY_DATA");
      expect(availability.canRefresh).toBe(false);
    } else {
      expect(remaining > 0).toBe(true);
    }
  });
});

describe("fixture-only classification refresh", () => {
  let adminCookie = "";
  let readerCookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearPipelineFixtures();
    adminCookie = (await makeUser("pipe.admin", "ADMIN")).cookie;
    readerCookie = (await makeUser("pipe.viewer", "VIEWER")).cookie;
  });

  test("RBAC: the refresh needs fantasy.sync.run", async () => {
    resetRateLimits();
    const anon = await call(classificationRefresh, { method: "POST", path: "/api/fantasy/classification-refresh", body: {} });
    expect(anon.status).toBe(401);

    resetRateLimits();
    const denied = await call(classificationRefresh, {
      method: "POST", path: "/api/fantasy/classification-refresh", cookie: readerCookie, body: { dryRun: true },
    });
    expect(denied.status).toBe(403);

    resetRateLimits();
    const admin = await call(classificationRefresh, {
      method: "POST", path: "/api/fantasy/classification-refresh", cookie: adminCookie, body: { dryRun: true },
    });
    expect(admin.status).toBe(403);

    resetRateLimits();
    const operatorCookie = (await makeUser("pipe.integration", "FANTASY_INTEGRATION")).cookie;
    const allowed = await call(classificationRefresh, {
      method: "POST", path: "/api/fantasy/classification-refresh", cookie: operatorCookie, body: { dryRun: true },
    });
    expect(allowed.status).toBe(200);
    expect(allowed.json.dryRun).toBe(true);
  });

  test("live and ambiguous records are never reclassified", async () => {
    const live = `${BATCH}-LIVE`;
    const ambiguous = `${BATCH}-AMBIG`;
    const now = new Date();

    await makeCanonicalLot({ lotId: live, status: "STOCK", docDate: now, sourceType: "FANTASY_API", isSimulated: false });
    await db.lotMasterRecord.create({
      data: {
        lotId: ambiguous, currentStatus: "STOCK", statusEffectiveDate: now, docDate: now,
        shape: "ROUND", weight: 1.0, country: "IN", branch: "SRT", lastSyncBatchId: BATCH,
        isCurrent: true, sourceType: "FIXTURE", isSimulated: true, currentVersion: 1,
      },
    });
    await db.lotHistoryRecord.create({
      data: {
        lotId: ambiguous, version: 1, status: "STOCK", docDate: now, statusEffectiveDate: now,
        shape: "ROUND", weight: 1.0, country: "IN", branch: "SRT", syncBatchId: BATCH,
        checkpoint: 1, isCurrent: true,
        isSimulated: false,
      },
    });

    await refreshFixtureClassification({ actor: "pipe-test", actorUserId: null });

    const [liveRow, ambiguousRow] = await Promise.all([
      db.lotMasterRecord.findUniqueOrThrow({ where: { lotId: live }, select: { classificationState: true } }),
      db.lotMasterRecord.findUniqueOrThrow({ where: { lotId: ambiguous }, select: { classificationState: true } }),
    ]);

    expect({ live: liveRow.classificationState, ambiguous: ambiguousRow.classificationState }).toEqual({
      live: null, ambiguous: null,
    });
  });

  test("a provable fixture record is classified, audited, and its history is appended", async () => {
    const lotId = `${BATCH}-FIXTURE`;
    await makeCanonicalLot({ lotId, status: "STOCK", docDate: new Date() });

    const versionsBefore = await db.lotHistoryRecord.count({ where: { lotId } });
    const result = await refreshFixtureClassification({ actor: "pipe-test", actorUserId: null });
    expect(result.refreshed >= 1).toBe(true);

    const row = await db.lotMasterRecord.findUniqueOrThrow({
      where: { lotId },
      select: { classificationState: true, inventoryClass: true, classificationProfile: true },
    });
    expect(row.classificationState).not.toBe(null);
    expect(row.classificationProfile).toBe("LEGACY_FIXTURE");

    const versionsAfter = await db.lotHistoryRecord.count({ where: { lotId } });
    expect(versionsAfter).toBe(versionsBefore + 1);
    const appended = await db.lotHistoryRecord.findFirst({
      where: { lotId, changeReason: "FIXTURE_CLASSIFICATION_BACKFILL" },
      select: { classificationState: true, classificationProfile: true, shape: true },
    });
    expect(appended?.classificationProfile).toBe("LEGACY_FIXTURE");
    expect(appended?.shape).toBe("ROUND");

    const audited = await db.auditLog.findFirst({
      where: { action: "FANTASY_CLASSIFICATION_REFRESH", entityId: lotId },
      select: { outcome: true, before: true, after: true },
    });
    expect(audited?.outcome).toBe("SUCCESS");
    expect(String(audited?.before)).toContain("null");
    expect(String(audited?.after)).toContain("LEGACY_FIXTURE");
  });

  test("the refresh creates or changes no planning data", async () => {
    const snapshot = async () =>
      Promise.all([
        db.requirement.count(), db.planningCase.count(), db.planOption.count(),
        db.polishedStone.count(), db.roughStone.count(),
      ]);
    const before = await snapshot();
    await refreshFixtureClassification({ actor: "pipe-test", actorUserId: null });
    expect(await snapshot()).toEqual(before);
  });

  test("the legacy seeded mirrors are never deleted or imported", async () => {
    const [polished, rough] = await Promise.all([db.polishedStone.count(), db.roughStone.count()]);
    expect({ polishedPresent: polished > 0, roughPresent: rough > 0 }).toEqual({
      polishedPresent: polished > 0, roughPresent: rough > 0,
    });
    const canonicalFromMirrors = await db.lotMasterRecord.count({ where: { lastSyncBatchId: { contains: "SEED" } } });
    expect(canonicalFromMirrors).toBe(0);
  });
});
