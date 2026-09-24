import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { GET as inventory } from "@/app/api/analysis/inventory/route";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import {
  classifyCanonicalCategory,
  loadCategoryClassificationContext,
  PLACEHOLDER_NORMALIZATIONS,
} from "@/lib/fantasy/category-classification";
import { reconcileOperationalProjection } from "@/lib/fantasy/operational-projection";
import { loadLabMappings } from "@/lib/fantasy/sync-service";

/**
 * Canonical-to-demand category agreement.
 *
 * The planning category was decided twice — once by the synchronizer onto the canonical
 * record, once by the demand calculation from the raw columns through whatever the
 * mapping tables held at run time. The two disagreed in production: canonical inventory
 * grouped 66 lots under lab `Other` while the demand result carried a lab called `IGI`
 * that existed in no canonical record. Inventory, Aging and lab scope read one
 * vocabulary; Stockout and Excess read the other.
 *
 * Re-deriving also made a committed run retroactively mutable: editing a mapping row
 * changed what yesterday's categorisation meant.
 *
 * These tests hold the single decision in place.
 */

const BATCH = "CATCLASS-TEST";
const BASE = new Date("2026-06-15T00:00:00.000Z");

/**
 * The band a weight actually resolves to in this database.
 *
 * Other suites seed the confirmed band set, whose ranges overlap this suite's. Asserting
 * a hardcoded label would be asserting which suite ran first, not what the classifier
 * decided.
 */
async function bandLabelFor(weightCt: number): Promise<string> {
  const band = await db.weightBand.findFirst({
    where: { active: true, minCt: { lte: weightCt }, maxCt: { gte: weightCt } },
    orderBy: { sortOrder: "asc" },
    select: { label: true },
  });
  return band!.label;
}

async function ensureReferenceData() {
  const bands = [
    { code: "CC-1.00-1.49", label: "1.00 - 1.49 ct", minCt: 1.0, maxCt: 1.49, sortOrder: 901 },
    { code: "CC-2.00-2.49", label: "2.00 - 2.49 ct", minCt: 2.0, maxCt: 2.49, sortOrder: 902 },
  ];
  for (const b of bands) {
    const existing = await db.weightBand.findFirst({ where: { code: b.code } });
    if (!existing) await db.weightBand.create({ data: { ...b, active: true } });
  }
  for (const m of [{ rawLab: "GIA", normalizedLab: "GIA" }]) {
    const existing = await db.labMapping.findFirst({ where: { rawLab: m.rawLab } });
    if (!existing) await db.labMapping.create({ data: { ...m, active: true } });
  }
  for (const m of [{ rawShape: "ROUND", normalizedShape: "ROUND" }, { rawShape: "OVAL", normalizedShape: "OVAL" }]) {
    const existing = await db.shapeMapping.findFirst({ where: { rawShape: m.rawShape } });
    if (!existing) await db.shapeMapping.create({ data: { ...m, active: true } });
  }
}

async function makeLot(opts: {
  lotId: string;
  labRaw: string | null;
  shape: string;
  weight: number;
  status?: string;
  inventoryClass?: string;
}) {
  await db.lotMasterRecord.create({
    data: {
      lotId: opts.lotId,
      currentStatus: opts.status ?? "STOCK",
      statusEffectiveDate: BASE,
      docDate: BASE,
      shape: opts.shape,
      weight: new Prisma.Decimal(opts.weight),
      labRaw: opts.labRaw,
      quantity: new Prisma.Decimal(1),
      quantityProvenance: "EXPLICIT_FIXTURE",
      country: "IN",
      branch: "SRT",
      lastSyncBatchId: BATCH,
      isCurrent: true,
      roughOrPolished: "POLISHED",
      sourceType: "FIXTURE",
      isSimulated: true,
      inventoryClass: opts.inventoryClass ?? "PHYSICAL_AVAILABLE",
      classificationState: "CLASSIFIED",
      holdState: "NOT_HELD",
      canonicalLifecycle: "AVAILABLE",
      firstSeenAt: BASE,
      lastSeenAt: BASE,
    },
  });
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Category classification — an unapproved value never becomes a category", () => {
  let ctx: Awaited<ReturnType<typeof loadCategoryClassificationContext>>;

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    ctx = await loadCategoryClassificationContext(db, await loadLabMappings(db));
  });

  test("an approved lab, shape and weight produce a category key", async () => {
    const expectedBand = await bandLabelFor(1.2);
    const c = classifyCanonicalCategory({ labRaw: "GIA", shapeRaw: "ROUND", weightCt: 1.2 }, ctx);
    expect({ key: c.categoryKey, state: c.state, lab: c.labNormalized }).toEqual({
      key: `GIA|ROUND|${expectedBand}`,
      state: "APPROVED",
      lab: "GIA",
    });
  });

  test("an unapproved lab leaves labNormalized null rather than storing the raw value", () => {
    // `EGL_UNAPPROVED` reached `DemandMetric.labNormalized` in production and became the
    // category `EGL_UNAPPROVED|ROUND|1.00-1.09`. It is not a lab; it is the absence of one.
    const c = classifyCanonicalCategory({ labRaw: "EGL_UNAPPROVED", shapeRaw: "ROUND", weightCt: 1.2 }, ctx);
    expect({ lab: c.labNormalized, labState: c.labState, key: c.categoryKey, state: c.state }).toEqual({
      lab: null,
      labState: "UNMAPPED",
      key: null,
      state: "REVIEW_REQUIRED",
    });
    expect(c.reviewReasons).toEqual(["LAB_NOT_APPROVED"]);
  });

  test("a placeholder normalization target is not an approval", () => {
    // Mapping every unmapped lab onto `Other` merges genuinely different labs into one
    // valid-looking bucket. Two labs nobody has mapped are not the same lab.
    for (const placeholder of PLACEHOLDER_NORMALIZATIONS) {
      const local = { ...ctx, labMappings: new Map([["ZZLAB", placeholder]]) };
      const c = classifyCanonicalCategory({ labRaw: "ZZLAB", shapeRaw: "ROUND", weightCt: 1.2 }, local);
      expect({ placeholder, lab: c.labNormalized, state: c.state })
        .toEqual({ placeholder, lab: null, state: "REVIEW_REQUIRED" });
    }
  });

  test("an unapproved shape and an unresolvable weight are reported separately", () => {
    const shape = classifyCanonicalCategory({ labRaw: "GIA", shapeRaw: "HEXAGON_TEST", weightCt: 1.2 }, ctx);
    expect({ s: shape.shapeNormalized, r: shape.reviewReasons }).toEqual({ s: null, r: ["SHAPE_NOT_APPROVED"] });

    const band = classifyCanonicalCategory({ labRaw: "GIA", shapeRaw: "ROUND", weightCt: 0.25 }, ctx);
    expect({ b: band.weightBandLabel, r: band.reviewReasons }).toEqual({ b: null, r: ["WEIGHT_BAND_UNRESOLVED"] });

    // No partial key: a category identified by two confirmed dimensions and one guess is
    // not a category.
    expect(shape.categoryKey).toBe(null);
    expect(band.categoryKey).toBe(null);
  });

  test("a missing weight resolves no band rather than choosing one", () => {
    const c = classifyCanonicalCategory({ labRaw: "GIA", shapeRaw: "ROUND", weightCt: null }, ctx);
    expect({ band: c.weightBandLabel, state: c.state }).toEqual({ band: null, state: "REVIEW_REQUIRED" });
  });
});

describe("Category classification — canonical and demand agree", () => {
  let runId = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    await makeLot({ lotId: `${BATCH}-OK-1`, labRaw: "GIA", shape: "ROUND", weight: 1.2 });
    await makeLot({ lotId: `${BATCH}-OK-2`, labRaw: "GIA", shape: "OVAL", weight: 2.1 });
    // Unapproved lab: must never key a category.
    await makeLot({ lotId: `${BATCH}-BAD-LAB`, labRaw: "EGL_UNAPPROVED", shape: "ROUND", weight: 1.2 });
    // Unapproved shape.
    await makeLot({ lotId: `${BATCH}-BAD-SHAPE`, labRaw: "GIA", shape: "HEXAGON_TEST", weight: 1.2 });
    const run = await runDemandCalculation({ actor: "catclass-test", windowDays: 90, referenceDate: BASE });
    runId = run.runId;
  });

  test("every demand category key exists in the canonical vocabulary", async () => {
    const metrics = await db.demandMetric.findMany({
      where: { runId },
      select: { labNormalized: true, shapeNormalized: true, planningCategory: true },
    });
    const canonicalLabs = new Set(
      (await db.lotMasterRecord.findMany({
        where: { isCurrent: true, labNormalized: { not: null } },
        select: { labNormalized: true },
        distinct: ["labNormalized"],
      })).map((r) => r.labNormalized),
    );
    // A lab in the demand result that no canonical record carries is the exact
    // divergence this change removes.
    const orphanLabs = metrics
      .map((m) => m.labNormalized)
      .filter((l) => l !== null && !canonicalLabs.has(l));
    expect(orphanLabs).toEqual([]);
  });

  test("an unapproved lab produces no planning category at all", async () => {
    const metrics = await db.demandMetric.findMany({
      where: { runId },
      select: { planningCategory: true, labNormalized: true },
    });
    const leaked = metrics.filter(
      (m) => m.planningCategory.includes("EGL_UNAPPROVED") || m.labNormalized === "EGL_UNAPPROVED",
    );
    expect(leaked).toEqual([]);
  });

  test("the unapproved record is quarantined and still visible, not dropped", async () => {
    const traced = await db.demandMetricTraceItem.findMany({
      where: { runId, lotId: { in: [`${BATCH}-BAD-LAB`, `${BATCH}-BAD-SHAPE`] } },
      select: { lotId: true, planningCategory: true, isIncluded: true },
    });
    // Visible — a record nobody can categorise must not vanish from the trace.
    expect(traced.length >= 2).toBe(true);
    expect(traced.every((t) => t.isIncluded === false)).toBe(true);
    // And filed in the quarantine bucket, never under a category built from its own
    // unapproved value.
    expect(traced.every((t) => !t.planningCategory.includes("EGL_UNAPPROVED"))).toBe(true);
  });

  test("the canonical record keeps the raw value while refusing to normalize it", async () => {
    const lot = await db.lotMasterRecord.findUnique({
      where: { lotId: `${BATCH}-BAD-LAB` },
      select: { labRaw: true, labNormalized: true, categoryState: true, categoryReviewReasons: true },
    });
    expect({
      raw: lot?.labRaw,
      normalized: lot?.labNormalized,
      state: lot?.categoryState,
    }).toEqual({ raw: "EGL_UNAPPROVED", normalized: null, state: "REVIEW_REQUIRED" });
    expect(lot?.categoryReviewReasons).toBe("LAB_NOT_APPROVED");
  });
});

describe("Category classification — a committed run is not retroactively re-categorised", () => {
  let runId = "";
  let mappingId = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    await makeLot({ lotId: `${BATCH}-FROZEN`, labRaw: "GIA", shape: "ROUND", weight: 1.2 });
    const run = await runDemandCalculation({ actor: "catclass-frozen", windowDays: 90, referenceDate: BASE });
    runId = run.runId;
  });

  test("editing a mapping after the run leaves that run's categories unchanged", async () => {
    const before = await db.demandMetric.findMany({
      where: { runId },
      select: { planningCategory: true, labNormalized: true },
      orderBy: { planningCategory: "asc" },
    });
    expect(before.length > 0).toBe(true);

    // Re-point GIA at a different normalization, as an administrator might.
    const gia = await db.labMapping.findFirst({ where: { rawLab: "GIA" } });
    mappingId = gia!.id;
    await db.labMapping.update({ where: { id: mappingId }, data: { normalizedLab: "GIA-REBRANDED" } });

    const after = await db.demandMetric.findMany({
      where: { runId },
      select: { planningCategory: true, labNormalized: true },
      orderBy: { planningCategory: "asc" },
    });
    expect(after).toEqual(before);

    // And the canonical record keeps the decision it was projected with, so a re-run
    // reads the same category rather than silently re-categorising committed stock.
    const lot = await db.lotMasterRecord.findUnique({
      where: { lotId: `${BATCH}-FROZEN` },
      select: { labNormalized: true, categoryKey: true },
    });
    expect({ lab: lot?.labNormalized, key: lot?.categoryKey })
      .toEqual({ lab: "GIA", key: `GIA|ROUND|${await bandLabelFor(1.2)}` });

    await db.labMapping.update({ where: { id: mappingId }, data: { normalizedLab: "GIA" } });
  });

  test("reconciliation never overwrites a classification already recorded", async () => {
    const before = await db.lotMasterRecord.findUnique({
      where: { lotId: `${BATCH}-FROZEN` },
      select: { categoryKey: true, labNormalized: true },
    });
    const result = await reconcileOperationalProjection({ actor: "catclass-idempotency" });
    const after = await db.lotMasterRecord.findUnique({
      where: { lotId: `${BATCH}-FROZEN` },
      select: { categoryKey: true, labNormalized: true },
    });
    expect(after).toEqual(before);
    // Nothing to classify on a second pass.
    expect(result.classificationsWritten).toBe(0);
  });
});

describe("Category classification — one vocabulary across every surface", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    await makeLot({ lotId: `${BATCH}-SCOPE-1`, labRaw: "GIA", shape: "ROUND", weight: 1.2 });
    await makeLot({ lotId: `${BATCH}-SCOPE-2`, labRaw: "EGL_UNAPPROVED", shape: "ROUND", weight: 1.2 });
    await runDemandCalculation({ actor: "catclass-scope", windowDays: 90, referenceDate: BASE });
    const user = await makeUser("catclass.analyst", "ANALYSIS_MANAGER");
    cookie = user.cookie;
    // A lab-scoped reader, restricted to the one approved lab.
    await db.userAccessScope.create({
      data: { userId: user.user.id, dimension: "LAB", value: "GIA", reason: "test fixture" },
    });
  });

  test("Inventory and Stockout answer with the same lab vocabulary for a scoped reader", async () => {
    resetRateLimits();
    const inv = await call(inventory, {
      path: "/api/analysis/inventory?section=position&grouping=lab",
      cookie,
    });
    expect(inv.status).toBe(200);
    const invLabs = new Set(
      (inv.json.rows as Array<{ groupKey: string }>).map((r) => r.groupKey).filter((k) => k !== "(unspecified)"),
    );

    resetRateLimits();
    const so = await call(stockout, { path: "/api/analysis/stockout?section=categories&shortageOnly=false", cookie });
    expect(so.status).toBe(200);
    const soLabs = new Set((so.json.rows as Array<{ lab: string }>).map((r) => r.lab).filter(Boolean));

    // Every lab Stockout reports is one Inventory also knows. Before the single
    // classification these two sets could be disjoint for the same physical stock.
    const unknownToInventory = [...soLabs].filter((l) => !invLabs.has(l));
    expect(unknownToInventory).toEqual([]);
  });

  test("an out-of-scope lab is refused identically on both surfaces", async () => {
    for (const [name, handler, path] of [
      ["inventory", inventory, "/api/analysis/inventory?section=position&lab=EGL_UNAPPROVED"],
      ["stockout", stockout, "/api/analysis/stockout?section=categories&lab=EGL_UNAPPROVED"],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { path, cookie });
      expect({ name, status: res.status }).toEqual({ name, status: 403 });
    }
  });
});

describe("Category classification — the status vocabulary is closed again", () => {
  test("CanonicalLotStatus has no string escape hatch", () => {
    const source = readFileSync("src/lib/fantasy/canonical.ts", "utf8");
    const type = source.slice(source.indexOf("export type CanonicalLotStatus"));
    const declaration = type.slice(0, type.indexOf(";") + 1);
    // `| (string & {})` makes the union equivalent to `string`, so any provider value
    // type-checks and the compiler can no longer say a status is unknown.
    expect(declaration.includes("string & {}")).toBe(false);
    expect(declaration.includes('"ROUGH_AVAILABLE"')).toBe(true);
  });

  test("demand no longer re-normalizes a canonical record's lab or shape", () => {
    const source = readFileSync("src/lib/demand/demand-service.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The canonical loops must read the persisted decision. `resolveLabNormalization`
    // remains for the plan-piece loop, which reads a plan's certification intent rather
    // than a canonical record.
    expect(/resolveLabNormalization\(\s*rec\.labRaw/.test(source)).toBe(false);
    expect(/resolveLabNormalization\(\s*inv\.labRaw/.test(source)).toBe(false);
    expect(source.includes("persistedCategoryOf(rec)")).toBe(true);
    expect(source.includes("persistedCategoryOf(inv)")).toBe(true);
  });
});
