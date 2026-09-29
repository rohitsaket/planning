// Sarin Workbook Import workflow: page and navigation permission alignment, the separate
// upload / validate / generate / export authorities, upload safety and idempotency,
// revalidation of imports validated under older rules, unresolved-mapping review, and the
// structured-output export.
//
// Every request goes through the real route handlers against the isolated
// planning_sectest database, as users holding exactly the permissions under test (custom
// roles created through the real admin routes). Failures are injected by database
// triggers. All data is synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { randomUUID } from "node:crypto";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { permissionsFor, ROLES } from "@/lib/auth/permissions";
import { GET as listImports, POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import * as importRoute from "@/app/api/planning/sarin/imports/[batchId]/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { GET as listIssues } from "@/app/api/planning/sarin/imports/[batchId]/issues/route";
import { POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { GET as exportOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/export/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { exportOutputVersion } from "@/lib/sarin/output-export";
import { SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";
import { applyCatalog, type CatalogRule } from "./sarin-catalog";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, planner: User, reader: User, viewer: User, admin: User, mapper: User;
let uploader: User, validator: User, generator: User, exporter: User;
let blueSetId = "";
const BLUE_RULES: CatalogRule[] = [{ rawShape: "ROUND", normalizedShape: "Round" }];

// ---- synthetic records ---------------------------------------------------------------------
let nonce = 0;
const kapan = () => `7${String(++nonce).padStart(3, "0")}Q`;
interface Rec { name: string; rough?: string; shape?: string; est?: string; clarity?: string; ratio?: string }
const line = (r: Rec) => [r.name, r.rough ?? "3.000", r.shape ?? "ROUND", r.est ?? "1.500", r.clarity ?? "VS1", "G", "61.6", r.ratio ?? "1.000", "7.62", "7.62", "4.69"].join(",");
const file = (recs: Rec[]) => recs.map(line).join("\n") + "\n";
const stone = (o: Rec, count = 17) => Array.from({ length: count }, () => ({ ...o }));

// ---- requests -------------------------------------------------------------------------------
async function upload(cookie: string | undefined, bytes: Uint8Array, name = "sarin.csv", fields: Record<string, string> = {}) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([bytes as BlobPart], name, { type: "text/csv" }));
  for (const [k, v] of Object.entries({ packetType: "BLUE", planningDate: "2026-09-28", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) };
  if (cookie) headers.cookie = cookie;
  const res = await uploadImport(new Request(URL_, { method: "POST", headers, body }), { params: Promise.resolve({}) } as never);
  return { status: res.status, json: (await res.json()) as any };
}
const text = (s: string) => new TextEncoder().encode(s);
async function uploadBatch(recs: Rec[], fields: Record<string, string> = {}) {
  const r = await upload(planner.cookie, text(file(recs)), "sarin.csv", fields);
  if (r.status !== 201) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.batch.id as string;
}
/** Checks a file against the shape mappings in effect. */
const validate = (batchId: string, cookie: string) => {
  resetRateLimits();
  return call(validateImport, { method: "POST", cookie, body: {}, params: { batchId } });
};
const generate = (batchId: string, cookie: string) => {
  resetRateLimits();
  return call(generateOutput, { method: "POST", cookie, body: {}, params: { batchId } });
};
const read = (handler: any, params: Record<string, string>, query = "", cookie = planner.cookie) => {
  resetRateLimits();
  return call(handler, { cookie, path: `/api/x${query}`, params });
};
async function exportCsv(batchId: string, versionId: string, cookie: string | undefined) {
  resetRateLimits();
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const res = await exportOutput(new Request(`${URL_}/${batchId}/outputs/${versionId}/export`, { headers }), { params: Promise.resolve({ batchId, versionId }) } as never);
  return { status: res.status, headers: res.headers, body: await res.text() };
}
const audits = (action: string, batchId: string) => db.auditLog.findMany({ where: { action, entityId: batchId }, orderBy: { timestamp: "asc" } });

/** A user whose only role holds exactly these permissions, built through the admin routes. */
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `SARIN_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Test ${name}`, permissions } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status} ${JSON.stringify(role.json)}`);
  resetRateLimits();
  const assigned = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } });
  if (assigned.status !== 200) throw new Error(`role assign failed ${assigned.status}`);
  return u;
}

/** Records a completed, clean validation made under an older validation profile, the way Phase 5 recorded one. */
async function markValidatedUnder(batchId: string, profile: string) {
  const b = await db.sarinImportBatch.update({
    where: { id: batchId },
    data: { status: "VALIDATING", validationAttempt: { increment: 1 }, fencingVersion: { increment: 1 }, claimToken: randomUUID(), claimedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), shapeMappingSetId: blueSetId },
  });
  const attempt = await db.sarinValidationAttempt.create({
    data: { batchId, attemptNumber: b.validationAttempt, shapeMappingSetId: blueSetId, startedByUserId: planner.user.id, claimFencingVersion: b.fencingVersion, validationProfileVersion: profile },
  });
  await db.sarinValidationAttempt.update({ where: { id: attempt.id }, data: { status: "COMPLETED", result: "VALIDATED", blockCount: 0, parsedBlockCount: 0, quarantinedBlockCount: 0, interpretationCount: 0, issueCount: 0, blockingIssueCount: 0 } });
  await db.sarinImportBatch.update({ where: { id: batchId }, data: { status: "VALIDATED", claimToken: null, claimedAt: null, leaseExpiresAt: null } });
  return attempt.id;
}

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("wf.root", "SUPER_ADMIN");
  planner = await makeUser("wf.planner", "PLANNER", "Priya Planner");
  reader = await makeUser("wf.reader", "PLANNING_VIEWER");
  viewer = await makeUser("wf.viewer", "VIEWER");
  admin = await makeUser("wf.admin", "ADMIN");
  mapper = await userWith("wf.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  uploader = await userWith("wf.uploader", ["sarin.import.read", "sarin.import.upload"]);
  validator = await userWith("wf.validator", ["sarin.import.read", "sarin.import.validate"]);
  generator = await userWith("wf.generator", ["sarin.import.read", "sarin.output.generate"]);
  exporter = await userWith("wf.exporter", ["sarin.import.read", "sarin.output.export"]);
});
// Every test starts from the Blue catalog; a test that changes it does so through the API.
beforeEach(async () => {
  resetRateLimits();
  blueSetId = await applyCatalog(mapper.cookie, BLUE_RULES);
});

// =========================================================================================
describe("sarin workflow: page and navigation permissions", () => {
  test("the page admits exactly the roles that hold sarin.import.read, not plan.create", () => {
    for (const role of ROLES) {
      const perms = permissionsFor(role);
      expect([role, isViewAuthorized(perms, "planning-workbook-import")]).toEqual([role, perms.includes("sarin.import.read")]);
    }
    expect(isViewAuthorized(["plan.create"], "planning-workbook-import")).toBe(false);
    expect(isViewAuthorized(["sarin.import.read"], "planning-workbook-import")).toBe(true);
  });

  test("a reader can list imports but gets no upload constraints; an uploader gets them; others are refused", async () => {
    await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    const asReader = await read(listImports, {}, "", reader.cookie);
    expect([asReader.status, asReader.json.upload, asReader.json.rows.length > 0]).toEqual([200, null, true]);
    const asUploader = await read(listImports, {}, "", uploader.cookie);
    expect(asUploader.json.upload).toMatchObject({ acceptedExtension: ".csv", maxFileBytes: 8 * 1024 * 1024, maxRecords: 150_000 });
    expect([Array.isArray(asUploader.json.upload.labs), "countries" in asUploader.json.upload]).toEqual([true, false]);
    expect((await read(listImports, {}, "", viewer.cookie)).status).toBe(403);
    expect((await call(listImports, { path: "/api/x" })).status).toBe(401);
  });
});

// =========================================================================================
describe("sarin workflow: upload", () => {
  test("only sarin.import.upload may upload; the uploader and summary come from the session", async () => {
    const content = text(file(stone({ name: `${kapan()}-001 DC` })));
    expect((await upload(undefined, content)).status).toBe(401);
    for (const u of [reader, validator, generator, exporter, admin]) expect([u.user.username, (await upload(u.cookie, content)).status]).toEqual([u.user.username, 403]);
    const ok = await upload(uploader.cookie, content);
    expect(ok.status).toBe(201);
    const batch = ok.json.batch;
    expect([batch.uploadedBy, batch.stones, batch.revalidationRequired, batch.counts.records, batch.status]).toEqual(["wf.uploader", null, false, 17, "UPLOADED"]);
    expect((await audits("SARIN_IMPORT_UPLOADED", batch.id)).map((a: any) => a.actorUserId)).toEqual([uploader.user.id]);
    // Client-supplied identity is refused, not ignored.
    expect((await upload(uploader.cookie, content, "sarin.csv", { uploadedBy: "someone" })).status).toBe(400);
  });

  test("the same file and details twice is one import; unsupported, empty and oversized files are refused safely", async () => {
    const content = text(file(stone({ name: `${kapan()}-001 DC` })));
    const first = await upload(uploader.cookie, content);
    const again = await upload(uploader.cookie, content);
    expect([first.status, again.status, again.json.duplicate, again.json.batch.id]).toEqual([201, 200, true, first.json.batch.id]);
    expect(await db.sarinImportBatch.count({ where: { sourceFile: { sha256: first.json.batch.sourceFile.sha256 } } })).toBe(1);
    const refusals: Array<[string, Uint8Array, string, number, string]> = [
      ["xlsx", content, "plan.xlsx", 400, "NOT_A_CSV_FILE"],
      ["txt", content, "plan.txt", 400, "NOT_A_CSV_FILE"],
      ["empty", new Uint8Array(0), "empty.csv", 400, "EMPTY_FILE"],
      ["oversized", new Uint8Array(8 * 1024 * 1024 + 1).fill(65), "big.csv", 413, "FILE_TOO_LARGE"],
      ["zip renamed to csv", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]), "zip.csv", 400, "NOT_A_CSV_FILE"],
      ["binary", new Uint8Array([0x41, 0x00, 0x42, 0x0a]), "bin.csv", 400, "BINARY_CONTENT"],
    ];
    for (const [label, bytes, name, status, code] of refusals) {
      const r = await upload(uploader.cookie, bytes, name);
      expect([label, r.status, r.json.error.code]).toEqual([label, status, code]);
      expect([label, /at .*\.ts|node_modules|[A-Z]:\\\\|SELECT/.test(JSON.stringify(r.json))]).toEqual([label, false]);
    }
  });

  test("uploads are rate limited per user", async () => {
    resetRateLimits();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const fd = new FormData();
      fd.append("file", new File([new Uint8Array(0) as BlobPart], "x.csv"));
      const encoded = new Response(fd);
      const body = new Uint8Array(await encoded.arrayBuffer());
      const res = await uploadImport(new Request(URL_, { method: "POST", headers: { cookie: uploader.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }), { params: Promise.resolve({}) } as never);
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});

// =========================================================================================
describe("sarin workflow: separate authorities for validate and generate", () => {
  test("validation needs sarin.import.validate; generation needs sarin.output.generate", async () => {
    const batchId = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    for (const u of [reader, uploader, generator, exporter]) expect([u.user.username, (await validate(batchId, u.cookie)).status]).toEqual([u.user.username, 403]);
    const v = await validate(batchId, validator.cookie);
    expect([v.status, v.json.batch.status, v.json.batch.stones]).toEqual([200, "VALIDATED", { detected: 1, identityResolved: 1, identityUnresolved: 0 }]);
    for (const u of [reader, uploader, validator, exporter]) expect([u.user.username, (await generate(batchId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect(await db.sarinOutputVersion.count({ where: { batchId } })).toBe(0);
    const g = await generate(batchId, generator.cookie);
    expect([g.status, g.json.output.version.generatedBy]).toEqual([201, "wf.generator"]);
  });

  test("an out-of-scope import cannot be discovered, validated, generated or exported", async () => {
    const be = await uploadBatch(stone({ name: `${kapan()}-001 DC` }), { labId: "IGI" });
    await validate(be, planner.cookie);
    const versionId = (await generate(be, planner.cookie)).json.output.version.id;
    const scoped = await makeUser("wf.scoped", "PLANNER");
    await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "LAB", value: "GIA" } });
    expect((await read(listImports, {}, "?pageSize=100", scoped.cookie)).json.rows.some((b: any) => b.id === be)).toBe(false);
    expect((await read(importRoute.GET, { batchId: be }, "", scoped.cookie)).status).toBe(404);
    expect((await validate(be, scoped.cookie)).status).toBe(404);
    expect((await generate(be, scoped.cookie)).status).toBe(404);
    expect((await exportCsv(be, versionId, scoped.cookie)).status).toBe(404);
  });
});

// =========================================================================================
describe("sarin workflow: revalidation under updated rules", () => {
  test("an import validated under an older profile shows Revalidation Required and cannot generate", async () => {
    const batchId = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    await markValidatedUnder(batchId, "SARIN_VALIDATION_V2");
    const detail = (await read(importRoute.GET, { batchId })).json;
    expect([detail.validation.revalidationRequired, detail.validation.currentValidationProfile, detail.validation.lastCompletedAttempt.validationProfile]).toEqual([
      true, SARIN_VALIDATION_PROFILE_VERSION, "SARIN_VALIDATION_V2",
    ]);
    expect(detail.batch.revalidationRequired).toBe(true);
    const listed = (await read(listImports, {}, "?pageSize=100")).json.rows.find((b: any) => b.id === batchId);
    expect(listed.revalidationRequired).toBe(true);
    const refused = await generate(batchId, planner.cookie);
    expect([refused.status, refused.json.error.code]).toEqual([409, "VALIDATION_PROFILE_OUTDATED"]);
    expect(/SARIN_VALIDATION_V|stack|SELECT/.test(refused.json.error.message)).toBe(false);
    expect(await db.sarinOutputVersion.count({ where: { batchId } })).toBe(0);
  });

  test("revalidation needs sarin.import.validate, keeps the earlier validation, is audited and is idempotent", async () => {
    const batchId = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    const oldAttemptId = await markValidatedUnder(batchId, "SARIN_VALIDATION_V2");
    for (const u of [reader, uploader, generator]) expect([u.user.username, (await validate(batchId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(1);

    const again = await validate(batchId, validator.cookie);
    expect([again.status, again.json.reused, again.json.batch.status, again.json.validation.revalidationRequired, again.json.validation.lastCompletedAttempt.number]).toEqual([200, false, "VALIDATED", false, 2]);
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId }, orderBy: { attemptNumber: "asc" }, select: { id: true, status: true, validationProfileVersion: true } });
    expect(attempts).toEqual([
      { id: oldAttemptId, status: "COMPLETED", validationProfileVersion: "SARIN_VALIDATION_V2" },
      { id: attempts[1].id, status: "COMPLETED", validationProfileVersion: SARIN_VALIDATION_PROFILE_VERSION },
    ]);
    const revalidated = await audits("SARIN_VALIDATION_PROFILE_REVALIDATION", batchId);
    expect(revalidated.map((a: any) => [a.actorUserId, JSON.parse(a.before!).validationProfile, JSON.parse(a.after!).validationProfile])).toEqual([[validator.user.id, "SARIN_VALIDATION_V2", SARIN_VALIDATION_PROFILE_VERSION]]);

    // Repeating it changes nothing and records no second revalidation.
    const repeat = await validate(batchId, validator.cookie);
    expect([repeat.status, repeat.json.reused]).toEqual([200, true]);
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(2);
    expect((await audits("SARIN_VALIDATION_PROFILE_REVALIDATION", batchId)).length).toBe(1);
    expect((await generate(batchId, generator.cookie)).status).toBe(201);
  });

  test("two concurrent revalidations start exactly one attempt", async () => {
    const k = kapan();
    const batchId = await uploadBatch(Array.from({ length: 60 }, (_, s) => stone({ name: `${k}-${String(s).padStart(3, "0")} DC` })).flat());
    await markValidatedUnder(batchId, "SARIN_VALIDATION_V2");
    resetRateLimits();
    const results = await Promise.all([0, 1].map(() => call(validateImport, { method: "POST", cookie: validator.cookie, body: {}, params: { batchId } })));
    const outcomes = results.map((r) => (r.status === 200 ? (r.json.reused ? "REUSED" : "RAN") : r.json.error.code));
    expect(outcomes.filter((o) => o === "RAN")).toHaveLength(1);
    expect(outcomes.every((o) => ["RAN", "REUSED", "VALIDATION_IN_PROGRESS"].includes(o))).toBe(true);
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(2);
  });

  test("a revalidation that fails part-way keeps nothing and leaves the import needing revalidation", async () => {
    const k = kapan();
    const batchId = await uploadBatch(Array.from({ length: 4 }, (_, s) => stone({ name: `${k}-${String(s).padStart(3, "0")} DC` })).flat());
    await markValidatedUnder(batchId, "SARIN_VALIDATION_V2");
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_inject_revalidation_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW."sourceRowNumber" = 40 THEN RAISE EXCEPTION 'injected revalidation failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_revalidation_failure BEFORE INSERT ON "SarinRowInterpretation" FOR EACH ROW EXECUTE FUNCTION test_inject_revalidation_failure()`);
    let failed: Awaited<ReturnType<typeof validate>>;
    try {
      failed = await validate(batchId, validator.cookie);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_revalidation_failure ON "SarinRowInterpretation"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_revalidation_failure()`);
    }
    expect([failed.status, failed.json.error.code, /injected/.test(JSON.stringify(failed.json))]).toEqual([500, "VALIDATION_NOT_COMPLETED", false]);
    expect(await db.sarinRowInterpretation.count({ where: { batchId } })).toBe(0);
    expect(await db.sarinStoneBlock.count({ where: { batchId } })).toBe(0);
    const detail = (await read(importRoute.GET, { batchId })).json;
    expect([detail.batch.status, detail.validation.revalidationRequired, detail.validation.lastCompletedAttempt.validationProfile]).toEqual(["FAILED", true, "SARIN_VALIDATION_V2"]);
    const retry = await validate(batchId, validator.cookie);
    expect([retry.status, retry.json.batch.status, retry.json.validation.revalidationRequired]).toEqual([200, "VALIDATED", false]);
  });
});

// =========================================================================================
describe("sarin workflow: findings for review", () => {
  test("blocking issues and warnings are listed separately, with the raw shape, Ratio and a next step", async () => {
    await applyCatalog(mapper.cookie, [
      ...BLUE_RULES,
      { rawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: "1.000", ratioMax: "1.030" },
      { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.400", ratioMax: null },
    ]);
    const name = `${kapan()}-001 DC`;
    const recs = stone({ name });
    recs[4] = { name, shape: "EMERALD 4STEP", ratio: "1.435" }; // no mapping at all: written unmapped, with a warning
    recs[6] = { name, shape: "EMERALD 5STEP", ratio: "1.200" }; // mapped by Ratio, but outside every range: blocks
    const batchId = await uploadBatch(recs);
    expect((await validate(batchId, validator.cookie)).json.batch.status).toBe("NEEDS_REVIEW");
    const blocking = (await read(listIssues, { batchId }, "?blocking=true", reader.cookie)).json;
    expect(blocking.rows.map((i: any) => [i.code, i.sourceRowNumber, i.block.stoneName, i.details])).toEqual([
      ["MAPPING_NO_CONDITIONAL_RULE", 7, name, { rawShapeKey: "EMERALD 5STEP", ratio: "1.200" }],
      ["NORMALIZED_SHAPE_MISSING", 7, name, null],
    ]);
    expect(blocking.rows.every((i: any) => i.blocking && i.nextStep === "Add a mapping for this shape in Mappings, then process the file again.")).toBe(true);
    const warnings = (await read(listIssues, { batchId }, "?blocking=false", reader.cookie)).json;
    expect(warnings.rows.map((i: any) => [i.code, i.sourceRowNumber, i.blocking, i.details, i.nextStep])).toEqual([
      ["SHAPE_NOT_MAPPED", 5, false, { rawShapeKey: "EMERALD 4STEP", ratio: "1.435" }, "Add a mapping for this shape in Mappings, then process the file again."],
    ]);
    expect((await read(listIssues, { batchId }, "?blocking=maybe")).status).toBe(400);
    // Nothing is assumed for the blocking row: output is refused, with nothing written.
    const refused = await generate(batchId, generator.cookie);
    expect([refused.status, refused.json.error.code]).toEqual([422, "BLOCKING_FINDINGS_OPEN"]);
    expect([await db.sarinOutputVersion.count({ where: { batchId } }), await db.sarinPlanOption.count({ where: { batchId } }), await db.sarinPlanPiece.count({ where: { batchId } })]).toEqual([0, 0, 0]);
    expect((await audits("SARIN_OUTPUT_REJECTED", batchId)).length).toBe(1);
  });
});

// =========================================================================================
describe("sarin workflow: export", () => {
  test("export needs sarin.output.export and returns the stored values, formula-safe, in a fixed column order", async () => {
    const name = `${kapan()}-001 DC`;
    const recs = [...stone({ name }, 16), { name, clarity: "=1+2" }, { name, est: "0.750", clarity: "@SUM(A1)" }];
    const batchId = await uploadBatch(recs);
    await validate(batchId, validator.cookie);
    const versionId = (await generate(batchId, generator.cookie)).json.output.version.id;
    expect((await exportCsv(batchId, versionId, undefined)).status).toBe(401);
    for (const u of [reader, uploader, validator, generator, admin]) expect([u.user.username, (await exportCsv(batchId, versionId, u.cookie)).status]).toEqual([u.user.username, 403]);

    const r = await exportCsv(batchId, versionId, exporter.cookie);
    expect([r.status, r.headers.get("content-type"), r.headers.get("cache-control"), r.headers.get("x-sarin-export-rows")]).toEqual([200, "text/csv; charset=utf-8", "no-store", "18"]);
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="sarin-output-v1-blue-2026-09-28.csv"');
    const lines = r.body.trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Sarin structured output: transformed Sarin candidate data. Not an approved manufacturing plan."');
    expect(lines[4]).toBe(
      ['Output Row', 'Stone Name', 'Kapan', 'Packet', 'Signer', 'Packet Type', 'Rough Weight (ct)', 'Option', 'Plan Code', 'Plan', 'Option Pieces', 'Option Est. Weight (ct)', 'Option Yield %', 'Twin Weight Difference (ct)', 'Piece', 'Source Record', 'Sarin Shape', 'Normalized Shape', 'Est. Weight (ct)', 'Clarity', 'Color', 'Depth %', 'Ratio', 'Length', 'Width', 'Depth (mm)']
        .map((h) => `"${h}"`).join(","),
    );
    expect(lines.length).toBe(5 + 18);
    // Counts and sequences are plain numbers; weights and yields keep their fixed decimals as text.
    expect(lines[5]).toBe(`1,"${name}","${name.split("-")[0]}","001","DC","BLUE","3.000",1,"MAIN","Main plan",1,"1.500","50.00","",1,1,"ROUND","Round","1.500","VS1","G","61.600","1.000","7.620","7.620","4.690"`);
    expect(lines[21]).toContain(`"'=1+2"`); // record 17: a formula becomes text
    expect(lines[22]).toContain(`"'@SUM(A1)"`);
    expect(lines[22]).toContain(`"ADDITIONAL","Additional group",1,"0.750","25.00"`);
    const audit = await audits("SARIN_OUTPUT_EXPORTED", batchId);
    expect(audit.map((a: any) => [a.actorUserId, JSON.parse(a.after!)])).toEqual([[exporter.user.id, { outputVersionId: versionId, versionNumber: 1, format: "CSV", rows: 18 }]]);
    expect(audit[0].after!.includes("=1+2")).toBe(false); // content is never logged
  });

  test("the selected immutable version is exported, even after a newer one; a larger version is refused, not cut", async () => {
    const batchId = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    await validate(batchId, validator.cookie);
    const v1 = (await generate(batchId, generator.cookie)).json.output.version.id;
    await applyCatalog(mapper.cookie, [...BLUE_RULES, { rawShape: "OVAL", normalizedShape: "Oval" }]);
    await validate(batchId, validator.cookie);
    const v2 = (await generate(batchId, generator.cookie)).json.output.version.id;
    const old = await exportCsv(batchId, v1, exporter.cookie);
    const cur = await exportCsv(batchId, v2, exporter.cookie);
    expect([old.status, old.body.split("\r\n")[1].includes("Output version 1 (superseded)"), cur.body.split("\r\n")[1].includes("Output version 2 (current)")]).toEqual([200, true, true]);
    expect(old.headers.get("content-disposition")).toContain("sarin-output-v1-");
    const other = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    expect((await exportCsv(other, v1, exporter.cookie)).status).toBe(404);
    await expect(exportOutputVersion({ countries: null, labs: null }, batchId, v1, 16)).rejects.toThrow(/more than the 16/);
  });

  test("a Pink output exports 45 pieces per stone with its plan codes", async () => {
    await applyCatalog(mapper.cookie, [
      { rawShape: "ROUND", normalizedShape: "Round" }, { rawShape: "PEAR", normalizedShape: "Pear" }, { rawShape: "OVAL", normalizedShape: "Oval" },
      { rawShape: "ASSCHER", normalizedShape: "Asscher" }, { rawShape: "EMERALD", normalizedShape: "Emerald" }, { rawShape: "RADIANT", normalizedShape: "Radiant" },
      { rawShape: "CUSHION", normalizedShape: "Cushion Brilliant" }, { rawShape: "ANTIQUE CUSHION", normalizedShape: "Antique Cushion" }, { rawShape: "HEART", normalizedShape: "Heart" },
    ]);
    const name = `${kapan().slice(0, 4)}-111_M`;
    const fam = ["ROUND", "PEAR", "OVAL", "ASSCHER", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION", "HEART"];
    const recs: Rec[] = [];
    fam.forEach((shape) => recs.push({ name, shape, est: "1.000" }, { name, shape, est: "1.000" }, { name, shape: "ROUND", est: "0.200" }));
    for (const shape of ["EMERALD", "ROUND", "OVAL", "ROUND", "EMERALD", "OVAL"]) recs.push({ name, shape, est: "0.500" });
    for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push({ name, shape, est: "0.400" }, { name, shape, est: shape === "OVAL" ? "0.404" : "0.400" });
    const batchId = await uploadBatch(recs, { packetType: "PINK" });
    const v = await validate(batchId, validator.cookie);
    expect(v.json.batch.status).toBe("VALIDATED");
    const advisory = (await read(listIssues, { batchId }, "?blocking=false")).json.rows;
    expect(advisory.map((i: any) => [i.code, i.details.firstWeight, i.details.secondWeight, i.details.difference, i.nextStep === "Weight difference requires review."])).toEqual([["BT_WEIGHT_VARIANCE_UNCONFIRMED", "0.400", "0.404", "0.004", true]]);
    const versionId = (await generate(batchId, generator.cookie)).json.output.version.id;
    const lines = (await exportCsv(batchId, versionId, exporter.cookie)).body.trimEnd().split("\r\n").slice(5);
    expect(lines.length).toBe(45);
    const codes = lines.map((l: any) => l.split(",")[8].replace(/"/g, ""));
    expect([codes.filter((c: any) => c === "MK").length, codes.filter((c: any) => c === "SL").length, codes.filter((c: any) => c === "BP").length, codes.filter((c: any) => c === "BT").length]).toEqual([9, 18, 6, 12]);
    expect(lines[36]).toContain(`"BT","Best Twin",2,"0.804",`); // positions 36–37: the 0.004 twin
    expect(lines[36]).toContain(`"0.004"`);
  });

  test("deleting a Sarin import batch archives it, logs audit trail, and excludes it from recent files", async () => {
    const batchId = await uploadBatch(stone({ name: `${kapan()}-001 DC` }));
    expect(Object.keys(importRoute).sort()).toEqual(["DELETE", "GET"]);

    // A user without sarin.import.upload authority cannot delete
    const denied = await call(importRoute.DELETE, { method: "DELETE", cookie: viewer.cookie, params: { batchId } });
    expect(denied.status).toBe(403);

    // An authorized uploader can delete
    const res = await call(importRoute.DELETE, { method: "DELETE", cookie: uploader.cookie, params: { batchId } });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);

    // It should now be ARCHIVED in DB
    const batchInDb = await db.sarinImportBatch.findUnique({ where: { id: batchId } });
    expect(batchInDb?.status).toBe("ARCHIVED");
    expect(batchInDb?.archivedAt).not.toBeNull();

    // Audit log was recorded
    const audit = await audits("SARIN_IMPORT_ARCHIVED", batchId);
    expect(audit.length).toBe(1);
    expect(audit[0].actorUserId).toBe(uploader.user.id);

    // It should no longer appear in the default recent files list
    const recent = await read(listImports, {}, "?pageSize=100", uploader.cookie);
    expect(recent.json.rows.some((b: any) => b.id === batchId)).toBe(false);
  });
});
