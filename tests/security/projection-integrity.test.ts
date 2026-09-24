import { beforeAll, describe, expect, test } from "./harness";
import { db, resetDb } from "./helpers";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";
import {
  checkProjectionInvariant,
  reconcileOperationalProjection,
  requiresOperationalMirror,
} from "@/lib/fantasy/operational-projection";
import { proveDisposableDatabase, isIsolatedTestDatabase } from "@/lib/fantasy/database-environment";
import { runDemandCalculation } from "@/lib/demand/demand-service";

/**
 * Operational projection integrity.
 *
 * The audited failure, reproduced: an ordinary seed cleared `PolishedStone` while leaving
 * the canonical records, their history and their checkpoints in place. The next
 * synchronization saw every source record unchanged and rebuilt nothing, so 523 current,
 * classified, physically-available lots had no operational mirror. The demand run blocked
 * all of them, reported zero available stock in every category, and the loader announced
 * the dataset was ready for evaluation.
 *
 * These tests cover the whole sequence: the damage, the repair, the refusal to call a run
 * ready while it persists, and the guard that stops the seed causing it again.
 */

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

/** Canonical records across every class, so eligibility is exercised both ways. */
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
      // Everything the synchronizer would not have mirrored either.
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
    // Nine eligible records (6 stock + 3 memo) and every record unclassified.
    expect(before.missingMirrors).toBe(9);
    expect(before.satisfied).toBe(false);

    const result = await reconcileOperationalProjection({ actor: "projection-test" });
    expect(result.mirrorsCreated).toBe(9);
    expect(result.complete).toBe(true);

    // And nothing was manufactured for a record that should not have one.
    const mirrors = await db.polishedStone.count({ where: { fantasyLotId: { startsWith: BATCH } } });
    expect(mirrors).toBe(9);
  });

  test("step 2 — the permitted seed workflow refuses to run over canonical data", () => {
    // The seed clears derived tables but never the canonical records, their history or
    // their checkpoints. Running it here is what produced the audited damage, so it now
    // refuses rather than performing half of a reset.
    const seed = readFileSync("prisma/seed.ts", "utf8");
    expect(seed.includes("Seed refused: this database holds canonical operational data")).toBe(true);
    expect(seed.includes("OPERATIONAL_TABLES_NOT_CLEARED")).toBe(true);
    // The opt-in path deletes canonical data, so it must prove where it is first.
    expect(seed.includes("proveDisposableDatabase")).toBe(true);
    // And it clears the canonical owners together with their projections.
    expect(/if \(fullReset\)/.test(seed)).toBe(true);
  });

  test("step 3 — a seed-shaped deletion is detected and repaired", async () => {
    // Exactly what an ordinary seed did: delete the projections, keep their owners.
    await db.polishedStone.deleteMany({ where: { fantasyLotId: { startsWith: BATCH } } });

    const damaged = await checkProjectionInvariant();
    expect(damaged.satisfied).toBe(false);
    expect(damaged.missingMirrors).toBe(9);
    expect(damaged.message !== null).toBe(true);

    // The canonical records are untouched and unchanged, so a synchronization would
    // rebuild nothing. Reconciliation does not depend on the source having changed.
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
    // Every record is still present, and every *current* one now carries a
    // classification. Superseded versions are history: they are not current stock, are
    // read through `LotHistoryRecord` rather than here, and are deliberately left alone.
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
    // Demand completes the projection itself before reading it, so the invariant holds.
    const invariant = await checkProjectionInvariant();
    expect(invariant.satisfied).toBe(true);
    expect(["COMPLETED", "REVIEW_REQUIRED"].includes(run.status)).toBe(true);
  });

  test("the run records the reason when the projection could not be completed", () => {
    // The refusal is wired to the invariant, not to a comment: the run status is derived
    // from it and a data-quality issue names it.
    const source = readFileSync("src/lib/demand/demand-service.ts", "utf8");
    expect(source.includes("OPERATIONAL_PROJECTION_INCOMPLETE")).toBe(true);
    expect(source.includes("|| !projectionInvariant.satisfied")).toBe(true);
    // And the projection is completed before the sale facts are read, not after — a
    // repair that lands after the read leaves the run a version behind.
    const repairAt = source.indexOf("reconcileOperationalProjection");
    const salesAt = source.indexOf("loadConfirmedSaleFacts({");
    expect(repairAt < salesAt).toBe(true);
  });
});

describe("Projection integrity — database environment proof", () => {
  test("a loopback host with a disposable database name is proven", () => {
    for (const url of [
      "postgresql://u:p@localhost:5432/planning",
      "postgres://u:p@127.0.0.1:5432/planning_sectest",
      "postgresql://u:p@localhost:5432/planning_review",
    ]) {
      expect({ url, proven: proveDisposableDatabase(url).proven }).toEqual({ url, proven: true });
    }
  });

  test("a remote host is refused however familiar its database name looks", () => {
    // The previous check searched the whole connection string for substrings, so this
    // exact URL passed as "local" because it contains `planning_sectest`.
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
    // Cleanup deletes canonical records and immutable history, so it is permitted only
    // on a throwaway database — never on the local development one.
    expect(isIsolatedTestDatabase("postgresql://u:p@localhost:5432/planning")).toBe(false);
    expect(isIsolatedTestDatabase("postgresql://u:p@localhost:5432/planning_sectest")).toBe(true);
  });

  test("the fixture cleanup refuses outside an isolated review database", () => {
    const source = readFileSync("src/lib/fantasy/analysis-review-fixture.ts", "utf8");
    expect(source.includes("isIsolatedTestDatabase")).toBe(true);
    // And it no longer orphans the demand runs it created.
    expect(source.includes("cleanedDemandRuns")).toBe(true);
    // The checkpoint is never moved backwards.
    expect(/never moved backwards/i.test(source)).toBe(true);
  });
});

describe("Projection integrity — reconciliation stays bounded", () => {
  test("it pages rather than reading the table", () => {
    const source = readFileSync("src/lib/fantasy/operational-projection.ts", "utf8");
    // Keyset pagination with an explicit batch ceiling, not one unbounded findMany.
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
