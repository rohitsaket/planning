// Sarin Blue/White transformation: plan structure validation, validation-profile binding,
// output versions, grouping, yield, idempotency, concurrency, rollback and preview reads.
//
// Uploads, validations, generation and reads go through the real route handlers against
// the isolated planning_sectest database. The generation service is also called directly
// where a test must vary its batch size or lock wait. Failures are injected by database
// triggers and a real row lock, so the service has no test-only branch. All data is
// synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { GET as listIssues } from "@/app/api/planning/sarin/imports/[batchId]/issues/route";
import { GET as listOutputs, POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { GET as getOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/route";
import { GET as listStones } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/stones/route";
import { GET as listOptions } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/options/route";
import { GET as listPieces } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/pieces/route";
import { GET as listApproved } from "@/app/api/planning/sarin/mapping-sets/approved/route";
import { POST as createSet } from "@/app/api/planning/sarin/mapping-sets/route";
import { POST as addRule } from "@/app/api/planning/sarin/mapping-sets/[setId]/rules/route";
import { POST as approveSet } from "@/app/api/planning/sarin/mapping-sets/[setId]/approve/route";
import { POST as retireSet } from "@/app/api/planning/sarin/mapping-sets/[setId]/retire/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { generateSarinOutput } from "@/lib/sarin/output-service";
import { SARIN_OUTPUT_CONFIG } from "@/lib/sarin/output-config";
import { planBlueWhiteStone, SARIN_BLUE_WHITE_TRANSFORM_PROFILE, SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH } from "@/lib/sarin/transform/blue-white";
import { displayYield, planYield } from "@/lib/sarin/yield";
import { SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
type User = Awaited<ReturnType<typeof makeUser>>;
let planner: User, viewer: User, planningViewer: User, admin: User, manager: User, root: User;
let mapperA: User, mapperB: User;
let standardSetId = "";

// ---- synthetic records ---------------------------------------------------------------------
let nonce = 0;
const kapan = () => `8${String(++nonce).padStart(3, "0")}W`;
interface Rec {
  name: string;
  rough?: string;
  shape?: string;
  est?: string;
  clarity?: string;
  color?: string;
  depth?: string;
  ratio?: string;
  length?: string;
  width?: string;
  depthMm?: string;
}
const rec = (o: Rec) =>
  [o.name, o.rough ?? "3.000", o.shape ?? "ROUND", o.est ?? "1.500", o.clarity ?? "VS1", o.color ?? "G", o.depth ?? "61.6", o.ratio ?? "1", o.length ?? "7.62", o.width ?? "7.62", o.depthMm ?? "4.69"].join(",");
const file = (lines: string[]) => lines.join("\n") + "\n";
/** A stone of `count` identical records. */
const stone = (o: Rec, count = 17) => Array.from({ length: count }, () => rec(o));
/** A stone whose records carry the given Estimated Weights in order. */
const stoneOf = (name: string, ests: string[], o: Omit<Rec, "name" | "est"> = {}) => ests.map((est) => rec({ ...o, name, est }));

// ---- requests -------------------------------------------------------------------------------
async function upload(cookie: string, content: string, fields: Record<string, string> = {}) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(content) as BlobPart], "sarin.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ stoneType: "BLUE", country: "IN", planningDate: "2026-09-26", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(
    new Request(URL_, { method: "POST", headers: { cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  return { status: res.status, json: (await res.json()) as any };
}
async function uploadBatch(content: string, fields: Record<string, string> = {}): Promise<string> {
  const r = await upload(planner.cookie, content, fields);
  if (r.status !== 201) throw new Error(`upload failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.batch.id;
}
const validate = (batchId: string, mappingSetId = standardSetId, cookie = planner.cookie) => {
  resetRateLimits();
  return call(validateImport, { method: "POST", cookie, body: { mappingSetId }, params: { batchId } });
};
async function validatedBatch(content: string, fields: Record<string, string> = {}, mappingSetId = standardSetId) {
  const batchId = await uploadBatch(content, fields);
  const v = await validate(batchId, mappingSetId);
  if (v.status !== 200 || v.json.batch.status !== "VALIDATED") throw new Error(`validation did not pass: ${v.status} ${JSON.stringify(v.json.batch?.status ?? v.json)}`);
  return batchId;
}
const generate = (batchId: string, cookie: string = planner.cookie, body: unknown = {}) => {
  resetRateLimits();
  return call(generateOutput, { method: "POST", cookie, body, params: { batchId } });
};
const read = (handler: any, params: Record<string, string>, query = "", cookie = planner.cookie) => {
  resetRateLimits();
  return call(handler, { cookie, path: `/api/x${query}`, params });
};
const post = (handler: any, cookie: string, body: unknown, params: Record<string, string> = {}) => {
  resetRateLimits();
  return call(handler, { method: "POST", cookie, body, params });
};

async function approvedSetViaApi(rules: Array<{ rawShape: string; normalizedShape: string; conditionKind?: "NONE" | "RATIO_RANGE"; ratioMin?: string | null; ratioMax?: string | null }>) {
  const created = await post(createSet, mapperA.cookie, { description: "synthetic" });
  if (created.status !== 201) throw new Error(`create failed ${created.status}`);
  const setId = created.json.set.id;
  for (const r of rules) {
    const a = await post(addRule, mapperA.cookie, { conditionKind: "NONE", ...r }, { setId });
    if (a.status !== 201) throw new Error(`rule failed ${a.status} ${JSON.stringify(a.json)}`);
  }
  const ok = await post(approveSet, mapperB.cookie, {}, { setId });
  if (ok.status !== 200) throw new Error(`approve failed ${ok.status}`);
  return setId;
}
const STANDARD_RULES = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE" as const, ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE" as const, ratioMin: "1.400", ratioMax: null },
];

const serviceActor = () => ({
  userId: planner.user.id,
  scope: { countries: null, labs: null },
  requestId: "output-worker",
  audit: async (client: any, input: any) => {
    await client.auditLog.create({ data: { actor: "output-worker", actorUserId: planner.user.id, action: input.action, entity: input.entity, entityId: input.entityId ?? null, after: JSON.stringify(input.after ?? null), outcome: input.outcome ?? "SUCCESS" } });
  },
});

async function grantScope(userId: string, countries: string[]) {
  await db.userAccessScope.deleteMany({ where: { userId } });
  if (countries.length) await db.userAccessScope.createMany({ data: countries.map((value) => ({ userId, dimension: "COUNTRY", value })) });
}
const auditCount = (action: string, batchId: string) => db.auditLog.count({ where: { action, entityId: batchId } });
const outputRows = async (batchId: string) => ({
  versions: await db.sarinOutputVersion.count({ where: { batchId } }),
  options: await db.sarinPlanOption.count({ where: { batchId } }),
  pieces: await db.sarinPlanPiece.count({ where: { batchId } }),
});

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureCountryRegistry(["IN", "BE"]);
  await ensureLabRegistry(["GIA"]);
  planner = await makeUser("out.planner", "PLANNER");
  viewer = await makeUser("out.viewer", "VIEWER");
  planningViewer = await makeUser("out.pviewer", "PLANNING_VIEWER");
  admin = await makeUser("out.admin", "ADMIN");
  manager = await makeUser("out.manager", "PLANNING_MANAGER");
  root = await makeUser("out.root", "SUPER_ADMIN");
  mapperA = await makeUser("out.mapper.a", "PLANNER");
  mapperB = await makeUser("out.mapper.b", "PLANNER");
  const code = `SARIN_MAPPER_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: "Sarin Mapping Manager", permissions: ["sarin.mapping.manage"] } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status}`);
  for (const u of [mapperA, mapperB]) {
    resetRateLimits();
    const r = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: ["PLANNER", code] } });
    if (r.status !== 200) throw new Error(`role assign failed ${r.status}`);
  }
  standardSetId = await approvedSetViaApi(STANDARD_RULES);
});
beforeEach(() => resetRateLimits());

// =========================================================================================
describe("sarin output: approved mapping-set discovery", () => {
  test("validators see approved sets only, with identity facts and no editing surface", async () => {
    const draft = await post(createSet, mapperA.cookie, { description: "draft, never listed" });
    expect(draft.status).toBe(201);
    const r = await read(listApproved, {}, "?pageSize=100");
    expect(r.status).toBe(200);
    expect(r.json.rows.every((s: any) => s.status === "APPROVED")).toBe(true);
    expect(r.json.rows.some((s: any) => s.id === draft.json.set.id)).toBe(false);
    const std = r.json.rows.find((s: any) => s.id === standardSetId);
    expect(Object.keys(std).sort()).toEqual(["approvedAt", "contentHashPrefix", "id", "ruleCount", "sourceSystem", "status", "version"]);
    const full = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: standardSetId } });
    expect([std.ruleCount, std.sourceSystem, std.contentHashPrefix]).toEqual([3, "SARIN", full.contentHash!.slice(0, 12)]);
    expect(std.contentHashPrefix).toHaveLength(12);
    // Mapping managers use it too (every default role holding mapping management validates).
    expect((await read(listApproved, {}, "", mapperA.cookie)).status).toBe(200);
  });

  test("callers without sarin.import.validate are refused; pagination is bounded", async () => {
    expect((await call(listApproved, { path: "/api/x" })).status).toBe(401);
    for (const u of [viewer, planningViewer, admin]) expect([u.user.username, (await read(listApproved, {}, "", u.cookie)).status]).toEqual([u.user.username, 403]);
    expect((await read(listApproved, {}, "?pageSize=101")).status).toBe(400);
    const p = await read(listApproved, {}, "?pageSize=1");
    expect([p.json.rows.length, p.json.hasMore]).toEqual([1, p.json.total > 1]);
  });
});

// =========================================================================================
describe("sarin output: validation reuse is bound to the validation profile", () => {
  test("an attempt made under an older profile is never reused, and never feeds output", async () => {
    const batchId = await uploadBatch(file(stone({ name: `${kapan()}-001 DC` })));
    // A completed Phase 4 (V1) attempt, driven through the same lifecycle the triggers allow.
    await db.sarinImportBatch.update({
      where: { id: batchId },
      data: { status: "VALIDATING", validationAttempt: { increment: 1 }, fencingVersion: { increment: 1 }, claimToken: randomUUID(), claimedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), shapeMappingSetId: standardSetId },
    });
    const legacy = await db.sarinValidationAttempt.create({
      data: { batchId, attemptNumber: 1, shapeMappingSetId: standardSetId, startedByUserId: planner.user.id, claimFencingVersion: 1, validationProfileVersion: "SARIN_VALIDATION_V1" },
    });
    await db.sarinValidationAttempt.update({ where: { id: legacy.id }, data: { status: "COMPLETED", result: "VALIDATED", blockCount: 0, parsedBlockCount: 0, quarantinedBlockCount: 0, interpretationCount: 0, issueCount: 0, blockingIssueCount: 0 } });
    await db.sarinImportBatch.update({ where: { id: batchId }, data: { status: "VALIDATED", claimToken: null, claimedAt: null, leaseExpiresAt: null } });

    const refused = await generate(batchId);
    expect([refused.status, refused.json.error.code]).toEqual([409, "VALIDATION_PROFILE_OUTDATED"]);
    expect((await outputRows(batchId)).versions).toBe(0);

    const again = await validate(batchId);
    expect([again.status, again.json.reused, again.json.batch.status, again.json.validation.lastCompletedAttempt.number]).toEqual([200, false, "VALIDATED", 2]);
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId }, orderBy: { attemptNumber: "asc" }, select: { validationProfileVersion: true } });
    expect(attempts.map((a) => a.validationProfileVersion)).toEqual(["SARIN_VALIDATION_V1", SARIN_VALIDATION_PROFILE_VERSION]);
    // Now the current profile has run: the same set and profile are reused, and output works.
    expect((await validate(batchId)).json.reused).toBe(true);
    expect((await generate(batchId)).status).toBe(201);
  });

  test("the profile an attempt ran is frozen", async () => {
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })));
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } });
    await expect(db.sarinValidationAttempt.update({ where: { id: attempt.id }, data: { validationProfileVersion: "SARIN_VALIDATION_V9" } })).rejects.toThrow();
  });
});

// =========================================================================================
describe("sarin output: Blue/White plan structure validation", () => {
  test("a stone shorter than its main-plan limit is a blocking finding; exactly the limit validates", async () => {
    const cases: Array<[string, number, string]> = [["BLUE", 16, "NEEDS_REVIEW"], ["BLUE", 17, "VALIDATED"], ["WHITE", 31, "NEEDS_REVIEW"], ["WHITE", 32, "VALIDATED"]];
    for (const [stoneType, rows, expected] of cases) {
      const signer = stoneType === "BLUE" ? "DC" : "HA";
      const batchId = await uploadBatch(file(stone({ name: `${kapan()}-001 ${signer}` }, rows)), { stoneType });
      const v = await validate(batchId);
      expect([stoneType, rows, v.json.batch.status]).toEqual([stoneType, rows, expected]);
      const issues = (await read(listIssues, { batchId }, "?pageSize=500")).json.rows;
      const short = issues.filter((i: any) => i.code === "STONE_BLOCK_SHORTER_THAN_MAIN_LIMIT");
      if (expected === "NEEDS_REVIEW") {
        expect(short.map((i: any) => [i.block.sequence, i.sourceRowNumber, i.blocking, i.details])).toEqual([[1, null, true, { rows, requiredRows: rows + 1 }]]);
        expect(issues).toHaveLength(1);
      } else {
        expect(issues).toHaveLength(0);
      }
    }
  });

  test("every row that would become a plan piece must be usable; each gap is its own stable finding", async () => {
    const name = `${kapan()}-001 DC`;
    const lines = stone({ name }, 20);
    lines[2] = rec({ name, est: "" }); // row 3: main plan, no Estimated Weight
    lines[4] = rec({ name, shape: "HEXAGON" }); // row 5: no approved shape
    lines[6] = rec({ name, clarity: "" }); // row 7: accepted, but no clarity to show
    lines[8] = rec({ name, depthMm: "" }); // row 9: accepted, but no depth (mm)
    lines[18] = rec({ name, est: "" }); // row 19: additional plan, cannot be grouped
    const batchId = await uploadBatch(file(lines));
    const v = await validate(batchId);
    expect(v.json.batch.status).toBe("NEEDS_REVIEW");
    const STRUCTURAL = ["MAIN_PLAN_ROW_UNUSABLE", "ADDITIONAL_PLAN_ROW_UNUSABLE", "NORMALIZED_SHAPE_MISSING", "ESTIMATED_WEIGHT_MISSING", "GROUPING_INPUT_INVALID", "OUTPUT_FIELD_UNAVAILABLE"];
    const issues = (await read(listIssues, { batchId }, "?pageSize=500")).json.rows.filter((i: any) => STRUCTURAL.includes(i.code));
    expect(issues.map((i: any) => [i.sourceRowNumber, i.code, i.fieldPosition, i.field])).toEqual([
      [3, "MAIN_PLAN_ROW_UNUSABLE", null, null],
      [3, "ESTIMATED_WEIGHT_MISSING", 4, "estimatedWeight"],
      [5, "NORMALIZED_SHAPE_MISSING", 3, "shape"],
      [7, "OUTPUT_FIELD_UNAVAILABLE", 5, "clarity"],
      [9, "OUTPUT_FIELD_UNAVAILABLE", 11, "depthMm"],
      [19, "ADDITIONAL_PLAN_ROW_UNUSABLE", null, null],
      [19, "GROUPING_INPUT_INVALID", 4, "estimatedWeight"],
    ]);
    expect(issues.every((i: any) => i.blocking && typeof i.title === "string" && i.block.sequence === 1)).toBe(true);
    // The findings speak plainly: no pattern, formula or query behind them.
    expect(/\\|\^|regex|SELECT|round\(/.test(JSON.stringify(issues))).toBe(false);

    // A batch with open blocking findings is never transformed.
    const refused = await generate(batchId);
    expect([refused.status, refused.json.error.code, refused.json.error.details?.blockingFindings > 0]).toEqual([422, "BLOCKING_FINDINGS_OPEN", true]);
    expect(await outputRows(batchId)).toEqual({ versions: 0, options: 0, pieces: 0 });
    expect(await auditCount("SARIN_OUTPUT_REJECTED", batchId)).toBe(1);
  });

  test("Pink batches carry no Blue/White structural findings; their own structure applies instead", async () => {
    const name = `${kapan()}-111_M`;
    const batchId = await uploadBatch(file([rec({ name, clarity: "" }), rec({ name })]), { stoneType: "PINK" });
    const v = await validate(batchId);
    expect(v.json.batch.status).toBe("NEEDS_REVIEW");
    const codes = (await read(listIssues, { batchId }, "?pageSize=500")).json.rows.map((i: any) => i.code);
    expect(codes).toEqual(["PINK_BLOCK_ROW_COUNT_INVALID", "OUTPUT_FIELD_UNAVAILABLE"]);
    const refused = await generate(batchId);
    expect([refused.status, refused.json.error.code]).toEqual([422, "BLOCKING_FINDINGS_OPEN"]);
    expect((await outputRows(batchId)).versions).toBe(0);
  });
});

// =========================================================================================
describe("sarin output: plan construction and yield", () => {
  test("grouping follows file order and a strict three-decimal increase; nothing is sorted", () => {
    const w = (v: string) => ({ estimatedWeight: new Prisma.Decimal(v), tag: v });
    const main = Array.from({ length: 17 }, () => w("1.000"));
    const additional = ["0.500", "0.4", "0.400", "0.600", "0.300", "0.700", "0.700", "0.701"].map(w);
    const plan = planBlueWhiteStone("BLUE", [...main, ...additional]);
    expect(plan.filter((o) => o.kind === "MAIN").map((o) => [o.kind === "MAIN" && o.mainOrdinal, o.rows.length])).toEqual(main.map((_, i) => [i + 1, 1]));
    expect(plan.filter((o) => o.kind === "ADDITIONAL").map((o) => [o.kind === "ADDITIONAL" && o.groupOrdinal, o.rows.map((r) => r.tag)])).toEqual([
      [1, ["0.500", "0.4", "0.400"]],
      [2, ["0.600", "0.300"]],
      [3, ["0.700", "0.700"]],
      [4, ["0.701"]],
    ]);
    // Exactly the limit: no additional group. Below it: refused, never padded.
    expect(planBlueWhiteStone("WHITE", Array.from({ length: 32 }, () => w("1"))).every((o) => o.kind === "MAIN")).toBe(true);
    expect(() => planBlueWhiteStone("WHITE", Array.from({ length: 31 }, () => w("1")))).toThrow();
  });

  test("yield is exact fixed-decimal arithmetic, stored at ten places and displayed half-up at two", () => {
    const y = planYield([new Prisma.Decimal("0.500"), new Prisma.Decimal("0.4"), new Prisma.Decimal("0.400")], new Prisma.Decimal("3.000"));
    expect([y.numerator.toFixed(3), y.denominator.toFixed(3), y.percent.toFixed(10), displayYield(y.percent)]).toEqual(["1.300", "3.000", "43.3333333333", "43.33"]);
    expect(planYield([new Prisma.Decimal("1.4")], new Prisma.Decimal("3")).percent.toFixed(10)).toBe("46.6666666667");
    // Binary floating point rounds 0.075 down; the confirmed rule is half-up.
    expect((0.075).toFixed(2)).toBe("0.07");
    const trap = planYield([new Prisma.Decimal("0.003")], new Prisma.Decimal("4.000"));
    expect([trap.percent.toFixed(10), displayYield(trap.percent)]).toEqual(["0.0750000000", "0.08"]);
    expect(() => planYield([], new Prisma.Decimal("1"))).toThrow();
    expect(() => planYield([new Prisma.Decimal("1")], new Prisma.Decimal("0"))).toThrow();
  });

  test("a generated Blue version holds every stone, option and piece with exact lineage and stored yields", async () => {
    const k = kapan();
    const s1 = `${k}-001 DC`;
    const s2 = `${k}-002 DC`;
    const s1Lines = stoneOf(s1, [...Array(17).fill("1.500"), "0.500", "0.4", "0.400", "0.600", "0.300", "0.700", "0.700"]);
    s1Lines[1] = rec({ name: s1, shape: "EMERALD 5STEP", ratio: "1.02" }); // conditionally mapped
    const s2Lines = stoneOf(s2, Array(17).fill("0.003"), { rough: "4.000" });
    const batchId = await validatedBatch(file([...s1Lines, ...s2Lines]));
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId, status: "COMPLETED" }, orderBy: { attemptNumber: "desc" } });

    const g = await generate(batchId);
    expect([g.status, g.json.reused]).toEqual([201, false]);
    const version = g.json.output.version;
    expect([version.versionNumber, version.status, version.isCurrent, version.stoneType, version.counts]).toEqual([1, "GENERATED", true, "BLUE", { stones: 2, options: 37, pieces: 41 }]);
    expect([version.validationAttempt, version.mappingSet.id, version.validationProfile, version.transformProfile]).toEqual([
      attempt.attemptNumber,
      standardSetId,
      SARIN_VALIDATION_PROFILE_VERSION,
      { version: SARIN_BLUE_WHITE_TRANSFORM_PROFILE.version, hash: SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH },
    ]);
    expect(g.json.output.content).toEqual({ main: { options: 34, pieces: 34 }, additional: { options: 3, pieces: 7 } });
    const stored = await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect([stored.inputsHash.length, stored.generatedByUserId, Math.abs(stored.generatedAt.getTime() - Date.now()) < 120_000]).toEqual([64, planner.user.id, true]);

    const options = (await read(listOptions, { batchId, versionId: version.id }, "?pageSize=500")).json.rows;
    const view = options.map((o: any) => [o.stone.sequence, o.optionSequence, o.kind, o.mainOrdinal, o.additionalGroupOrdinal, o.pieceCount, o.totalEstimatedWeight, o.yield.percent, o.yield.display, o.outputRows.first, o.outputRows.last]);
    expect(view.slice(0, 2)).toEqual([
      [1, 1, "MAIN", 1, null, 1, "1.500", "50.0000000000", "50.00", 1, 1],
      [1, 2, "MAIN", 2, null, 1, "1.500", "50.0000000000", "50.00", 2, 2],
    ]);
    expect(view.slice(17, 21)).toEqual([
      [1, 18, "ADDITIONAL", null, 1, 3, "1.300", "43.3333333333", "43.33", 18, 20],
      [1, 19, "ADDITIONAL", null, 2, 2, "0.900", "30.0000000000", "30.00", 21, 22],
      [1, 20, "ADDITIONAL", null, 3, 2, "1.400", "46.6666666667", "46.67", 23, 24],
      [2, 1, "MAIN", 1, null, 1, "0.003", "0.0750000000", "0.08", 25, 25],
    ]);
    expect(options[17].yield).toEqual({ numerator: "1.300", denominator: "3.000", percent: "43.3333333333", display: "43.33" });

    const pieces = (await read(listPieces, { batchId, versionId: version.id }, "?pageSize=500")).json.rows;
    expect(pieces.map((p: any) => p.outputRow)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(pieces.map((p: any) => p.sourceRowNumber)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(pieces.slice(17, 20).map((p: any) => [p.option.sequence, p.pieceSequence, p.estimatedWeight])).toEqual([[18, 1, "0.500"], [18, 2, "0.400"], [18, 3, "0.400"]]);
    expect([pieces[1].rawShape, pieces[1].normalizedShape, pieces[1].ratio]).toEqual(["EMERALD 5STEP", "Asscher", "1.020"]);
    expect([pieces[0].normalizedShape, pieces[0].clarity, pieces[0].color, pieces[0].depthPct, pieces[0].length, pieces[0].width, pieces[0].depthMm]).toEqual(["Round", "VS1", "G", "61.600", "7.620", "7.620", "4.690"]);
    const rule = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: standardSetId, rawShapeKey: "ROUND" } });
    expect(pieces[0].mappingRuleId).toBe(rule.id);

    const stones = (await read(listStones, { batchId, versionId: version.id })).json.rows;
    expect(stones.map((s: any) => [s.sequence, s.stoneName, s.roughWeight, s.optionsByKind, s.options, s.pieces])).toEqual([
      [1, s1, "3.000", { MAIN: 17, ADDITIONAL: 3 }, 20, 24],
      [2, s2, "4.000", { MAIN: 17, ADDITIONAL: 0 }, 17, 17],
    ]);
    expect(await auditCount("SARIN_OUTPUT_GENERATED", batchId)).toBe(1);
  });

  test("a White stone has 32 main plans before its groups", async () => {
    const name = `${kapan()}-001 HA`;
    const batchId = await validatedBatch(file(stoneOf(name, [...Array(32).fill("0.100"), "0.200", "0.100"], { rough: "5.000" })), { stoneType: "WHITE" });
    const g = await generate(batchId);
    expect([g.status, g.json.output.version.counts, g.json.output.content]).toEqual([201, { stones: 1, options: 33, pieces: 34 }, { main: { options: 32, pieces: 32 }, additional: { options: 1, pieces: 2 } }]);
  });
});

// =========================================================================================
describe("sarin output: API contract, authorization and scope", () => {
  test("the same inputs return the same version (200, reused); the body carries no calculation", async () => {
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` }, 19)));
    const first = await generate(batchId);
    const again = await generate(batchId);
    expect([first.status, again.status, again.json.reused, again.json.output.version.id]).toEqual([201, 200, true, first.json.output.version.id]);
    expect(await outputRows(batchId)).toEqual({ versions: 1, options: 18, pieces: 19 });
    expect([await auditCount("SARIN_OUTPUT_GENERATED", batchId), await auditCount("SARIN_OUTPUT_REUSED", batchId)]).toEqual([1, 1]);
    for (const body of [{ yieldPercent: "99.9" }, { options: [] }, { userId: "someone" }, { stoneType: "WHITE" }, { validationAttemptId: "bad id!" }]) {
      expect([body, (await generate(batchId, planner.cookie, body)).status]).toEqual([body, 400]);
    }
    // Naming the reviewed attempt is a precondition, not an input.
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } });
    expect((await generate(batchId, planner.cookie, { validationAttemptId: attempt.id })).status).toBe(200);
  });

  test("generation needs sarin.output.generate; previews need sarin.import.read", async () => {
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })));
    expect((await call(generateOutput, { method: "POST", body: {}, params: { batchId } })).status).toBe(401);
    for (const u of [viewer, planningViewer, admin]) expect([u.user.username, (await generate(batchId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect((await outputRows(batchId)).versions).toBe(0);
    const made = await generate(batchId, manager.cookie);
    expect(made.status).toBe(201);
    const versionId = made.json.output.version.id;
    for (const [h, params] of [[listOutputs, { batchId }], [getOutput, { batchId, versionId }], [listStones, { batchId, versionId }], [listOptions, { batchId, versionId }], [listPieces, { batchId, versionId }]] as const) {
      expect((await read(h, params, "", planningViewer.cookie)).status).toBe(200);
      expect((await read(h, params, "", admin.cookie)).status).toBe(200);
      expect((await read(h, params, "", viewer.cookie)).status).toBe(403);
      expect((await call(h, { path: "/api/x", params })).status).toBe(401);
    }
  });

  test("an out-of-scope batch is a 404 for generation and every preview; a version is only found under its own batch", async () => {
    const be = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })), { country: "BE" });
    const versionId = (await generate(be)).json.output.version.id;
    const scoped = await makeUser("out.scoped.in", "PLANNER");
    await grantScope(scoped.user.id, ["IN"]);
    expect((await generate(be, scoped.cookie)).status).toBe(404);
    for (const [h, params] of [[listOutputs, { batchId: be }], [getOutput, { batchId: be, versionId }], [listStones, { batchId: be, versionId }], [listOptions, { batchId: be, versionId }], [listPieces, { batchId: be, versionId }]] as const) {
      expect((await read(h, params, "", scoped.cookie)).status).toBe(404);
    }
    const other = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })));
    for (const h of [getOutput, listStones, listOptions, listPieces]) expect((await read(h, { batchId: other, versionId })).status).toBe(404);
  });

  test("status refusals: not validated, needs review, Pink, retired mapping set", async () => {
    const uploaded = await uploadBatch(file(stone({ name: `${kapan()}-001 DC` })));
    const r1 = await generate(uploaded);
    expect([r1.status, r1.json.error.code]).toEqual([409, "IMPORT_NOT_VALIDATED"]);

    const setId = await approvedSetViaApi([{ rawShape: "ROUND", normalizedShape: "Round" }]);
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })), {}, setId);
    expect((await post(retireSet, mapperA.cookie, { reason: "Replaced by a newer master" }, { setId })).status).toBe(200);
    const r2 = await generate(batchId);
    expect([r2.status, r2.json.error.code]).toEqual([409, "MAPPING_SET_NOT_APPROVED"]);
    expect((await outputRows(batchId)).versions).toBe(0);
    expect(await auditCount("SARIN_OUTPUT_REJECTED", batchId)).toBe(1);
    expect(/SELECT|prisma|at .*\.ts/i.test(JSON.stringify(r2.json))).toBe(false);
  });
});

// =========================================================================================
describe("sarin output: versions, supersession and stale requests", () => {
  test("a new validation leads to a new version that supersedes the old; history stays readable", async () => {
    const name = `${kapan()}-001 DC`;
    const batchId = await validatedBatch(file(stoneOf(name, [...Array(17).fill("1.000"), "0.500"])));
    const v1 = (await generate(batchId)).json.output.version;
    const firstAttempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } });

    const secondSet = await approvedSetViaApi([...STANDARD_RULES, { rawShape: "HEXAGON", normalizedShape: "Kite" }]);
    expect((await validate(batchId, secondSet)).json.batch.status).toBe("VALIDATED");
    // Still GENERATED, but no longer derived from the current validation.
    const between = (await read(listOutputs, { batchId })).json.rows;
    expect(between.map((v: any) => [v.versionNumber, v.status, v.isCurrent])).toEqual([[1, "GENERATED", false]]);

    // A caller who reviewed the old validation is refused rather than silently served.
    const stale = await generate(batchId, planner.cookie, { validationAttemptId: firstAttempt.id });
    expect([stale.status, stale.json.error.code]).toEqual([409, "VALIDATION_CHANGED"]);

    const v2 = await generate(batchId);
    expect([v2.status, v2.json.output.version.versionNumber, v2.json.output.version.supersedesVersionId, v2.json.output.version.mappingSet.id]).toEqual([201, 2, v1.id, secondSet]);
    const list = (await read(listOutputs, { batchId })).json.rows;
    expect(list.map((v: any) => [v.versionNumber, v.status, v.isCurrent, v.supersededAt !== null])).toEqual([[2, "GENERATED", true, false], [1, "SUPERSEDED", false, true]]);
    const old = await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(Math.abs(old.supersededAt!.getTime() - Date.now()) < 120_000).toBe(true);
    expect((await read(listPieces, { batchId, versionId: v1.id })).json.total).toBe(18);
    expect(await db.sarinOutputVersion.count({ where: { batchId, status: "GENERATED" } })).toBe(1);
  });

  test("the database refuses a version from a stale validation and content outside the generating transaction", async () => {
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })));
    const v1 = (await generate(batchId)).json.output.version;
    const attempt1 = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } });
    const secondSet = await approvedSetViaApi(STANDARD_RULES);
    await validate(batchId, secondSet);
    const base = {
      batchId, shapeMappingSetId: standardSetId, validationProfileVersion: SARIN_VALIDATION_PROFILE_VERSION, transformProfileVersion: "SARIN_BLUE_WHITE_TRANSFORM_V1",
      transformProfileHash: "a".repeat(64), inputsHash: "b".repeat(64), stoneType: "BLUE", generatedByUserId: "u", stoneCount: 1, optionCount: 17, pieceCount: 17,
    };
    await db.sarinOutputVersion.updateMany({ where: { batchId, status: "GENERATED" }, data: { status: "SUPERSEDED" } });
    await expect(db.sarinOutputVersion.create({ data: { ...base, validationAttemptId: attempt1.id, versionNumber: 2 } })).rejects.toThrow(/current clean validation/);
    const block = await db.sarinStoneBlock.findFirstOrThrow({ where: { batchId } });
    await expect(
      db.sarinPlanOption.create({
        data: { outputVersionId: v1.id, batchId, stoneBlockId: block.id, optionSequence: 99, optionKind: "MAIN", mainOrdinal: 99, pieceCount: 1, totalEstimatedWeight: "1.500", yieldNumerator: "1.500", yieldDenominator: "3.000", yieldPercent: "50", firstOutputRow: 99, lastOutputRow: 99 },
      }),
    ).rejects.toThrow(/generates its version/);
  });

  test("output versions, options and pieces are immutable and cannot be deleted", async () => {
    const batchId = await validatedBatch(file(stone({ name: `${kapan()}-001 DC` })));
    const versionId = (await generate(batchId)).json.output.version.id;
    const option = await db.sarinPlanOption.findFirstOrThrow({ where: { outputVersionId: versionId } });
    const piece = await db.sarinPlanPiece.findFirstOrThrow({ where: { outputVersionId: versionId } });
    await expect(db.sarinPlanOption.update({ where: { id: option.id }, data: { yieldPercent: "99" } })).rejects.toThrow();
    await expect(db.sarinPlanOption.delete({ where: { id: option.id } })).rejects.toThrow();
    await expect(db.sarinPlanPiece.update({ where: { id: piece.id }, data: { estimatedWeight: "9.999" } })).rejects.toThrow();
    await expect(db.sarinPlanPiece.delete({ where: { id: piece.id } })).rejects.toThrow();
    await expect(db.sarinOutputVersion.update({ where: { id: versionId }, data: { pieceCount: 1 } })).rejects.toThrow(/immutable/);
    await expect(db.sarinOutputVersion.delete({ where: { id: versionId } })).rejects.toThrow();
    await db.sarinOutputVersion.update({ where: { id: versionId }, data: { status: "SUPERSEDED" } });
    await expect(db.sarinOutputVersion.update({ where: { id: versionId }, data: { status: "GENERATED", supersededAt: null } })).rejects.toThrow(/immutable/);
    expect(await outputRows(batchId)).toEqual({ versions: 1, options: 17, pieces: 17 });
  });
});

// =========================================================================================
describe("sarin output: concurrency, rollback and batch size", () => {
  const manyStones = (count: number, rows = 20) => {
    const k = kapan();
    return Array.from({ length: count }, (_, s) => stoneOf(`${k}-${String(s).padStart(3, "0")} DC`, Array.from({ length: rows }, (_, i) => (i < 17 ? "1.000" : ["0.300", "0.200", "0.400"][i % 3])))).flat();
  };

  test("five concurrent generation requests produce exactly one version", async () => {
    const batchId = await validatedBatch(file(manyStones(60)));
    resetRateLimits();
    const results = await Promise.all(Array.from({ length: 5 }, () => call(generateOutput, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } })));
    const outcomes = results.map((r) => (r.status === 201 ? "NEW" : r.status === 200 && r.json.reused ? "REUSED" : r.json.error?.code));
    expect(outcomes.filter((o) => o === "NEW")).toHaveLength(1);
    expect(outcomes.every((o) => o === "NEW" || o === "REUSED" || o === "OUTPUT_GENERATION_IN_PROGRESS")).toBe(true);
    const ids = new Set(results.filter((r) => r.status < 300).map((r) => r.json.output.version.id));
    expect(ids.size).toBe(1);
    // Each stone: 17 main plans and one group (0.400, 0.300, 0.200 never increase).
    expect(await outputRows(batchId)).toEqual({ versions: 1, options: 60 * 18, pieces: 60 * 20 });
  });

  test("a request that waits for a running generation succeeds afterwards; one that cannot wait is told to retry", async () => {
    const batchId = await validatedBatch(file(manyStones(3)));
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const held = new Promise<void>((r) => (release = r));
    // A real competing holder of the batch row lock, in its own transaction.
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "SarinImportBatch" WHERE "id" = ${batchId} FOR UPDATE`;
        locked();
        await held;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    const impatient = await generateSarinOutput(serviceActor(), batchId, {}, { ...SARIN_OUTPUT_CONFIG, lockWaitMs: 200 }).then(
      () => "GENERATED",
      (e: any) => e.code,
    );
    expect(impatient).toBe("OUTPUT_GENERATION_IN_PROGRESS");
    let settled = false;
    resetRateLimits();
    const waiting = call(generateOutput, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 1000));
    expect(settled).toBe(false); // genuinely blocked behind the holder
    release();
    await holder;
    const r = await waiting;
    expect([r.status, r.json.output.version.counts]).toEqual([201, { stones: 3, options: 54, pieces: 60 }]);
    expect(await auditCount("SARIN_OUTPUT_REJECTED", batchId)).toBe(1);
  });

  test("a failure part-way through writing keeps nothing partial; the previous version stays current", async () => {
    const batchId = await validatedBatch(file(manyStones(6)));
    const v1 = (await generate(batchId)).json.output.version;
    const before = await outputRows(batchId);
    const secondSet = await approvedSetViaApi(STANDARD_RULES);
    await validate(batchId, secondSet);
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_inject_piece_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW."outputRowSequence" = 95 THEN RAISE EXCEPTION 'injected output failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_piece_failure BEFORE INSERT ON "SarinPlanPiece" FOR EACH ROW EXECUTE FUNCTION test_inject_piece_failure()`);
    let failure: unknown;
    try {
      // Two stones per round: rows 1-80 are written in earlier rounds before the failure.
      failure = await generateSarinOutput(serviceActor(), batchId, {}, { ...SARIN_OUTPUT_CONFIG, writeBatch: 2 }).catch((e) => e);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_piece_failure ON "SarinPlanPiece"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_piece_failure()`);
    }
    expect([(failure as any).status, (failure as any).code]).toEqual([500, "OUTPUT_NOT_GENERATED"]);
    expect(/injected/.test((failure as Error).message)).toBe(false);
    expect(await outputRows(batchId)).toEqual(before);
    const versions = await db.sarinOutputVersion.findMany({ where: { batchId }, select: { id: true, status: true } });
    expect(versions).toEqual([{ id: v1.id, status: "GENERATED" }]);
    expect(await auditCount("SARIN_OUTPUT_FAILED", batchId)).toBe(1);

    const retry = await generate(batchId);
    expect([retry.status, retry.json.output.version.versionNumber, retry.json.output.version.supersedesVersionId]).toEqual([201, 2, v1.id]);
  });

  test("the write batch size changes nothing about the output", async () => {
    const content = file([
      ...manyStones(4, 17),
      ...stoneOf(`${kapan()}-001 DC`, [...Array(17).fill("0.250"), "0.100", "0.300", "0.300", "0.200", "0.900"]),
      ...manyStones(5, 23),
    ]);
    const snapshots: string[] = [];
    for (const [i, writeBatch] of [1, 3, 200].entries()) {
      const batchId = await validatedBatch(content, { planningDate: `2026-10-0${i + 1}` });
      const out = await generateSarinOutput(serviceActor(), batchId, {}, { ...SARIN_OUTPUT_CONFIG, writeBatch });
      const options = await db.sarinPlanOption.findMany({
        where: { outputVersionId: out.versionId },
        orderBy: { firstOutputRow: "asc" },
        select: { optionSequence: true, optionKind: true, mainOrdinal: true, additionalGroupOrdinal: true, pieceCount: true, yieldPercent: true, firstOutputRow: true, lastOutputRow: true, stoneBlock: { select: { blockSequence: true } } },
      });
      const pieces = await db.sarinPlanPiece.findMany({ where: { outputVersionId: out.versionId }, orderBy: { outputRowSequence: "asc" }, select: { outputRowSequence: true, sourceRowNumber: true, pieceSequence: true, estimatedWeight: true, normalizedShape: true } });
      expect([writeBatch, options.length, pieces.length]).toEqual([writeBatch, 4 * 17 + 20 + 5 * 19, 4 * 17 + 22 + 5 * 23]);
      snapshots.push(JSON.stringify({ options, pieces }));
    }
    expect(snapshots[1]).toBe(snapshots[0]);
    expect(snapshots[2]).toBe(snapshots[0]);
  });
});

// =========================================================================================
describe("sarin output: bounded preview reads", () => {
  test("previews are paginated, filtered, validated and free of internals", async () => {
    const k = kapan();
    const batchId = await validatedBatch(file(Array.from({ length: 30 }, (_, s) => stoneOf(`${k}-${String(s).padStart(3, "0")} DC`, [...Array(17).fill("1.000"), "0.100", "0.200"])).flat()));
    const versionId = (await generate(batchId)).json.output.version.id;
    const stones = await read(listStones, { batchId, versionId }, "?pageSize=10&page=3");
    expect([stones.json.rows.length, stones.json.total, stones.json.hasMore, stones.json.rows[0].sequence]).toEqual([10, 30, false, 21]);
    const options = await read(listOptions, { batchId, versionId }, "?pageSize=50");
    expect([options.json.rows.length, options.json.total, options.json.hasMore]).toEqual([50, 30 * 19, true]);
    const additional = await read(listOptions, { batchId, versionId }, "?stone=4&kind=ADDITIONAL");
    expect(additional.json.rows.map((o: any) => [o.stone.sequence, o.additionalGroupOrdinal, o.pieceCount])).toEqual([[4, 1, 1], [4, 2, 1]]);
    const oneOption = await read(listPieces, { batchId, versionId }, `?option=${additional.json.rows[1].id}`);
    expect(oneOption.json.rows.map((p: any) => [p.stoneSequence, p.sourceRowNumber, p.estimatedWeight])).toEqual([[4, 4 * 19, "0.200"]]);
    const stonePieces = await read(listPieces, { batchId, versionId }, "?stone=2&pageSize=5");
    expect([stonePieces.json.total, stonePieces.json.rows[0].outputRow]).toEqual([19, 20]);
    for (const q of ["?pageSize=501", "?kind=BOGUS", "?stone=0", "?stone=abc"]) expect([q, (await read(listOptions, { batchId, versionId }, q)).status]).toEqual([q, 400]);
    for (const q of ["?pageSize=501", "?option=bad id", "?stone=-1"]) expect([q, (await read(listPieces, { batchId, versionId }, q)).status]).toEqual([q, 400]);
    expect((await read(listOutputs, { batchId }, "?pageSize=101")).status).toBe(400);
    const summary = (await read(getOutput, { batchId, versionId })).json;
    expect(JSON.stringify(summary).length).toBeLessThan(3000);
    const all = JSON.stringify([summary, options.json, stonePieces.json]);
    expect(/SELECT|regex|round\(|sha256Content|content":\s*"[A-Za-z0-9+/=]{40,}/.test(all)).toBe(false);
  });
});
