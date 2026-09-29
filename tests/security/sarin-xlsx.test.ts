// Sarin structured workbook (.xlsx) export and Phase 8 hardening: the client column
// sequence and layout for Blue, White and Pink, formats, merges, stone boundaries, safe
// cell content, no formulas / macros / links / hidden sheets, row-limit refusal,
// concurrency, cleanup after a failure, audit, RBAC and scope; plus explicit approval
// assignment and explicit mapping-version selection.
//
// Requests go through the real route handlers against the isolated planning_sectest
// database. Workbooks are inspected with a parser (tests/security/workbook-inspect.ts),
// never with Excel. Every fixture is synthetic; no client workbook content is copied.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { inspectWorkbook, type InspectedWorkbook } from "./workbook-inspect";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { POST as generateOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/route";
import { GET as listOptions } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/options/route";
import { GET as exportCsv } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/export/route";
import { GET as exportWorkbook } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/workbook/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { databaseWorkbookSource, exportOutputWorkbook, WORKBOOK_HEADERS, XLSX_CONTENT_TYPE, type WorkbookSource } from "@/lib/sarin/output-workbook";
import { effectiveSnapshotId, applyCatalog, type CatalogRule } from "./sarin-catalog";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, admin: User, planner: User, reader: User, viewer: User, mapper: User, scoped: User;
const COMMON_RULES: CatalogRule[] = [
  { rawShape: "ROUND", normalizedShape: "Round" }, { rawShape: "PEAR", normalizedShape: "Pear" }, { rawShape: "OVAL", normalizedShape: "Oval" },
  { rawShape: "RADIANT", normalizedShape: "Radiant" }, { rawShape: "CUSHION", normalizedShape: "Cushion Brilliant" }, { rawShape: "ANTIQUE CUSHION", normalizedShape: "Antique Cushion" }, { rawShape: "HEART", normalizedShape: "Heart" },
];
// Test-only EMERALD 4STEP thresholds: never a production rule.
const PINK_RULES: CatalogRule[] = [
  ...COMMON_RULES,
  { rawShape: "EMERALD 4STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 4STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.400" },
];

// ---- synthetic records ---------------------------------------------------------------------
interface Rec { name: string; rough?: string; shape?: string; est?: string; clarity?: string; ratio?: string }
const line = (r: Rec) => [r.name, r.rough ?? "3.000", r.shape ?? "ROUND", r.est ?? "1.500", r.clarity ?? "VS1", "G", "61.6", r.ratio ?? "1.000", "7.62", "7.58", "4.69"].join(",");
const file = (recs: Rec[]) => new TextEncoder().encode(recs.map(line).join("\n") + "\n");
const rows = (name: string, ests: string[], o: Partial<Rec> = {}) => ests.map((est) => ({ ...o, name, est }));
let nonce = 0;
const uniq = () => String(++nonce).padStart(3, "0");

async function upload(recs: Rec[], fields: Record<string, string> = {}) {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([file(recs) as BlobPart], "sarin.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ packetType: "BLUE", planningDate: "2026-09-28", ...fields })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(new Request(URL_, { method: "POST", headers: { cookie: planner.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }), { params: Promise.resolve({}) } as never);
  const json = (await res.json()) as any;
  if (res.status !== 201) throw new Error(`upload ${res.status} ${JSON.stringify(json)}`);
  return json.batch.id as string;
}
const post = (h: any, cookie: string, body: unknown, params: Record<string, string> = {}) => {
  resetRateLimits();
  return call(h, { method: "POST", cookie, body, params });
};
/** Uploads, checks against `rules` made the catalog in effect, and generates. */
async function outputOf(recs: Rec[], fields: Record<string, string> = {}, rules = COMMON_RULES) {
  const batchId = await upload(recs, fields);
  await applyCatalog(mapper.cookie, rules);
  const v = await post(validateImport, planner.cookie, {}, { batchId });
  if (v.json.batch?.status !== "VALIDATED") throw new Error(`validation ${v.status} ${JSON.stringify(v.json.batch?.status ?? v.json)}`);
  const g = await post(generateOutput, planner.cookie, {}, { batchId });
  if (g.status !== 201) throw new Error(`generate ${g.status}`);
  return { batchId, versionId: g.json.output.version.id as string };
}
async function download(handler: any, batchId: string, versionId: string, cookie?: string) {
  resetRateLimits();
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  const res = await handler(new Request(`${URL_}/${batchId}/outputs/${versionId}/x`, { headers }), { params: Promise.resolve({ batchId, versionId }) } as never);
  return { status: res.status, headers: res.headers, bytes: new Uint8Array(await res.arrayBuffer()) };
}
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `XLSX_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Test ${name}`, permissions } });
  if (role.status !== 200) throw new Error(`role ${role.status}`);
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("assign");
  return u;
}
const actor = (u: User) => ({
  userId: u.user.id,
  scope: { countries: null, labs: null },
  requestId: "xlsx-test",
  audit: async (client: any, input: any) => {
    await client.auditLog.create({ data: { actor: "xlsx-test", actorUserId: u.user.id, action: input.action, entity: input.entity, entityId: input.entityId ?? null, after: JSON.stringify(input.after ?? null), outcome: input.outcome ?? "SUCCESS" } });
  },
});
const tempDirs = () => readdirSync(tmpdir()).filter((n) => n.startsWith("sarin-xlsx-")).length;
const values = (r: Array<{ v: unknown } | null>) => r.map((c) => (c === null ? null : c.v));

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("xl.root", "SUPER_ADMIN");
  admin = await makeUser("xl.admin", "ADMIN");
  planner = await makeUser("xl.planner", "PLANNER");
  reader = await makeUser("xl.reader", "PLANNING_VIEWER");
  viewer = await makeUser("xl.viewer", "VIEWER");
  mapper = await userWith("xl.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  scoped = await makeUser("xl.scoped", "PLANNER");
  await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "LAB", value: "GIA" } });
});
beforeEach(async () => {
  resetRateLimits();
  await applyCatalog(mapper.cookie, COMMON_RULES);
});

// =========================================================================================
describe("sarin xlsx: Phase 8 hardening", () => {
  test("mapping authority is read and manage only; there is no approval step", async () => {
    const perms = async (u: User) => {
      resetRateLimits();
      return ((await call(me, { cookie: u.cookie, path: "/api/auth/me" })).json.user.permissions as string[]).filter((p) => p.startsWith("sarin.mapping"));
    };
    expect((await perms(root)).sort()).toEqual(["sarin.mapping.manage", "sarin.mapping.read"]);
    expect(await perms(admin)).toEqual([]);
    expect((await perms(mapper)).sort()).toEqual(["sarin.mapping.manage", "sarin.mapping.read"]);
  });

  test("processing always uses the mappings in effect; a caller cannot name another snapshot", async () => {
    const batchId = await upload(rows(`7${uniq()}A-001 DC`, Array(17).fill("1.500")));
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { sourceSystem_version: { sourceSystem: "SARIN", version: 1 } }, select: { id: true } });
    for (const body of [{ mappingSetId: null }, { mappingSetId: "" }, { mappingSetId: "latest" }, { mappingSetId: baseline.id }]) {
      const r = await post(validateImport, planner.cookie, body, { batchId });
      expect([JSON.stringify(body), r.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await db.sarinValidationAttempt.count({ where: { batchId } })).toBe(0);
    const effective = await effectiveSnapshotId();
    const ok = await post(validateImport, planner.cookie, {}, { batchId });
    expect(ok.json.validation.lastCompletedAttempt.mappingSet.id).toBe(effective);
    expect((await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId } })).shapeMappingSetId).toBe(effective);
  });
});

// =========================================================================================
describe("sarin xlsx: Blue and White layout", () => {
  test("Blue: one sheet per Kapan, 17 main plans, merged additional groups, stone boundaries", async () => {
    const k1 = `6${uniq()}B`;
    const k2 = `6${uniq()}C`;
    const recs = [
      ...rows(`${k1}-001 DC`, [...Array(17).fill("1.500"), "0.500", "0.400", "0.600", "0.300"]),
      ...rows(`${k1}-002 DC`, Array(17).fill("1.100"), { rough: "2.750" }),
      ...rows(`${k2}-0450 JV`, [...Array(17).fill("0.900"), "0.200"], { rough: "4.000" }),
    ];
    recs[16] = { ...recs[16], clarity: "=HYPERLINK(1)" };
    const { batchId, versionId } = await outputOf(recs);
    const r = await download(exportWorkbook, batchId, versionId, planner.cookie);
    expect([r.status, r.headers.get("content-type"), r.headers.get("content-disposition"), r.headers.get("x-content-type-options"), r.headers.get("x-sarin-export-rows")]).toEqual([
      200, XLSX_CONTENT_TYPE, 'attachment; filename="sarin-output-v1-blue-2026-09-28.xlsx"', "nosniff", "56",
    ]);
    const wb = inspectWorkbook(r.bytes);
    expect(wb.sheetNames).toEqual([k1, k2]);
    const s1 = wb.rows(k1);
    expect(values(s1[0])).toEqual([...WORKBOOK_HEADERS]);
    expect(s1.length).toBe(1 + 21 + 17);
    // First row of the first stone: identity once, date as a real date, weights to three places.
    expect(s1[1].map((c) => c && [c.t, c.v, c.z ?? null])).toEqual([
      ["n", 1, null], ["n", 46293, "dd\\-mm\\-yyyy"], ["s", "DC", "@"], ["n", 1, null], ["s", k1, "@"], ["s", "001", "@"], ["n", 3, "0.000"], null,
      ["s", "Round", "@"], ["n", 1.5, "0.000"], ["s", "VS1", "@"], ["s", "G", "@"], ["n", 61.6, "0.00"], ["n", 1, "0.00"], ["n", 7.58, "0.00"], ["n", 7.62, "0.00"], ["n", 4.69, "0.00"], ["n", 0.5, "0.00%"], null,
    ]);
    // Continuation rows: blank Date, Signer, stone NO. and Kapan; Packet and Rough Weight repeat.
    expect(values(s1[2]).slice(0, 8)).toEqual([2, null, null, null, null, "001", 3, null]);
    expect(s1.slice(1, 22).map((c) => c[0]!.v)).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    expect(s1.slice(1, 18).every((c) => c[7] === null)).toBe(true); // main plans: H blank
    expect([s1[18][7]!.v, s1[19][7], s1[20][7]!.v, s1[21][7]]).toEqual(["2 Pcs", null, "2 Pcs", null]);
    // Group yield once, from the stored value (0.900/3.000 = 30.00 %, 0.900 again for 0.6+0.3).
    expect([s1[18][17]!.v, s1[19][17], s1[20][17]!.v, s1[21][17]]).toEqual([0.3, null, 0.3, null]);
    // Second stone: numbering restarts, stone NO. 2, its own Rough Weight.
    expect(values(s1[22]).slice(0, 7)).toEqual([1, 46293, "DC", 2, k1, "002", 2.75]);
    expect(wb.merges(k1)).toEqual(["H19:H20", "H21:H22", "R19:R20", "R21:R22"]);
    // Second Kapan sheet: stone NO. restarts; a one-piece group is labelled but not merged.
    const s2 = wb.rows(k2);
    expect(values(s2[1]).slice(0, 7)).toEqual([1, 46293, "JV", 1, k2, "0450", 4]);
    expect([s2[18][7]!.v, s2[18][17]!.v]).toEqual(["1 Pcs", 0.05]);
    expect(wb.merges(k2)).toEqual([]);
    // Formula-like text is kept as text, marked with the quote prefix, never a formula.
    expect([s1[17][10]!.t, s1[17][10]!.v, wb.quotePrefixed(wb.styleOf(1, "K18")!)]).toEqual(["s", "=HYPERLINK(1)", true]);
    expect(wb.quotePrefixed(wb.styleOf(1, "K2")!)).toBe(false);
    // OK column is present and empty everywhere.
    expect(s1.slice(1).every((c) => c[18] === null)).toBe(true);
    // Stored yield, not recomputed: matches the API's display value for every option.
    const options = (await call(listOptions, { cookie: planner.cookie, path: "/api/x?pageSize=500&stone=1", params: { batchId, versionId } })).json.rows;
    const shown = s1.slice(1, 22).map((c) => c[17]).filter((c) => c !== null).map((c) => (c!.v as number).toFixed(4));
    expect(shown).toEqual(options.map((o: any) => (Number(o.yield.display) / 100).toFixed(4)));
  });

  test("White: 32 main plans before its additional groups; Packet leading zeros kept", async () => {
    const k = `2${uniq()}`;
    const { batchId, versionId } = await outputOf(rows(`${k}-0007 HA`, [...Array(32).fill("0.250"), "0.900", "0.800", "1.000"], { rough: "10.000" }), { packetType: "WHITE" });
    const wb = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    const s = wb.rows(k);
    expect(s.length).toBe(1 + 35);
    expect(s.slice(1, 33).every((c) => c[7] === null && c[17] !== null)).toBe(true);
    expect([s[33][7]!.v, s[34][7], s[35][7]!.v]).toEqual(["2 Pcs", null, "1 Pcs"]);
    expect([s[33][17]!.v, s[35][17]!.v]).toEqual([0.17, 0.1]);
    expect(wb.merges(k)).toEqual(["H34:H35", "R34:R35"]);
    expect(s.slice(1).every((c) => c[5]!.t === "s" && c[5]!.v === "0007")).toBe(true);
    expect([s[1][2]!.v, s[1][4]!.v]).toEqual(["HA", k]);
  });
});

// =========================================================================================
describe("sarin xlsx: Pink layout", () => {
  test("27 options over 45 rows: MK single, SL/BP/BT merged pairs, codes in H", async () => {
    const name = `6${uniq()}-111_M`;
    const fam: Array<[string, string]> = [["ROUND", "1.000"], ["PEAR", "1.500"], ["OVAL", "1.350"], ["EMERALD 4STEP", "1.000"], ["EMERALD 4STEP", "1.435"], ["RADIANT", "1.200"], ["CUSHION", "1.050"], ["ANTIQUE CUSHION", "1.100"], ["HEART", "0.950"]];
    const recs: Rec[] = [];
    fam.forEach(([shape, ratio], i) => recs.push({ name, shape, ratio, est: `0.1${i}0` }, { name, shape, ratio, est: `0.1${i}0` }, { name, est: "0.040" }));
    for (const [shape, ratio] of [["EMERALD 4STEP", "1.435"], ["ROUND", "1.000"], ["OVAL", "1.350"], ["ROUND", "1.000"], ["EMERALD 4STEP", "1.435"], ["OVAL", "1.350"]]) recs.push({ name, shape, ratio, est: "0.050" });
    for (const [shape, ratio] of [["ROUND", "1.000"], ["OVAL", "1.350"], ["EMERALD 4STEP", "1.435"], ["RADIANT", "1.200"], ["CUSHION", "1.050"], ["ANTIQUE CUSHION", "1.100"]]) recs.push({ name, shape, ratio, est: "0.060" }, { name, shape, ratio, est: shape === "OVAL" ? "0.064" : "0.060" });
    const { batchId, versionId } = await outputOf(recs.map((r) => ({ ...r, rough: "0.500" })), { packetType: "PINK" }, PINK_RULES);
    const wb = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    expect(wb.sheetNames).toEqual(["Sheet1"]);
    const s = wb.rows("Sheet1");
    expect(s.length).toBe(46);
    const codes = s.slice(1).map((c) => (c[7] === null ? "" : c[7].v));
    expect(codes).toEqual([
      ...Array.from({ length: 9 }, () => ["MK", "SL", ""]).flat(),
      "BP", "", "BP", "", "BP", "",
      ...Array.from({ length: 6 }, () => ["BT", ""]).flat(),
    ]);
    expect(s.slice(1).map((c) => c[0]!.v)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    const merges = wb.merges("Sheet1");
    expect(merges.length).toBe(36);
    expect(merges.filter((m) => m.startsWith("H"))).toEqual([
      ...Array.from({ length: 9 }, (_, i) => `H${3 * i + 3}:H${3 * i + 4}`),
      "H29:H30", "H31:H32", "H33:H34", "H35:H36", "H37:H38", "H39:H40", "H41:H42", "H43:H44", "H45:H46",
    ].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
    // MK yields on their own row; SL yield once over its two rows (0.100 + 0.040 over 0.500).
    expect([s[1][17]!.v, s[2][17]!.v, s[3][17]]).toEqual([0.2, 0.28, null]);
    expect(s.slice(1).map((c) => c[8]!.v).slice(9, 15)).toEqual(["Asscher", "Asscher", "Round", "Emerald", "Emerald", "Round"]);
    // The twin weight difference stays in the application: no advisory text in the workbook.
    expect(JSON.stringify(s).includes("Twin")).toBe(false);
  });
});

// =========================================================================================
describe("sarin xlsx: workbook safety and presentation", () => {
  test("no formulas, macros, external links, hidden sheets or extra parts; frozen header; landscape print with titles", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}D-001 DC`, [...Array(17).fill("1.500"), "0.200", "0.100"]));
    const wb = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    expect(wb.parts.slice().sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const all = wb.parts.map((p) => wb.part(p)).join("\n");
    expect([/<f[ >]/.test(all), /vbaProject|externalLink|oleObject|activeX|macro/i.test(all), /state="(hidden|veryHidden)"/.test(all), /<autoFilter/.test(all)]).toEqual([false, false, false, false]);
    const sheet = wb.sheetXml(1);
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
    expect(wb.part("xl/workbook.xml")).toMatch(/<definedName name="_xlnm.Print_Titles" localSheetId="0">'[^']+'!\$1:\$1<\/definedName>/);
    expect(wb.widths(wb.sheetNames[0]).length).toBe(19);
    expect(wb.widths(wb.sheetNames[0])[8]).toBeGreaterThan(20); // Shape column is wide enough for long names
    // Document properties say what the file is; they carry no database identifiers.
    const core = wb.part("docProps/core.xml");
    expect(core).toContain("Not an approved manufacturing plan.");
    expect(core.includes(versionId) || core.includes(batchId)).toBe(false);
    // Which mapping snapshot produced it is kept in the database and audit, not printed in the file.
    expect(/mapping/i.test(wb.sheetNames.map((n) => JSON.stringify(wb.rows(n))).join("") + core)).toBe(false);
  });

  test("the same version exports identically every time, also concurrently", async () => {
    const { batchId, versionId } = await outputOf([...rows(`6${uniq()}E-001 DC`, [...Array(17).fill("1.200"), "0.400", "0.300"]), ...rows(`6${uniq()}E-002 DC`, Array(17).fill("0.800"))]);
    resetRateLimits();
    const results = await Promise.all(Array.from({ length: 4 }, () => exportWorkbook(new Request(`${URL_}/x`, { headers: { cookie: planner.cookie } }), { params: Promise.resolve({ batchId, versionId }) } as never)));
    const sheets = await Promise.all(results.map(async (r) => {
      expect(r.status).toBe(200);
      const wb = inspectWorkbook(new Uint8Array(await r.arrayBuffer()));
      return JSON.stringify(wb.sheetNames.map((n) => [n, wb.rows(n), wb.merges(n)]));
    }));
    expect(new Set(sheets).size).toBe(1);
  });
});

// =========================================================================================
describe("sarin xlsx: access, limits, failures and audit", () => {
  test("export permission, scope and version checks; CSV stays as it was", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}F-001 DC`, Array(17).fill("1.500")), { labId: "IGI" });
    expect((await download(exportWorkbook, batchId, versionId)).status).toBe(401);
    for (const u of [reader, viewer, admin]) expect([u.user.username, (await download(exportWorkbook, batchId, versionId, u.cookie)).status]).toEqual([u.user.username, 403]);
    expect((await download(exportWorkbook, batchId, versionId, scoped.cookie)).status).toBe(404);
    expect((await download(exportWorkbook, batchId, "nonexistentversion", planner.cookie)).status).toBe(404);
    const other = await outputOf(rows(`6${uniq()}F-002 DC`, Array(17).fill("1.500")));
    expect((await download(exportWorkbook, other.batchId, versionId, planner.cookie)).status).toBe(404);
    const csv = await download(exportCsv, batchId, versionId, planner.cookie);
    const text = new TextDecoder().decode(csv.bytes).split("\r\n");
    expect([csv.status, csv.headers.get("content-type"), text[0], text[4].split(",").length]).toEqual([200, "text/csv; charset=utf-8", '"Sarin structured output: transformed Sarin candidate data. Not an approved manufacturing plan."', 26]);
    // The notice lines keep their places; none names the mapping snapshot.
    expect([text[2].startsWith('"Generated '), /mapping/i.test(text.slice(0, 4).join(""))]).toEqual([true, false]);
    const output = await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: versionId }, select: { shapeMappingSetId: true } });
    expect(output.shapeMappingSetId).toBe(await effectiveSnapshotId());
  });

  test("a superseded version remains exportable exactly as it was", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}G-001 DC`, Array(17).fill("1.500")));
    const before = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    await applyCatalog(mapper.cookie, [...COMMON_RULES, { rawShape: "HEXAGON", normalizedShape: "Kite" }]);
    await post(validateImport, planner.cookie, {}, { batchId });
    const v2 = (await post(generateOutput, planner.cookie, {}, { batchId })).json.output.version;
    expect(v2.versionNumber).toBe(2);
    const old = await download(exportWorkbook, batchId, versionId, planner.cookie);
    const after = inspectWorkbook(old.bytes);
    expect([old.status, old.headers.get("content-disposition")]).toEqual([200, 'attachment; filename="sarin-output-v1-blue-2026-09-28.xlsx"']);
    expect(JSON.stringify(after.sheetNames.map((n) => after.rows(n)))).toBe(JSON.stringify(before.sheetNames.map((n) => before.rows(n))));
    expect(after.part("docProps/core.xml")).toContain("Output version 1");
  });

  test("an output over the row limit is refused and audited, never cut short", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}H-001 DC`, Array(17).fill("1.500")));
    await expect(exportOutputWorkbook(actor(planner), batchId, versionId, { maxRows: 16 })).rejects.toThrow(/more than the 16/);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_OUTPUT_EXPORT_FAILED", entityId: batchId } });
    expect([audit.outcome, JSON.parse(audit.after!).code, JSON.parse(audit.after!).format]).toEqual(["FAILED", "EXPORT_TOO_LARGE", "XLSX"]);
  });

  test("a failure while writing leaves no temporary file and is audited; success is audited with its row count", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}I-001 DC`, Array(17).fill("1.500")));
    const before = tempDirs();
    const failing: WorkbookSource = { stones: databaseWorkbookSource.stones, pieces: async () => { throw new Error("injected read failure"); } };
    const err = await exportOutputWorkbook(actor(planner), batchId, versionId, { source: failing }).catch((e) => e);
    expect([err.status, err.code, /injected/.test(err.message)]).toEqual([500, "EXPORT_NOT_GENERATED", false]);
    expect(tempDirs()).toBe(before);
    const failed = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_OUTPUT_EXPORT_FAILED", entityId: batchId } });
    expect(JSON.parse(failed.after!).code).toBe("EXPORT_NOT_GENERATED");
    expect((await download(exportWorkbook, batchId, versionId, planner.cookie)).status).toBe(200);
    expect(tempDirs()).toBe(before);
    const ok = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_OUTPUT_EXPORTED", entityId: batchId } });
    expect([ok.actorUserId, JSON.parse(ok.after!)]).toEqual([planner.user.id, { outputVersionId: versionId, versionNumber: 1, format: "XLSX", rows: 17 }]);
    expect(ok.after!.length).toBeLessThan(200); // no workbook content in the audit
  });
});

// =========================================================================================
// The output area is A:S. Excel paints every cell that names no style with cellXfs[0], so
// that entry must be plain; everything else — cells, merges, fills, used range and print
// area — must stay inside A:S and the written rows.
const COLUMN_S = 19;
const columnNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const cellXfs = (wb: InspectedWorkbook) => (wb.part("xl/styles.xml").match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "").match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) ?? [];
const fillOf = (xf: string) => Number(xf.match(/fillId="(\d+)"/)?.[1] ?? 0);
const cellsOf = (xml: string) => [...xml.matchAll(/<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?/g)].map((m) => ({ col: columnNumber(m[1]), row: Number(m[2]), ref: `${m[1]}${m[2]}`, style: m[3] === undefined ? 0 : Number(m[3]) }));

/** Every A:S boundary fact of one workbook, per sheet, for exact comparison. */
function boundaryOf(wb: InspectedWorkbook) {
  const xfs = cellXfs(wb);
  const workbookXml = wb.part("xl/workbook.xml");
  return wb.sheetNames.map((name, i) => {
    const xml = wb.sheetXml(i + 1);
    const rowTags = [...xml.matchAll(/<row [^>]*>/g)].map((m) => m[0]);
    const lastRow = Math.max(...rowTags.map((t) => Number(t.match(/ r="(\d+)"/)![1])));
    const cells = cellsOf(xml);
    const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)].map((m) => ({ from: columnNumber(m[1]), to: columnNumber(m[3]), last: Number(m[4]) }));
    const cols = [...xml.matchAll(/<col [^>]*\/>/g)].map((m) => m[0]);
    const printArea = workbookXml.match(new RegExp(`<definedName name="_xlnm.Print_Area" localSheetId="${i}">([^<]*)</definedName>`))?.[1] ?? null;
    const header = cells.filter((c) => fillOf(xfs[c.style] ?? "") === 2);
    return {
      dimension: xml.match(/<dimension ref="([^"]+)"\/>/)?.[1] ?? null,
      expectedDimension: `A1:S${lastRow}`,
      parsedRows: wb.rows(name).length,
      lastRow,
      allRowsSpanAtoS: rowTags.every((t) => t.includes(' spans="1:19"')),
      rowOrColumnStyles: rowTags.some((t) => / s="|customFormat/.test(t)) || cols.some((c) => /style=/.test(c)),
      widestColumn: Math.max(...cols.map((c) => Number(c.match(/max="(\d+)"/)![1]))),
      cellBeyondS: cells.filter((c) => c.col > COLUMN_S).map((c) => c.ref),
      cellBelowLastRow: cells.filter((c) => c.row > lastRow).map((c) => c.ref),
      mergeBeyondS: merges.filter((m) => m.to > COLUMN_S || m.last > lastRow).length,
      mergeColumns: [...new Set(merges.map((m) => m.from))].sort((a, b) => a - b),
      headerCells: header.map((c) => c.ref).join(","),
      printArea,
      expectedPrintArea: `'${name}'!$A$1:$S$${lastRow}`,
      extras: /<conditionalFormatting|<dataValidations|<hyperlinks|<tableParts/.test(xml),
    };
  });
}
const HEADER_REFS = Array.from({ length: 19 }, (_, i) => `${String.fromCharCode(65 + i)}1`).join(",");

function expectInsideAtoS(wb: InspectedWorkbook) {
  for (const b of boundaryOf(wb)) {
    expect([b.dimension, b.printArea]).toEqual([b.expectedDimension, b.expectedPrintArea]);
    expect(b.parsedRows).toBe(b.lastRow);
    expect([b.allRowsSpanAtoS, b.rowOrColumnStyles, b.widestColumn, b.cellBeyondS, b.cellBelowLastRow, b.mergeBeyondS, b.extras]).toEqual([true, false, COLUMN_S, [], [], 0, false]);
    expect(b.mergeColumns.every((c) => c === 8 || c === 18)).toBe(true);
    expect(b.headerCells).toBe(HEADER_REFS);
  }
}

const PINK_FAMILIES: Array<[string, string]> = [["ROUND", "1.000"], ["PEAR", "1.500"], ["OVAL", "1.350"], ["EMERALD 4STEP", "1.000"], ["EMERALD 4STEP", "1.435"], ["RADIANT", "1.200"], ["CUSHION", "1.050"], ["ANTIQUE CUSHION", "1.100"], ["HEART", "0.950"]];
function pinkStone(name: string): Rec[] {
  const recs: Rec[] = [];
  PINK_FAMILIES.forEach(([shape, ratio], i) => recs.push({ name, shape, ratio, est: `0.1${i}0` }, { name, shape, ratio, est: `0.1${i}0` }, { name, est: "0.040" }));
  for (const [shape, ratio] of [["EMERALD 4STEP", "1.435"], ["ROUND", "1.000"], ["OVAL", "1.350"], ["ROUND", "1.000"], ["EMERALD 4STEP", "1.435"], ["OVAL", "1.350"]]) recs.push({ name, shape, ratio, est: "0.050" });
  for (const [shape, ratio] of [["ROUND", "1.000"], ["OVAL", "1.350"], ["EMERALD 4STEP", "1.435"], ["RADIANT", "1.200"], ["CUSHION", "1.050"], ["ANTIQUE CUSHION", "1.100"]]) recs.push({ name, shape, ratio, est: "0.060" }, { name, shape, ratio, est: "0.060" });
  return recs.map((r) => ({ ...r, rough: "0.500" }));
}

describe("sarin xlsx: the output area ends at column S", () => {
  test("the default cell format is plain: nothing outside A:S can show the header gold, a fill or a border", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}S-001 DC`, [...Array(17).fill("1.500"), "0.200", "0.100"]));
    const wb = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    const xfs = cellXfs(wb);
    const styles = wb.part("xl/styles.xml");
    expect(xfs[0]).toBe('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');
    expect([styles.includes('<fills count="9"><fill><patternFill patternType="none"/></fill>'), styles.includes('<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>')]).toEqual([true, true]);
    // The gold header style exists once and is used by A1:S1 only.
    expect(xfs.filter((x) => fillOf(x) === 2).length).toBe(1);
    expect(boundaryOf(wb)[0].headerCells).toBe(HEADER_REFS);
    // No written cell relies on the default style, and neither rows, columns nor the sheet default carry one.
    expect(cellsOf(wb.sheetXml(1)).filter((c) => c.style === 0).map((c) => c.ref)).toEqual([]);
    expect([/<sheetFormatPr[^>]* style=/.test(wb.sheetXml(1)), boundaryOf(wb)[0].rowOrColumnStyles]).toEqual([false, false]);
  });

  test("Blue: used range, cells, merges, fills and print area stay inside A:S, over several Kapan sheets", async () => {
    const k1 = `6${uniq()}T`;
    const k2 = `6${uniq()}U`;
    const { batchId, versionId } = await outputOf([
      ...rows(`${k1}-001 DC`, [...Array(17).fill("1.500"), "0.500", "0.400", "0.600", "0.300"]),
      ...rows(`${k2}-0450 JV`, [...Array(17).fill("0.900"), "0.200"], { rough: "4.000" }),
    ]);
    const wb = inspectWorkbook((await download(exportWorkbook, batchId, versionId, planner.cookie)).bytes);
    expect(wb.sheetNames).toEqual([k1, k2]);
    expectInsideAtoS(wb);
    expect(boundaryOf(wb).map((b) => [b.dimension, b.printArea])).toEqual([["A1:S22", `'${k1}'!$A$1:$S$22`], ["A1:S19", `'${k2}'!$A$1:$S$19`]]);
    // Print titles are kept beside the print area.
    expect((wb.part("xl/workbook.xml").match(/_xlnm\.Print_Titles/g) ?? []).length).toBe(2);
    // Group shading covers only the group's own cells H..Q, never a whole row.
    const xfs = cellXfs(wb);
    const shaded = cellsOf(wb.sheetXml(1)).filter((c) => [4, 5].includes(fillOf(xfs[c.style] ?? "")));
    expect([...new Set(shaded.map((c) => c.col))].sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...new Set(shaded.map((c) => c.row))].sort((a, b) => a - b)).toEqual([19, 20, 21, 22]);
    // Values and formats are unchanged: weights 0.000, yield 0.00% from the stored value, merges H and R only.
    const s = wb.rows(k1);
    expect([s[1][9]!.z, s[1][17]!.z, s[18][17]!.v, s[18][7]!.v]).toEqual(["0.000", "0.00%", 0.3, "2 Pcs"]);
    expect(wb.merges(k1)).toEqual(["H19:H20", "H21:H22", "R19:R20", "R21:R22"]);
  });

  test("White and Pink: the same A:S boundary; values, merges and formats unchanged; no formulas", async () => {
    const k = `2${uniq()}`;
    const white = await outputOf(rows(`${k}-0007 HA`, [...Array(32).fill("0.250"), "0.900", "0.800", "1.000"], { rough: "10.000" }), { packetType: "WHITE" });
    const w = inspectWorkbook((await download(exportWorkbook, white.batchId, white.versionId, planner.cookie)).bytes);
    expectInsideAtoS(w);
    const s = w.rows(k);
    expect([s.length, s[1][9]!.z, s[1][17]!.z, s[33][17]!.v, w.merges(k)]).toEqual([36, "0.000", "0.00%", 0.17, ["H34:H35", "R34:R35"]]);

    const pink = await outputOf(pinkStone(`6${uniq()}-112_M`), { packetType: "PINK" }, PINK_RULES);
    const p = inspectWorkbook((await download(exportWorkbook, pink.batchId, pink.versionId, planner.cookie)).bytes);
    expectInsideAtoS(p);
    expect(boundaryOf(p)[0].dimension).toBe("A1:S46");
    expect([p.merges("Sheet1").length, p.rows("Sheet1")[1][17]!.v, p.rows("Sheet1")[2][17]!.v]).toEqual([36, 0.2, 0.28]);
    const all = [w, p].flatMap((wb) => wb.parts.map((x) => wb.part(x))).join("\n");
    expect(/<f[ >]/.test(all)).toBe(false);
  });

  test("a sheet whose stored rows disagree with its declared used range is refused, not written", async () => {
    const { batchId, versionId } = await outputOf(rows(`6${uniq()}V-001 DC`, Array(17).fill("1.500")));
    const before = tempDirs();
    const overstated: WorkbookSource = { stones: async (v) => (await databaseWorkbookSource.stones(v)).map((s) => ({ ...s, pieces: s.pieces + 1 })), pieces: databaseWorkbookSource.pieces };
    const err = await exportOutputWorkbook(actor(planner), batchId, versionId, { source: overstated }).catch((e) => e);
    expect([err.status, err.code]).toEqual([500, "EXPORT_NOT_GENERATED"]);
    expect(tempDirs()).toBe(before);
    const failed = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_OUTPUT_EXPORT_FAILED", entityId: batchId } });
    expect(failed.outcome).toBe("FAILED");
  });
});
