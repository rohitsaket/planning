// Unmapped Sarin shapes (design v1.7 §15.10): a present shape with no confirmed mapping is
// written unchanged in the structured output with one warning per record, summarised by
// shape; blank shapes, malformed rows and Pink's positional contract still block output.
//
// The White file below reproduces the audited structure of the client's White raw file:
// five stones of 51, 45, 44, 45 and 50 plans, `RAD MODIFIED` at plan 16 of each (CSV rows
// 16, 67, 112, 156, 201) and `NP-1235-6-KITE` at plan 43 of the second (CSV row 94, in an
// additional group). Every other shape is in the confirmed master. Files go through Workbook
// Import's processing code and the real routes against the isolated planning_sectest
// database. The White file is processed first with a catalog lacking `RAD MODIFIED` (as it was
// before the client confirmed it), then again once the confirmed `RAD MODIFIED -> Kriss Cut`
// rule is in effect.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { inspectWorkbook } from "./workbook-inspect";
import { applyCatalog, type CatalogRule } from "./sarin-catalog";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as listImports } from "@/app/api/planning/sarin/imports/route";
import { POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import * as importRoute from "@/app/api/planning/sarin/imports/[batchId]/route";
import { GET as getOutput } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/route";
import { GET as listPieces } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/pieces/route";
import { GET as exportWorkbook } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/workbook/route";
import { GET as exportCsv } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/export/route";
import { GET as listIssues } from "@/app/api/planning/sarin/imports/[batchId]/issues/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { continueProcessing, fileStatus, processFile, rightsOf, type ProcessingStage } from "@/components/diamond/views/sarin/sarin-processing";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, planner: User, viewer: User, mapper: User, scopedIn: User;
const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
// The confirmed master shapes this file uses. RAD MODIFIED and NP-1235-6-KITE are absent.
const MASTER: CatalogRule[] = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "LeoOval22", normalizedShape: "Oval" },
  { rawShape: "LeoPear11", normalizedShape: "Pear" },
  { rawShape: "ANT-OVAL", normalizedShape: "Antique Oval" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.400", ratioMax: null },
];

// ---- the audited White structure ------------------------------------------------------------
type Rec = [name: string, rough: string, shape: string, est: string, ratio: string];
const line = ([name, rough, shape, est, ratio]: Rec) => [name, rough, shape, est, "VS1", "D", "61.1", ratio, "17.62", "9.16", "5.6"].join(",");
/** One White stone: 32 main plans (RAD MODIFIED at plan 16), then additional groups of falling weights. */
function whiteStone(name: string, rough: string, plans: number, extra: Record<number, string> = {}): Rec[] {
  return Array.from({ length: plans }, (_, i) => {
    const plan = i + 1;
    const shape = plan === 16 ? "RAD MODIFIED" : extra[plan] ?? (plan % 3 === 0 ? "LeoOval22" : plan % 3 === 1 ? "ROUND" : "LeoPear11");
    // Main plans descend; each additional group of four restarts higher, so groups form.
    const est = plan <= 32 ? (20 - plan * 0.4).toFixed(3) : (4 - ((plan - 33) % 4) * 0.8).toFixed(3);
    return [name, rough, shape, est, shape === "NP-1235-6-KITE" ? "1.920" : shape === "RAD MODIFIED" ? "1.430" : "1.000"];
  });
}
const auditedWhite = () => [
  ...whiteStone("2501-001 HA", "72.126", 51),
  ...whiteStone("2501-002 NH", "63.227", 45, { 43: "NP-1235-6-KITE" }),
  ...whiteStone("2501-003 JJ", "74.924", 44),
  ...whiteStone("2501-004 SB", "70.916", 45),
  ...whiteStone("2501-005 JK", "74.607", 50),
];
const csvFile = (recs: Rec[], fileName: string, extraLines: string[] = []) =>
  new File([new TextEncoder().encode([...recs.map(line), ...extraLines].join("\n") + "\n") as BlobPart], fileName, { type: "text/csv" });

async function processAs(u: User, file: File, packetType = "WHITE", labId: string | null = null) {
  const stages: ProcessingStage[] = [];
  const r = await processFile(routeFetch(u.cookie), file, { packetType, labId, planningDate: "2026-09-28" }, rightsOf((await sessionUser(u.cookie)).permissions), (s) => stages.push(s));
  return { ...r, stages };
}
const get = (handler: any, u: User, params: Record<string, string>, query = "") => {
  resetRateLimits();
  return call(handler, { cookie: u.cookie, path: `/api/x${query}`, params });
};
async function download(handler: any, u: User, batchId: string, versionId: string) {
  resetRateLimits();
  const res = await handler(new Request("http://localhost/api/x", { headers: { cookie: u.cookie } }), { params: Promise.resolve({ batchId, versionId }) } as never);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}
const currentOutput = async (u: User, batchId: string) => (await get(importRoute.GET, u, { batchId })).json.batch.currentOutputId as string;
const render = async (batchId: string, u: User) =>
  renderPage(SarinFileResult, { batchId, rights: rightsOf((await sessionUser(u.cookie)).permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, await sessionUser(u.cookie), u.cookie);
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `PASS_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Pass ${name}`, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

let white: { batchId: string; outputId: string };

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("pass.root", "SUPER_ADMIN");
  planner = await makeUser("pass.planner", "PLANNER");
  viewer = await makeUser("pass.viewer", "VIEWER");
  mapper = await userWith("pass.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  scopedIn = await makeUser("pass.scoped", "PLANNER");
  await db.userAccessScope.create({ data: { userId: scopedIn.user.id, dimension: "LAB", value: "GIA" } });
  resetRateLimits();
  await applyCatalog(mapper.cookie, MASTER);
  const r = await processAs(planner, csvFile(auditedWhite(), "WHITE stone raw.CSV"));
  white = { batchId: r.batchId!, outputId: await currentOutput(planner, r.batchId!) };
});
beforeEach(async () => {
  resetRateLimits();
  await applyCatalog(mapper.cookie, MASTER);
});

// =========================================================================================
describe("sarin shape pass-through: the audited White file", () => {
  test("the six audited records are read in place and are the only unmapped rows", async () => {
    const rows = await db.sarinSourceRow.findMany({ where: { batchId: white.batchId, shapeRaw: { in: ["RAD MODIFIED", "NP-1235-6-KITE"] } }, orderBy: { sourceRowNumber: "asc" }, select: { sourceRowNumber: true, shapeRaw: true, fieldCount: true, stoneNameRaw: true, estimatedWeight: true, ratio: true } });
    expect(rows.map((r) => [r.sourceRowNumber, r.shapeRaw, r.fieldCount, r.stoneNameRaw])).toEqual([
      [16, "RAD MODIFIED", 11, "2501-001 HA"], [67, "RAD MODIFIED", 11, "2501-002 NH"], [94, "NP-1235-6-KITE", 11, "2501-002 NH"],
      [112, "RAD MODIFIED", 11, "2501-003 JJ"], [156, "RAD MODIFIED", 11, "2501-004 SB"], [201, "RAD MODIFIED", 11, "2501-005 JK"],
    ]);
    expect(rows.find((r) => r.sourceRowNumber === 94)!.ratio!.toFixed(3)).toBe("1.920");
    expect(await db.sarinSourceRow.count({ where: { batchId: white.batchId, outcome: { not: "ACCEPTED" } } })).toBe(0);
  });

  test("the file reaches Output Ready with Warnings, with the whole structured output stored", async () => {
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: white.batchId } });
    const output = await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: white.outputId } });
    expect([batch.status, output.status, output.stoneCount, output.pieceCount]).toEqual(["VALIDATED", "GENERATED", 5, 235]);
    // White structure is unchanged: 32 main plans per stone, then additional groups.
    const kinds = await db.sarinPlanOption.groupBy({ by: ["optionKind"], where: { outputVersionId: output.id }, _count: { _all: true } });
    expect(Object.fromEntries(kinds.map((k) => [k.optionKind, k._count._all])).MAIN).toBe(160);
    resetRateLimits();
    const listed = (await call(listImports, { cookie: planner.cookie, path: "/api/planning/sarin/imports?pageSize=50" })).json.rows.find((b: any) => b.id === white.batchId);
    expect([listed.currentOutputUnmappedRows, fileStatus(listed)]).toEqual([6, "Output Ready with Warnings"]);
  });

  test("warnings are one per record, summarised as 2 shapes and 6 records, with no second finding per row", async () => {
    const issues = (await get(listIssues, planner, { batchId: white.batchId }, "?pageSize=100")).json.rows as any[];
    expect(issues.map((i) => [i.code, i.blocking, i.row?.number ?? i.sourceRowNumber])).toEqual([16, 67, 94, 112, 156, 201].map((n) => ["SHAPE_NOT_MAPPED", false, n]));
    const summary = (await get(getOutput, planner, { batchId: white.batchId, versionId: white.outputId })).json.unmappedShapes;
    expect(summary).toEqual({ shapes: [{ shape: "RAD MODIFIED", records: 5 }, { shape: "NP-1235-6-KITE", records: 1 }], records: 6, partial: false });
    const page = await render(white.batchId, planner);
    for (const label of ["Output Ready with Warnings", "2 shapes are not mapped", "RAD MODIFIED", "— 5 records", "NP-1235-6-KITE", "— 1 record", "View affected records", "Export XLSX", "Hide Preview"]) {
      expect([label, page.text.includes(label)]).toEqual([label, true]);
    }
    expect([page.text.includes("Shape mapping is missing"), page.text.includes("Plan has no confirmed shape"), page.text.includes("item to review"), /SHAPE_NOT_MAPPED|RAW_PASSTHROUGH/.test(page.text)]).toEqual([false, false, false, false]);
  });

  test("pass-through rows keep the raw shape and no canonical shape; mapped rows keep their rule", async () => {
    const pieces = await db.sarinPlanPiece.findMany({ where: { outputVersionId: white.outputId }, orderBy: { outputRowSequence: "asc" }, select: { sourceRowNumber: true, rawShape: true, shapeResolution: true, normalizedShape: true, mappingRuleId: true } });
    const raw = pieces.filter((p) => p.shapeResolution === "RAW_PASSTHROUGH");
    expect(raw.map((p) => [p.sourceRowNumber, p.rawShape, p.normalizedShape, p.mappingRuleId])).toEqual([
      [16, "RAD MODIFIED", null, null], [67, "RAD MODIFIED", null, null], [94, "NP-1235-6-KITE", null, null],
      [112, "RAD MODIFIED", null, null], [156, "RAD MODIFIED", null, null], [201, "RAD MODIFIED", null, null],
    ]);
    const mapped = pieces.filter((p) => p.shapeResolution === "MAPPED");
    expect([mapped.length, mapped.every((p) => p.normalizedShape !== null && p.mappingRuleId !== null), mapped.some((p) => p.normalizedShape === "RAD MODIFIED")]).toEqual([229, true, false]);
    // The affected-records list names stone, CSV row, plan and raw shape; the kite is in an additional group.
    const affected = (await get(listPieces, planner, { batchId: white.batchId, versionId: white.outputId }, "?unmapped=true&pageSize=50")).json;
    expect(affected.rows.map((r: any) => [r.stoneName, r.sourceRowNumber, r.option.kind, r.shape, r.shapeResolution])).toEqual([
      ["2501-001 HA", 16, "MAIN", "RAD MODIFIED", "RAW_PASSTHROUGH"], ["2501-002 NH", 67, "MAIN", "RAD MODIFIED", "RAW_PASSTHROUGH"],
      ["2501-002 NH", 94, "ADDITIONAL", "NP-1235-6-KITE", "RAW_PASSTHROUGH"], ["2501-003 JJ", 112, "MAIN", "RAD MODIFIED", "RAW_PASSTHROUGH"],
      ["2501-004 SB", 156, "MAIN", "RAD MODIFIED", "RAW_PASSTHROUGH"], ["2501-005 JK", 201, "MAIN", "RAD MODIFIED", "RAW_PASSTHROUGH"],
    ]);
    expect(affected.rows.every((r: any) => r.normalizedShape === null && r.mappingRuleId === null)).toBe(true);
  });

  test("preview, reopened output, XLSX and CSV agree row for row, raw shapes included", async () => {
    const preview: any[] = [];
    for (let page = 1; ; page++) {
      const r = (await get(listPieces, planner, { batchId: white.batchId, versionId: white.outputId }, `?pageSize=100&page=${page}`)).json;
      preview.push(...r.rows);
      if (!r.hasMore) break;
    }
    expect(await currentOutput(planner, white.batchId)).toBe(white.outputId);
    const wb = inspectWorkbook((await download(exportWorkbook, planner, white.batchId, white.outputId)).bytes);
    const sheetRows = wb.sheetNames.flatMap((n) => wb.rows(n).slice(1));
    expect(sheetRows.map((c) => [c[8]!.v, Number(c[9]!.v).toFixed(3), c[9]!.z])).toEqual(preview.map((p) => [p.shape, p.estimatedWeight, "0.000"]));
    expect(sheetRows.filter((c) => c[8]!.v === "RAD MODIFIED").length).toBe(5);
    expect(sheetRows.filter((c) => c[8]!.v === "NP-1235-6-KITE").length).toBe(1);
    expect([wb.rows(wb.sheetNames[0])[0].length, wb.merges(wb.sheetNames[0]).length > 0]).toEqual([19, true]);
    const csv = new TextDecoder().decode((await download(exportCsv, planner, white.batchId, white.outputId)).bytes).trimEnd().split("\r\n").slice(5);
    // CSV keeps its columns: Sarin Shape is the raw text; Normalized Shape stays blank where none is mapped.
    expect(csv.map((l) => l.split(",").slice(16, 18).map((c) => c.replace(/"/g, "")))).toEqual(preview.map((p) => [p.rawShape, p.normalizedShape ?? ""]));
  });

  test("the confirmed Kriss Cut rule changes nothing stored; Process Again makes a new traceable version", async () => {
    const r = await processAs(planner, csvFile(auditedWhite(), "white-remap.csv"), "WHITE", "GIA");
    const firstOutput = await currentOutput(planner, r.batchId!);
    const before = await db.sarinPlanPiece.findMany({ where: { outputVersionId: firstOutput }, orderBy: { outputRowSequence: "asc" }, select: { rawShape: true, shapeResolution: true, normalizedShape: true } });
    const firstSheet = JSON.stringify(inspectWorkbook((await download(exportWorkbook, planner, r.batchId!, firstOutput)).bytes).rows("2501"));
    // The client-confirmed rule: RAD MODIFIED is Kriss Cut, for every Ratio.
    await applyCatalog(mapper.cookie, [...MASTER, { rawShape: "RAD MODIFIED", normalizedShape: "Kriss Cut" }]);
    expect(await db.sarinPlanPiece.findMany({ where: { outputVersionId: firstOutput }, orderBy: { outputRowSequence: "asc" }, select: { rawShape: true, shapeResolution: true, normalizedShape: true } })).toEqual(before);
    const again = await continueProcessing(routeFetch(planner.cookie), r.batchId!, true, rightsOf((await sessionUser(planner.cookie)).permissions));
    expect(again.failure).toBe(null);
    const secondOutput = await currentOutput(planner, r.batchId!);
    expect(secondOutput === firstOutput).toBe(false);
    const versions = await db.sarinOutputVersion.findMany({ where: { batchId: r.batchId! }, orderBy: { versionNumber: "asc" }, select: { id: true, status: true, shapeMappingSetId: true } });
    expect(versions.map((v) => v.status)).toEqual(["SUPERSEDED", "GENERATED"]);
    expect(versions[0].shapeMappingSetId === versions[1].shapeMappingSetId).toBe(false);
    const now = await db.sarinPlanPiece.groupBy({ by: ["shapeResolution"], where: { outputVersionId: secondOutput }, _count: { _all: true } });
    expect(Object.fromEntries(now.map((g) => [g.shapeResolution, g._count._all]))).toEqual({ MAPPED: 234, RAW_PASSTHROUGH: 1 });
    const kriss = await db.sarinPlanPiece.findMany({ where: { outputVersionId: secondOutput, rawShape: "RAD MODIFIED" }, orderBy: { sourceRowNumber: "asc" }, select: { sourceRowNumber: true, normalizedShape: true, shapeResolution: true, mappingRule: { select: { rawShapeKey: true, normalizedShape: true } } } });
    expect(kriss.map((p) => [p.sourceRowNumber, p.normalizedShape, p.shapeResolution, p.mappingRule?.rawShapeKey])).toEqual([16, 67, 112, 156, 201].map((n) => [n, "Kriss Cut", "MAPPED", "RAD MODIFIED"]));
    expect(await db.sarinPlanPiece.count({ where: { outputVersionId: secondOutput, normalizedShape: "Radiant Modified" } })).toBe(0);
    // The new version warns only about the kite; the historical one is unchanged, warnings and export included.
    expect((await get(getOutput, planner, { batchId: r.batchId!, versionId: secondOutput })).json.unmappedShapes).toEqual({ shapes: [{ shape: "NP-1235-6-KITE", records: 1 }], records: 1, partial: false });
    expect((await get(getOutput, planner, { batchId: r.batchId!, versionId: firstOutput })).json.unmappedShapes.records).toBe(6);
    expect(await db.sarinPlanPiece.findMany({ where: { outputVersionId: firstOutput }, orderBy: { outputRowSequence: "asc" }, select: { rawShape: true, shapeResolution: true, normalizedShape: true } })).toEqual(before);
    expect(JSON.stringify(inspectWorkbook((await download(exportWorkbook, planner, r.batchId!, firstOutput)).bytes).rows("2501"))).toBe(firstSheet);
    // The new version agrees across preview, reopened detail, XLSX and CSV.
    resetRateLimits();
    const listed = (await call(listImports, { cookie: planner.cookie, path: "/api/planning/sarin/imports?pageSize=50" })).json.rows.find((b: any) => b.id === r.batchId);
    expect([listed.currentOutputId, listed.currentOutputUnmappedRows, fileStatus(listed)]).toEqual([secondOutput, 1, "Output Ready with Warnings"]);
    const preview = (await get(listPieces, planner, { batchId: r.batchId!, versionId: secondOutput }, "?pageSize=500")).json.rows as any[];
    const sheet = inspectWorkbook((await download(exportWorkbook, planner, r.batchId!, secondOutput)).bytes);
    const sheetRows = sheet.sheetNames.flatMap((n) => sheet.rows(n).slice(1));
    expect(sheetRows.map((c) => c[8]!.v)).toEqual(preview.map((p) => p.shape));
    expect([sheetRows.filter((c) => c[8]!.v === "Kriss Cut").length, sheetRows.filter((c) => c[8]!.v === "RAD MODIFIED").length, sheetRows.filter((c) => c[8]!.v === "NP-1235-6-KITE").length]).toEqual([5, 0, 1]);
    expect([sheet.rows(sheet.sheetNames[0])[0].length, sheetRows.every((c) => c[9]!.z === "0.000"), sheet.merges(sheet.sheetNames[0]).length > 0]).toEqual([19, true, true]);
    const csv = new TextDecoder().decode((await download(exportCsv, planner, r.batchId!, secondOutput)).bytes).trimEnd().split("\r\n").slice(5);
    expect(csv.map((l) => l.split(",")[17].replace(/"/g, ""))).toEqual(preview.map((p) => p.normalizedShape ?? ""));
    expect(csv.filter((l) => l.includes('"RAD MODIFIED","Kriss Cut"')).length).toBe(5);
    // Retrying changes nothing further.
    await continueProcessing(routeFetch(planner.cookie), r.batchId!, true, rightsOf((await sessionUser(planner.cookie)).permissions));
    expect(await db.sarinOutputVersion.count({ where: { batchId: r.batchId! } })).toBe(2);
  });
});

// =========================================================================================
describe("sarin shape pass-through: what still blocks", () => {
  const blue = (name: string, shapes: string[]) => shapes.map((shape, i): Rec => [name, "3.000", shape, (1.5 - i * 0.01).toFixed(3), "1.000"]);

  test("a blank shape still blocks output", async () => {
    const recs = blue("7201-001 DC", Array.from({ length: 17 }, (_, i) => (i === 4 ? "" : "ROUND")));
    const r = await processAs(planner, csvFile(recs, "blank-shape.csv"), "BLUE");
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect([batch.status, await db.sarinOutputVersion.count({ where: { batchId: batch.id } })]).toEqual(["NEEDS_REVIEW", 0]);
    const codes = (await get(listIssues, planner, { batchId: batch.id }, "?pageSize=50")).json.rows.map((i: any) => i.code);
    expect(codes.includes("SHAPE_MISSING")).toBe(true);
  });

  test("a malformed row still blocks output", async () => {
    const recs = blue("7202-001 DC", Array(17).fill("HEXA CUT"));
    const r = await processAs(planner, csvFile(recs, "malformed.csv", ["7202-001 DC,3.000,ROUND,1.000,VS1,D,61.1,1.000,7.6,7.5"]), "BLUE");
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect([batch.status, await db.sarinOutputVersion.count({ where: { batchId: batch.id } })]).toEqual(["NEEDS_REVIEW", 0]);
  });

  test("Pink keeps its positional contract: an unmapped shape blocks, with one finding per record", async () => {
    const name = "7203-111_M";
    const fam = ["ROUND", "LeoPear11", "LeoOval22", "EMERALD 5STEP", "EMERALD 4STEP", "ROUND", "ROUND", "ROUND", "ROUND"];
    const recs: Rec[] = [];
    fam.forEach((s) => recs.push([name, "3.000", s, "1.000", "1.000"], [name, "3.000", s, "1.000", "1.000"], [name, "3.000", "ROUND", "0.200", "1.000"]));
    for (let i = 0; i < 18; i++) recs.push([name, "3.000", "ROUND", "0.400", "1.000"]);
    const r = await processAs(planner, csvFile(recs, "pink-unmapped.csv"), "PINK");
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect([batch.status, await db.sarinOutputVersion.count({ where: { batchId: batch.id } })]).toEqual(["NEEDS_REVIEW", 0]);
    const rows = (await get(listIssues, planner, { batchId: batch.id }, "?pageSize=200")).json.rows.filter((i: any) => i.row?.number === 13 || i.sourceRowNumber === 13);
    expect(rows.map((i: any) => i.code)).toEqual(["SHAPE_UNMAPPED"]);
  });

  test("raw shape text can never become a spreadsheet formula", async () => {
    const recs = blue("7204-001 DC", [...Array(16).fill("ROUND"), "=HYPERLINK(1)"]);
    const r = await processAs(planner, csvFile(recs, "formula.csv"), "BLUE");
    expect(r.failure).toBe(null);
    const outputId = await currentOutput(planner, r.batchId!);
    const xlsx = await download(exportWorkbook, planner, r.batchId!, outputId);
    const wb = inspectWorkbook(xlsx.bytes);
    const cell = wb.rows(wb.sheetNames[0])[17][8] as { v: unknown; t: string; f?: string };
    expect([cell.v, cell.f, /<f[ >]/.test(wb.sheetXml(1))]).toEqual(["=HYPERLINK(1)", undefined, false]);
    const csv = new TextDecoder().decode((await download(exportCsv, planner, r.batchId!, outputId)).bytes);
    expect(csv.includes(`"'=HYPERLINK(1)"`)).toBe(true);
  });
});

// =========================================================================================
describe("sarin shape pass-through: the Kriss Cut shape", () => {
  test("mapping managers may map to Kriss Cut; others may not; only the exact canonical name is accepted", async () => {
    const save = (u: User, body: Record<string, unknown>) => {
      resetRateLimits();
      return call(saveMapping, { method: "POST", cookie: u.cookie, body: { applyTo: "ALL_RATIOS", ...body } });
    };
    expect((await save(planner, { sarinShape: "KRISS TEST", fantasyShape: "Kriss Cut" })).status).toBe(403);
    const lower = await save(mapper, { sarinShape: "KRISS TEST", fantasyShape: "kriss cut" });
    expect([lower.status, lower.json.error.message]).toEqual([400, "Choose a valid Fantasy shape"]);
    // A client cannot supply a code or an actor: unknown fields are refused.
    expect((await save(mapper, { sarinShape: "KRISS TEST", fantasyShape: "Kriss Cut", fantasyCode: "KC" })).status).toBe(400);
    expect((await save(mapper, { sarinShape: "KRISS TEST", fantasyShape: "Kriss Cut", changedByUserId: planner.user.id })).status).toBe(400);
    const ok = await save(mapper, { sarinShape: "KRISS TEST", fantasyShape: "Kriss Cut" });
    expect([ok.status, ok.json.message]).toEqual([200, "Mapping saved"]);
    const saved = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { rawShapeKey: "KRISS TEST", mappingSet: { status: "EFFECTIVE" } } });
    expect([saved.normalizedShape, saved.changedByUserId]).toEqual(["Kriss Cut", mapper.user.id]);
  });
});

// =========================================================================================
describe("sarin shape pass-through: access", () => {
  test("warnings and affected records follow the output's permissions and scope", async () => {
    expect((await get(listPieces, viewer, { batchId: white.batchId, versionId: white.outputId }, "?unmapped=true")).status).toBe(403);
    expect((await get(listPieces, planner, { batchId: white.batchId, versionId: white.outputId }, "?unmapped=yes")).status).toBe(400);
    const be = await processAs(planner, csvFile(auditedWhite(), "white-igi.csv"), "WHITE", "IGI");
    const beOutput = await currentOutput(planner, be.batchId!);
    expect([(await get(getOutput, scopedIn, { batchId: be.batchId!, versionId: beOutput })).status, (await get(listPieces, scopedIn, { batchId: be.batchId!, versionId: beOutput }, "?unmapped=true")).status, (await download(exportWorkbook, scopedIn, be.batchId!, beOutput)).status]).toEqual([404, 404, 404]);
    // Only a mapping manager is offered the way to Mappings; everyone sees the summary.
    const asPlanner = await render(white.batchId, planner);
    expect([asPlanner.text.includes("2 shapes are not mapped"), asPlanner.text.includes("Open Mappings")]).toEqual([true, false]);
  });
});
