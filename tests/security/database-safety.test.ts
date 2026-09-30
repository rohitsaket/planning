// Destructive database tooling fails closed, and non-test commands never destroy.
//
// The environment proof refuses every target that is not an isolated test database, before
// anything connects: a missing or malformed URL, a remote host, the development database, an
// unknown name, and any production or staging marker. The package scripts expose no
// destructive command that skips it. Confirmed reference data is inserted, never replaced:
// it is exercised here through the real service against the isolated planning_sectest
// database, including a rollback forced inside its transaction.
// (Command-level refusals and row-count proofs run in scripts/test-db-safety.ts.)

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { db } from "./helpers";
import { isIsolatedTestDatabase, proveDisposableDatabase, proveLocalDatabase } from "@/lib/fantasy/database-environment";
import { syncConfirmedReferenceData } from "@/lib/reference-data/reference-sync";
import { CONFIRMED_LAB_MAPPINGS, CONFIRMED_SHAPE_MAPPINGS, CONFIRMED_WEIGHT_BANDS } from "@/lib/domain/diamond-rules";

const SECTEST = "postgresql://u:p@localhost:5432/planning_sectest";
const NO_MARKERS = {};

describe("environment proof: destructive tooling refuses anything but an isolated test database", () => {
  const cases: Array<[string, string | undefined, Record<string, string>, string]> = [
    ["missing URL", undefined, NO_MARKERS, "URL_MISSING"],
    ["empty URL", "", NO_MARKERS, "URL_MISSING"],
    ["malformed URL", "not a url", NO_MARKERS, "URL_UNPARSEABLE"],
    ["non-PostgreSQL URL", "mysql://u:p@localhost:3306/planning_sectest", NO_MARKERS, "PROTOCOL_NOT_POSTGRES"],
    ["remote host", "postgresql://u:p@db.internal.corp:5432/planning_sectest", NO_MARKERS, "HOST_NOT_LOOPBACK"],
    ["development database", "postgresql://u:p@localhost:5432/planning", NO_MARKERS, "DATABASE_NAME_NOT_DISPOSABLE"],
    ["unknown database name", "postgresql://u:p@127.0.0.1:5432/customer_live", NO_MARKERS, "DATABASE_NAME_NOT_DISPOSABLE"],
    ["near-miss test name", "postgresql://u:p@localhost:5432/planning_sectest_copy", NO_MARKERS, "DATABASE_NAME_NOT_DISPOSABLE"],
    ["production marker", SECTEST, { APP_ENV: "production" }, "DEPLOYED_ENVIRONMENT"],
    ["staging marker", SECTEST, { DEPLOY_ENV: "staging" }, "DEPLOYED_ENVIRONMENT"],
    ["NODE_ENV production", SECTEST, { NODE_ENV: "production" }, "DEPLOYED_ENVIRONMENT"],
    ["hosted preview marker", SECTEST, { VERCEL_ENV: "Production" }, "DEPLOYED_ENVIRONMENT"],
  ];

  test("each unsafe target is refused, with a reason that never echoes the credentials", () => {
    for (const [label, url, env, refusal] of cases) {
      const proof = proveDisposableDatabase(url, env);
      expect([label, proof.proven, proof.refusal]).toEqual([label, false, refusal]);
      expect([label, (proof.message ?? "").includes("u:p")]).toEqual([label, false]);
      expect([label, isIsolatedTestDatabase(url, env)]).toEqual([label, false]);
    }
  });

  test("the approved isolated test databases on a loopback host are proven", () => {
    for (const url of [SECTEST, "postgres://u:p@127.0.0.1:5432/planning_review", "postgresql://u:p@[::1]:5432/planning_sectest_nocatalog"]) {
      const proof = proveDisposableDatabase(url, { NODE_ENV: "test" });
      expect([url, proof.proven, proof.refusal]).toEqual([url, true, null]);
    }
  });

  test("local development setup accepts the development database but never a remote or deployed one", () => {
    expect(proveLocalDatabase("postgresql://u:p@localhost:5432/planning", NO_MARKERS).proven).toBe(true);
    expect(proveLocalDatabase("postgresql://u:p@db.internal.corp:5432/planning", NO_MARKERS).refusal).toBe("HOST_NOT_LOOPBACK");
    expect(proveLocalDatabase("postgresql://u:p@localhost:5432/planning", { APP_ENV: "staging" }).refusal).toBe("DEPLOYED_ENVIRONMENT");
    // Proving a local database never licenses destruction of it.
    expect(proveDisposableDatabase("postgresql://u:p@localhost:5432/planning", NO_MARKERS).proven).toBe(false);
  });
});

describe("database commands: destructive ones are named and guarded; the others never destroy", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;

  test("no ambiguous seed, reset or push command remains", () => {
    for (const name of ["db:seed", "db:reset", "db:push", "test:seed"]) expect([name, name in scripts]).toEqual([name, false]);
    expect(Object.keys(scripts).filter((k) => k.startsWith("db:")).sort()).toEqual(
      ["db:generate", "db:migrate", "db:migrate:deploy", "db:reference:sync", "db:setup:dev", "db:test:prisma-reset:destructive", "db:test:push:accept-data-loss", "db:test:reset"].sort(),
    );
  });

  test("every command that resets, pushes with data loss or recreates a database proves the target first", () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (/migrate reset|db push|accept-data-loss/.test(command)) {
        expect([name, name.startsWith("db:test:"), /with-sectest-db\.ts npx tsx scripts\/db-guard\.ts \S+ -- npx prisma (migrate reset|db push)/.test(command)]).toEqual([name, true, true]);
      }
    }
    for (const file of ["scripts/test-demo-fixture.ts", "scripts/sectest-db.ts", "scripts/db-guard.ts"]) {
      const source = readFileSync(file, "utf8");
      const guardAt = source.search(/assertDisposableDatabase\(|proveDisposableDatabase\(/);
      const connectAt = source.search(/new PrismaClient\(|spawnSync\(/);
      expect([file, guardAt > 0 && (connectAt < 0 || guardAt < connectAt)]).toEqual([file, true]);
    }
    expect(scripts["db:test:reset"]).toMatch(/^npx tsx --env-file-if-exists=\.env scripts\/sectest-db\.ts --recreate && .*test-demo-fixture\.ts$/);
  });

  test("development setup and reference sync contain no delete, truncate, drop, reset or overwrite", () => {
    for (const file of ["scripts/db-setup-dev.ts", "scripts/db-reference-sync.ts", "src/lib/reference-data/reference-sync.ts"]) {
      const source = readFileSync(file, "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
      expect([file, /\.(delete|deleteMany|update|updateMany|upsert)\(|TRUNCATE|DROP |migrate reset|db push|executeRaw/i.test(source)]).toEqual([file, false]);
    }
    expect(scripts["db:setup:dev"]).toBe("npx tsx --env-file-if-exists=.env scripts/db-setup-dev.ts");
    // Setup applies committed migrations and nothing that resets.
    expect(/"prisma", "migrate", "deploy"/.test(readFileSync("scripts/db-setup-dev.ts", "utf8"))).toBe(true);
  });
});

describe("confirmed reference data is inserted, never replaced", () => {
  // Weight bands other suites' records point at are never deleted here; lab and shape
  // mappings have no dependants. Every row is restored afterwards.
  const UNREFERENCED = { salesRecords: { none: {} }, polishedStones: { none: {} }, salesOrderLines: { none: {} }, requirements: { none: {} }, planningCategories: { none: {} } };
  const CONFIRMED_BAND_CODES = CONFIRMED_WEIGHT_BANDS.map((b) => b.code);
  const NON_BLANK_LABS = CONFIRMED_LAB_MAPPINGS.filter((m) => m.raw.trim() !== "");
  let saved: { bands: Awaited<ReturnType<typeof db.weightBand.findMany>>; labs: Awaited<ReturnType<typeof db.labMapping.findMany>>; shapes: Awaited<ReturnType<typeof db.shapeMapping.findMany>> };
  let existingBands: string[] = [];
  let firstRun: Awaited<ReturnType<typeof syncConfirmedReferenceData>>;
  const auditCount = () => db.auditLog.count();
  const counts = async () => [await db.weightBand.count(), await db.labMapping.count(), await db.shapeMapping.count()];

  beforeAll(async () => {
    saved = { bands: await db.weightBand.findMany(), labs: await db.labMapping.findMany(), shapes: await db.shapeMapping.findMany() };
    // Start from missing reference data wherever that is safe.
    await db.weightBand.deleteMany({ where: { code: { in: CONFIRMED_BAND_CODES }, ...UNREFERENCED } });
    await db.labMapping.deleteMany({});
    await db.shapeMapping.deleteMany({});
    existingBands = (await db.weightBand.findMany({ where: { code: { in: CONFIRMED_BAND_CODES } }, select: { code: true } })).map((b) => b.code);
  });
  afterAll(async () => {
    await db.labMapping.deleteMany({});
    await db.shapeMapping.deleteMany({});
    await db.labMapping.createMany({ data: saved.labs });
    await db.shapeMapping.createMany({ data: saved.shapes });
    const savedCodes = saved.bands.map((b) => b.code);
    await db.weightBand.deleteMany({ where: { code: { notIn: savedCodes }, ...UNREFERENCED } });
    for (const band of saved.bands) await db.weightBand.upsert({ where: { code: band.code }, create: band, update: band });
  });

  test("missing confirmed rows are added, audited in the same transaction; existing history survives", async () => {
    const history = await db.auditLog.create({ data: { actor: "historical.admin", action: "RULE_CHANGE", entity: "BusinessRule", reason: "history that must survive" } });
    const before = [...(await counts()), await auditCount()];
    firstRun = await syncConfirmedReferenceData(db, "cli");
    const expectedBands = CONFIRMED_BAND_CODES.filter((c) => !existingBands.includes(c)).sort();
    expect(expectedBands.length).toBeGreaterThanOrEqual(3);
    expect([firstRun.weightBands, firstRun.labMappings, firstRun.shapeMappings]).toEqual([expectedBands, NON_BLANK_LABS.map((m) => m.raw).sort(), CONFIRMED_SHAPE_MAPPINGS.map((m) => m.raw).sort()]);
    expect(await counts()).toEqual([before[0] + expectedBands.length, NON_BLANK_LABS.length, CONFIRMED_SHAPE_MAPPINGS.length]);
    const audits = await db.auditLog.findMany({ where: { action: "REFERENCE_DATA_INSERTED", timestamp: { gte: history.timestamp } }, orderBy: { entity: "asc" } });
    expect(audits.map((a) => [a.entity, a.actor, a.outcome, a.category])).toEqual([["LabMapping", "cli", "SUCCESS", "OPERATIONAL"], ["ShapeMapping", "cli", "SUCCESS", "OPERATIONAL"], ["WeightBand", "cli", "SUCCESS", "OPERATIONAL"]]);
    expect(await auditCount()).toBe(before[3] + 3);
    expect(await db.auditLog.count({ where: { id: history.id } })).toBe(1);
  });

  test("running again adds nothing and writes no audit", async () => {
    const before = [...(await counts()), await auditCount()];
    const added = await syncConfirmedReferenceData(db, "cli");
    expect([added.weightBands, added.labMappings, added.shapeMappings]).toEqual([[], [], []]);
    expect([...(await counts()), await auditCount()]).toEqual(before);
  });

  test("an edited mapping or band is never overwritten; only a missing row is added back", async () => {
    const labKey = NON_BLANK_LABS[0].raw;
    const shapeKey = CONFIRMED_SHAPE_MAPPINGS[0].raw;
    const [removedBand, editedBand] = firstRun.weightBands;
    await db.labMapping.update({ where: { rawLab: labKey }, data: { normalizedLab: "Other", active: false } });
    await db.shapeMapping.update({ where: { rawShape: shapeKey }, data: { normalizedShape: "Edited by an administrator", category: "custom" } });
    await db.weightBand.update({ where: { code: editedBand }, data: { label: "edited", maxCt: 9.99, active: false } });
    await db.weightBand.delete({ where: { code: removedBand } });

    const added = await syncConfirmedReferenceData(db, "cli");
    expect([added.weightBands, added.labMappings, added.shapeMappings]).toEqual([[removedBand], [], []]);
    const lab = await db.labMapping.findUniqueOrThrow({ where: { rawLab: labKey } });
    const shape = await db.shapeMapping.findUniqueOrThrow({ where: { rawShape: shapeKey } });
    const band = await db.weightBand.findUniqueOrThrow({ where: { code: editedBand } });
    expect([lab.normalizedLab, lab.active, shape.normalizedShape, shape.category, band.label, Number(band.maxCt), band.active]).toEqual(["Other", false, "Edited by an administrator", "custom", "edited", 9.99, false]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "REFERENCE_DATA_INSERTED", entity: "WeightBand" }, orderBy: { timestamp: "desc" } });
    expect(JSON.parse(audit.after!)).toEqual({ inserted: [removedBand] });
  });

  test("a failure inside the transaction leaves neither rows nor audit behind", async () => {
    const missing = firstRun.weightBands[2];
    await db.weightBand.delete({ where: { code: missing } });
    const before = [await db.weightBand.count(), await auditCount()];
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION sectest_fail_reference_audit() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'REFERENCE_DATA_INSERTED' THEN RAISE EXCEPTION 'sectest forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sectest_fail_reference_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sectest_fail_reference_audit()`);
    try {
      await expect(syncConfirmedReferenceData(db, "cli")).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER sectest_fail_reference_audit ON "AuditLog"`);
    }
    expect([await db.weightBand.count(), await auditCount(), await db.weightBand.count({ where: { code: missing } })]).toEqual([...before, 0]);
    // Once the failure is gone, the missing band is added.
    expect((await syncConfirmedReferenceData(db, "cli")).weightBands).toEqual([missing]);
  });
});
