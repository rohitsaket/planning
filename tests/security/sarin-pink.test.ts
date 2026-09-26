// Sarin Pink transformation: the 45-record positional contract, its validation findings and
// advisories, the 27-option output, decimal yields, idempotency, concurrency, rollback,
// authorization, scope and audit.
//
// Uploads, validations, generation and reads go through the real route handlers against
// the isolated planning_sectest database. The generation service is called directly only
// to vary its batch size. Mapping sets here are explicit, test-only approved sets; no
// production mapping is seeded. Failures are injected by database triggers, so the service
// has no test-only branch. All data is synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, makeUser, resetDb } from "./helpers";
import { randomUUID } from "node:crypto";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { GET as listIssues } from "@/app/api/planning/sarin/imports/[batchId]/issues/route";
import { GET as listInterpretations } from "@/app/api/planning/sarin/imports/[batchId]/interpretations/route";
import { GET as listOutputs, POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { GET as getOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/route";
import { GET as listStones } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/stones/route";
import { GET as listOptions } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/options/route";
import { GET as listPieces } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/pieces/route";
import { POST as createSet } from "@/app/api/planning/sarin/mapping-sets/route";
import { POST as addRule } from "@/app/api/planning/sarin/mapping-sets/[setId]/rules/route";
import { POST as approveSet } from "@/app/api/planning/sarin/mapping-sets/[setId]/approve/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { generateSarinOutput } from "@/lib/sarin/output-service";
import { SARIN_OUTPUT_CONFIG } from "@/lib/sarin/output-config";
import { SARIN_PINK_LAYOUT } from "@/lib/sarin/pink-structure";
import { SARIN_PLAN_OPTION_KINDS } from "@/lib/sarin/domain";
import { SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";
import { planPinkStone, SARIN_PINK_TRANSFORM_PROFILE, SARIN_PINK_TRANSFORM_PROFILE_HASH } from "@/lib/sarin/transform/pink";
import { Prisma } from "@prisma/client";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
type User = Awaited<ReturnType<typeof makeUser>>;
let planner: User, viewer: User, planningViewer: User, admin: User, root: User, mapperA: User, mapperB: User;
let pinkSetId = "";
let noEmeraldSetId = "";

// ---- synthetic Pink records ---------------------------------------------------------------
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
const line = (r: Rec) =>
  [r.name, r.rough ?? "4.000", r.shape ?? "ROUND", r.est ?? "1.000", r.clarity ?? "VS1", r.color ?? "G", r.depth ?? "61.6", r.ratio ?? "1.000", r.length ?? "5.10", r.width ?? "5.05", r.depthMm ?? "3.12"].join(",");
const file = (recs: Rec[]) => recs.map(line).join("\n") + "\n";

// Raw Sarin shape and Ratio for each family. EMERALD 4STEP is Asscher or Emerald only by
// its Ratio, resolved solely by the test-only conditional rules below.
const ROUND = ["ROUND", "1.000"] as const;
const OVAL = ["OVAL", "1.350"] as const;
const EMERALD = ["EMERALD 4STEP", "1.435"] as const;
const RADIANT = ["RADIANT", "1.200"] as const;
const CUSHION = ["CUSHION", "1.050"] as const;
const ANTIQUE = ["ANTIQUE CUSHION", "1.100"] as const;
const FAMILIES = [ROUND, ["PEAR", "1.500"], OVAL, ["EMERALD 4STEP", "1.000"], EMERALD, RADIANT, CUSHION, ANTIQUE, ["HEART", "0.950"]] as const;
const FAMILY_SHAPES = ["Round", "Pear", "Oval", "Asscher", "Emerald", "Radiant", "Cushion Brilliant", "Antique Cushion", "Heart"];

let nonce = 0;
const kapan = () => `6${String(++nonce).padStart(3, "0")}`;

/** A complete, valid 45-record Pink stone. Twins differ by 0, 0.001, 0.004, 0, 0 and 0.002 ct. */
function pinkStone(name: string, rough = "4.000"): Rec[] {
  const recs: Rec[] = [];
  const add = ([shape, ratio]: readonly string[], est: string) => recs.push({ name, rough, shape, ratio, est });
  FAMILIES.forEach((family, i) => {
    const est = `1.0${i}0`;
    add(family, est); // MK
    add(family, est); // SL primary: the same candidate
    add(ROUND, "0.200"); // SL remainder
  });
  add(EMERALD, "0.900"); add(ROUND, "0.500"); // BP Emerald + Round
  add(OVAL, "0.800"); add(ROUND, "0.400"); // BP Oval + Round
  add(EMERALD, "0.700"); add(OVAL, "0.601"); // BP Emerald + Oval
  const twins: Array<[readonly string[], string, string]> = [[ROUND, "0.600", "0.600"], [OVAL, "0.550", "0.551"], [EMERALD, "0.500", "0.504"], [RADIANT, "0.450", "0.450"], [CUSHION, "0.400", "0.400"], [ANTIQUE, "0.350", "0.352"]];
  for (const [shape, a, b] of twins) { add(shape, a); add(shape, b); }
  return recs;
}
/** The stone with the record at a 1-based position changed. */
const withAt = (recs: Rec[], position: number, patch: Partial<Rec>) => recs.map((r, i) => (i === position - 1 ? { ...r, ...patch } : r));

// ---- requests -------------------------------------------------------------------------------
async function uploadBatch(content: string, fields: Record<string, string> = {}): Promise<string> {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(content) as BlobPart], "pink.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ stoneType: "PINK", country: "IN", planningDate: "2026-09-26", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(
    new Request(URL_, { method: "POST", headers: { cookie: planner.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  const json = (await res.json()) as any;
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${JSON.stringify(json)}`);
  return json.batch.id;
}
const validate = (batchId: string, mappingSetId = pinkSetId, cookie = planner.cookie) => {
  resetRateLimits();
  return call(validateImport, { method: "POST", cookie, body: { mappingSetId }, params: { batchId } });
};
async function validatedBatch(recs: Rec[], fields: Record<string, string> = {}) {
  const batchId = await uploadBatch(file(recs), fields);
  const v = await validate(batchId);
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
const findings = async (batchId: string, query = "") => (await read(listIssues, { batchId }, `?pageSize=500${query}`)).json.rows as any[];
const pinkFindings = async (batchId: string) =>
  (await findings(batchId)).filter((i) => i.code.startsWith("PINK_")).map((i) => [i.code, i.sourceRowNumber, i.details]);
const auditCount = (action: string, batchId: string) => db.auditLog.count({ where: { action, entityId: batchId } });
const outputRows = async (batchId: string) => ({
  versions: await db.sarinOutputVersion.count({ where: { batchId } }),
  options: await db.sarinPlanOption.count({ where: { batchId } }),
  pieces: await db.sarinPlanPiece.count({ where: { batchId } }),
});

async function approvedSetViaApi(rules: Array<{ rawShape: string; normalizedShape: string; conditionKind?: "NONE" | "RATIO_RANGE"; ratioMin?: string | null; ratioMax?: string | null }>) {
  const created = await post(createSet, mapperA.cookie, { description: "test-only Pink mapping" });
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
const PLAIN_RULES = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "PEAR", normalizedShape: "Pear" },
  { rawShape: "OVAL", normalizedShape: "Oval" },
  { rawShape: "RADIANT", normalizedShape: "Radiant" },
  { rawShape: "CUSHION", normalizedShape: "Cushion Brilliant" },
  { rawShape: "ANTIQUE CUSHION", normalizedShape: "Antique Cushion" },
  { rawShape: "HEART", normalizedShape: "Heart" },
];
// Test-only thresholds. They are not the production EMERALD 4STEP rule, which is unconfirmed.
const TEST_ONLY_EMERALD_4STEP = [
  { rawShape: "EMERALD 4STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE" as const, ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 4STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE" as const, ratioMin: "1.400", ratioMax: null },
];

const serviceActor = () => ({
  userId: planner.user.id,
  scope: { countries: null, labs: null },
  requestId: "pink-worker",
  audit: async (client: any, input: any) => {
    await client.auditLog.create({ data: { actor: "pink-worker", actorUserId: planner.user.id, action: input.action, entity: input.entity, entityId: input.entityId ?? null, after: JSON.stringify(input.after ?? null), outcome: input.outcome ?? "SUCCESS" } });
  },
});

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureCountryRegistry(["IN", "BE"]);
  planner = await makeUser("pink.planner", "PLANNER");
  viewer = await makeUser("pink.viewer", "VIEWER");
  planningViewer = await makeUser("pink.pviewer", "PLANNING_VIEWER");
  admin = await makeUser("pink.admin", "ADMIN");
  root = await makeUser("pink.root", "SUPER_ADMIN");
  mapperA = await makeUser("pink.mapper.a", "PLANNER");
  mapperB = await makeUser("pink.mapper.b", "PLANNER");
  const code = `SARIN_MAPPER_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: "Sarin Mapping Manager", permissions: ["sarin.mapping.manage"] } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status}`);
  for (const u of [mapperA, mapperB]) {
    resetRateLimits();
    const r = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: ["PLANNER", code] } });
    if (r.status !== 200) throw new Error(`role assign failed ${r.status}`);
  }
  pinkSetId = await approvedSetViaApi([...PLAIN_RULES, ...TEST_ONLY_EMERALD_4STEP]);
  noEmeraldSetId = await approvedSetViaApi(PLAIN_RULES);
});
beforeEach(() => resetRateLimits());

const EXPECTED_CODES = [...Array.from({ length: 9 }, () => ["MK", "SL"]).flat(), "BP", "BP", "BP", ...Array(6).fill("BT")];
const EXPECTED_POSITIONS = [
  ...Array.from({ length: 9 }, (_, f) => [[3 * f + 1], [3 * f + 2, 3 * f + 3]]).flat(),
  [28, 29], [30, 31], [32, 33], [34, 35], [36, 37], [38, 39], [40, 41], [42, 43], [44, 45],
];

// =========================================================================================
describe("sarin pink: positional contract", () => {
  test("27 options cover the 45 positions exactly once, in physical order", () => {
    expect(SARIN_PINK_LAYOUT.map((s) => s.sequence)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(SARIN_PINK_LAYOUT.map((s) => s.code)).toEqual(EXPECTED_CODES);
    expect(SARIN_PINK_LAYOUT.map((s) => s.pieces.map((p) => p.position))).toEqual(EXPECTED_POSITIONS);
    expect(SARIN_PINK_LAYOUT.flatMap((s) => s.pieces.map((p) => p.position))).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    const count = (c: string) => SARIN_PINK_LAYOUT.filter((s) => s.code === c).length;
    expect([count("MK"), count("SL"), count("BP"), count("BT")]).toEqual([9, 9, 3, 6]);
    expect(SARIN_PINK_LAYOUT.filter((s) => s.code === "MK").map((s) => s.pieces[0].shape)).toEqual(FAMILY_SHAPES);
    expect(SARIN_PINK_LAYOUT.filter((s) => s.code === "SL").every((s) => s.pieces[1].shape === "Round")).toBe(true);
    expect(SARIN_PINK_LAYOUT.filter((s) => s.code === "BP").map((s) => s.pieces.map((p) => p.shape))).toEqual([["Emerald", "Round"], ["Oval", "Round"], ["Emerald", "Oval"]]);
    expect(SARIN_PINK_LAYOUT.filter((s) => s.code === "BT").map((s) => s.pieces.map((p) => p.shape))).toEqual(
      ["Round", "Oval", "Emerald", "Radiant", "Cushion Brilliant", "Antique Cushion"].map((s) => [s, s]),
    );
  });

  test("the planner places records by position only and refuses 44 or 46 records", () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ estimatedWeight: new Prisma.Decimal(i === 36 ? "0.554" : "0.550"), position: i + 1 }));
    const plan = planPinkStone(rows);
    expect(plan.map((o) => o.rows.map((r) => r.position))).toEqual(EXPECTED_POSITIONS);
    expect(plan.map((o) => o.pairWeightDifference?.toFixed(3) ?? null)).toEqual([...Array(21).fill(null), "0.000", "0.004", "0.000", "0.000", "0.000", "0.000"]);
    expect(() => planPinkStone(rows.slice(1))).toThrow();
    expect(() => planPinkStone([...rows, rows[0]])).toThrow();
  });

  test("the option-kind vocabulary is exactly what the database allows", async () => {
    const [row] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'SarinPlanOption_optionKind_check'`;
    expect(Array.from(row.def.matchAll(/'([A-Z_]+)'/g), (m) => m[1]).sort()).toEqual([...SARIN_PLAN_OPTION_KINDS].sort());
  });
});

// =========================================================================================
describe("sarin pink: valid stones become 27 options of 45 pieces", () => {
  test("two stones validate with only advisories and produce exact, traceable output", async () => {
    const k = kapan();
    const s1 = `${k}-111_M`;
    const s2 = `${k}-112_M`;
    const batchId = await uploadBatch(file([...pinkStone(s1, "4.000"), ...pinkStone(s2, "3.000")]));
    const v = await validate(batchId);
    expect([v.status, v.json.batch.status]).toEqual([200, "VALIDATED"]);
    expect([v.json.validation.lastCompletedAttempt.issues.total, v.json.validation.lastCompletedAttempt.issues.blocking]).toEqual([6, 0]);

    // Best Twin differences are advisories: visible, non-blocking, never labelled invalid.
    const advisories = await findings(batchId);
    expect(advisories.map((i) => [i.code, i.severity, i.blocking, i.block.sequence, i.sourceRowNumber, i.details])).toEqual([
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 1, 37, { firstPosition: 36, secondPosition: 37, difference: "0.001" }],
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 1, 39, { firstPosition: 38, secondPosition: 39, difference: "0.004" }],
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 1, 45, { firstPosition: 44, secondPosition: 45, difference: "0.002" }],
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 2, 82, { firstPosition: 36, secondPosition: 37, difference: "0.001" }],
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 2, 84, { firstPosition: 38, secondPosition: 39, difference: "0.004" }],
      ["BT_WEIGHT_VARIANCE_UNCONFIRMED", "WARNING", false, 2, 90, { firstPosition: 44, secondPosition: 45, difference: "0.002" }],
    ]);
    expect(/tolerance (is|was) (approved|confirmed)/i.test(JSON.stringify(advisories))).toBe(false);
    const completed = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_VALIDATION_COMPLETED", entityId: batchId } });
    expect(JSON.parse(completed.after!).advisoryCount).toBe(6);
    // EMERALD 4STEP resolved only through the explicit (test-only) conditional rules.
    const interp = (await read(listInterpretations, { batchId }, "?pageSize=500")).json.rows;
    expect([interp[9].rawShape, interp[9].normalizedShape, interp[9].mappingResult, interp[12].normalizedShape]).toEqual(["EMERALD 4STEP", "Asscher", "CONDITIONALLY_MAPPED", "Emerald"]);

    const g = await generate(batchId);
    expect([g.status, g.json.reused]).toEqual([201, false]);
    const version = g.json.output.version;
    expect([version.stoneType, version.counts, version.validationProfile, version.transformProfile, version.mappingSet.id]).toEqual([
      "PINK",
      { stones: 2, options: 54, pieces: 90 },
      SARIN_VALIDATION_PROFILE_VERSION,
      { version: "SARIN_PINK_TRANSFORM_V1", hash: SARIN_PINK_TRANSFORM_PROFILE_HASH },
      pinkSetId,
    ]);
    expect(SARIN_PINK_TRANSFORM_PROFILE.version).toBe("SARIN_PINK_TRANSFORM_V1");
    expect(g.json.output.content).toEqual({ mk: { options: 18, pieces: 18 }, sl: { options: 18, pieces: 36 }, bp: { options: 6, pieces: 12 }, bt: { options: 12, pieces: 24 } });
    const generated = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_OUTPUT_GENERATED", entityId: batchId } });
    expect([JSON.parse(generated.after!).stoneType, JSON.parse(generated.after!).advisories]).toEqual(["PINK", 6]);

    const stones = (await read(listStones, { batchId, versionId: version.id })).json.rows;
    expect(stones.map((s: any) => [s.sequence, s.stoneName, s.kapan, s.packet, s.signer, s.roughWeight, s.optionsByKind, s.options, s.pieces])).toEqual([
      [1, s1, k, "111", "M", "4.000", { MK: 9, SL: 9, BP: 3, BT: 6 }, 27, 45],
      [2, s2, k, "112", "M", "3.000", { MK: 9, SL: 9, BP: 3, BT: 6 }, 27, 45],
    ]);

    const options = (await read(listOptions, { batchId, versionId: version.id }, "?pageSize=500")).json.rows;
    const pieces = (await read(listPieces, { batchId, versionId: version.id }, "?pageSize=500")).json.rows;
    for (const [stone, offset] of [[1, 0], [2, 45]] as const) {
      const own = options.filter((o: any) => o.stone.sequence === stone);
      expect(own.map((o: any) => o.optionSequence)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
      expect(own.map((o: any) => o.kind)).toEqual(EXPECTED_CODES);
      expect(own.map((o: any) => o.pieceCount)).toEqual(EXPECTED_POSITIONS.map((p) => p.length));
      // Physical record → option, and deterministic piece order within each option.
      const placed = own.map((o: any) => pieces.filter((p: any) => p.option.id === o.id));
      expect(placed.map((ps: any[]) => ps.map((p) => p.sourceRowNumber - offset))).toEqual(EXPECTED_POSITIONS);
      expect(placed.map((ps: any[]) => ps.map((p) => p.pieceSequence))).toEqual(EXPECTED_POSITIONS.map((p) => p.map((_, i) => i + 1)));
      expect(placed.map((ps: any[]) => ps.map((p) => p.normalizedShape))).toEqual(SARIN_PINK_LAYOUT.map((s) => s.pieces.map((p) => p.shape)));
      // Best Twin: stored absolute difference, advisory only where it is not zero.
      const twins = own.filter((o: any) => o.kind === "BT");
      expect(twins.map((o: any) => [o.pairWeightDifference, o.advisory])).toEqual([
        ["0.000", null], ["0.001", "BT_WEIGHT_VARIANCE_UNCONFIRMED"], ["0.004", "BT_WEIGHT_VARIANCE_UNCONFIRMED"], ["0.000", null], ["0.000", null], ["0.002", "BT_WEIGHT_VARIANCE_UNCONFIRMED"],
      ]);
      expect(own.filter((o: any) => o.kind !== "BT").every((o: any) => o.pairWeightDifference === null && o.advisory === null)).toBe(true);
    }
    expect(pieces.map((p: any) => p.outputRow)).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    // Original Sarin shape kept; three-decimal weights.
    expect([pieces[9].rawShape, pieces[9].normalizedShape, pieces[9].estimatedWeight, pieces[9].ratio]).toEqual(["EMERALD 4STEP", "Asscher", "1.030", "1.000"]);

    // Yields: stored at ten places, displayed half-up at two. Rough 4.000 then 3.000.
    const y = (stone: number, seq: number) => options.find((o: any) => o.stone.sequence === stone && o.optionSequence === seq);
    expect([y(1, 1).totalEstimatedWeight, y(1, 1).yield]).toEqual(["1.000", { numerator: "1.000", denominator: "4.000", percent: "25.0000000000", display: "25.00" }]);
    expect([y(1, 2).totalEstimatedWeight, y(1, 2).yield.percent, y(1, 2).yield.display]).toEqual(["1.200", "30.0000000000", "30.00"]);
    expect([y(1, 21).totalEstimatedWeight, y(1, 21).yield.percent, y(1, 21).yield.display]).toEqual(["1.301", "32.5250000000", "32.53"]); // half-up
    expect([y(2, 1).yield.denominator, y(2, 1).yield.percent, y(2, 1).yield.display]).toEqual(["3.000", "33.3333333333", "33.33"]);
    expect([y(2, 3).totalEstimatedWeight, y(2, 3).yield.percent, y(2, 3).yield.display]).toEqual(["1.010", "33.6666666667", "33.67"]);
    // Responses carry results, not the calculation behind them.
    expect(/numerator \/|\* 100|SUM\(|SELECT|round\(/i.test(JSON.stringify(options))).toBe(false);
  });

  test("equal twin weights raise no advisory", async () => {
    const recs = [36, 38, 44].reduce((acc, p) => withAt(acc, p + 1, { est: acc[p - 1].est }), pinkStone(`${kapan()}-111_M`));
    const batchId = await validatedBatch(recs);
    expect(await findings(batchId)).toEqual([]);
    const versionId = (await generate(batchId)).json.output.version.id;
    const twins = (await read(listOptions, { batchId, versionId }, "?kind=BT")).json.rows;
    expect(twins.map((o: any) => [o.pairWeightDifference, o.advisory])).toEqual(Array(6).fill(["0.000", null]));
  });
});

// =========================================================================================
describe("sarin pink: blocking structure findings", () => {
  test("MK/SL candidate mismatch, non-Round remainder, wrong MK, BP and BT shapes are each blocking", async () => {
    let recs = pinkStone(`${kapan()}-111_M`);
    recs = withAt(recs, 3, { shape: "PEAR", ratio: "1.500" }); // SL remainder must be Round
    recs = withAt(recs, 5, { est: "1.011" }); // Pear SL primary: another candidate's weight
    recs = withAt(recs, 8, { clarity: "VS2" }); // Oval SL primary: another candidate's clarity
    recs = withAt(recs, 16, { shape: "HEART", ratio: "0.950" }); // Radiant MK holds a Heart
    recs = withAt(recs, 29, { shape: "OVAL", ratio: "1.350" }); // BP Emerald + Round holds an Oval
    recs = withAt(recs, 37, { shape: "ROUND", ratio: "1.000" }); // Oval twin holds a Round
    const batchId = await uploadBatch(file(recs));
    expect((await validate(batchId)).json.batch.status).toBe("NEEDS_REVIEW");
    expect(await pinkFindings(batchId)).toEqual([
      ["PINK_SL_REMAINDER_NOT_ROUND", 3, { position: 3, shape: "Pear" }],
      ["PINK_SL_PRIMARY_MISMATCH", 5, { position: 5, makeablePosition: 4, fields: ["estimatedWeight"] }],
      ["PINK_SL_PRIMARY_MISMATCH", 8, { position: 8, makeablePosition: 7, fields: ["clarity"] }],
      ["PINK_MK_SHAPE_MISMATCH", 16, { position: 16, expectedShape: "Radiant", shape: "Heart" }],
      ["PINK_SL_PRIMARY_MISMATCH", 17, { position: 17, makeablePosition: 16, fields: ["normalizedShape", "ratio"] }],
      ["PINK_BP_SHAPE_MISMATCH", 29, { position: 29, expectedShape: "Round", shape: "Oval" }],
      ["PINK_BT_SHAPE_MISMATCH", 37, { position: 37, expectedShape: "Oval", shape: "Round" }],
    ]);
    expect((await findings(batchId)).filter((i) => i.code.startsWith("PINK_")).every((i) => i.blocking && i.severity === "BLOCKING")).toBe(true);
    const refused = await generate(batchId);
    expect([refused.status, refused.json.error.code]).toEqual([422, "BLOCKING_FINDINGS_OPEN"]);
    expect(/SELECT|stack|at .*\.ts|regex/i.test(JSON.stringify(refused.json))).toBe(false);
    expect(await outputRows(batchId)).toEqual({ versions: 0, options: 0, pieces: 0 });
    expect(await auditCount("SARIN_OUTPUT_REJECTED", batchId)).toBe(1);
  });

  test("44 or 46 records, a missing, duplicated or reordered position are all refused", async () => {
    const cases: Array<[string, (r: Rec[]) => Rec[], unknown[]]> = [
      ["44 records", (r) => r.slice(0, 44), [["PINK_BLOCK_ROW_COUNT_INVALID", null, { rows: 44, requiredRows: 45 }]]],
      ["46 records", (r) => [...r, r[44]], [["PINK_BLOCK_ROW_COUNT_INVALID", null, { rows: 46, requiredRows: 45 }]]],
      ["missing position 10", (r) => r.filter((_, i) => i !== 9), [["PINK_BLOCK_ROW_COUNT_INVALID", null, { rows: 44, requiredRows: 45 }]]],
      ["duplicated position 10", (r) => [...r.slice(0, 10), r[9], ...r.slice(10)], [["PINK_BLOCK_ROW_COUNT_INVALID", null, { rows: 46, requiredRows: 45 }]]],
      [
        "positions 4 and 7 swapped",
        (r) => r.map((x, i) => (i === 3 ? r[6] : i === 6 ? r[3] : x)),
        [
          ["PINK_MK_SHAPE_MISMATCH", 4, { position: 4, expectedShape: "Pear", shape: "Oval" }],
          ["PINK_SL_PRIMARY_MISMATCH", 5, { position: 5, makeablePosition: 4, fields: ["normalizedShape", "estimatedWeight", "ratio"] }],
          ["PINK_MK_SHAPE_MISMATCH", 7, { position: 7, expectedShape: "Oval", shape: "Pear" }],
          ["PINK_SL_PRIMARY_MISMATCH", 8, { position: 8, makeablePosition: 7, fields: ["normalizedShape", "estimatedWeight", "ratio"] }],
        ],
      ],
    ];
    for (const [label, change, expected] of cases) {
      const batchId = await uploadBatch(file(change(pinkStone(`${kapan()}-111_M`))));
      const v = await validate(batchId);
      expect([label, v.json.batch.status]).toEqual([label, "NEEDS_REVIEW"]);
      expect([label, await pinkFindings(batchId)]).toEqual([label, expected]);
      expect([label, (await generate(batchId)).status]).toEqual([label, 422]);
    }
  });

  test("unusable values: zero or negative Rough Weight, oversized and over-precise weights, missing output values", async () => {
    const cases: Array<[string, (r: Rec[]) => Rec[], string[]]> = [
      ["zero rough", (r) => r.map((x) => ({ ...x, rough: "0.000" })), ["ROUGH_WEIGHT_INVALID"]],
      ["negative rough", (r) => r.map((x) => ({ ...x, rough: "-4.000" })), ["ROUGH_WEIGHT_INVALID"]],
      ["oversized weight", (r) => withAt(r, 1, { est: "1234567890.123" }), ["SOURCE_VALUE_QUARANTINED", "PINK_PLAN_ROW_UNUSABLE"]],
      ["over-precise weight", (r) => withAt(r, 1, { est: "1.0005" }), ["SOURCE_VALUE_QUARANTINED", "PINK_PLAN_ROW_UNUSABLE"]],
      ["missing weight", (r) => withAt(r, 1, { est: "" }), ["SOURCE_VALUE_QUARANTINED", "PINK_PLAN_ROW_UNUSABLE", "ESTIMATED_WEIGHT_MISSING"]],
      ["missing color", (r) => withAt(r, 40, { color: "" }), ["OUTPUT_FIELD_UNAVAILABLE"]],
    ];
    for (const [label, change, codes] of cases) {
      const batchId = await uploadBatch(file(change(pinkStone(`${kapan()}-111_M`))));
      expect([label, (await validate(batchId)).json.batch.status]).toEqual([label, "NEEDS_REVIEW"]);
      const got = new Set((await findings(batchId)).filter((i) => i.blocking).map((i) => i.code));
      expect([label, codes.every((c) => got.has(c))]).toEqual([label, true]);
      expect([label, (await generate(batchId)).status]).toEqual([label, 422]);
    }
    const zero = await db.sarinStoneBlock.findFirstOrThrow({ where: { batch: { sourceFile: { originalFileName: "pink.csv" } }, roughWeight: null } });
    expect(zero.roughWeight).toBe(null); // no Rough Weight is ever guessed
  });

  test("a non-Pink Stone Name and a repeated stone identity are blocking", async () => {
    const blue = await uploadBatch(file(pinkStone("691C-117 DC")));
    expect((await validate(blue)).json.batch.status).toBe("NEEDS_REVIEW");
    expect((await findings(blue)).map((i) => i.code)).toContain("STONE_NAME_TYPE_MISMATCH");
    expect((await generate(blue)).status).toBe(422);

    const k = kapan();
    const a = `${k}-111_M`;
    const repeated = await uploadBatch(file([...pinkStone(a), ...pinkStone(`${k}-112_M`), ...pinkStone(a)]));
    expect((await validate(repeated)).json.batch.status).toBe("NEEDS_REVIEW");
    const repeat = (await findings(repeated)).filter((i) => i.code === "STONE_NAME_REPEATED_NON_CONSECUTIVE");
    expect(repeat.map((i) => [i.block.sequence, i.details])).toEqual([[3, { firstBlockSequence: 1 }]]);
    expect((await generate(repeated)).status).toBe(422);
  });
});

// =========================================================================================
describe("sarin pink: EMERALD 4STEP needs an approved rule", () => {
  test("without a rule, Asscher and Emerald positions stay unresolved and output is refused", async () => {
    const batchId = await uploadBatch(file(pinkStone(`${kapan()}-111_M`)));
    expect((await validate(batchId, noEmeraldSetId)).json.batch.status).toBe("NEEDS_REVIEW");
    const interp = (await read(listInterpretations, { batchId }, "?pageSize=500")).json.rows;
    const emerald4 = interp.filter((r: any) => r.rawShape === "EMERALD 4STEP");
    expect(emerald4.map((r: any) => r.sourceRowNumber)).toEqual([10, 11, 13, 14, 28, 32, 38, 39]);
    expect(emerald4.every((r: any) => r.mappingResult === "UNMAPPED" && r.normalizedShape === null)).toBe(true); // never defaulted
    const codes = (await findings(batchId)).filter((i) => i.sourceRowNumber === 10).map((i) => i.code);
    expect(codes).toEqual(["SHAPE_UNMAPPED", "NORMALIZED_SHAPE_MISSING"]);
    const refused = await generate(batchId);
    expect([refused.status, refused.json.error.code]).toEqual([422, "BLOCKING_FINDINGS_OPEN"]);
  });

  test("a Ratio the approved rules cannot place is blocking, not guessed", async () => {
    const recs = withAt(withAt(pinkStone(`${kapan()}-111_M`), 13, { ratio: "1.200" }), 14, { ratio: "1.200" });
    const batchId = await uploadBatch(file(recs));
    expect((await validate(batchId)).json.batch.status).toBe("NEEDS_REVIEW");
    expect((await findings(batchId)).filter((i) => i.sourceRowNumber === 13).map((i) => i.code)).toEqual(["MAPPING_NO_CONDITIONAL_RULE", "NORMALIZED_SHAPE_MISSING"]);
    expect((await generate(batchId)).status).toBe(422);
  });

  test("no production EMERALD 4STEP rule is seeded", async () => {
    // The migration-seeded baseline is built from the confirmed shape master only.
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } }, select: { id: true } });
    expect(await db.sarinShapeMappingRule.count({ where: { mappingSetId: baseline.id, rawShapeKey: "EMERALD 4STEP" } })).toBe(0);
  });
});

// =========================================================================================
describe("sarin pink: idempotency, concurrency and rollback", () => {
  const manyStones = (count: number) => {
    const k = kapan();
    return Array.from({ length: count }, (_, s) => pinkStone(`${k}-${String(s).padStart(3, "0")}_M`)).flat();
  };

  test("the same request returns the same version", async () => {
    const batchId = await validatedBatch(pinkStone(`${kapan()}-111_M`));
    const first = await generate(batchId);
    const again = await generate(batchId);
    expect([first.status, again.status, again.json.reused, again.json.output.version.id]).toEqual([201, 200, true, first.json.output.version.id]);
    expect(await outputRows(batchId)).toEqual({ versions: 1, options: 27, pieces: 45 });
    expect([await auditCount("SARIN_OUTPUT_GENERATED", batchId), await auditCount("SARIN_OUTPUT_REUSED", batchId)]).toEqual([1, 1]);
  });

  test("five concurrent requests produce exactly one version", async () => {
    const batchId = await validatedBatch(manyStones(20));
    resetRateLimits();
    const results = await Promise.all(Array.from({ length: 5 }, () => call(generateOutput, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } })));
    const outcomes = results.map((r) => (r.status === 201 ? "NEW" : r.status === 200 && r.json.reused ? "REUSED" : r.json.error?.code));
    expect(outcomes.filter((o) => o === "NEW")).toHaveLength(1);
    expect(outcomes.every((o) => o === "NEW" || o === "REUSED" || o === "OUTPUT_GENERATION_IN_PROGRESS")).toBe(true);
    expect(await outputRows(batchId)).toEqual({ versions: 1, options: 20 * 27, pieces: 20 * 45 });
  });

  test("a failure part-way through writing keeps nothing; a retry succeeds", async () => {
    const batchId = await validatedBatch(manyStones(4));
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_inject_pink_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW."outputRowSequence" = 120 THEN RAISE EXCEPTION 'injected pink failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_pink_failure BEFORE INSERT ON "SarinPlanPiece" FOR EACH ROW EXECUTE FUNCTION test_inject_pink_failure()`);
    let failure: any;
    try {
      // One stone per round: two stones are written before the failure in the third.
      failure = await generateSarinOutput(serviceActor(), batchId, {}, { ...SARIN_OUTPUT_CONFIG, writeBatch: 1 }).catch((e) => e);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_pink_failure ON "SarinPlanPiece"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_pink_failure()`);
    }
    expect([failure.status, failure.code, /injected/.test(failure.message)]).toEqual([500, "OUTPUT_NOT_GENERATED", false]);
    expect(await outputRows(batchId)).toEqual({ versions: 0, options: 0, pieces: 0 });
    expect(await auditCount("SARIN_OUTPUT_FAILED", batchId)).toBe(1);
    const retry = await generate(batchId);
    expect([retry.status, retry.json.output.version.counts]).toEqual([201, { stones: 4, options: 108, pieces: 180 }]);
  });
});

// =========================================================================================
describe("sarin pink: database integrity", () => {
  test("the database refuses wrong Pink counts, Blue/White kinds and a wrong twin difference", async () => {
    const batchId = await validatedBatch(pinkStone(`${kapan()}-111_M`));
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId, status: "COMPLETED" }, orderBy: { attemptNumber: "desc" } });
    const block = await db.sarinStoneBlock.findFirstOrThrow({ where: { batchId } });
    const version = (optionCount: number) => ({
      batchId, validationAttemptId: attempt.id, shapeMappingSetId: pinkSetId, validationProfileVersion: attempt.validationProfileVersion, transformProfileVersion: "SARIN_PINK_TRANSFORM_V1",
      transformProfileHash: "a".repeat(64), inputsHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), versionNumber: 1, stoneType: "PINK", generatedByUserId: "u", stoneCount: 1, optionCount, pieceCount: 45,
    });
    const option = (outputVersionId: string, o: Partial<Prisma.SarinPlanOptionUncheckedCreateInput>) => ({
      outputVersionId, batchId, stoneBlockId: block.id, optionSequence: 22, optionKind: "BT", pieceCount: 2, totalEstimatedWeight: "1.101", yieldNumerator: "1.101", yieldDenominator: "4.000",
      yieldPercent: "27.525", firstOutputRow: 1, lastOutputRow: 2, pairWeightDifference: "0.000", ...o,
    });
    await expect(db.$transaction(async (tx) => { await tx.sarinOutputVersion.create({ data: version(26) }); })).rejects.toThrow(/pink_counts_check/);
    await expect(
      db.$transaction(async (tx) => {
        const v = await tx.sarinOutputVersion.create({ data: version(27) });
        await tx.sarinPlanOption.create({ data: option(v.id, { optionKind: "MAIN", mainOrdinal: 1, pieceCount: 1, lastOutputRow: 1, pairWeightDifference: null, totalEstimatedWeight: "0.550", yieldNumerator: "0.550", yieldPercent: "13.75" }) });
      }),
    ).rejects.toThrow(/stone type/);
    // Twins at positions 36 and 37 weigh 0.550 and 0.551: a recorded 0.000 is refused.
    const rows = await db.sarinSourceRow.findMany({ where: { batchId, sourceRowNumber: { in: [36, 37] } }, orderBy: { sourceRowNumber: "asc" } });
    const interp = await db.sarinRowInterpretation.findMany({ where: { attemptId: attempt.id, sourceRowNumber: { in: [36, 37] } }, orderBy: { sourceRowNumber: "asc" } });
    await expect(
      db.$transaction(async (tx) => {
        const v = await tx.sarinOutputVersion.create({ data: version(27) });
        const o = await tx.sarinPlanOption.create({ data: option(v.id, {}) });
        for (const [i, r] of rows.entries()) {
          await tx.sarinPlanPiece.create({
            data: {
              outputVersionId: v.id, planOptionId: o.id, pieceSequence: i + 1, batchId, sourceRowId: r.id, sourceRowNumber: r.sourceRowNumber, outputRowSequence: i + 1,
              rawShape: r.shapeRaw!, normalizedShape: interp[i].normalizedShape!, mappingRuleId: interp[i].mappingRuleId!, estimatedWeight: r.estimatedWeight!, clarity: r.clarity!, color: r.color!,
              depthPct: r.depthPct!, ratio: r.ratio!, length: r.length!, width: r.width!, depthMm: r.depthMm!,
            },
          });
        }
      }),
    ).rejects.toThrow(/exact weight difference/);
    expect(await outputRows(batchId)).toEqual({ versions: 0, options: 0, pieces: 0 });
  });
});

// =========================================================================================
describe("sarin pink: authorization, scope and safe responses", () => {
  test("validation and generation need their own permissions; previews need sarin.import.read", async () => {
    const batchId = await uploadBatch(file(pinkStone(`${kapan()}-111_M`)));
    expect((await call(validateImport, { method: "POST", body: { mappingSetId: pinkSetId }, params: { batchId } })).status).toBe(401);
    for (const u of [viewer, planningViewer, admin]) expect([u.user.username, (await validate(batchId, pinkSetId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect((await validate(batchId)).json.batch.status).toBe("VALIDATED");
    expect((await call(generateOutput, { method: "POST", body: {}, params: { batchId } })).status).toBe(401);
    for (const u of [viewer, planningViewer, admin]) expect([u.user.username, (await generate(batchId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect((await outputRows(batchId)).versions).toBe(0);
    const versionId = (await generate(batchId)).json.output.version.id;
    for (const [h, params] of [[listOutputs, { batchId }], [getOutput, { batchId, versionId }], [listStones, { batchId, versionId }], [listOptions, { batchId, versionId }], [listPieces, { batchId, versionId }]] as const) {
      expect((await read(h, params, "", planningViewer.cookie)).status).toBe(200);
      expect((await read(h, params, "", viewer.cookie)).status).toBe(403);
    }
    // Client-supplied actor, plan codes or yields are refused.
    for (const body of [{ userId: "x" }, { options: [{ kind: "MK" }] }, { yieldPercent: "99" }]) expect((await generate(batchId, planner.cookie, body)).status).toBe(400);
    expect((await read(listOptions, { batchId, versionId }, "?kind=XX")).status).toBe(400);
  });

  test("an out-of-scope Pink import is a 404 everywhere", async () => {
    const be = await validatedBatch(pinkStone(`${kapan()}-111_M`), { country: "BE" });
    const versionId = (await generate(be)).json.output.version.id;
    const scoped = await makeUser("pink.scoped.in", "PLANNER");
    await db.userAccessScope.deleteMany({ where: { userId: scoped.user.id } });
    await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "COUNTRY", value: "IN" } });
    expect((await validate(be, pinkSetId, scoped.cookie)).status).toBe(404);
    expect((await generate(be, scoped.cookie)).status).toBe(404);
    for (const [h, params] of [[listOutputs, { batchId: be }], [getOutput, { batchId: be, versionId }], [listStones, { batchId: be, versionId }], [listOptions, { batchId: be, versionId }], [listPieces, { batchId: be, versionId }]] as const) {
      expect((await read(h, params, "", scoped.cookie)).status).toBe(404);
    }
  });
});
