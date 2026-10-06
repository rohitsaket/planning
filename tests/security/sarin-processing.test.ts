import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, routeFetch, sessionUser } from "./ui-render";
import { inspectWorkbook } from "./workbook-inspect";
import { effectiveSnapshotId, applyCatalog, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { randomUUID } from "node:crypto";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { SessionUser } from "@/stores/auth-store";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { WORKBOOK_HEADERS } from "@/lib/sarin/output-workbook";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";
import { SarinFileResult } from "@/components/diamond/views/sarin/sarin-file-result";
import { MappingsView } from "@/components/diamond/views/consolidated/mappings-view";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import {
  continueProcessing,
  fileStatus,
  outputPath,
  processFile,
  processingFailureMessage,
  resultView,
  rightsOf,
  uploadFailureMessage,
  type ImportDetail,
  type ProcessingStage,
} from "@/components/diamond/views/sarin/sarin-processing";

type User = Awaited<ReturnType<typeof makeUser>>;
interface Session { cookie: string; user: SessionUser }
let root: User, planner: User, reader: User, manager: User, mapper: User, withRead: User, withManage: User;
let uploader: User, validator: User, generator: User, exporter: User, scoped: User;

const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const SHAPES = [["ROUND", "Round"], ["PEAR", "Pear"], ["OVAL", "Oval"], ["ASSCHER", "Asscher"], ["EMERALD", "Emerald"], ["RADIANT", "Radiant"], ["CUSHION", "Cushion Brilliant"], ["ANTIQUE CUSHION", "Antique Cushion"], ["HEART", "Heart"]] as const;
const SHAPE_RULES: CatalogRule[] = SHAPES.map(([rawShape, normalizedShape]) => ({ rawShape, normalizedShape }));

let nonce = 0;
const kapan = () => `9${String(++nonce).padStart(3, "0")}P`;
interface Rec { name: string; shape?: string; est?: string; rough?: string }
const csv = (recs: Rec[]) => recs.map((r) => [r.name, r.rough ?? "3.000", r.shape ?? "ROUND", r.est ?? "1.500", "VS1", "G", "61.6", "1.000", "7.62", "7.58", "4.69"].join(",")).join("\n") + "\n";
const csvFile = (recs: Rec[], name = "sarin.csv") => new File([new TextEncoder().encode(csv(recs)) as BlobPart], name, { type: "text/csv" });
const rows = (name: string, ests: string[], o: Partial<Rec> = {}) => ests.map((est) => ({ ...o, name, est }));
const details = (packetType: string, labId: string | null = null) => ({ packetType, labId, planningDate: "2026-09-28" });

function pinkStone(name: string, emerald = "EMERALD"): Rec[] {
  const recs: Rec[] = [];
  for (const [shape] of SHAPES) {
    const s = shape === "EMERALD" ? emerald : shape;
    recs.push({ name, shape: s, est: "1.000" }, { name, shape: s, est: "1.000" }, { name, shape: "ROUND", est: "0.200" });
  }
  for (const shape of ["EMERALD", "ROUND", "OVAL", "ROUND", "EMERALD", "OVAL"]) recs.push({ name, shape, est: "0.500" });
  for (const shape of ["ROUND", "OVAL", "EMERALD", "RADIANT", "CUSHION", "ANTIQUE CUSHION"]) recs.push({ name, shape, est: "0.400" }, { name, shape, est: shape === "OVAL" ? "0.404" : "0.400" });
  return recs;
}

const sessions = new Map<User, Session>();
const as = async (u: User): Promise<Session> => {
  if (!sessions.has(u)) sessions.set(u, { cookie: u.cookie, user: await sessionUser(u.cookie) });
  return sessions.get(u)!;
};
const rights = async (u: User) => rightsOf((await as(u)).user.permissions);
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => {
  const s = await as(u);
  return renderPage(view, props, s.user, s.cookie);
};
const fileResult = async (batchId: string, u: User) =>
  render(SarinFileResult, { batchId, rights: await rights(u), failure: null, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, u);

async function process(u: User, file: File, packetType: string, labId: string | null = null) {
  const stages: ProcessingStage[] = [];
  const result = await processFile(routeFetch(u.cookie), file, details(packetType, labId), await rights(u), (s) => stages.push(s));
  return { ...result, stages };
}
async function detailOf(batchId: string, u: User = planner): Promise<ImportDetail> {
  const res = await routeFetch(u.cookie)(`/api/planning/sarin/imports/${batchId}`);
  return (await res.json()) as ImportDetail;
}
const counts = async (batchId: string) => ({
  attempts: await db.sarinValidationAttempt.count({ where: { batchId } }),
  outputs: await db.sarinOutputVersion.count({ where: { batchId } }),
});
const audits = (action: string, batchId: string) => db.auditLog.count({ where: { action, entityId: batchId } });

async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `PROC_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Test ${name}`, permissions } })).status !== 200) throw new Error("role");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("assign");
  return u;
}

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("proc.root", "SUPER_ADMIN");
  planner = await makeUser("proc.planner", "PLANNER");
  reader = await makeUser("proc.reader", "PLANNING_VIEWER");
  manager = await makeUser("proc.manager", "PLANNING_MANAGER");
  mapper = await userWith("proc.mapper", ["sarin.mapping.read", "sarin.mapping.manage"]);
  withRead = await userWith("proc.reader.mappings", ["sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.mapping.read"]);
  withManage = await userWith("proc.manager.mappings", ["sarin.import.read", "sarin.mapping.read", "sarin.mapping.manage"]);
  uploader = await userWith("proc.uploader", ["sarin.import.read", "sarin.import.upload"]);
  validator = await userWith("proc.validator", ["sarin.import.read", "sarin.import.validate"]);
  generator = await userWith("proc.generator", ["sarin.import.read", "sarin.output.generate"]);
  exporter = await userWith("proc.exporter", ["sarin.import.read", "sarin.output.export"]);
  scoped = await makeUser("proc.scoped", "PLANNER");
  await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "LAB", value: "GIA" } });
});
beforeEach(async () => {
  resetRateLimits();
  await applyCatalog(mapper.cookie, SHAPE_RULES);
});

describe("sarin processing: one simple form", () => {
  test("the page is one compact form with Process File; no stage interface and no mapping choice", async () => {
    const page = await render(WorkbookImportView, {}, planner);
    for (const label of ["Prepare Sarin Output", "Sarin CSV file", "Packet Type", "Lab (optional)", "Planning date", "Process File", "CSV without a header · Maximum 8.0 MB", "Recent Files"]) {
      expect([label, page.text.includes(label)]).toEqual([label, true]);
    }
    expect([/country/i.test(page.html.match(/<form[\s\S]*<\/form>/)![0]), /stone[ -]?type/i.test(page.text)]).toEqual([false, false]);
    expect(/Parse|Validate|Revalidate|Generate Output|Review and Export|Import summary|Upload a Sarin file|\b[1-5] · |validation run|profile|immutable|Shape Mappings|records?\b/i.test(page.text)).toBe(false);
    expect(/Approved shape mapping|Choose a mapping|mapping version|Shape mappings are not configured/i.test(page.text)).toBe(false);
    expect(page.html.includes('aria-label="Import workflow"')).toBe(false);
  });

  test("Process File uses the mappings in effect, captured once and recorded with the check", async () => {
    const effective = await effectiveSnapshotId();
    const r = await process(planner, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500"))), "BLUE");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const attempt = await db.sarinValidationAttempt.findFirstOrThrow({ where: { batchId: r.batchId! } });
    const output = await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: r.batchId! } });
    expect([attempt.shapeMappingSetId, output.shapeMappingSetId]).toEqual([effective, effective]);
  });
});

describe("sarin processing: end to end", () => {
  test("valid Blue: upload, check and output in one run, with the XLSX structure of Phase 9", async () => {
    const k = kapan();
    const file = csvFile([...rows(`${k}-001 DC`, [...Array(17).fill("1.500"), "0.500", "0.400"]), ...rows(`${k}-0450 JV`, Array(17).fill("0.900"), { rough: "4.000" })], "blue.csv");
    const r = await process(planner, file, "BLUE");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking", "preparing"]]);
    const detail = await detailOf(r.batchId!);
    const view = resultView(detail, await rights(planner));
    expect([detail.batch.status, fileStatus(detail.batch), view.kind]).toEqual(["VALIDATED", "Output Ready", "ready"]);

    const res = await routeFetch(planner.cookie)(`${outputPath(r.batchId!, detail.batch.currentOutputId!)}/workbook`);
    const wb = inspectWorkbook(new Uint8Array(await res.arrayBuffer()));
    const sheet = wb.rows(k);
    expect(sheet[0].map((c) => (c === null ? null : c.v))).toEqual([...WORKBOOK_HEADERS]);
    expect([WORKBOOK_HEADERS.length, WORKBOOK_HEADERS[7]]).toEqual([19, ""]);
    expect([sheet[1][5]!.v, sheet[1][6]!.z, sheet[1][9]!.z, sheet[1][17]!.z, sheet[20][5]!.v]).toEqual(["001", "0.000", "0.000", "0.00%", "0450"]);
    expect([sheet.slice(1, 18).every((c) => c[7] === null), sheet[18][7]!.v, wb.merges(k).includes("H19:H20"), wb.merges(k).includes("R19:R20")]).toEqual([true, "2 Pcs", true, true]);
    expect(sheet.flat().some((c) => c !== null && (c as { f?: string }).f !== undefined)).toBe(false);
  });

  test("valid White: 32 main plans before its additional group", async () => {
    const k = `2${String(++nonce).padStart(3, "0")}`;
    const r = await process(planner, csvFile(rows(`${k}-0007 HA`, [...Array(32).fill("0.250"), "0.900", "0.800"], { rough: "10.000" }), "white.csv"), "WHITE");
    expect(r.failure).toBe(null);
    const detail = await detailOf(r.batchId!);
    expect(resultView(detail, await rights(planner)).kind).toBe("ready");
    const res = await routeFetch(planner.cookie)(`${outputPath(r.batchId!, detail.batch.currentOutputId!)}/workbook`);
    const sheet = inspectWorkbook(new Uint8Array(await res.arrayBuffer())).rows(k);
    expect([sheet.length, sheet.slice(1, 33).every((c) => c[7] === null), sheet[33][7]!.v, sheet[1][5]!.v]).toEqual([1 + 34, true, "2 Pcs", "0007"]);
  });

  test("synthetic Pink: MK, SL, BP and BT in one run, with the Best Twin item to review", async () => {
    const name = `${kapan().slice(0, 4)}-111_M`;
    const r = await process(planner, csvFile(pinkStone(name), "pink.csv"), "PINK");
    expect(r.failure).toBe(null);
    const detail = await detailOf(r.batchId!);
    expect(resultView(detail, await rights(planner))).toEqual({ kind: "ready", outputId: detail.batch.currentOutputId!, advisories: 1 });
    const res = await routeFetch(planner.cookie)(`${outputPath(r.batchId!, detail.batch.currentOutputId!)}/workbook`);
    const wb = inspectWorkbook(new Uint8Array(await res.arrayBuffer()));
    const codes = wb.rows(wb.sheetNames[0]).slice(1).map((c) => c[7]?.v ?? null).filter((v) => v !== null);
    expect([codes.filter((c) => c === "MK").length, codes.filter((c) => c === "SL").length, codes.filter((c) => c === "BP").length, codes.filter((c) => c === "BT").length]).toEqual([9, 9, 3, 6]);
    const page = (await fileResult(r.batchId!, planner)).text;
    expect([page.includes("Output Ready"), page.includes("Output ready with 1 item to review"), page.includes("Export XLSX")]).toEqual([true, true, true]);
  });

  test("real-style Pink stays blocked without an EMERALD 4STEP mapping; the shape is listed to map, nothing suggested", async () => {
    const name = `${kapan().slice(0, 4)}-112_M`;
    const r = await process(planner, csvFile(pinkStone(name, "EMERALD 4STEP"), "pink-real.csv"), "PINK");
    expect([r.failure, r.stages]).toEqual([null, ["uploading", "checking"]]);
    const detail = await detailOf(r.batchId!);
    expect([detail.batch.status, fileStatus(detail.batch), resultView(detail, await rights(planner)).kind, (await counts(r.batchId!)).outputs]).toEqual(["NEEDS_REVIEW", "Needs Attention", "attention", 0]);
    expect(await audits("SARIN_OUTPUT_REJECTED", r.batchId!)).toBe(0);
    const page = await fileResult(r.batchId!, planner);
    expect([page.text.includes("Output needs attention"), page.text.includes("Some shapes need mapping before output can be prepared."), page.text.includes("EMERALD 4STEP"), /SHAPE_UNMAPPED|\{"/.test(page.text)]).toEqual([true, true, true, false]);
    expect(/Asscher|Emerald\b|suggest/i.test(page.text.replace(/EMERALD 4STEP/g, ""))).toBe(false);
    expect([page.text.includes(r.batchId!), page.text.includes((await effectiveSnapshotId())!)]).toEqual([false, false]);
  });

  test("Process Again after the shape is mapped uses the new snapshot; earlier checks and outputs keep theirs", async () => {
    const ready = await process(planner, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "kept.csv"), "BLUE");
    const keptOutput = await db.sarinOutputVersion.findFirstOrThrow({ where: { batchId: ready.batchId! } });
    const r = await process(planner, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500"), { shape: "HEXA CUT" }), "map-again.csv"), "BLUE");
    expect(fileStatus((await detailOf(r.batchId!)).batch)).toBe("Output Ready with Warnings");
    const firstOutput = (await detailOf(r.batchId!)).batch.currentOutputId;
    const before = await effectiveSnapshotId();
    const after = await applyCatalog(mapper.cookie, [...SHAPE_RULES, { rawShape: "HEXA CUT", normalizedShape: "Kite" }]);
    const again = await continueProcessing(routeFetch(planner.cookie), r.batchId!, true, await rights(planner));
    expect([again.failure, fileStatus((await detailOf(r.batchId!)).batch)]).toEqual([null, "Output Ready"]);
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId: r.batchId! }, orderBy: { attemptNumber: "asc" } });
    expect(attempts.map((a) => a.shapeMappingSetId)).toEqual([before, after]);
    const versions = await db.sarinOutputVersion.findMany({ where: { batchId: r.batchId! }, orderBy: { versionNumber: "asc" }, select: { id: true, status: true } });
    expect(versions.map((v) => [v.id === firstOutput, v.status])).toEqual([[true, "SUPERSEDED"], [false, "GENERATED"]]);
    expect(await db.sarinOutputVersion.findMany({ where: { batchId: ready.batchId! }, select: { id: true, shapeMappingSetId: true, status: true } })).toEqual([{ id: keptOutput.id, shapeMappingSetId: before, status: "GENERATED" }]);
  });
});

describe("sarin processing: partial completion and retries", () => {
  test("an upload followed by a failed check keeps the import; Try Again resumes it without duplicates", async () => {
    const file = csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "retry.csv");
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_inject_check_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected check failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_check_failure BEFORE INSERT ON "SarinRowInterpretation" FOR EACH ROW EXECUTE FUNCTION test_inject_check_failure()`);
    let first: Awaited<ReturnType<typeof process>>;
    try {
      first = await process(planner, file, "BLUE");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_check_failure ON "SarinRowInterpretation"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_check_failure()`);
    }
    const batchId = first.batchId!;
    expect([first.failure?.stage, first.failure?.error.code, first.failure?.error.status]).toEqual(["checking", "VALIDATION_NOT_COMPLETED", 500]);
    const message = processingFailureMessage(first.failure!.error);
    expect([message.startsWith("Output could not be prepared. Try again."), /Reference [0-9a-f]{8}\./.test(message), /injected|VALIDATION_|500|\/api\//.test(message.replace(/Reference [0-9a-f]{8}\./, ""))]).toEqual([true, true, false]);
    const failed = await detailOf(batchId);
    expect([failed.batch.status, resultView(failed, await rights(planner)).kind]).toEqual(["FAILED", "retry"]);
    const page = (await render(SarinFileResult, { batchId, rights: await rights(planner), failure: first.failure, busy: false, onProcessAgain: () => {}, onProcessAnother: () => {} }, planner)).text;
    expect([page.includes("The file was uploaded, but output could not be prepared."), page.includes("Try Again")]).toEqual([true, true]);

    const retry = await continueProcessing(routeFetch(planner.cookie), batchId, false, await rights(planner));
    expect([retry.failure, fileStatus((await detailOf(batchId)).batch)]).toEqual([null, "Output Ready"]);
    expect(await counts(batchId)).toEqual({ attempts: 2, outputs: 1 });

    const again = await process(planner, file, "BLUE");
    expect([again.batchId, again.failure, again.stages]).toEqual([batchId, null, ["uploading"]]);
    expect(await counts(batchId)).toEqual({ attempts: 2, outputs: 1 });
    expect(await db.sarinImportBatch.count({ where: { sourceFile: { sanitizedFileName: "retry.csv" } } })).toBe(1);
    await continueProcessing(routeFetch(planner.cookie), batchId, true, await rights(planner));
    await continueProcessing(routeFetch(planner.cookie), batchId, false, await rights(planner));
    expect(await counts(batchId)).toEqual({ attempts: 2, outputs: 1 });
  });

  test("a prepared check whose output failed resumes with output only; a busy file is reported, not retried", async () => {
    const file = csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "output-retry.csv");
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_inject_output_failure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected output failure'; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_output_failure BEFORE INSERT ON "SarinPlanPiece" FOR EACH ROW EXECUTE FUNCTION test_inject_output_failure()`);
    let first: Awaited<ReturnType<typeof process>>;
    try {
      first = await process(planner, file, "BLUE");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_output_failure ON "SarinPlanPiece"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_output_failure()`);
    }
    const batchId = first.batchId!;
    expect([first.failure?.stage, first.failure?.error.code]).toEqual(["preparing", "OUTPUT_NOT_GENERATED"]);
    expect([await counts(batchId), await db.sarinPlanOption.count({ where: { batchId } })]).toEqual([{ attempts: 1, outputs: 0 }, 0]);
    const detail = await detailOf(batchId);
    expect([detail.batch.status, resultView(detail, await rights(planner)).kind]).toEqual(["VALIDATED", "retry"]);
    const stages: ProcessingStage[] = [];
    const retry = await continueProcessing(routeFetch(planner.cookie), batchId, false, await rights(planner), (s) => stages.push(s));
    expect([retry.failure, stages, await counts(batchId)]).toEqual([null, ["preparing"], { attempts: 1, outputs: 1 }]);
  });

  test("changed validation rules: the file must be processed again, and Process Again checks it against the mappings in effect", async () => {
    const r = await process(uploader, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "reprocess.csv"), "BLUE");
    const batchId = r.batchId!;
    const setId = (await effectiveSnapshotId())!;
    const b = await db.sarinImportBatch.update({
      where: { id: batchId },
      data: { status: "VALIDATING", validationAttempt: { increment: 1 }, fencingVersion: { increment: 1 }, claimToken: randomUUID(), claimedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), shapeMappingSetId: setId },
    });
    const old = await db.sarinValidationAttempt.create({ data: { batchId, attemptNumber: b.validationAttempt, shapeMappingSetId: setId, startedByUserId: planner.user.id, claimFencingVersion: b.fencingVersion, validationProfileVersion: "SARIN_VALIDATION_V2" } });
    await db.sarinValidationAttempt.update({ where: { id: old.id }, data: { status: "COMPLETED", result: "VALIDATED", blockCount: 0, parsedBlockCount: 0, quarantinedBlockCount: 0, interpretationCount: 0, issueCount: 0, blockingIssueCount: 0 } });
    await db.sarinImportBatch.update({ where: { id: batchId }, data: { status: "VALIDATED", claimToken: null, claimedAt: null, leaseExpiresAt: null } });

    const detail = await detailOf(batchId);
    expect([fileStatus(detail.batch), resultView(detail, await rights(planner)).kind]).toEqual(["Needs Attention", "reprocess"]);
    const page = (await fileResult(batchId, planner)).text;
    expect([page.includes("This file needs to be processed again."), page.includes("Process Again"), /profile|V2|validat/i.test(page)]).toEqual([true, true, false]);
    await continueProcessing(routeFetch(generator.cookie), batchId, false, await rights(generator));
    expect(await counts(batchId)).toEqual({ attempts: 1, outputs: 0 });
    const again = await continueProcessing(routeFetch(planner.cookie), batchId, true, await rights(planner));
    expect([again.failure, fileStatus((await detailOf(batchId)).batch), await counts(batchId)]).toEqual([null, "Output Ready", { attempts: 2, outputs: 1 }]);
  });

  test("upload refusals read as short business messages", async () => {
    const refusals: Array<[File, string]> = [
      [new File([new TextEncoder().encode("a,b\n") as BlobPart], "plan.xlsx"), "The file format is not supported."],
      [new File([new Uint8Array([0x41, 0x00, 0x42, 0x0a]) as BlobPart], "bin.csv"), "The file format is not supported."],
      [new File([new Uint8Array(0) as BlobPart], "empty.csv"), "The file is empty."],
      [new File([new Uint8Array(8 * 1024 * 1024 + 1).fill(65) as BlobPart], "big.csv"), "The file is too large."],
    ];
    for (const [file, expected] of refusals) {
      const r = await process(planner, file, "BLUE");
      expect([file.name, r.batchId, uploadFailureMessage(r.failure!.error, null)]).toEqual([file.name, null, expected]);
    }
  });
});

describe("sarin processing: permissions and scope", () => {
  test("upload-only: File submitted for processing; no check can be started", async () => {
    const r = await process(uploader, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "up.csv"), "BLUE");
    expect([r.failure, r.stages, (await counts(r.batchId!)).attempts]).toEqual([null, ["uploading"], 0]);
    const page = (await fileResult(r.batchId!, uploader)).text;
    expect([page.includes("File submitted for processing"), page.includes("Process File")]).toEqual([true, false]);
    const form = (await render(WorkbookImportView, {}, uploader)).text;
    expect(form.includes("Process File")).toBe(true);
    const denied = await routeFetch(uploader.cookie)(`/api/planning/sarin/imports/${r.batchId}/validate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(denied.status).toBe(403);

    const checked = await continueProcessing(routeFetch(validator.cookie), r.batchId!, true, await rights(validator));
    const detail = await detailOf(r.batchId!);
    expect([checked.failure, detail.batch.status, resultView(detail, await rights(validator)).kind, (await counts(r.batchId!)).outputs]).toEqual([null, "VALIDATED", "awaiting-output", 0]);
    expect((await fileResult(r.batchId!, validator)).text.includes("The output will be prepared by an authorized user.")).toBe(true);
    const genDenied = await routeFetch(validator.cookie)(`/api/planning/sarin/imports/${r.batchId}/outputs`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(genDenied.status).toBe(403);

    const prepared = await continueProcessing(routeFetch(generator.cookie), r.batchId!, false, await rights(generator));
    const ready = await detailOf(r.batchId!);
    expect([prepared.failure, fileStatus(ready.batch), await counts(r.batchId!)]).toEqual([null, "Output Ready", { attempts: 1, outputs: 1 }]);
    expect((await fileResult(r.batchId!, generator)).text.includes("Export XLSX")).toBe(false);

    const url = `${outputPath(r.batchId!, ready.batch.currentOutputId!)}/workbook`;
    expect([(await routeFetch(exporter.cookie)(url)).status, (await routeFetch(generator.cookie)(url)).status]).toEqual([200, 403]);
    expect((await fileResult(r.batchId!, exporter)).text.includes("Export XLSX")).toBe(true);
    const exporterUpload = await process(exporter, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500"))), "BLUE");
    expect(uploadFailureMessage(exporterUpload.failure!.error, null)).toBe("You do not have permission to upload files.");
  });

  test("Recent Files shows business statuses and only the actions each user may take", async () => {
    await process(uploader, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "waiting.csv"), "BLUE");
    const list = (await (await routeFetch(planner.cookie)("/api/planning/sarin/imports?pageSize=100")).json()) as { rows: Array<Parameters<typeof fileStatus>[0] & { id: string; status: string }> };
    const statuses = new Set(list.rows.map((b) => fileStatus(b)));
    expect(["Output Ready", "Needs Attention", "Processing"].every((s) => statuses.has(s as never))).toBe(true);
    const plannerPage = await render(WorkbookImportView, {}, planner);
    const exporterPage = await render(WorkbookImportView, {}, exporter);
    const readerPage = await render(WorkbookImportView, {}, reader);
    expect([plannerPage.html.includes('aria-label="Open '), plannerPage.html.includes('aria-label="Export output of '), plannerPage.html.includes('aria-label="Process ')]).toEqual([true, true, true]);
    expect([exporterPage.html.includes('aria-label="Export output of '), exporterPage.html.includes('aria-label="Process ')]).toEqual([true, false]);
    expect([readerPage.html.includes('aria-label="Open '), readerPage.html.includes('aria-label="Export output of '), readerPage.html.includes('aria-label="Process '), readerPage.text.includes("Process File")]).toEqual([true, false, false, false]);
    expect(/VALIDATING|NEEDS_REVIEW|VALIDATED|UPLOADED|Delete/.test(plannerPage.text)).toBe(false);
  });

  test("lab scope: another lab's file cannot be continued, exported or listed", async () => {
    const be = await process(planner, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500")), "igi.csv"), "BLUE", "IGI");
    const outputId = (await detailOf(be.batchId!)).batch.currentOutputId!;
    const attempt = await continueProcessing(routeFetch(scoped.cookie), be.batchId!, true, await rights(scoped));
    expect([attempt.failure?.error.status, processingFailureMessage(attempt.failure!.error)]).toEqual([404, "This file is not available."]);
    expect((await routeFetch(scoped.cookie)(`${outputPath(be.batchId!, outputId)}/workbook`)).status).toBe(404);
    const listed = (await (await routeFetch(scoped.cookie)("/api/planning/sarin/imports?pageSize=100")).json()) as { rows: Array<{ id: string }> };
    expect(listed.rows.some((b) => b.id === be.batchId)).toBe(false);
    const outside = await process(scoped, csvFile(rows(`${kapan()}-001 DC`, Array(17).fill("1.500"))), "BLUE", "IGI");
    expect([outside.batchId, outside.failure?.error.status]).toEqual([null, 403]);
  });
});

describe("sarin processing: Sarin Shape Mapping under Mappings", () => {
  test("it is the Sarin Shape Mapping tab of Administration → Mappings, visible only with sarin.mapping.read", async () => {
    const asMapper = await render(SarinShapeMappingsView, {}, mapper);
    for (const label of ["Sarin Shape Mapping", "Current mappings", "Add Mapping"]) expect([label, asMapper.text.includes(label)]).toEqual([label, true]);
    const managerPerms = (await sessionUser(manager.cookie)).permissions;
    expect([isViewAuthorized((await sessionUser(mapper.cookie)).permissions, "admin-mappings"), managerPerms.includes("sarin.mapping.read")]).toEqual([true, false]);
    const host = await render(MappingsView, {}, root);
    expect([host.text.includes("Mappings"), host.text.includes("Sarin Shape Mapping"), host.text.includes("Business Rules")]).toEqual([true, true, false]);
    const workbook = await render(WorkbookImportView, {}, root);
    expect([workbook.text.includes("Shape-mapping versions"), workbook.html.includes('role="tablist"')]).toEqual([false, false]);
  });

  test("on a blocked file only a mapping manager is offered Map and Open Mappings; readers and planners are not", async () => {
    const name = `${kapan().slice(0, 4)}-113_M`;
    const r = await process(planner, csvFile(pinkStone(name, "EMERALD 4STEP"), "pink-link.csv"), "PINK");
    const asManager = await fileResult(r.batchId!, withManage);
    const asReader = await fileResult(r.batchId!, withRead);
    const asPlanner = await fileResult(r.batchId!, planner);
    expect([asManager.html.includes('aria-label="Map EMERALD 4STEP"'), asManager.text.includes("Open Mappings")]).toEqual([true, true]);
    expect([asReader.html.includes('aria-label="Map EMERALD 4STEP"'), asReader.text.includes("Open Mappings")]).toEqual([false, false]);
    expect([asPlanner.html.includes('aria-label="Map EMERALD 4STEP"'), asPlanner.text.includes("Open Mappings")]).toEqual([false, false]);
  });
});
