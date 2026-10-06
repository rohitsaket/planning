import { beforeAll, describe, expect, test } from "./harness";
import { db, resetDb } from "./helpers";
import { existsSync, readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import {
  checkProjectionInvariant,
  reconcileOperationalProjection,
  requiresOperationalMirror,
} from "@/lib/fantasy/operational-projection";
import { proveDisposableDatabase, isIsolatedTestDatabase } from "@/lib/fantasy/database-environment";
import { runDemandCalculation } from "@/lib/demand/demand-service";

const BATCH = "PROJECTION-TEST";
const BASE = new Date("2026-06-15T00:00:00.000Z");

async function ensureReferenceData() {
  const band = { code: "PT-1.00-1.49", label: "1.00 - 1.49 ct", minCt: 1.0, maxCt: 1.49, sortOrder: 950 };
  if (!(await db.weightBand.findFirst({ where: { code: band.code } }))) {
    await db.weightBand.create({ data: { ...band, active: true } });
  }
  if (!(await db.labMapping.findFirst({ where: { rawLab: "GIA" } }))) {
    await db.labMapping.create({ data: { rawLab: "GIA", normalizedLab: "GIA", active: true } });
  }
  if (!(await db.shapeMapping.findFirst({ where: { rawShape: "ROUND" } }))) {
    await db.shapeMapping.create({ data: { rawShape: "ROUND", normalizedShape: "ROUND", active: true } });
  }
}

async function seedCanonical() {
  const rows: Prisma.LotMasterRecordCreateManyInput[] = [];
  const spec: Array<{ n: number; cls: string; status: string; form: string; current: boolean }> = [
    { n: 6, cls: "PHYSICAL_AVAILABLE", status: "STOCK", form: "POLISHED", current: true },
    { n: 3, cls: "MEMO", status: "MEMO", form: "POLISHED", current: true },
    { n: 2, cls: "RESERVED", status: "RESERVED", form: "POLISHED", current: true },
    { n: 2, cls: "WIP", status: "WIP_LASER", form: "WIP", current: true },
    { n: 2, cls: "EXCLUDED", status: "ROUGH_AVAILABLE", form: "ROUGH", current: true },
    { n: 2, cls: "EXCLUDED", status: "SOLD", form: "POLISHED", current: false },
  ];
  let i = 0;
  for (const s of spec) {
    for (let k = 0; k < s.n; k++) {
      rows.push({
        lotId: `${BATCH}-${s.cls}-${i++}`,
        currentStatus: s.status,
        statusEffectiveDate: BASE,
        docDate: BASE,
        shape: "ROUND",
        weight: new Prisma.Decimal(1.2),
        labRaw: "GIA",
        quantity: new Prisma.Decimal(1),
        quantityProvenance: "EXPLICIT_FIXTURE",
        country: "IN",
        branch: "SRT",
        lastSyncBatchId: BATCH,
        isCurrent: s.current,
        roughOrPolished: s.form,
        sourceType: "FIXTURE",
        isSimulated: true,
        inventoryClass: s.cls,
        classificationState: s.cls === "EXCLUDED" ? "BLOCKED" : "CLASSIFIED",
        holdState: "NOT_HELD",
        canonicalLifecycle: s.current ? "AVAILABLE" : "SOLD",
        firstSeenAt: BASE,
        lastSeenAt: BASE,
      });
    }
  }
  await db.lotMasterRecord.createMany({ data: rows });
}

async function clearFixtures() {
  await db.polishedStone.deleteMany({ where: { fantasyLotId: { startsWith: BATCH } } });
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

describe("Projection integrity — eligibility", () => {
  test("only current polished stock and memo require an operational mirror", () => {
    const cases = [
      { isCurrent: true, roughOrPolished: "POLISHED", inventoryClass: "PHYSICAL_AVAILABLE", expect: true },
      { isCurrent: true, roughOrPolished: "POLISHED", inventoryClass: "MEMO", expect: true },
      { isCurrent: true, roughOrPolished: "POLISHED", inventoryClass: "RESERVED", expect: false },
      { isCurrent: true, roughOrPolished: "WIP", inventoryClass: "WIP", expect: false },
      { isCurrent: true, roughOrPolished: "ROUGH", inventoryClass: "EXCLUDED", expect: false },
      { isCurrent: true, roughOrPolished: "POLISHED", inventoryClass: "EXCLUDED", expect: false },
      { isCurrent: true, roughOrPolished: "POLISHED", inventoryClass: null, expect: false },
      { isCurrent: false, roughOrPolished: "POLISHED", inventoryClass: "PHYSICAL_AVAILABLE", expect: false },
    ];
    const wrong = cases.filter((c) => requiresOperationalMirror(c) !== c.expect);
    expect(wrong).toEqual([]);
  });
});

describe("Projection integrity — the audited sequence", () => {
  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    await seedCanonical();
  });

  test("step 1 — reconciliation builds the mirrors the canonical records are owed", async () => {
    const before = await checkProjectionInvariant();
    expect(before.missingMirrors).toBe(9);
    expect(before.satisfied).toBe(false);

    const result = await reconcileOperationalProjection({ actor: "projection-test" });
    expect(result.mirrorsCreated).toBe(9);
    expect(result.complete).toBe(true);

    const mirrors = await db.polishedStone.count({ where: { fantasyLotId: { startsWith: BATCH } } });
    expect(mirrors).toBe(9);
  });

  test("step 2 — no general-purpose seed exists; the demo fixture clears projections with their owners, on a test database only", () => {
    expect(existsSync("prisma/seed.ts")).toBe(false);
    const fixture = readFileSync("scripts/test-demo-fixture.ts", "utf8");
    const guardAt = fixture.indexOf("assertDisposableDatabase(process.env.DATABASE_URL");
    expect([guardAt > 0, guardAt < fixture.indexOf("new PrismaClient()")]).toEqual([true, true]);
    expect([/"PolishedStone"[\s\S]*"LotMasterRecord"/.test(fixture), fixture.includes("client.$transaction(")]).toEqual([true, true]);
  });

  test("step 3 — a seed-shaped deletion is detected and repaired", async () => {
    await db.polishedStone.deleteMany({ where: { fantasyLotId: { startsWith: BATCH } } });

    const damaged = await checkProjectionInvariant();
    expect(damaged.satisfied).toBe(false);
    expect(damaged.missingMirrors).toBe(9);
    expect(damaged.message !== null).toBe(true);

    const repair = await reconcileOperationalProjection({ actor: "projection-test" });
    expect(repair.mirrorsCreated).toBe(9);
    expect(repair.complete).toBe(true);
  });

  test("step 4 — canonical records, history and checkpoints remain coherent", async () => {
    const after = await checkProjectionInvariant();
    expect(after.satisfied).toBe(true);

    const lots = await db.lotMasterRecord.count({ where: { lastSyncBatchId: BATCH } });
    const current = await db.lotMasterRecord.count({ where: { lastSyncBatchId: BATCH, isCurrent: true } });
    const classifiedCurrent = await db.lotMasterRecord.count({
      where: { lastSyncBatchId: BATCH, isCurrent: true, categoryState: { not: null } },
    });
    expect({ lots, current, classifiedCurrent }).toEqual({ lots: 17, current: 15, classifiedCurrent: 15 });
  });

  test("reconciliation is idempotent — a second pass changes nothing", async () => {
    const second = await reconcileOperationalProjection({ actor: "projection-test" });
    expect({
      created: second.mirrorsCreated,
      classifications: second.classificationsWritten,
      complete: second.complete,
    }).toEqual({ created: 0, classifications: 0, complete: true });
  });
});

describe("Projection integrity — demand refuses to declare an incomplete run ready", () => {
  beforeAll(async () => {
    await resetDb();
    await clearFixtures();
    await ensureReferenceData();
    await seedCanonical();
  });

  test("a run over a complete projection may reach COMPLETED", async () => {
    const run = await runDemandCalculation({ actor: "projection-ready", windowDays: 90, referenceDate: BASE });
    const invariant = await checkProjectionInvariant();
    expect(invariant.satisfied).toBe(true);
    expect(["COMPLETED", "REVIEW_REQUIRED"].includes(run.status)).toBe(true);
  });

  test("the run records the reason when the projection could not be completed", () => {
    const source = readFileSync("src/lib/demand/demand-service.ts", "utf8");
    expect(source.includes("OPERATIONAL_PROJECTION_INCOMPLETE")).toBe(true);
    expect(source.includes("|| !projectionInvariant.satisfied")).toBe(true);
    const repairAt = source.indexOf("reconcileOperationalProjection");
    const salesAt = source.indexOf("loadConfirmedSaleFacts({");
    expect(repairAt < salesAt).toBe(true);
  });
});

describe("Projection integrity — database environment proof", () => {
  test("a loopback host with an isolated test database name is proven; the development database is not", () => {
    for (const url of [
      "postgres://u:p@127.0.0.1:5432/planning_sectest",
      "postgresql://u:p@localhost:5432/planning_review",
    ]) {
      expect({ url, proven: proveDisposableDatabase(url).proven }).toEqual({ url, proven: true });
    }
    expect(proveDisposableDatabase("postgresql://u:p@localhost:5432/planning").refusal).toBe("DATABASE_NAME_NOT_DISPOSABLE");
  });

  test("a remote host is refused however familiar its database name looks", () => {
    const proof = proveDisposableDatabase("postgresql://u:p@db.internal.corp:5432/planning_sectest");
    expect({ proven: proof.proven, refusal: proof.refusal }).toEqual({
      proven: false,
      refusal: "HOST_NOT_LOOPBACK",
    });
    expect(proof.message?.includes("db.internal.corp")).toBe(true);
  });

  test("an unrecognised database name on a loopback host is refused", () => {
    const proof = proveDisposableDatabase("postgresql://u:p@localhost:5432/customer_live");
    expect({ proven: proof.proven, refusal: proof.refusal }).toEqual({
      proven: false,
      refusal: "DATABASE_NAME_NOT_DISPOSABLE",
    });
  });

  test("a missing or unparseable URL is refused rather than assumed", () => {
    expect(proveDisposableDatabase(undefined).refusal).toBe("URL_MISSING");
    expect(proveDisposableDatabase("").refusal).toBe("URL_MISSING");
    expect(proveDisposableDatabase("not a url").refusal).toBe("URL_UNPARSEABLE");
    expect(proveDisposableDatabase("mysql://u:p@localhost:3306/planning").refusal).toBe("PROTOCOL_NOT_POSTGRES");
  });

  test("the development database is not treated as a disposable review database", () => {
    expect(isIsolatedTestDatabase("postgresql://u:p@localhost:5432/planning")).toBe(false);
    expect(isIsolatedTestDatabase("postgresql://u:p@localhost:5432/planning_sectest")).toBe(true);
  });

  test("the fixture cleanup refuses outside an isolated review database", () => {
    const source = readFileSync("src/lib/fantasy/analysis-review-fixture.ts", "utf8");
    expect(source.includes("isIsolatedTestDatabase")).toBe(true);
    expect(source.includes("cleanedDemandRuns")).toBe(true);
    expect(/never moved backwards/i.test(source)).toBe(true);
  });
});

describe("Projection integrity — reconciliation stays bounded", () => {
  test("it pages rather than reading the table", () => {
    const source = readFileSync("src/lib/fantasy/operational-projection.ts", "utf8");
    expect(source.includes("RECONCILIATION_BATCH_SIZE")).toBe(true);
    expect(source.includes("RECONCILIATION_MAX_BATCHES")).toBe(true);
    expect(/LIMIT \$\{batchSize\}/.test(source)).toBe(true);
    expect(source.includes("truncated")).toBe(true);
  });

  test("the audit summary carries counts, not record payloads", () => {
    const source = readFileSync("src/lib/fantasy/operational-projection.ts", "utf8");
    const logCall = source.slice(source.indexOf('"operational_projection_reconciled"'));
    const block = logCall.slice(0, logCall.indexOf("});"));
    for (const leak of ["lotId", "customerName", "certificate", "labRaw", "weight"]) {
      expect({ leak, present: block.includes(leak) }).toEqual({ leak, present: false });
    }
    expect(block.includes("scanned")).toBe(true);
  });
});
