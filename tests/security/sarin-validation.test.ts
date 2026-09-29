// Sarin validation: stone identity, consecutive blocks, Rough Weight, shape resolution
// against the effective mapping catalog, catalog changes, claims and rollback.
//
// Uploads, validations, mapping management and reads go through the real route handlers
// against the isolated planning_sectest database. The claim/run/fail steps are also
// called directly where a test must act as a second worker (a stale or crashed one). The
// mid-attempt failure is injected by a database trigger, so the service has no test-only
// branch. All data is synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { GET as importDetail } from "@/app/api/planning/sarin/imports/[batchId]/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { GET as listBlocks } from "@/app/api/planning/sarin/imports/[batchId]/blocks/route";
import { GET as listIssues } from "@/app/api/planning/sarin/imports/[batchId]/issues/route";
import { GET as listInterpretations } from "@/app/api/planning/sarin/imports/[batchId]/interpretations/route";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { claimSarinValidation, failSarinValidationAttempt, runSarinValidationAttempt } from "@/lib/sarin/validation-service";
import { parseSarinStoneName } from "@/lib/sarin/stone-name";
import { SARIN_SHAPE_MAPPING_RESULTS } from "@/lib/sarin/domain";
import { effectiveSnapshotId, applyCatalog, type CatalogRule } from "./sarin-catalog";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
type User = Awaited<ReturnType<typeof makeUser>>;
let planner: User, viewer: User, planningViewer: User, admin: User, manager: User, root: User;
let mapperA: User, mapperB: User;
let standardSetId = "";
const STANDARD_RULES: CatalogRule[] = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "LeoPear11", normalizedShape: "Pear" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.400", ratioMax: null },
];

// ---- synthetic records ---------------------------------------------------------------------
let nonce = 0;
const kapan = () => `9${String(++nonce).padStart(3, "0")}V`;
type Rec = Partial<Record<"name" | "rough" | "shape" | "est" | "ratio", string>>;
const rec = (o: Rec & { name: string }) => [o.name, o.rough ?? "5.413", o.shape ?? "ROUND", o.est ?? "1.664", "IF", "D", "61.6", o.ratio ?? "1", "7.62", "7.62", "4.69"].join(",");
const file = (lines: string[]) => lines.join("\n") + "\n";
/** One complete stone: Blue needs 17 plan records and White 32 before it can validate cleanly. */
const stone = (o: Rec & { name: string }, count = 17) => Array.from({ length: count }, () => rec(o));

// ---- requests -------------------------------------------------------------------------------
async function upload(cookie: string, content: string, fields: Record<string, string> = {}) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(content) as BlobPart], "sarin.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ packetType: "BLUE", planningDate: "2026-09-26", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(
    new Request(URL_, { method: "POST", headers: { cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  return { status: res.status, json: (await res.json()) as any };
}
async function uploadBatch(cookie: string, content: string, fields: Record<string, string> = {}): Promise<string> {
  const r = await upload(cookie, content, fields);
  if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.batch.id;
}
const validate = (cookie: string | undefined, batchId: string, body: unknown) => {
  resetRateLimits();
  return call(validateImport, { method: "POST", cookie, body, params: { batchId }, path: `/api/planning/sarin/imports/${batchId}/validate` });
};
const get = (handler: any, cookie: string, path: string, params: Record<string, string>) => {
  resetRateLimits();
  return call(handler, { cookie, path, params });
};
/** Saves one mapping through the Mappings page's route. */
const save = (cookie: string, body: Record<string, unknown>) => {
  resetRateLimits();
  return call(saveMapping, { method: "POST", cookie, body: { applyTo: "ALL_RATIOS", ...body }, path: "/api/planning/sarin/shape-mappings" });
};
const issuesOf = async (cookie: string, batchId: string, query = "?pageSize=500") => (await get(listIssues, cookie, `/api/x${query}`, { batchId })).json;
const blocksOf = async (cookie: string, batchId: string, query = "?pageSize=500") => (await get(listBlocks, cookie, `/api/x${query}`, { batchId })).json;
const interpretationsOf = async (cookie: string, batchId: string, query = "?pageSize=500") => (await get(listInterpretations, cookie, `/api/x${query}`, { batchId })).json;

const serviceActor = () => ({
  userId: planner.user.id,
  scope: { countries: null, labs: null },
  requestId: "second-worker",
  audit: async (client: any, input: any) => {
    await client.auditLog.create({ data: { actor: "second-worker", actorUserId: planner.user.id, action: input.action, entity: input.entity, entityId: input.entityId ?? null, after: JSON.stringify(input.after ?? null), outcome: input.outcome ?? "SUCCESS" } });
  },
});

async function grantScope(userId: string, countries: string[], labs: string[]) {
  await db.userAccessScope.deleteMany({ where: { userId } });
  const data = [...countries.map((value) => ({ userId, dimension: "COUNTRY", value })), ...labs.map((value) => ({ userId, dimension: "LAB", value }))];
  if (data.length) await db.userAccessScope.createMany({ data });
}

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "IGI"]);
  planner = await makeUser("val.planner", "PLANNER");
  viewer = await makeUser("val.viewer", "VIEWER");
  planningViewer = await makeUser("val.pviewer", "PLANNING_VIEWER");
  admin = await makeUser("val.admin", "ADMIN");
  manager = await makeUser("val.manager", "PLANNING_MANAGER");
  root = await makeUser("val.root", "SUPER_ADMIN");
  mapperA = await makeUser("val.mapper.a", "PLANNER");
  mapperB = await makeUser("val.mapper.b", "PLANNER");
  // An explicitly built mapping-manager role, created and assigned through the real admin routes.
  const code = `SARIN_MAPPER_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: "Sarin Mapping Manager", permissions: ["sarin.mapping.read", "sarin.mapping.manage"] } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status}`);
  for (const u of [mapperA, mapperB]) {
    resetRateLimits();
    const r = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: ["PLANNER", code] } });
    if (r.status !== 200) throw new Error(`role assign failed ${r.status}`);
  }
});
// Every test starts from the standard catalog; a test that changes it does so through the API.
beforeEach(async () => {
  resetRateLimits();
  standardSetId = await applyCatalog(mapperA.cookie, STANDARD_RULES);
});

/** Asserts that exactly one entry of `list` deep-equals `entry`, reporting the list if not. */
function expectListed(list: unknown[], entry: unknown) {
  const hits = list.filter((x) => JSON.stringify(x) === JSON.stringify(entry)).length;
  if (hits !== 1) throw new Error(`expected exactly one ${JSON.stringify(entry)} in ${JSON.stringify(list)} (found ${hits})`);
}

// =========================================================================================
describe("sarin validation: authorization and scope", () => {
  test("anonymous → 401; roles without sarin.import.validate → 403; nothing is claimed", async () => {
    const batchId = await uploadBatch(planner.cookie, file(stone({ name: `${kapan()}-001 DC` })));
    expect((await validate(undefined, batchId, {})).status).toBe(401);
    expect((await validate(viewer.cookie, batchId, {})).status).toBe(403);
    expect((await validate(planningViewer.cookie, batchId, {})).status).toBe(403);
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(0);
    const ok = await validate(planner.cookie, batchId, {});
    expect([ok.status, ok.json.reused, ok.json.batch.status, ok.json.validation.attemptCount]).toEqual([200, false, "VALIDATED", 1]);
  });

  test("client-supplied actor, attempt or claim fields are refused", async () => {
    const batchId = await uploadBatch(planner.cookie, file([rec({ name: `${kapan()}-001 DC` })]));
    for (const extra of [{ actor: "someone" }, { attempt: 7 }, { claimToken: "t" }, { userId: "u" }]) {
      const r = await validate(planner.cookie, batchId, { ...extra });
      expect(r.status).toBe(400);
    }
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(0);
  });

  test("an out-of-scope batch is a 404 for validation and every validation read", async () => {
    const be = await uploadBatch(planner.cookie, file([rec({ name: `${kapan()}-001 DC` })]), { labId: "IGI" });
    const scoped = await makeUser("val.scoped.gia", "PLANNER");
    await grantScope(scoped.user.id, [], ["GIA"]);
    expect((await validate(scoped.cookie, be, {})).status).toBe(404);
    expect((await validate(planner.cookie, be, {})).status).toBe(200);
    for (const h of [listBlocks, listIssues, listInterpretations, importDetail]) {
      expect((await get(h, scoped.cookie, "/api/x", { batchId: be })).status).toBe(404);
    }
  });

  test("mapping management is its own authority: ADMIN, planner and planning manager are refused", async () => {
    for (const u of [admin, planner, manager, viewer]) {
      expect([u.user.username, (await get(readCatalog, u.cookie, "/api/x", {})).status]).toEqual([u.user.username, 403]);
      expect([u.user.username, (await save(u.cookie, { sarinShape: "HEXA", fantasyShape: "Round" })).status]).toEqual([u.user.username, 403]);
    }
    const allowed = await get(readCatalog, mapperA.cookie, "/api/x", {});
    expect([allowed.status, allowed.json.configured, allowed.json.mappings.length]).toEqual([200, true, STANDARD_RULES.length]);
  });
});

// =========================================================================================
describe("sarin validation: Stone Name identity", () => {
  test("the parser keeps components exactly and names the specific problem", () => {
    expect(parseSarinStoneName("691C-117 DC", "BLUE")).toEqual({ ok: true, kapan: "691C", packet: "117", signer: "DC" });
    expect(parseSarinStoneName("2501-001 HA", "WHITE")).toEqual({ ok: true, kapan: "2501", packet: "001", signer: "HA" });
    expect(parseSarinStoneName("678-111_M", "PINK")).toEqual({ ok: true, kapan: "678", packet: "111", signer: "M" });
    expect(parseSarinStoneName("691C-120 dc", "BLUE")).toEqual({ ok: true, kapan: "691C", packet: "120", signer: "dc" });
    const code = (n: string, t: "BLUE" | "WHITE" | "PINK") => (parseSarinStoneName(n, t) as { code?: string }).code;
    expect(code("691C-117", "BLUE")).toBe("STONE_NAME_SIGNER_MISSING");
    expect(code("-117 DC", "BLUE")).toBe("STONE_NAME_KAPAN_MISSING");
    expect(code("691C- DC", "BLUE")).toBe("STONE_NAME_PACKET_MISSING");
    expect(code("691C-117  DC", "BLUE")).toBe("STONE_NAME_INVALID");
    expect(code("691C‐117 DC", "BLUE")).toBe("STONE_NAME_INVALID");
    expect(code("678-111_M", "BLUE")).toBe("STONE_NAME_TYPE_MISMATCH");
    expect(code("691C-117 DC", "PINK")).toBe("STONE_NAME_TYPE_MISMATCH");
    expect(code(" 691C-117 DC", "WHITE")).toBe("STONE_NAME_SURROUNDING_WHITESPACE");
    expect(code("678-111_", "PINK")).toBe("STONE_NAME_SIGNER_MISSING");
  });

  test("a validated batch stores parsed identity per block and a blocking finding per malformed name", async () => {
    const k = kapan();
    const names = [`${k}-117 DC`, `${k}-117 DC`, `${k}-001 dc`, `${k}-118`, `-119 DC`, `${k}- DC`, `${k}-120  DC`, `${k}-121_DC`, `${k}‐122 DC`, ` ${k}-123 DC`];
    const batchId = await uploadBatch(planner.cookie, file(names.map((name) => rec({ name }))));
    const v = await validate(planner.cookie, batchId, {});
    expect([v.status, v.json.batch.status]).toEqual([200, "NEEDS_REVIEW"]);
    const blocks = (await blocksOf(planner.cookie, batchId)).rows;
    expect(blocks.map((b: any) => [b.sequence, b.firstRowNumber, b.lastRowNumber, b.parseStatus])).toEqual([
      [1, 1, 2, "PARSED"], [2, 3, 3, "PARSED"], [3, 4, 4, "QUARANTINED"], [4, 5, 5, "QUARANTINED"], [5, 6, 6, "QUARANTINED"],
      [6, 7, 7, "QUARANTINED"], [7, 8, 8, "QUARANTINED"], [8, 9, 9, "QUARANTINED"], [9, 10, 10, "QUARANTINED"],
    ]);
    expect([blocks[0].kapan, blocks[0].packet, blocks[0].signer]).toEqual([k, "117", "DC"]);
    expect([blocks[1].packet, blocks[1].signer]).toEqual(["001", "dc"]);
    expect(blocks[8].stoneName).toBe(` ${k}-123 DC`); // original kept exactly
    expect([blocks[2].kapan, blocks[2].packet, blocks[2].signer]).toEqual([null, null, null]); // nothing guessed
    const issues = (await issuesOf(planner.cookie, batchId)).rows.filter((i: any) => i.code.startsWith("STONE_NAME"));
    expect(issues.map((i: any) => [i.block.sequence, i.code, i.blocking, i.reviewStatus])).toEqual([
      [3, "STONE_NAME_SIGNER_MISSING", true, "OPEN"],
      [4, "STONE_NAME_KAPAN_MISSING", true, "OPEN"],
      [5, "STONE_NAME_PACKET_MISSING", true, "OPEN"],
      [6, "STONE_NAME_INVALID", true, "OPEN"],
      [7, "STONE_NAME_TYPE_MISMATCH", true, "OPEN"],
      [8, "STONE_NAME_INVALID", true, "OPEN"],
      [9, "STONE_NAME_SURROUNDING_WHITESPACE", true, "OPEN"],
    ]);
    // Findings carry a title and explanation, never the rule behind them.
    expect(typeof issues[0].title).toBe("string");
    expect(/\\|\^|\$\/|regex|SELECT|\[A-Z/.test(JSON.stringify(issues))).toBe(false);
  });

  test("the declared type decides the pattern: Pink and White names under their own type", async () => {
    const pk = kapan();
    const pink = await uploadBatch(planner.cookie, file([rec({ name: `${pk}-111_M` }), rec({ name: `${pk}-112 M` })]), { packetType: "PINK" });
    await validate(planner.cookie, pink, {});
    const pb = (await blocksOf(planner.cookie, pink)).rows;
    expect(pb.map((b: any) => [b.parseStatus, b.kapan, b.packet, b.signer])).toEqual([["PARSED", pk, "111", "M"], ["QUARANTINED", null, null, null]]);
    // Identity findings only; these one-record stones also fail the Pink 45-record structure.
    expect((await issuesOf(planner.cookie, pink)).rows.map((i: any) => i.code).filter((c: string) => c.startsWith("STONE_NAME"))).toEqual(["STONE_NAME_TYPE_MISMATCH"]);

    const wk = kapan();
    const white = await uploadBatch(planner.cookie, file(stone({ name: `${wk}-001 HA` }, 32)), { packetType: "WHITE" });
    const w = await validate(planner.cookie, white, {});
    expect(w.json.batch.status).toBe("VALIDATED");
    expect((await blocksOf(planner.cookie, white)).rows[0].packet).toBe("001");
  });
});

// =========================================================================================
describe("sarin validation: consecutive blocks and Rough Weight", () => {
  test("blocks follow file order; a rejected record ends a block; a later repeat is its own block and a finding", async () => {
    const k = kapan();
    const [A, B, C, D] = [`${k}-001 DC`, `${k}-002 DC`, `${k}-003 DC`, `${k}-004 DC`];
    const lines = [
      rec({ name: A }), rec({ name: A }),
      rec({ name: B }),
      [B, "5.413", "ROUND", "1.664", "IF", "D", "61.6", "1", "7.62", "7.62"].join(","), // 10 fields
      rec({ name: B }),
      rec({ name: A }),
      rec({ name: C, rough: "5.413" }), rec({ name: C, rough: "5.414" }),
      rec({ name: D, rough: "bad" }), rec({ name: D, rough: "5.000" }),
    ];
    const batchId = await uploadBatch(planner.cookie, file(lines));
    const v = await validate(planner.cookie, batchId, {});
    expect(v.json.batch.status).toBe("NEEDS_REVIEW");
    const blocks = (await blocksOf(planner.cookie, batchId)).rows;
    expect(blocks.map((b: any) => [b.sequence, b.stoneName, b.firstRowNumber, b.lastRowNumber, b.rowCount, b.roughWeight])).toEqual([
      [1, A, 1, 2, 2, "5.413"],
      [2, B, 3, 3, 1, "5.413"],
      [3, B, 5, 5, 1, "5.413"],
      [4, A, 6, 6, 1, "5.413"],
      [5, C, 7, 8, 2, null], // inconsistent: no weight is chosen
      [6, D, 9, 10, 2, null], // an invalid first weight is never skipped past
    ]);
    const issues = (await issuesOf(planner.cookie, batchId)).rows;
    const view = issues.map((i: any) => [i.code, i.block?.sequence ?? null, i.sourceRowNumber, i.details]);
    expectListed(view, ["SOURCE_ROW_STRUCTURALLY_REJECTED", null, 4, { reasons: ["FIELD_COUNT_MISMATCH"] }]);
    expectListed(view, ["ROUGH_WEIGHT_INCONSISTENT", 5, 7, { roughWeight: "5.413", distinctValues: 2 }]);
    expectListed(view, ["ROUGH_WEIGHT_INCONSISTENT", 5, 8, { roughWeight: "5.414", distinctValues: 2 }]);
    expectListed(view, ["ROUGH_WEIGHT_INVALID", 6, 9, { reason: "ROUGH_WEIGHT_INVALID" }]);
    expectListed(view, ["STONE_NAME_REPEATED_NON_CONSECUTIVE", 3, null, { firstBlockSequence: 2 }]);
    expectListed(view, ["STONE_NAME_REPEATED_NON_CONSECUTIVE", 4, null, { firstBlockSequence: 1 }]);
    // The rejected record is kept and referenced, never silently dropped.
    expect(await db.sarinSourceRow.count({ where: { batchId } })).toBe(10);
    // Stable order: the list follows the order findings were raised (contiguous ordinals).
    const stored = await db.sarinValidationIssue.findMany({ where: { batchId, validationAttempt: 1 }, orderBy: { ordinal: "asc" }, select: { id: true, ordinal: true } });
    expect(issues.map((i: any) => i.id)).toEqual(stored.map((i) => i.id));
    expect(stored.map((i) => i.ordinal)).toEqual(stored.map((_, n) => n + 1));
  });
});

// =========================================================================================
describe("sarin validation: shape resolution", () => {
  test("exact and conditional rules resolve exactly one shape; everything else is a finding", async () => {
    const k = kapan();
    const n = `${k}-001 DC`;
    const shapes: Array<[Rec, string, string | null, string | null]> = [
      [{ shape: "ROUND" }, "MAPPED", "Round", null],
      [{ shape: " round " }, "MAPPED", "Round", null],
      [{ shape: "HEXAGON" }, "UNMAPPED", null, "SHAPE_NOT_MAPPED"],
      [{ shape: "" }, "UNMAPPED", null, "SHAPE_MISSING"],
      [{ shape: "EMERALD 5STEP", ratio: "" }, "UNMAPPED", null, "MAPPING_RATIO_MISSING"],
      [{ shape: "EMERALD 5STEP", ratio: "1" }, "CONDITIONALLY_MAPPED", "Asscher", null],
      [{ shape: "EMERALD 5STEP", ratio: "1.03" }, "CONDITIONALLY_MAPPED", "Asscher", null],
      [{ shape: "EMERALD 5STEP", ratio: "1.031" }, "UNMAPPED", null, "MAPPING_NO_CONDITIONAL_RULE"],
      [{ shape: "EMERALD 5STEP", ratio: "1.399" }, "UNMAPPED", null, "MAPPING_NO_CONDITIONAL_RULE"],
      [{ shape: "EMERALD 5STEP", ratio: "1.4" }, "CONDITIONALLY_MAPPED", "Emerald", null],
      [{ shape: "emerald 5step", ratio: "2.5" }, "CONDITIONALLY_MAPPED", "Emerald", null],
    ];
    const batchId = await uploadBatch(planner.cookie, file(shapes.map(([o]) => rec({ name: n, ...o }))));
    await validate(planner.cookie, batchId, {});
    const interp = (await interpretationsOf(planner.cookie, batchId)).rows;
    expect(interp.map((r: any) => [r.sourceRowNumber, r.mappingResult, r.normalizedShape])).toEqual(shapes.map(([, result, shape], i) => [i + 1, result, shape]));
    expect(interp[1].rawShape).toBe(" round "); // the raw shape is kept exactly
    expect(interp.every((r: any) => r.mappingSet.id === standardSetId)).toBe(true);
    const issues = (await issuesOf(planner.cookie, batchId)).rows.filter((i: any) => i.code.startsWith("SHAPE") || i.code.startsWith("MAPPING"));
    expect(issues.map((i: any) => [i.sourceRowNumber, i.code])).toEqual(shapes.flatMap(([, , , code], i) => (code ? [[i + 1, code]] : [])));
  });

  test("unconfirmed Sarin shapes stay unresolved, even in a catalog built from the confirmed master", async () => {
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } }, include: { rules: true } });
    const master: CatalogRule[] = baseline.rules.map((r) => ({ rawShape: r.sourceRawShape, normalizedShape: r.normalizedShape, conditionKind: r.conditionKind as "NONE" | "RATIO_RANGE", ratioMin: r.ratioMin?.toFixed(3) ?? null, ratioMax: r.ratioMax?.toFixed(3) ?? null }));
    await applyCatalog(mapperA.cookie, master);
    const n = `${kapan()}-111_M`;
    const unconfirmed = ["EMERALD 4STEP", "RAD MODIFIED", "NP-1235-6-KITE", "HEGAZGON", "TREGAL-3", "CU-MO-GCAL-RT-1.42"];
    const batchId = await uploadBatch(planner.cookie, file([rec({ name: n, shape: "LeoOval22" }), ...unconfirmed.map((shape) => rec({ name: n, shape, ratio: "1" }))]), { packetType: "PINK" });
    const v = await validate(planner.cookie, batchId, {});
    expect(v.json.batch.status).toBe("NEEDS_REVIEW");
    const interp = (await interpretationsOf(planner.cookie, batchId)).rows;
    expect([interp[0].mappingResult, interp[0].normalizedShape]).toEqual(["MAPPED", "Oval"]);
    expect(interp.slice(1).map((r: any) => r.mappingResult)).toEqual(unconfirmed.map(() => "UNMAPPED"));
    const codes = (await issuesOf(planner.cookie, batchId)).rows.map((i: any) => i.code);
    expect(codes.filter((c: string) => c === "SHAPE_UNMAPPED")).toHaveLength(unconfirmed.length);
  });

  test("every mapping result in the shared vocabulary is exactly what the database allows", async () => {
    const [row] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'SarinRowInterpretation_mappingResult_check'`;
    expect(Array.from(row.def.matchAll(/'([A-Z_]+)'/g), (m) => m[1]).sort()).toEqual([...SARIN_SHAPE_MAPPING_RESULTS].sort());
  });
});

// =========================================================================================
describe("sarin validation: saving mappings", () => {
  test("a saved mapping is checked and effective at once as a new snapshot; the replaced snapshot is frozen history", async () => {
    const before = standardSetId;
    const refusals: Array<[Record<string, unknown>, number]> = [
      [{ sarinShape: "EMERALD 5STEP", fantasyShape: "Emerald", applyTo: "RATIO_RANGE", minimumRatio: "1.020", maximumRatio: "1.100" }, 409],
      [{ sarinShape: "emerald 5step ", fantasyShape: "Emerald" }, 409],
      [{ sarinShape: "HEXAGON", fantasyShape: "Hexagon" }, 400],
      [{ sarinShape: "OVAL", fantasyShape: "Oval", applyTo: "RATIO_RANGE", minimumRatio: "1.2345" }, 400],
      [{ sarinShape: "OVAL", fantasyShape: "Oval", applyTo: "RATIO_RANGE" }, 400],
      [{ sarinShape: "OVAL", fantasyShape: "Oval", minimumRatio: "1.000" }, 400],
      [{ sarinShape: "OVAL", fantasyShape: "Oval", applyTo: "RATIO_RANGE", minimumRatio: "-1.000" }, 400],
      [{ sarinShape: "OVAL", fantasyShape: "Oval", sql: "DROP" }, 400],
    ];
    for (const [body, status] of refusals) expect([body, (await save(mapperA.cookie, body)).status]).toEqual([body, status]);
    // Nothing refused changed the effective catalog.
    expect(await effectiveSnapshotId()).toBe(before);

    const added = await save(mapperA.cookie, { sarinShape: "OVAL", fantasyShape: "Oval" });
    expect([added.status, added.json.changed, added.json.message]).toEqual([200, true, "Mapping saved"]);
    const after = await effectiveSnapshotId();
    expect(after === before).toBe(false);
    const [old, current] = await Promise.all([db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: before } }), db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: after! } })]);
    expect([old.status, old.supersededBySetId, current.status, current.copiedFromSetId, current.approvedAt, current.approvedByUserId]).toEqual(["SUPERSEDED", after, "EFFECTIVE", before, null, null]);
    expect([await db.sarinShapeMappingRule.count({ where: { mappingSetId: before } }), await db.sarinShapeMappingRule.count({ where: { mappingSetId: after! } })]).toEqual([STANDARD_RULES.length, STANDARD_RULES.length + 1]);
    const oldRule = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: before } });
    await expect(db.sarinShapeMappingRule.update({ where: { id: oldRule.id }, data: { normalizedShape: "Changed" } })).rejects.toThrow(/immutable/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_MAPPING_SAVED", entityId: after! } });
    expect([audit.actorUserId, JSON.parse(audit.after!).sarinShape]).toEqual([mapperA.user.id, "OVAL"]);
  });

  test("editing a mapping replaces it in a new snapshot and records who changed it", async () => {
    const catalog = (await get(readCatalog, mapperA.cookie, "/api/x", {})).json;
    const round = catalog.mappings.find((m: any) => m.sarinShape === "ROUND");
    const changed = await save(mapperB.cookie, { ruleId: round.id, sarinShape: "ROUND", fantasyShape: "Old European Brilliant" });
    expect([changed.status, changed.json.changed]).toEqual([200, true]);
    const now = (await get(readCatalog, mapperA.cookie, "/api/x", {})).json.mappings.filter((m: any) => m.sarinShape === "ROUND");
    expect(now.map((m: any) => [m.fantasyShape, m.updatedBy])).toEqual([["Old European Brilliant", "val.mapper.b"]]);
    // The earlier snapshot still maps ROUND to Round.
    expect((await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: standardSetId, rawShapeKey: "ROUND" } })).normalizedShape).toBe("Round");
  });

  test("two overlapping mappings saved concurrently: one is applied, the other refused", async () => {
    resetRateLimits();
    const results = await Promise.all([
      call(saveMapping, { method: "POST", cookie: mapperA.cookie, body: { sarinShape: "PRINCESS CUT", fantasyShape: "Princess", applyTo: "RATIO_RANGE", minimumRatio: "1.000", maximumRatio: "1.050" } }),
      call(saveMapping, { method: "POST", cookie: mapperB.cookie, body: { sarinShape: "PRINCESS CUT", fantasyShape: "Princess", applyTo: "RATIO_RANGE", minimumRatio: "1.040", maximumRatio: "2.000" } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const id = await effectiveSnapshotId();
    expect(await db.sarinShapeMappingRule.count({ where: { mappingSetId: id!, rawShapeKey: "PRINCESS CUT" } })).toBe(1);
    expect(await db.sarinShapeMappingSet.count({ where: { status: "EFFECTIVE" } })).toBe(1);
  });

  test("a validation keeps the snapshot it captured after the catalog changes", async () => {
    const batchId = await uploadBatch(planner.cookie, file(stone({ name: `${kapan()}-001 DC` })));
    expect((await validate(planner.cookie, batchId, {})).json.batch.status).toBe("VALIDATED");
    expect((await save(mapperA.cookie, { sarinShape: "CUSHION MOD", fantasyShape: "Cushion Modified" })).status).toBe(200);
    const detail = await get(importDetail, planner.cookie, "/api/x", { batchId });
    const lineage = detail.json.validation.lastCompletedAttempt.mappingSet;
    // Still valid lineage: a replaced snapshot is not a withdrawn mapping.
    expect([lineage.id, lineage.status, detail.json.validation.revalidationRequired]).toEqual([standardSetId, "SUPERSEDED", false]);
    expect((await interpretationsOf(planner.cookie, batchId)).rows[0].mappingSet.id).toBe(standardSetId);
  });

  test("a catalog change during processing does not change the snapshot the attempt captured", async () => {
    const n = `${kapan()}-001 DC`;
    const batchId = await uploadBatch(planner.cookie, file(stone({ name: n, shape: "LeoPear11" })));
    const claim = await claimSarinValidation(serviceActor(), batchId);
    if (claim.kind !== "CLAIMED") throw new Error("expected a claim");
    // Someone remaps the shape while the attempt is running.
    const pear = (await get(readCatalog, mapperA.cookie, "/api/x", {})).json.mappings.find((m: any) => m.sarinShape === "LeoPear11");
    expect((await save(mapperB.cookie, { ruleId: pear.id, sarinShape: "LeoPear11", fantasyShape: "Heart" })).status).toBe(200);
    await runSarinValidationAttempt(serviceActor(), claim.claim);
    const attempt = await db.sarinValidationAttempt.findUniqueOrThrow({ where: { id: claim.claim.attemptId } });
    expect(attempt.shapeMappingSetId).toBe(standardSetId);
    const interp = (await interpretationsOf(planner.cookie, batchId)).rows;
    expect([...new Set(interp.map((r: any) => r.normalizedShape))]).toEqual(["Pear"]);
  });

  test("with an empty catalog every shape is written unmapped, each with a non-blocking warning", async () => {
    // An empty catalog is configured: no shape has a mapping.
    await applyCatalog(mapperA.cookie, []);
    const batchId = await uploadBatch(planner.cookie, file(stone({ name: `${kapan()}-001 DC` })));
    const v = await validate(planner.cookie, batchId, {});
    expect([v.status, v.json.batch.status]).toEqual([200, "VALIDATED"]);
    const issues = (await issuesOf(planner.cookie, batchId)).rows;
    expect([issues.length, issues.every((i: any) => i.code === "SHAPE_NOT_MAPPED" && !i.blocking)]).toEqual([17, true]);
  });
});

// =========================================================================================
describe("sarin validation: claims, retries and rollback", () => {
  test("two overlapping validation requests start exactly one attempt", async () => {
    const k = kapan();
    const batchId = await uploadBatch(planner.cookie, file(Array.from({ length: 1500 }, (_, i) => rec({ name: `${k}-${String(Math.floor(i / 20)).padStart(3, "0")} DC` }))));
    resetRateLimits();
    const [a, b] = await Promise.all([
      call(validateImport, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } }),
      call(validateImport, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } }),
    ]);
    const outcomes = [a, b].map((r) => (r.status === 200 ? (r.json.reused ? "REUSED" : "RAN") : r.json.error.code)).sort();
    expect(outcomes.filter((o) => o === "RAN")).toHaveLength(1);
    expect(outcomes.every((o) => ["RAN", "REUSED", "VALIDATION_IN_PROGRESS"].includes(o))).toBe(true);
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(1);
    expect(await db.sarinStoneBlock.count({ where: { batchId } })).toBe(75);
  });

  test("a live claim cannot be taken; an expired one is abandoned and reclaimed; the stale worker changes nothing", async () => {
    const batchId = await uploadBatch(planner.cookie, file([...stone({ name: `${kapan()}-001 DC` }), ...stone({ name: `${kapan()}-002 DC` })]));
    const first = await claimSarinValidation(serviceActor(), batchId);
    if (first.kind !== "CLAIMED") throw new Error("expected a claim");
    const busy = await validate(planner.cookie, batchId, {});
    expect([busy.status, busy.json.error.code]).toEqual([409, "VALIDATION_IN_PROGRESS"]);

    // The first worker crashes: its lease runs out.
    await db.sarinImportBatch.update({ where: { id: batchId }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) } });
    const reclaimed = await validate(planner.cookie, batchId, {});
    expect([reclaimed.status, reclaimed.json.batch.status, reclaimed.json.validation.attemptCount]).toEqual([200, "VALIDATED", 2]);
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((a) => [a.attemptNumber, a.status, a.failureCode])).toEqual([[1, "ABANDONED", "VALIDATION_LEASE_EXPIRED"], [2, "COMPLETED", null]]);
    expect(await db.auditLog.count({ where: { action: "SARIN_VALIDATION_ABANDONED", entityId: batchId } })).toBe(1);

    // The stale worker wakes up: it can neither finalize nor release the newer claim.
    await expect(runSarinValidationAttempt(serviceActor(), first.claim)).rejects.toThrow(/no longer current/);
    expect(await failSarinValidationAttempt(serviceActor(), first.claim, "STALE_WORKER")).toBe(false);
    const after = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect([after.status, after.validationAttempt, after.claimToken]).toEqual(["VALIDATED", 2, null]);
  });

  test("repeating a completed validation with the same set changes nothing; a new set is a new, traceable attempt", async () => {
    const k = kapan();
    const batchId = await uploadBatch(planner.cookie, file([rec({ name: `${k}-001 DC`, shape: "EMERALD 5STEP", ratio: "1.200" }), ...stone({ name: `${k}-001 DC` }, 16), ...stone({ name: `${k}-002 DC` })]));
    await validate(planner.cookie, batchId, {});
    const snapshot = async () => [
      await db.sarinValidationAttempt.count({ where: { batchId } }),
      await db.sarinStoneBlock.count({ where: { batchId } }),
      await db.sarinRowInterpretation.count({ where: { batchId } }),
      await db.sarinValidationIssue.count({ where: { batchId, status: "OPEN" } }),
    ];
    const before = await snapshot();
    const again = await validate(planner.cookie, batchId, {});
    expect([again.status, again.json.reused]).toEqual([200, true]);
    expect(await snapshot()).toEqual(before);

    // A range covering Ratio 1.200 makes a new snapshot; checking the file again uses it.
    await applyCatalog(mapperA.cookie, [...STANDARD_RULES, { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.100", ratioMax: "1.300" }]);
    const next = await validate(planner.cookie, batchId, {});
    expect([next.json.reused, next.json.batch.status, next.json.validation.lastCompletedAttempt.number]).toEqual([false, "VALIDATED", 2]);
    // Prior evidence stays: attempt 1's interpretations remain; its findings are superseded, not deleted.
    expect(await db.sarinRowInterpretation.count({ where: { batchId, validationAttempt: 1 } })).toBe(34);
    // Attempt 1's findings for that row: the Ratio outside every range and the plan it leaves shapeless.
    expect((await db.sarinValidationIssue.findMany({ where: { batchId, validationAttempt: 1 }, orderBy: { ordinal: "asc" } })).map((i) => [i.code, i.status])).toEqual([
      ["MAPPING_NO_CONDITIONAL_RULE", "SUPERSEDED"],
      ["NORMALIZED_SHAPE_MISSING", "SUPERSEDED"],
    ]);
    expect(await db.sarinStoneBlock.count({ where: { batchId } })).toBe(2); // blocks reused, not duplicated
    const firstAttempt = await interpretationsOf(planner.cookie, batchId, "?attempt=1");
    expect([firstAttempt.total, firstAttempt.rows.every((r: any) => r.mappingSet.id === standardSetId)]).toEqual([34, true]);
  });

  test("a failure mid-attempt keeps nothing partial, records FAILED, and the prior attempt survives", async () => {
    const k = kapan();
    const lines = Array.from({ length: 68 }, (_, i) => rec({ name: `${k}-${String(Math.floor(i / 17)).padStart(3, "0")} DC`, ...(i === 0 ? { shape: "EMERALD 5STEP", ratio: "1.200" } : { shape: "ROUND" }) }));
    const batchId = await uploadBatch(planner.cookie, file(lines));
    await validate(planner.cookie, batchId, {}); // attempt 1: NEEDS_REVIEW (Ratio 1.200 is outside every EMERALD 5STEP range)
    await applyCatalog(mapperA.cookie, [...STANDARD_RULES, { rawShape: "OVAL", normalizedShape: "Oval" }]);
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_inject_interpretation_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW."sourceRowNumber" = 40 THEN RAISE EXCEPTION 'injected validation failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_interpretation_failure BEFORE INSERT ON "SarinRowInterpretation" FOR EACH ROW EXECUTE FUNCTION test_inject_interpretation_failure()`);
    let failed: Awaited<ReturnType<typeof validate>>;
    let fresh: Awaited<ReturnType<typeof validate>>;
    let freshId = "";
    try {
      failed = await validate(planner.cookie, batchId, {});
      freshId = await uploadBatch(planner.cookie, file(Array.from({ length: 60 }, (_, i) => rec({ name: `${kapan()}-${String(i).padStart(3, "0")} DC` }))));
      fresh = await validate(planner.cookie, freshId, {});
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_interpretation_failure ON "SarinRowInterpretation"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_interpretation_failure()`);
    }
    expect([failed.status, failed.json.error.code]).toEqual([500, "VALIDATION_NOT_COMPLETED"]);
    expect(/injected|SELECT|at .*\.ts/.test(JSON.stringify(failed.json))).toBe(false);
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect([batch.status, batch.failureCode, batch.claimToken]).toEqual(["FAILED", "VALIDATION_PROCESSING_FAILED", null]);
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((a) => [a.attemptNumber, a.status, a.result])).toEqual([[1, "COMPLETED", "NEEDS_REVIEW"], [2, "FAILED", null]]);
    expect(await db.sarinRowInterpretation.count({ where: { batchId, validationAttempt: 2 } })).toBe(0);
    expect(await db.sarinValidationIssue.count({ where: { batchId, validationAttempt: 2 } })).toBe(0);
    // Attempt 1 is untouched: its interpretations and still-open findings remain the current result.
    expect(await db.sarinRowInterpretation.count({ where: { batchId, validationAttempt: 1 } })).toBe(68);
    expect(await db.sarinValidationIssue.count({ where: { batchId, validationAttempt: 1, status: "OPEN" } })).toBe(2); // MAPPING_NO_CONDITIONAL_RULE + NORMALIZED_SHAPE_MISSING
    const detail = await get(importDetail, planner.cookie, "/api/x", { batchId });
    expect([detail.json.validation.latestAttempt.status, detail.json.validation.lastCompletedAttempt.number]).toEqual(["FAILED", 1]);
    expect(await db.auditLog.count({ where: { action: "SARIN_VALIDATION_FAILED", entityId: batchId } })).toBe(1);

    // A first attempt that fails after writing blocks leaves no blocks behind either.
    expect(fresh!.status).toBe(500);
    expect(await db.sarinStoneBlock.count({ where: { batchId: freshId } })).toBe(0);

    const retry = await validate(planner.cookie, batchId, {});
    // The retry completes; the out-of-range row keeps the batch in review.
    expect([retry.status, retry.json.batch.status, retry.json.validation.lastCompletedAttempt.number]).toEqual([200, "NEEDS_REVIEW", 3]);
  });
});

// =========================================================================================
describe("sarin validation: UTC time stamps", () => {
  test("times stamped by the database are UTC, like every Prisma-written time", async () => {
    const batchId = await uploadBatch(planner.cookie, file([rec({ name: `${kapan()}-001 DC` })]));
    await validate(planner.cookie, batchId, {});
    const near = (d: Date | null) => d !== null && Math.abs(d.getTime() - Date.now()) < 120_000;
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } });
    const set = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: standardSetId } });
    expect([near(batch.statusChangedAt), near(batch.createdAt), near(attempt.finishedAt), near(attempt.startedAt)]).toEqual([true, true, true, true]);
    expect(set.effectiveAt !== null && set.effectiveAt.getTime() <= Date.now() + 60_000).toBe(true);
    // The seeded baseline is corrected to UTC: it can never appear to be created in the future.
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } } });
    expect(baseline.createdAt.getTime() <= Date.now() + 60_000).toBe(true);
  });
});

// =========================================================================================
describe("sarin validation: registries and bounded reads", () => {
  test("uploads need a registered lab; a scope code alone is not enough", async () => {
    const scoped = await makeUser("val.scoped.labx", "PLANNER");
    await grantScope(scoped.user.id, [], ["LAB-X"]);
    const noLab = await upload(scoped.cookie, file([rec({ name: `${kapan()}-001 DC` })]), { labId: "LAB-X" });
    expect([noLab.status, noLab.json.error.code]).toEqual([400, "UNKNOWN_LAB"]);
  });

  test("a lab removed from its registry after upload is a validation finding; no country is checked", async () => {
    await ensureLabRegistry(["LAB-TMP"]);
    const batchId = await uploadBatch(planner.cookie, file(stone({ name: `${kapan()}-001 DC` })), { labId: "LAB-TMP" });
    await db.labMapping.update({ where: { rawLab: "LAB-TMP" }, data: { active: false } });
    const v = await validate(planner.cookie, batchId, {});
    expect(v.json.batch.status).toBe("NEEDS_REVIEW");
    const issues = (await issuesOf(planner.cookie, batchId)).rows;
    expect(issues.map((i: any) => [i.code, i.block, i.sourceRowNumber])).toEqual([["LAB_NOT_IN_REGISTRY", null, null]]);
  });

  test("blocks, findings and interpretations are paginated, ordered, filtered and bounded", async () => {
    const k = kapan();
    const batchId = await uploadBatch(planner.cookie, file(Array.from({ length: 120 }, (_, i) => rec({ name: `${k}-${String(i).padStart(3, "0")} DC`, shape: i % 2 ? "HEXAGON" : "ROUND" }))));
    // HEXAGON has no mapping: each such row carries one pass-through warning.
    await validate(planner.cookie, batchId, {});
    const p1 = await blocksOf(planner.cookie, batchId, "?pageSize=50&page=1");
    const p3 = await blocksOf(planner.cookie, batchId, "?pageSize=50&page=3");
    expect([p1.rows.length, p1.total, p1.hasMore, p3.rows.length, p3.hasMore]).toEqual([50, 120, true, 20, false]);
    expect(p1.rows.map((b: any) => b.sequence)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const issues = await issuesOf(planner.cookie, batchId, "?code=SHAPE_NOT_MAPPED&pageSize=10");
    expect([issues.rows.length, issues.total, issues.hasMore]).toEqual([10, 60, true]);
    expect(issues.rows.map((i: any) => i.sourceRowNumber)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    const unmapped = await interpretationsOf(planner.cookie, batchId, "?mappingResult=UNMAPPED&pageSize=500");
    expect(unmapped.total).toBe(60);
    for (const q of ["?pageSize=501", "?parseStatus=BOGUS"]) expect((await get(listBlocks, planner.cookie, `/api/x${q}`, { batchId })).status).toBe(400);
    for (const q of ["?pageSize=501", "?severity=BOGUS", "?status=BOGUS", "?code=DROP_TABLE", "?attempt=0"]) expect((await get(listIssues, planner.cookie, `/api/x${q}`, { batchId })).status).toBe(400);
    expect((await get(listInterpretations, planner.cookie, "/api/x?mappingResult=BOGUS", { batchId })).status).toBe(400);
    // The batch detail stays a bounded summary.
    const detail = (await get(importDetail, planner.cookie, "/api/x", { batchId })).json;
    expect(detail.validation.lastCompletedAttempt.blocks).toEqual({ total: 120, parsed: 120, quarantined: 0 });
    // 60 unmapped-shape warnings (one per record, no second finding), plus 120 one-record
    // stones shorter than the Blue main-plan limit.
    expect(detail.validation.lastCompletedAttempt.issues.total).toBe(180);
    expect(JSON.stringify(detail).length).toBeLessThan(4000);
  });
});
