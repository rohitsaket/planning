// The built-in Sarin shape master: installed by migration as the effective catalog, used by
// Blue, White and Pink processing without any mapping step, and shown on the Mappings page
// before any file is imported.
//
// Registered first among the Sarin suites, so it meets the catalog exactly as a fresh
// installation has it; it never changes the catalog. Files go through Workbook Import's own
// processing code and the real routes against the isolated planning_sectest database. The
// expected master below restates the SARIN SHAPE workbook (ID, EXCEL, SARIN columns) and
// design v1.7 §15.10 independently of the migration that seeds it. All records are synthetic.

import { beforeAll, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { applyCatalog, effectiveSnapshotId, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as readCatalog } from "@/app/api/planning/sarin/shape-mappings/route";
import { GET as listInterpretations } from "@/app/api/planning/sarin/imports/[batchId]/interpretations/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { SARIN_ECOSYSTEM_SHAPES, SARIN_FANTASY_SHAPE_CODES } from "@/lib/sarin/domain";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { processFile, rightsOf, type ProcessingStage } from "@/components/diamond/views/sarin/sarin-processing";

// [Fantasy code, Fantasy shape, Sarin shape, Ratio from, Ratio to] — the confirmed master.
const MASTER: Array<[string, string, string, string | null, string | null]> = [
  ["BR", "Round", "ROUND", null, null],
  ["EURO", "Old European Brilliant", "OLD ROUND", null, null],
  ["MQ", "Marquise", "LIYO MQ", null, null],
  ["ANMQ", "Antique Marquise", "MQ_21", null, null],
  ["PS", "Pear", "LeoPear11", null, null],
  ["OV", "Oval", "LeoOval22", null, null],
  ["AS", "Asscher", "EMERALD 5STEP", "1.000", "1.030"],
  ["EM", "Emerald", "EMERALD 5STEP", "1.400", null],
  ["MORAD", "Radiant Modified", "KRISS 3-STEP", null, null],
  ["RAD", "Radiant", "RAD4(1)", null, null],
  ["SCB", "Square Cushion Brilliant", "SQ.BE.CUS", null, null],
  ["SQMOCU", "Square Cushion Modified", "SQ_CU", null, null],
  ["BECU", "Cushion Brilliant", "BE.CU.LONG", null, null],
  ["MOCU", "Cushion Modified", "CU.LONG", null, null],
  ["SQANCU", "Square Antique Cushion", "SQ.ANTIK.CUS", null, null],
  ["ANCU", "Antique Cushion", "ANTIK-CU-LONG", null, null],
  ["PR", "Princess", "BEZEL PRINCESS", null, null],
  ["HS", "Heart", "S.HEART", null, null],
  ["KOV", "KRISS OVAL", "KRISS OVAL", null, null],
  ["SM", "Step Marquise", "STEP MQ", null, null],
  ["ANOV", "Antique Oval", "ANT-OVAL", null, null],
  ["MOV", "Moval", "Moval", null, null],
  ["FBZ", "Febrizio", "FABRIZIO", null, null],
  ["LSC", "Lozenge Step Cut", "LOZENGES-2", null, null],
  ["KITE", "Kite", "Kite_V2", null, null],
  ["TRI", "Triangle", "TREGAL(1)", null, null],
  ["CAD", "Cadillacs", "CAD", null, null],
  ["TP", "Trapper Baguette", "TAPERED-BG-LW", null, null],
  ["TRA", "Trapezoid", "TRAP50", null, null],
  ["BETR", "BRILLANT TRAPEZOID", "BE-TRA", null, null],
  ["HM", "Moon Half", "HALF_MOON", null, null],
  ["BAG", "Baguette", "BAGUETTE-LW", null, null],
];
// Confirmed by the client after the master: RAD MODIFIED is Kriss Cut, for every Ratio. Its
// Fantasy code is in no authoritative source yet, so it has none.
const CONFIRMED_SINCE: Array<[string | null, string, string, string | null, string | null]> = [[null, "Kriss Cut", "RAD MODIFIED", null, null]];
const UNCONFIRMED = ["EMERALD 4STEP", "NP-1235-6-KITE"];
const key = (s: string) => s.trim().toUpperCase();

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, planner: User, reader: User, manager: User, operator: User, scoped: User;
let baselineId = "";
let installedId = "";

// ---- synthetic files ------------------------------------------------------------------------
let nonce = 0;
const kapan = () => `3${String(++nonce).padStart(3, "0")}B`;
interface Rec { name: string; shape: string; est?: string; rough?: string; ratio?: string }
const csvFile = (recs: Rec[], fileName: string) =>
  new File([new TextEncoder().encode(recs.map((r) => [r.name, r.rough ?? "3.000", r.shape, r.est ?? "1.500", "VS1", "G", "61.6", r.ratio ?? "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n") as BlobPart], fileName, { type: "text/csv" });
async function run(u: User, recs: Rec[], fileName: string, packetType: string, labId: string | null = null) {
  const stages: ProcessingStage[] = [];
  const rights = rightsOf((await sessionUser(u.cookie)).permissions);
  const r = await processFile(routeFetch(u.cookie), csvFile(recs, fileName), { packetType, labId, planningDate: "2026-09-28" }, rights, (s) => stages.push(s));
  return { ...r, stages };
}
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => renderPage(view, props, await sessionUser(u.cookie), u.cookie);
const catalog = async (u: User = reader) => {
  resetRateLimits();
  return (await call(readCatalog, { cookie: u.cookie, path: "/api/planning/sarin/shape-mappings" })).json;
};
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `BASE_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Base ${name}`, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

/** A Pink stone of 45 records in the confirmed order, written only with confirmed Sarin shapes. */
function confirmedPinkStone(name: string): Rec[] {
  // Family order Round, Pear, Oval, Asscher, Emerald, Radiant, Cushion, Antique Cushion, Heart.
  const as = (shape: string): Rec => (shape === "ASSCHER" ? { name, shape: "EMERALD 5STEP", ratio: "1.020" } : shape === "EMERALD" ? { name, shape: "EMERALD 5STEP", ratio: "1.450" } : { name, shape });
  const raw: Record<string, string> = { ROUND: "ROUND", PEAR: "LeoPear11", OVAL: "LeoOval22", RADIANT: "RAD4(1)", CUSHION: "BE.CU.LONG", "ANTIQUE CUSHION": "ANTIK-CU-LONG", HEART: "S.HEART" };
  const rec = (shape: string, est: string): Rec => ({ ...(raw[shape] ? { name, shape: raw[shape] } : as(shape)), est });
  const recs: Rec[] = [];
  for (const shape of ["ROUND", "PEAR", "OVAL", "ASSCHER", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION", "HEART"]) recs.push(rec(shape, "1.000"), rec(shape, "1.000"), rec("ROUND", "0.200"));
  for (const shape of ["EMERALD", "ROUND", "OVAL", "ROUND", "EMERALD", "OVAL"]) recs.push(rec(shape, "0.500"));
  for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push(rec(shape, "0.400"), rec(shape, shape === "OVAL" ? "0.404" : "0.400"));
  return recs;
}

beforeAll(async () => {
  await ensureLabRegistry(["BASE-LAB-A", "BASE-LAB-B"]);
  root = await makeUser("base.root", "SUPER_ADMIN");
  planner = await makeUser("base.planner", "PLANNER");
  reader = await userWith("reader", ["sarin.mapping.read"]);
  manager = await userWith("manager", ["sarin.mapping.read", "sarin.mapping.manage"]);
  // Processes files and may also maintain mappings.
  operator = await userWith("operator", ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.output.generate", "sarin.output.export", "sarin.mapping.read", "sarin.mapping.manage"]);
  scoped = await makeUser("base.scoped", "PLANNER");
  await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "LAB", value: "BASE-LAB-A" } });
  baselineId = (await db.sarinShapeMappingSet.findFirstOrThrow({ where: { sourceSystem: "SARIN", origin: "MIGRATION_BASELINE" }, select: { id: true } })).id;
  installedId = (await db.sarinShapeMappingSet.findFirstOrThrow({ where: { sourceSystem: "SARIN", origin: "SYSTEM" }, select: { id: true } })).id;
});
const ruleKey = (shape: string, sarin: string, lo: string | null, hi: string | null) => [shape, key(sarin), lo, hi].join("|");

// =========================================================================================
describe("sarin baseline catalog: installed with the database", () => {
  test("a fresh installation has the confirmed master and the confirmed Kriss Cut rule in effect before any Sarin file is imported", async () => {
    expect([await db.sarinImportBatch.count(), await db.sarinSourceRow.count()]).toEqual([0, 0]);
    expect(await effectiveSnapshotId()).toBe(installedId);
    const rulesOf = (rules: Array<{ normalizedShape: string; rawShapeKey: string; ratioMin: { toFixed(n: number): string } | null; ratioMax: { toFixed(n: number): string } | null }>) =>
      rules.map((r) => ruleKey(r.normalizedShape, r.rawShapeKey, r.ratioMin?.toFixed(3) ?? null, r.ratioMax?.toFixed(3) ?? null)).sort();
    // The master, seeded by migration, became effective and was then replaced by the snapshot
    // the Kriss Cut migration installed from it; nobody approved either.
    const baseline = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: baselineId }, include: { rules: true } });
    expect([baseline.status, baseline.version, baseline.supersededBySetId, baseline.approvedByUserId]).toEqual(["SUPERSEDED", 1, installedId, null]);
    expect(rulesOf(baseline.rules)).toEqual(MASTER.map(([, shape, sarin, lo, hi]) => ruleKey(shape, sarin, lo, hi)).sort());
    const set = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: installedId }, include: { rules: true } });
    expect([set.status, set.origin, set.version, set.copiedFromSetId, set.createdByUserId, set.approvedByUserId, set.approvedAt, set.effectiveAt !== null, /^[0-9a-f]{64}$/.test(set.contentHash ?? "")]).toEqual(["EFFECTIVE", "SYSTEM", 2, baselineId, null, null, null, true, true]);
    expect(rulesOf(set.rules)).toEqual([...MASTER, ...CONFIRMED_SINCE].map(([, shape, sarin, lo, hi]) => ruleKey(shape, sarin, lo, hi)).sort());
    const kriss = set.rules.find((r) => r.rawShapeKey === "RAD MODIFIED")!;
    expect([kriss.normalizedShape, kriss.conditionKind, kriss.ratioMin, kriss.ratioMax, kriss.changedByUserId]).toEqual(["Kriss Cut", "NONE", null, null, null]);
    expect(set.rules.some((r) => UNCONFIRMED.includes(r.rawShapeKey))).toBe(false);
    // The migration's system audit event is not asserted here: earlier suites reset the audit
    // table (resetDb), so it is verified where the migration runs, on its own database.
  });

  test("every Fantasy shape carries its master code; Kriss Cut is in the vocabulary once, with no invented code", () => {
    for (const [code, shape] of MASTER) expect([shape, SARIN_FANTASY_SHAPE_CODES[shape as keyof typeof SARIN_FANTASY_SHAPE_CODES]]).toEqual([shape, code]);
    expect(Object.keys(SARIN_FANTASY_SHAPE_CODES).sort()).toEqual([...SARIN_ECOSYSTEM_SHAPES].sort());
    const codes = Object.values(SARIN_FANTASY_SHAPE_CODES).filter((c): c is string => c !== null);
    expect([new Set(codes).size, codes.length, SARIN_FANTASY_SHAPE_CODES["Kriss Cut"]]).toEqual([codes.length, SARIN_ECOSYSTEM_SHAPES.length - 1, null]);
    // One canonical identity: no two shapes differ only by case or spacing.
    expect(new Set(SARIN_ECOSYSTEM_SHAPES.map((s) => s.trim().toUpperCase())).size).toBe(SARIN_ECOSYSTEM_SHAPES.length);
    expect(SARIN_ECOSYSTEM_SHAPES.filter((s) => s.toUpperCase().replace(/\s+/g, " ") === "KRISS CUT")).toEqual(["Kriss Cut"]);
  });

  test("Current Mappings lists the whole master with zero imported files; nothing needs mapping yet", async () => {
    const page = await catalog();
    expect([page.configured, page.mappings.length, page.needsMapping, page.unconfirmed]).toEqual([true, 33, [], UNCONFIRMED]);
    const rad = page.mappings.filter((m: any) => m.sarinShape === "RAD MODIFIED");
    expect(rad.map((m: any) => [m.fantasyShape, m.fantasyCode, m.applyTo, m.minimumRatio, m.maximumRatio])).toEqual([["Kriss Cut", null, "ALL_RATIOS", null, null]]);
    const kriss3 = page.mappings.filter((m: any) => m.sarinShape === "KRISS 3-STEP");
    expect(kriss3.map((m: any) => [m.fantasyShape, m.fantasyCode, m.applyTo])).toEqual([["Radiant Modified", "MORAD", "ALL_RATIOS"]]);
    const round = page.mappings.find((m: any) => m.sarinShape === "ROUND");
    expect([round.fantasyShape, round.fantasyCode, round.applyTo]).toEqual(["Round", "BR", "ALL_RATIOS"]);
    const emerald = page.mappings.filter((m: any) => m.sarinShape === "EMERALD 5STEP").map((m: any) => [m.fantasyCode, m.minimumRatio, m.maximumRatio]);
    expect(emerald).toEqual([["AS", "1.000", "1.030"], ["EM", "1.400", null]]);
    const view = await render(SarinShapeMappingsView, {}, reader);
    for (const label of ["Current mappings", "ROUND", "BR", "Old European Brilliant", "EURO", "RAD MODIFIED", "Kriss Cut", "Not confirmed", "Unconfirmed mappings", "EMERALD 4STEP", "NP-1235-6-KITE"]) expect([label, view.text.includes(label)]).toEqual([label, true]);
    expect([view.text.includes("These shapes do not have a mapping yet."), view.text.includes("Shape mappings are not configured.")]).toEqual([false, false]);
  });

  test("Workbook Import has no mapping setup step when the master is in effect", async () => {
    for (const u of [planner, operator]) {
      const page = await render(WorkbookImportView, {}, u);
      expect([page.text.includes("Process File"), /Shape mappings are not configured|Open Mappings|mapping/i.test(page.text)]).toEqual([true, false]);
    }
  });

  test("saving the master exactly as it is changes nothing: installation and catalog saves are idempotent", async () => {
    const before = [await effectiveSnapshotId(), await db.sarinShapeMappingSet.count(), await db.auditLog.count({ where: { action: { startsWith: "SARIN_MAPPING_" } } })];
    const rules: CatalogRule[] = [...MASTER, ...CONFIRMED_SINCE].map(([, shape, sarin, lo, hi]) => ({ rawShape: sarin, normalizedShape: shape, conditionKind: lo || hi ? "RATIO_RANGE" : "NONE", ratioMin: lo, ratioMax: hi }));
    expect(await applyCatalog(manager.cookie, rules)).toBe(installedId);
    expect([await effectiveSnapshotId(), await db.sarinShapeMappingSet.count(), await db.auditLog.count({ where: { action: { startsWith: "SARIN_MAPPING_" } } })]).toEqual(before);
  });
});

// =========================================================================================
describe("sarin baseline catalog: processing with the master", () => {
  test("a Blue file of confirmed shapes goes from Process File straight to output", async () => {
    const k = kapan();
    const recs: Rec[] = [
      ...Array.from({ length: 13 }, () => ({ name: `${k}-001 DC`, shape: "ROUND" })),
      { name: `${k}-001 DC`, shape: "Moval" }, // mixed case: compared without case, as §15.10 confirms
      { name: `${k}-001 DC`, shape: "BEZEL PRINCESS" },
      { name: `${k}-001 DC`, shape: "EMERALD 5STEP", ratio: "1.030" },
      { name: `${k}-001 DC`, shape: "EMERALD 5STEP", ratio: "1.400" },
      { name: `${k}-001 DC`, shape: "LeoPear11", est: "0.500" },
      { name: `${k}-001 DC`, shape: "LEOOVAL22", est: "0.400" },
    ];
    const r = await run(planner, recs, "base-blue.csv", "BLUE");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const output = await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: r.batchId! } });
    expect(output.shapeMappingSetId).toBe(installedId);
    const pieces = await db.sarinPlanPiece.findMany({ where: { outputVersionId: output.id }, orderBy: { outputRowSequence: "asc" }, select: { normalizedShape: true } });
    expect(pieces.slice(13).map((p) => p.normalizedShape)).toEqual(["Moval", "Princess", "Asscher", "Emerald", "Pear", "Oval"]);
  });

  test("a White file of confirmed shapes goes straight to output", async () => {
    const name = `2${String(++nonce).padStart(3, "0")}-0007 HA`;
    const recs: Rec[] = [...Array.from({ length: 32 }, (_, i) => ({ name, shape: ["LeoOval22", "MQ_21", "STEP MQ", "ANT-OVAL"][i % 4], est: "0.250", rough: "10.000" })), { name, shape: "ROUND", est: "0.900", rough: "10.000" }, { name, shape: "S.HEART", est: "0.800", rough: "10.000" }];
    const r = await run(planner, recs, "base-white.csv", "WHITE");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    expect((await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: r.batchId! } })).shapeMappingSetId).toBe(installedId);
  });

  test("a Pink file written only with confirmed shapes goes straight to output", async () => {
    const r = await run(planner, confirmedPinkStone(`${kapan().slice(0, 4)}-111_M`), "base-pink.csv", "PINK");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const output = await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: r.batchId! } });
    expect([output.shapeMappingSetId, output.pieceCount]).toEqual([installedId, 45]);
  });

  test("a Pink file with EMERALD 4STEP stops before output; the shape needs mapping, nothing is guessed", async () => {
    const recs = confirmedPinkStone(`${kapan().slice(0, 4)}-112_M`).map((r) => (r.shape === "EMERALD 5STEP" && r.ratio === "1.450" ? { ...r, shape: "EMERALD 4STEP" } : r));
    const r = await run(planner, recs, "base-pink-4step.csv", "PINK");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking"]]);
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect([batch.status, await db.sarinOutputVersion.count({ where: { batchId: batch.id } })]).toEqual(["NEEDS_REVIEW", 0]);
    const page = await catalog();
    const row = page.needsMapping.find((s: any) => s.sarinShape === "EMERALD 4STEP");
    expect([row?.packetTypes, row?.records > 0]).toEqual([["PINK"], true]);
    expect(await db.sarinRowInterpretation.count({ where: { batchId: batch.id, rawShapeKey: "EMERALD 4STEP", normalizedShape: { not: null } } })).toBe(0);
  });

  test("an unknown shape is written unmapped with a warning and listed under Needs Mapping; confirmed shapes never are", async () => {
    const k = kapan();
    const recs: Rec[] = [...["ROUND", "LEOOVAL22", "LEOPEAR11", "MOVAL", "BEZEL PRINCESS"].flatMap((shape) => Array.from({ length: 3 }, () => ({ name: `${k}-001 DC`, shape }))), { name: `${k}-001 DC`, shape: "HEXA CUT" }, { name: `${k}-001 DC`, shape: "ROUND" }];
    const r = await run(planner, recs, "base-unknown.csv", "BLUE");
    expect([r.failure, r.stages, (await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } })).status]).toEqual([null, ["uploading", "checking", "preparing"], "VALIDATED"]);
    // Design v1.7 §15.10: the unknown shape keeps its raw text in the output; nothing is guessed.
    const raw = await db.sarinPlanPiece.findMany({ where: { batchId: r.batchId!, shapeResolution: "RAW_PASSTHROUGH" }, select: { rawShape: true, normalizedShape: true } });
    expect(raw).toEqual([{ rawShape: "HEXA CUT", normalizedShape: null }]);
    const needing = (await catalog()).needsMapping.map((s: any) => s.sarinShape);
    expect(needing.includes("HEXA CUT")).toBe(true);
    for (const known of ["ROUND", "LEOOVAL22", "LEOPEAR11", "MOVAL", "BEZEL PRINCESS", "EMERALD 5STEP"]) expect([known, needing.includes(known)]).toEqual([known, false]);
    // An imported unconfirmed shape is listed once, under Needs Mapping, not again as unconfirmed.
    expect((await catalog()).unconfirmed).toEqual(["NP-1235-6-KITE"]);
  });

  test("EMERALD 5STEP ratios are compared as exact decimals at every boundary", async () => {
    const k = kapan();
    const ratios = ["0.999", "1.000", "1.030", "1.031", "1.399", "1.400", "2.500"];
    const recs: Rec[] = [...ratios.map((ratio) => ({ name: `${k}-001 DC`, shape: "EMERALD 5STEP", ratio })), ...Array.from({ length: 10 }, () => ({ name: `${k}-001 DC`, shape: "ROUND" }))];
    const r = await run(planner, recs, "base-ratio.csv", "BLUE");
    resetRateLimits();
    const rows = (await call(listInterpretations, { cookie: planner.cookie, path: "/api/x?pageSize=500", params: { batchId: r.batchId! } })).json.rows as any[];
    const got = rows.filter((x) => x.rawShape === "EMERALD 5STEP").sort((a, b) => a.sourceRowNumber - b.sourceRowNumber).map((x) => x.normalizedShape);
    expect(got).toEqual([null, "Asscher", "Asscher", null, null, "Emerald", "Emerald"]);
    // A shape whose Ratio falls between the ranges needs attention; the confirmed ranges are not changed.
    const row = (await catalog()).needsMapping.find((s: any) => s.sarinShape === "EMERALD 5STEP");
    expect(row.observedRatio).toEqual({ lowest: "0.999", highest: "1.399" });
    expect(await effectiveSnapshotId()).toBe(installedId);
  });

  test("RAD MODIFIED is Kriss Cut at every Ratio; KRISS 3-STEP stays Radiant Modified", async () => {
    const name = `2${String(++nonce).padStart(3, "0")}-0016 HA`;
    const ratios = ["0.500", "1.000", "1.430", "1.920", "3.000"];
    const recs: Rec[] = [
      ...Array.from({ length: 32 }, (_, i) => (i < 5 ? { name, shape: "RAD MODIFIED", ratio: ratios[i] } : i < 7 ? { name, shape: "KRISS 3-STEP", ratio: "1.450" } : { name, shape: "ROUND" })).map((r, i) => ({ ...r, est: (1 - i * 0.01).toFixed(3), rough: "10.000" })),
    ];
    const r = await run(planner, recs, "base-kriss.csv", "WHITE");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const pieces = await db.sarinPlanPiece.findMany({ where: { batchId: r.batchId! }, orderBy: { outputRowSequence: "asc" }, select: { rawShape: true, normalizedShape: true, shapeResolution: true, mappingRule: { select: { mappingSetId: true, rawShapeKey: true } } } });
    expect(pieces.slice(0, 7).map((p) => [p.rawShape, p.normalizedShape, p.shapeResolution, p.mappingRule?.mappingSetId === installedId])).toEqual([
      ...ratios.map(() => ["RAD MODIFIED", "Kriss Cut", "MAPPED", true]),
      ["KRISS 3-STEP", "Radiant Modified", "MAPPED", true],
      ["KRISS 3-STEP", "Radiant Modified", "MAPPED", true],
    ]);
    expect(pieces.some((p) => p.rawShape === "RAD MODIFIED" && p.normalizedShape === "Radiant Modified")).toBe(false);
    expect(await db.sarinPlanPiece.count({ where: { batchId: r.batchId!, shapeResolution: "RAW_PASSTHROUGH" } })).toBe(0);
  });

  test("lab scope still applies to processing and to the Needs Mapping counts; country scope does not narrow Sarin", async () => {
    const k = kapan();
    const labB = await run(planner, Array.from({ length: 17 }, () => ({ name: `${k}-001 DC`, shape: "SCOPE ONLY LAB B" })), "base-lab-b.csv", "BLUE", "BASE-LAB-B");
    expect(labB.failure).toBe(null);
    const labReader = await userWith("lab reader", ["sarin.mapping.read"]);
    await db.userAccessScope.create({ data: { userId: labReader.user.id, dimension: "LAB", value: "BASE-LAB-A" } });
    const countryReader = await userWith("country reader", ["sarin.mapping.read"]);
    await db.userAccessScope.create({ data: { userId: countryReader.user.id, dimension: "COUNTRY", value: "IN" } });
    const sees = async (u: User) => (await catalog(u)).needsMapping.some((s: any) => s.sarinShape === "SCOPE ONLY LAB B");
    expect([await sees(reader), await sees(labReader), await sees(countryReader)]).toEqual([true, false, true]);
    const outside = await run(scoped, Array.from({ length: 17 }, () => ({ name: `${kapan()}-001 DC`, shape: "ROUND" })), "base-scope.csv", "BLUE", "BASE-LAB-B");
    expect([outside.batchId, outside.failure?.error.status]).toEqual([null, 403]);
  });
});
