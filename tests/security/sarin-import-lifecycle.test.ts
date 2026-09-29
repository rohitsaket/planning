// Workbook Import lifecycle: Process File stores the structured output in the database,
// the result and Recent Files reopen that stored output without processing again, exports
// are built from the same stored rows, and an archived import never answers a new upload.
//
// Files go through Workbook Import's own processing code (sarin-processing.ts) and the real
// route handlers against the isolated planning_sectest database, as real sessions. Imports
// are archived only through the real archive route. All data is synthetic.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { inspectWorkbook } from "./workbook-inspect";
import { applyCatalog, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as listImports } from "@/app/api/planning/sarin/imports/route";
import * as importRoute from "@/app/api/planning/sarin/imports/[batchId]/route";
import { GET as listPieces } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/pieces/route";
import { GET as exportWorkbook } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/workbook/route";
import { GET as exportCsv } from "@/app/api/planning/sarin/imports/[batchId]/outputs/[versionId]/export/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { processFile, rightsOf, type ProcessingStage } from "@/components/diamond/views/sarin/sarin-processing";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, planner: User, reader: User, viewer: User, mapper: User, scopedIn: User, labScoped: User;
const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const RULES: CatalogRule[] = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "LeoPear11", normalizedShape: "Pear" },
  { rawShape: "LeoOval22", normalizedShape: "Oval" },
];

// ---- synthetic Blue files -------------------------------------------------------------------
let nonce = 0;
const kapan = () => `4${String(++nonce).padStart(3, "0")}L`;
/** A Blue stone: 17 main plans and one additional group of two pieces. */
const blueStone = (name: string) => [
  ...Array.from({ length: 17 }, (_, i) => [name, "3.000", i % 2 ? "LeoOval22" : "ROUND", (1.5 - i * 0.01).toFixed(3)]),
  [name, "3.000", "LeoPear11", "0.500"],
  [name, "3.000", "ROUND", "0.400"],
];
const csvFile = (stones: string[][][], fileName: string) =>
  new File([new TextEncoder().encode(stones.flat().map((r) => [...r, "VS1", "G", "61.6", "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n") as BlobPart], fileName, { type: "text/csv" });

async function processAs(u: User, file: File, details: { labId?: string | null } = {}) {
  const stages: ProcessingStage[] = [];
  const rights = rightsOf((await sessionUser(u.cookie)).permissions);
  const r = await processFile(routeFetch(u.cookie), file, { packetType: "BLUE", labId: details.labId ?? null, planningDate: "2026-09-28" }, rights, (s) => stages.push(s));
  return { ...r, stages };
}
const get = (handler: any, u: User, params: Record<string, string>, query = "") => {
  resetRateLimits();
  return call(handler, { cookie: u.cookie, path: `/api/x${query}`, params });
};
async function download(handler: any, u: User, batchId: string, versionId: string) {
  resetRateLimits();
  const res = await handler(new Request(`http://localhost/api/x`, { headers: { cookie: u.cookie } }), { params: Promise.resolve({ batchId, versionId }) } as never);
  return { status: res.status, bytes: new Uint8Array(await res.arrayBuffer()) };
}
/** Every stored output row of a version, read through the paginated preview route. */
async function previewRows(u: User, batchId: string, versionId: string, pageSize = 7) {
  const rows: any[] = [];
  for (let page = 1; ; page++) {
    const r = await get(listPieces, u, { batchId, versionId }, `?pageSize=${pageSize}&page=${page}`);
    if (r.status !== 200) throw new Error(`pieces ${r.status}`);
    rows.push(...r.json.rows);
    if (!r.json.hasMore) return { rows, total: r.json.total, pages: page };
  }
}
const recentIds = async (u: User) => {
  resetRateLimits();
  return ((await call(listImports, { cookie: u.cookie, path: "/api/planning/sarin/imports?pageSize=100" })).json.rows as Array<{ id: string }>).map((r) => r.id);
};
const archive = async (u: User, batchId: string) => {
  resetRateLimits();
  return call(importRoute.DELETE, { method: "DELETE", cookie: u.cookie, params: { batchId } });
};
/** Everything an archived import holds, to prove it is left exactly as it was. */
const snapshotOf = async (batchId: string) => ({
  batch: await db.sarinImportBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true, archivedAt: true, statusChangedAt: true, validationAttempt: true, shapeMappingSetId: true } }),
  attempts: await db.sarinValidationAttempt.findMany({ where: { batchId }, select: { id: true, status: true }, orderBy: { attemptNumber: "asc" } }),
  outputs: await db.sarinOutputVersion.findMany({ where: { batchId }, select: { id: true, status: true, pieceCount: true }, orderBy: { versionNumber: "asc" } }),
  pieces: await db.sarinPlanPiece.count({ where: { batchId } }),
  rows: await db.sarinSourceRow.count({ where: { batchId } }),
});
const counts = async (batchId: string) => ({
  attempts: await db.sarinValidationAttempt.count({ where: { batchId } }),
  outputs: await db.sarinOutputVersion.count({ where: { batchId } }),
  pieces: await db.sarinPlanPiece.count({ where: { batchId } }),
});
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => renderPage(view, props, await sessionUser(u.cookie), u.cookie);
async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `LIFE_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Life ${name}`, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

beforeAll(async () => {
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("life.root", "SUPER_ADMIN");
  planner = await makeUser("life.planner", "PLANNER");
  reader = await makeUser("life.reader", "PLANNING_VIEWER");
  viewer = await makeUser("life.viewer", "VIEWER");
  mapper = await userWith("mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  scopedIn = await makeUser("life.scoped.in", "PLANNER");
  await db.userAccessScope.create({ data: { userId: scopedIn.user.id, dimension: "COUNTRY", value: "IN" } });
  labScoped = await makeUser("life.scoped.gia", "PLANNER");
  await db.userAccessScope.create({ data: { userId: labScoped.user.id, dimension: "LAB", value: "GIA" } });
});
beforeEach(async () => {
  resetRateLimits();
  await applyCatalog(mapper.cookie, RULES);
});

// =========================================================================================
describe("sarin import lifecycle: stored output", () => {
  test("Process File on a mapped Blue file reaches Output Ready with the structured output stored", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "stored.csv"));
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    const output = await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: batch.id } });
    expect([batch.status, output.status, output.stoneCount, output.optionCount, output.pieceCount]).toEqual(["VALIDATED", "GENERATED", 1, 18, 19]);
    // 17 main plans, then one additional group of two pieces, stored in output order.
    const options = await db.sarinPlanOption.findMany({ where: { outputVersionId: output.id }, orderBy: { optionSequence: "asc" }, select: { optionKind: true, pieceCount: true } });
    expect([options.filter((o) => o.optionKind === "MAIN").length, options.at(-1)]).toEqual([17, { optionKind: "ADDITIONAL", pieceCount: 2 }]);
    expect(await db.sarinPlanPiece.count({ where: { outputVersionId: output.id } })).toBe(19);
    // The detail the page reads names that stored output as current.
    const detail = await get(importRoute.GET, planner, { batchId: batch.id });
    expect([detail.status, detail.json.batch.currentOutputId]).toEqual([200, output.id]);
  });

  test("the preview pages through the stored rows; reopening shows the same rows without processing again", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`), blueStone(`${kapan()}-002 DC`)], "reopen.csv"));
    const outputId = (await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId;
    const stored = await db.sarinPlanPiece.findMany({ where: { outputVersionId: outputId }, orderBy: { outputRowSequence: "asc" }, select: { outputRowSequence: true, normalizedShape: true, estimatedWeight: true } });
    const first = await previewRows(planner, r.batchId!, outputId);
    expect([first.total, first.pages]).toEqual([38, 6]); // real server pages of 7 rows
    expect(first.rows.map((p) => [p.outputRow, p.normalizedShape, p.estimatedWeight])).toEqual(stored.map((p) => [p.outputRowSequence, p.normalizedShape, p.estimatedWeight.toFixed(3)]));
    const before = { ...(await counts(r.batchId!)), audits: await db.auditLog.count({ where: { entityId: r.batchId! } }) };
    // Open from Recent Files, twice, as the page does: detail, then the preview.
    for (let i = 0; i < 2; i++) {
      expect((await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId).toBe(outputId);
      expect((await previewRows(planner, r.batchId!, outputId, 50)).rows).toEqual(first.rows);
    }
    const page = await render(SarinFileResult, { batchId: r.batchId!, rights: rightsOf((await sessionUser(planner.cookie)).permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, planner);
    for (const label of ["Output Ready", "reopen.csv", "Blue", "2026-09-28", "Stones", "Output rows", "Export XLSX", "Process Another File"]) expect([label, page.text.includes(label)]).toEqual([label, true]);
    expect({ ...(await counts(r.batchId!)), audits: await db.auditLog.count({ where: { entityId: r.batchId! } }) }).toEqual(before);
  });

  test("XLSX and CSV exports are built from the same stored rows, row for row", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "export.csv"));
    const outputId = (await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId;
    const preview = (await previewRows(planner, r.batchId!, outputId, 100)).rows;
    const xlsx = await download(exportWorkbook, planner, r.batchId!, outputId);
    const wb = inspectWorkbook(xlsx.bytes);
    const sheet = wb.rows(wb.sheetNames[0]);
    expect([xlsx.status, sheet[0].length, sheet.length - 1]).toEqual([200, 19, preview.length]);
    expect(sheet.slice(1).map((c) => [c[8]!.v, Number(c[9]!.v).toFixed(3), c[9]!.z])).toEqual(preview.map((p) => [p.normalizedShape, p.estimatedWeight, "0.000"]));
    expect([sheet[1][17]!.z, wb.merges(wb.sheetNames[0]).includes("H19:H20")]).toEqual(["0.00%", true]);
    const csv = await download(exportCsv, planner, r.batchId!, outputId);
    const lines = new TextDecoder().decode(csv.bytes).trimEnd().split("\r\n").slice(5);
    // CSV columns 18 and 19: Normalized Shape and Est. Weight (ct).
    expect(lines.map((l) => l.split(",").slice(17, 19).map((c) => c.replace(/"/g, "")))).toEqual(preview.map((p) => [p.normalizedShape, p.estimatedWeight]));
  });

  test("a mapping change afterwards changes neither the stored output, its preview nor its export", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "history.csv"));
    const outputId = (await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId;
    const before = { preview: (await previewRows(planner, r.batchId!, outputId, 100)).rows, sheet: JSON.stringify(inspectWorkbook((await download(exportWorkbook, planner, r.batchId!, outputId)).bytes).rows("4" + String(nonce).padStart(3, "0") + "L")) };
    const setBefore = (await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: outputId } })).shapeMappingSetId;
    await applyCatalog(mapper.cookie, [{ rawShape: "ROUND", normalizedShape: "Old European Brilliant" }, ...RULES.slice(1)]);
    const after = { preview: (await previewRows(planner, r.batchId!, outputId, 100)).rows, sheet: JSON.stringify(inspectWorkbook((await download(exportWorkbook, planner, r.batchId!, outputId)).bytes).rows("4" + String(nonce).padStart(3, "0") + "L")) };
    expect(after).toEqual(before);
    expect(before.preview.some((p) => p.normalizedShape === "Round")).toBe(true);
    expect((await db.sarinOutputVersion.findUniqueOrThrow({ where: { id: outputId } })).shapeMappingSetId).toBe(setBefore);
  });
});

// =========================================================================================
describe("sarin import lifecycle: identity, idempotency and archive", () => {
  test("processing the same file again returns the existing output, adding nothing", async () => {
    const file = csvFile([blueStone(`${kapan()}-001 DC`)], "same.csv");
    const first = await processAs(planner, file);
    const before = await counts(first.batchId!);
    const again = await processAs(planner, file);
    expect([again.batchId, again.failure, again.stages]).toEqual([first.batchId, null, ["uploading"]]);
    expect(await counts(first.batchId!)).toEqual(before);
  });

  test("concurrent Process File requests for one new file produce one import and one output", async () => {
    const file = csvFile([blueStone(`${kapan()}-001 DC`)], "concurrent.csv");
    const results = await Promise.all([0, 1, 2].map(() => processAs(planner, file)));
    expect(new Set(results.map((r) => r.batchId)).size).toBe(1);
    expect(await counts(results[0].batchId!)).toEqual({ attempts: 1, outputs: 1, pieces: 19 });
  });

  test("an archived import never answers Process File: the same file becomes a new active import with its own output", async () => {
    const file = csvFile([blueStone(`${kapan()}-001 DC`)], "archived-then-again.csv");
    const old = await processAs(planner, file);
    expect((await archive(planner, old.batchId!)).status).toBe(200);
    const archived = await snapshotOf(old.batchId!);
    expect([archived.batch.status, archived.outputs.length, archived.pieces]).toEqual(["ARCHIVED", 1, 19]);
    expect(await recentIds(planner)).not.toContain(old.batchId);

    const fresh = await processAs(planner, file);
    expect([fresh.failure, fresh.stages, fresh.batchId === old.batchId]).toEqual([null, ["uploading", "checking", "preparing"], false]);
    const detail = (await get(importRoute.GET, planner, { batchId: fresh.batchId! })).json;
    expect([detail.batch.status, detail.batch.currentOutputId !== null]).toEqual(["VALIDATED", true]);
    const page = await render(SarinFileResult, { batchId: fresh.batchId!, rights: rightsOf((await sessionUser(planner.cookie)).permissions), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, planner);
    expect([page.text.includes("Output Ready"), page.text.includes("This file is archived")]).toEqual([true, false]);
    // Recent Files lists the new import and not the archived one; the archived one is unchanged history.
    const recent = await recentIds(planner);
    expect([recent.includes(fresh.batchId!), recent.includes(old.batchId!)]).toEqual([true, false]);
    expect(await snapshotOf(old.batchId!)).toEqual(archived);
    // History stays readable by those who may read imports.
    expect((await get(importRoute.GET, planner, { batchId: old.batchId! })).json.batch.status).toBe("ARCHIVED");
    expect((await previewRows(planner, old.batchId!, archived.outputs[0].id, 100)).total).toBe(19);
    // One source file holds both imports' evidence.
    const [a, b] = await Promise.all([old.batchId!, fresh.batchId!].map((id) => db.sarinImportBatch.findUniqueOrThrow({ where: { id }, select: { sourceFileId: true } })));
    expect(a.sourceFileId).toBe(b.sourceFileId);
  });

  test("concurrent re-uploads after archiving create exactly one new active import", async () => {
    const file = csvFile([blueStone(`${kapan()}-001 DC`)], "archived-concurrent.csv");
    const old = await processAs(planner, file);
    await archive(planner, old.batchId!);
    const results = await Promise.all([0, 1, 2].map(() => processAs(planner, file)));
    const ids = new Set(results.map((r) => r.batchId));
    expect([ids.size, ids.has(old.batchId)]).toEqual([1, false]);
    const sourceFileId = (await db.sarinImportBatch.findUniqueOrThrow({ where: { id: old.batchId! } })).sourceFileId;
    expect(await db.sarinImportBatch.count({ where: { sourceFileId, status: { not: "ARCHIVED" } } })).toBe(1);
    expect(await counts([...ids][0]!)).toEqual({ attempts: 1, outputs: 1, pieces: 19 });
  });

  test("the database allows one active import per identity, however many are archived", async () => {
    const file = csvFile([blueStone(`${kapan()}-001 DC`)], "identity.csv");
    const first = await processAs(planner, file);
    const batch = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: first.batchId! } });
    const identity = { sourceFileId: batch.sourceFileId, packetType: batch.packetType, contractVersion: batch.contractVersion, labScope: batch.labScope, planningDate: batch.planningDate, uploadedByUserId: planner.user.id, rowCount: 19, quarantinedRowCount: 0 };
    await expect(db.sarinImportBatch.create({ data: identity })).rejects.toThrow(/duplicate_identity|Unique constraint/);
    await archive(planner, first.batchId!);
    const second = await db.sarinImportBatch.create({ data: identity });
    expect(second.status).toBe("UPLOADED");
  });
});

// =========================================================================================
describe("sarin import lifecycle: access", () => {
  test("processing, detail, output rows and exports each need their permission", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "rbac.csv"));
    const outputId = (await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId;
    const denied = await processAs(viewer, csvFile([blueStone(`${kapan()}-001 DC`)], "rbac-denied.csv"));
    expect([denied.batchId, denied.failure?.error.status]).toEqual([null, 403]);
    expect([(await get(importRoute.GET, viewer, { batchId: r.batchId! })).status, (await get(listPieces, viewer, { batchId: r.batchId!, versionId: outputId })).status, (await download(exportWorkbook, viewer, r.batchId!, outputId)).status]).toEqual([403, 403, 403]);
    // A reader sees the stored output but may not export it or archive the import.
    expect([(await get(listPieces, reader, { batchId: r.batchId!, versionId: outputId })).status, (await download(exportWorkbook, reader, r.batchId!, outputId)).status, (await download(exportCsv, reader, r.batchId!, outputId)).status, (await archive(reader, r.batchId!)).status]).toEqual([200, 403, 403, 403]);
    expect((await call(importRoute.GET, { path: "/api/x", params: { batchId: r.batchId! } })).status).toBe(401);
  });

  test("another lab's import, output and export are not found; a country scope does not narrow Sarin imports", async () => {
    const igi = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "igi.csv"), { labId: "IGI" });
    const gia = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "gia.csv"), { labId: "GIA" });
    const igiOutput = (await get(importRoute.GET, planner, { batchId: igi.batchId! })).json.batch.currentOutputId;
    expect([(await get(importRoute.GET, labScoped, { batchId: igi.batchId! })).status, (await get(listPieces, labScoped, { batchId: igi.batchId!, versionId: igiOutput })).status, (await download(exportWorkbook, labScoped, igi.batchId!, igiOutput)).status, (await recentIds(labScoped)).includes(igi.batchId!)]).toEqual([404, 404, 404, false]);
    const giaOutput = (await get(importRoute.GET, planner, { batchId: gia.batchId! })).json.batch.currentOutputId;
    expect([(await get(importRoute.GET, labScoped, { batchId: gia.batchId! })).status, (await download(exportWorkbook, labScoped, gia.batchId!, giaOutput)).status]).toEqual([200, 200]);
    // Sarin imports carry no country, so a country-scoped user sees and processes them.
    expect([(await get(importRoute.GET, scopedIn, { batchId: igi.batchId! })).status, (await download(exportWorkbook, scopedIn, igi.batchId!, igiOutput)).status]).toEqual([200, 200]);
    const own = await processAs(scopedIn, csvFile([blueStone(`${kapan()}-001 DC`)], "country-scoped.csv"));
    expect([own.failure, own.batchId !== null]).toEqual([null, true]);
    // Processing for a lab outside the caller's scope is refused.
    const outside = await processAs(labScoped, csvFile([blueStone(`${kapan()}-001 DC`)], "outside.csv"), { labId: "IGI" });
    expect([outside.batchId, outside.failure?.error.status]).toEqual([null, 403]);
  });

  test("preview pages are bounded and ordered", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "pages.csv"));
    const outputId = (await get(importRoute.GET, planner, { batchId: r.batchId! })).json.batch.currentOutputId;
    expect((await get(listPieces, planner, { batchId: r.batchId!, versionId: outputId }, "?pageSize=501")).status).toBe(400);
    const beyond = await get(listPieces, planner, { batchId: r.batchId!, versionId: outputId }, "?pageSize=10&page=3");
    expect([beyond.status, beyond.json.rows, beyond.json.total, beyond.json.hasMore]).toEqual([200, [], 19, false]);
    const rows = (await previewRows(planner, r.batchId!, outputId, 4)).rows.map((p) => p.outputRow);
    expect(rows).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
  });

  test("Workbook Import lists the new import in Recent Files, with no Delete action", async () => {
    const r = await processAs(planner, csvFile([blueStone(`${kapan()}-001 DC`)], "listed.csv"));
    const page = await render(WorkbookImportView, {}, planner);
    expect([page.html.includes('aria-label="Open listed.csv"'), page.html.includes('aria-label="Export output of listed.csv"'), page.text.includes("Processed"), /Delete/.test(page.text)]).toEqual([true, true, true, false]);
    expect(await recentIds(planner)).toContain(r.batchId);
  });
});
