// Sarin raw CSV ingestion: upload, idempotency, scope, parsing evidence and history reads.
//
// Every upload goes through the real POST route handler with a real multipart body and
// Content-Length, and every read through the real GET handlers, against the isolated
// planning_sectest database. The transaction-rollback test injects its failure with a
// database trigger, so no test-only branch exists in the service. All CSV content is
// synthetic and follows the confirmed 11-field contract; no customer file is used.

import { createHash } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { validateNumericEnv } from "@/lib/config/numeric-env";
import { GET as listImports, POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { GET as importDetail } from "@/app/api/planning/sarin/imports/[batchId]/route";
import { GET as importRows } from "@/app/api/planning/sarin/imports/[batchId]/rows/route";
import { MULTIPART_OVERHEAD_BYTES, PROXY_BODY_LIMIT_BYTES, SARIN_INGESTION_BOUNDS, SARIN_INGESTION_LIMITS } from "@/lib/sarin/ingestion-config";
import { decodeSarinSource } from "@/lib/sarin/source-decoding";
import { interpretSarinRecord } from "@/lib/sarin/raw-contract";
import { ingestSarinSource } from "@/lib/sarin/import-service";
import { sanitizeSarinFileName } from "@/lib/sarin/upload-request";

const URL_ = "http://localhost:3000/api/planning/sarin/imports";
const SARIN_TABLES = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

type User = Awaited<ReturnType<typeof makeUser>>;
let planner: User, viewer: User, planningViewer: User, auditor: User, admin: User;

// ---- synthetic Sarin records -----------------------------------------------------------
let nonce = 0;
/** A distinct kapan per call, so no two tests upload the same bytes by accident. */
const kapan = () => `9${String(++nonce).padStart(3, "0")}X`;
function record(k: string, i: number, o: Partial<Record<"name" | "rough" | "shape" | "est" | "depth" | "ratio" | "length" | "width" | "mm", string>> = {}) {
  return [o.name ?? `${k}-${String(i).padStart(3, "0")} ZZ`, o.rough ?? "5.413", o.shape ?? "ROUND", o.est ?? "1.664", "IF", "D", o.depth ?? "61.6", o.ratio ?? "1", o.length ?? "7.62", o.width ?? "7.62", o.mm ?? "4.69"].join(",");
}
function csv(count: number, eol = "\n") {
  const k = kapan();
  return Array.from({ length: count }, (_, i) => record(k, i + 1)).join(eol) + eol;
}

// ---- requests --------------------------------------------------------------------------
interface UploadOptions {
  cookie?: string;
  files?: Array<{ bytes: Uint8Array | string; name?: string; type?: string }>;
  fields?: Record<string, string | string[] | undefined>;
  contentLength?: string | null;
}

async function upload(o: UploadOptions = {}) {
  resetRateLimits(); // the limiter is defence in depth, not what these tests exercise
  const fd = new FormData();
  for (const f of o.files ?? []) fd.append("file", new File([(typeof f.bytes === "string" ? new TextEncoder().encode(f.bytes) : f.bytes) as BlobPart], f.name ?? "sarin.csv", { type: f.type ?? "text/csv" }));
  const fields = { stoneType: "BLUE", country: "IN", planningDate: "2026-09-26", ...(o.fields ?? {}) };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const headers: Record<string, string> = { "content-type": encoded.headers.get("content-type")! };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.contentLength !== null) headers["content-length"] = o.contentLength ?? String(body.length);
  const res = await uploadImport(new Request(URL_, { method: "POST", headers, body }), { params: Promise.resolve({}) } as never);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const uploadCsv = (cookie: string, content: Uint8Array | string, fields: UploadOptions["fields"] = {}, name = "sarin.csv") => upload({ cookie, files: [{ bytes: content, name }], fields });

function rows(cookie: string, batchId: string, query = "") {
  resetRateLimits();
  return call(importRows, { cookie, path: `/api/planning/sarin/imports/${batchId}/rows${query}`, params: { batchId } });
}
function detail(cookie: string, batchId: string) {
  resetRateLimits();
  return call(importDetail, { cookie, path: `/api/planning/sarin/imports/${batchId}`, params: { batchId } });
}
function list(cookie: string, query = "") {
  resetRateLimits();
  return call(listImports, { cookie, path: `/api/planning/sarin/imports${query}` });
}

async function grantScope(userId: string, countries: string[], labs: string[]) {
  await db.userAccessScope.deleteMany({ where: { userId } });
  const data = [...countries.map((value) => ({ userId, dimension: "COUNTRY", value })), ...labs.map((value) => ({ userId, dimension: "LAB", value }))];
  if (data.length) await db.userAccessScope.createMany({ data });
}

const counts = async () => ({
  files: await db.sarinSourceFile.count(),
  batches: await db.sarinImportBatch.count(),
  rows: await db.sarinSourceRow.count(),
});

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_TABLES.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  // Uploads are checked against the canonical registries since validation hardening.
  await ensureCountryRegistry(["IN", "BE"]);
  await ensureLabRegistry(["GIA"]);
  planner = await makeUser("ingest.planner", "PLANNER");
  viewer = await makeUser("ingest.viewer", "VIEWER");
  planningViewer = await makeUser("ingest.pviewer", "PLANNING_VIEWER");
  auditor = await makeUser("ingest.auditor", "AUDITOR");
  admin = await makeUser("ingest.admin", "ADMIN");
});
beforeEach(() => resetRateLimits());

// =========================================================================================
describe("sarin ingestion: authorization and scope", () => {
  test("anonymous upload → 401", async () => {
    expect((await upload({ files: [{ bytes: csv(1) }] })).status).toBe(401);
  });

  test("roles without sarin.import.upload are refused and nothing is stored", async () => {
    const before = await counts();
    for (const u of [viewer, planningViewer, auditor, admin]) {
      const r = await uploadCsv(u.cookie, csv(2));
      expect([u.user.username, r.status]).toEqual([u.user.username, 403]);
    }
    expect(await counts()).toEqual(before);
  });

  test("a planner's upload is stored as UPLOADED and says so honestly", async () => {
    const content = csv(3);
    const r = await uploadCsv(planner.cookie, content, { stoneType: "WHITE", planningDate: "2026-09-01" });
    expect(r.status).toBe(201);
    expect([r.json.created, r.json.duplicate]).toEqual([true, false]);
    const b = r.json.batch;
    expect([b.status, b.validationAttempts, b.stoneType, b.planningDate, b.country, b.labId]).toEqual(["UPLOADED", 0, "WHITE", "2026-09-01", "IN", null]);
    expect(b.counts).toEqual({ records: 3, accepted: 3, quarantined: 0, rejectedStructure: 0 });
    expect([b.sourceFile.fileName, b.sourceFile.byteSize, b.sourceFile.sha256]).toEqual(["sarin.csv", Buffer.byteLength(content), sha256(content)]);
    // Stored, not validated: the response makes no claim beyond that.
    expect(/parsed cleanly|validated|ready/i.test(r.text)).toBe(false);
    const stored = await db.sarinImportBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect([stored.uploadedByUserId, stored.status, stored.validationAttempt]).toEqual([planner.user.id, "UPLOADED", 0]);
    const audits = await db.auditLog.findMany({ where: { action: "SARIN_IMPORT_UPLOADED", entityId: b.id } });
    expect(audits.map((a) => [a.actorUserId, a.outcome])).toEqual([[planner.user.id, "SUCCESS"]]);
  });

  test("an upload outside the actor's country or lab is refused with 403 and audited as denied", async () => {
    const scoped = await makeUser("ingest.scoped.in", "PLANNER");
    await grantScope(scoped.user.id, ["IN"], []);
    const before = await counts();
    expect((await uploadCsv(scoped.cookie, csv(1), { country: "BE" })).status).toBe(403);
    expect(await counts()).toEqual(before);
    const denied = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_IMPORT_UPLOAD_REJECTED", actorUserId: scoped.user.id } });
    expect([denied.outcome, JSON.parse(denied.after!).reasonCode]).toEqual(["DENIED", "FORBIDDEN"]);
    expect((await uploadCsv(scoped.cookie, csv(1), { country: "IN" })).status).toBe(201);

    const labbed = await makeUser("ingest.scoped.lab", "PLANNER");
    await grantScope(labbed.user.id, [], ["GIA"]);
    expect((await uploadCsv(labbed.cookie, csv(1), { labId: "HRD" })).status).toBe(403);
    // A lab-limited actor must declare a lab, or the batch would sit outside their own scope.
    expect((await uploadCsv(labbed.cookie, csv(1))).status).toBe(403);
    const ok = await uploadCsv(labbed.cookie, csv(1), { labId: "GIA" });
    expect([ok.status, ok.json.batch.labId]).toEqual([201, "GIA"]);
  });

  test("reads are scoped in the query: other countries are absent from lists, totals and lookups", async () => {
    const be = (await uploadCsv(planner.cookie, csv(2), { country: "BE" })).json.batch;
    const inn = (await uploadCsv(planner.cookie, csv(2), { country: "IN" })).json.batch;
    const reader = await makeUser("ingest.reader.in", "PLANNING_VIEWER");
    await grantScope(reader.user.id, ["IN"], []);

    const l = await list(reader.cookie, "?pageSize=100");
    expect(l.status).toBe(200);
    expect(l.json.rows.every((r: any) => r.country === "IN")).toBe(true);
    expect(l.json.total).toBe(await db.sarinImportBatch.count({ where: { country: "IN" } }));
    expect(l.json.rows.some((r: any) => r.id === inn.id)).toBe(true);
    expect((await list(reader.cookie, "?country=BE")).status).toBe(403);

    expect((await detail(reader.cookie, be.id)).status).toBe(404);
    expect((await rows(reader.cookie, be.id)).status).toBe(404);
    expect((await detail(reader.cookie, inn.id)).status).toBe(200);

    // A lab-limited reader cannot see a batch that declares no lab.
    const labReader = await makeUser("ingest.reader.lab", "PLANNING_VIEWER");
    await grantScope(labReader.user.id, [], ["GIA"]);
    expect((await detail(labReader.cookie, inn.id)).status).toBe(404);
  });

  test("read permission governs history: the auditor reads, the viewer is refused", async () => {
    expect((await list(auditor.cookie)).status).toBe(200);
    expect((await list(viewer.cookie)).status).toBe(403);
    const b = (await uploadCsv(planner.cookie, csv(1))).json.batch;
    expect((await detail(viewer.cookie, b.id)).status).toBe(403);
    expect((await rows(viewer.cookie, b.id)).status).toBe(403);
  });
});

// =========================================================================================
describe("sarin ingestion: file safety", () => {
  test("LF, CRLF and mixed endings yield identical records; stored bytes stay exactly as uploaded", async () => {
    const k = kapan();
    const recs = [record(k, 1), record(k, 2), record(k, 3)];
    const variants = [recs.join("\n") + "\n", recs.join("\r\n") + "\r\n", `${recs[0]}\r\n${recs[1]}\n${recs[2]}`];
    const hashes: string[][] = [];
    for (const v of variants) {
      const r = await uploadCsv(planner.cookie, v);
      expect(r.status).toBe(201);
      const stored = await db.sarinSourceRow.findMany({ where: { batchId: r.json.batch.id }, orderBy: { sourceRowNumber: "asc" } });
      expect(stored.map((s) => s.rawLine)).toEqual(recs);
      hashes.push(stored.map((s) => s.rowHash));
      const content = await db.sarinSourceFileContent.findFirstOrThrow({ where: { sourceFile: { sha256: sha256(v) } } });
      expect(Buffer.from(content.content).equals(Buffer.from(v))).toBe(true);
    }
    expect(hashes[1]).toEqual(hashes[0]);
    expect(hashes[2]).toEqual(hashes[0]);
  });

  test("a UTF-8 BOM is accepted, removed for reading only, and kept in the stored bytes", async () => {
    const text = csv(2);
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    const r = await uploadCsv(planner.cookie, bytes);
    expect([r.status, r.json.batch.sourceFile.encoding, r.json.batch.sourceFile.sha256]).toEqual([201, "UTF-8-BOM", sha256(bytes)]);
    const first = await db.sarinSourceRow.findFirstOrThrow({ where: { batchId: r.json.batch.id, sourceRowNumber: 1 } });
    expect(first.rawLine).toBe(text.split("\n")[0]);
    const content = await db.sarinSourceFileContent.findFirstOrThrow({ where: { sourceFile: { sha256: sha256(bytes) } } });
    expect(Buffer.from(content.content).equals(Buffer.from(bytes))).toBe(true);
  });

  test("empty, non-UTF-8, UTF-16, binary and disguised archives are refused before anything is stored", async () => {
    const before = await counts();
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(record(kapan(), 1), "utf16le")]);
    const cases: Array<[string, Uint8Array | string, string]> = [
      ["empty", "", "EMPTY_FILE"],
      ["BOM only", new Uint8Array([0xef, 0xbb, 0xbf]), "EMPTY_FILE"],
      ["invalid UTF-8", new Uint8Array([0x41, 0xc3, 0x28, 0x0a]), "INVALID_UTF8"],
      ["UTF-16 with BOM", utf16, "UNSUPPORTED_ENCODING"],
      ["UTF-16 without BOM", Buffer.from(record(kapan(), 1), "utf16le"), "BINARY_CONTENT"],
      ["NUL byte", `${record(kapan(), 1)}\u0000\n`, "BINARY_CONTENT"],
      ["ZIP/XLSX renamed .csv", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]), "NOT_A_CSV_FILE"],
      ["executable renamed .csv", new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]), "NOT_A_CSV_FILE"],
      ["control character", `${record(kapan(), 1)}\u0007\n`, "CONTROL_CHARACTERS"],
      ["bare carriage return", `${record(kapan(), 1)}\r${record(kapan(), 2)}\n`, "BARE_CARRIAGE_RETURN"],
    ];
    for (const [label, bytes, code] of cases) {
      const r = await uploadCsv(planner.cookie, bytes);
      expect([label, r.status, r.json?.error?.code]).toEqual([label, 400, code]);
    }
    expect(await counts()).toEqual(before);
  });

  test("size and record limits answer 413 — declared length, actual file size, records, line and field", async () => {
    const before = await counts();
    const L = SARIN_INGESTION_LIMITS;
    // Declared length alone: refused before the body is read.
    const declared = await upload({ cookie: planner.cookie, files: [{ bytes: csv(1) }], contentLength: String(L.maxRequestBytes + 1) });
    expect([declared.status, declared.json.error.code]).toEqual([413, "FILE_TOO_LARGE"]);
    // A real file one byte over the limit, whose request still fits the multipart allowance.
    const big = new Uint8Array(L.maxFileBytes + 1).fill(0x61);
    const tooBig = await uploadCsv(planner.cookie, big);
    expect([tooBig.status, tooBig.json.error.code]).toEqual([413, "FILE_TOO_LARGE"]);
    const tooMany = await uploadCsv(planner.cookie, "a\n".repeat(L.maxRecords + 1));
    expect([tooMany.status, tooMany.json.error.code]).toEqual([413, "TOO_MANY_RECORDS"]);
    const longLine = await uploadCsv(planner.cookie, `${"x".repeat(L.maxLineBytes + 1)}\n`);
    expect([longLine.status, longLine.json.error.code]).toEqual([413, "RECORD_TOO_LARGE"]);
    const longField = await uploadCsv(planner.cookie, `${record(kapan(), 1, { name: "N".repeat(L.maxFieldChars + 1) })}\n`);
    expect([longField.status, longField.json.error.code]).toEqual([413, "FIELD_TOO_LARGE"]);
    expect(await counts()).toEqual(before);
  });

  test("an upload without a declared Content-Length is refused rather than risking a truncated body", async () => {
    const r = await upload({ cookie: planner.cookie, files: [{ bytes: csv(1) }], contentLength: null });
    expect([r.status, r.json.error.code]).toEqual([411, "LENGTH_REQUIRED"]);
  });

  test("the configurable file ceiling can never reach the proxy's buffer", () => {
    const b = SARIN_INGESTION_BOUNDS.SARIN_IMPORT_MAX_FILE_BYTES;
    expect(b.max + MULTIPART_OVERHEAD_BYTES).toBeLessThanOrEqual(PROXY_BODY_LIMIT_BYTES);
    const refused = validateNumericEnv("SARIN_IMPORT_MAX_FILE_BYTES", String(PROXY_BODY_LIMIT_BYTES), b);
    expect([refused.value, refused.rejection]).toEqual([b.fallback, "ABOVE_MAXIMUM"]);
    expect(SARIN_INGESTION_LIMITS.maxRequestBytes).toBeLessThanOrEqual(PROXY_BODY_LIMIT_BYTES);
  });

  test("an unsafe file name is kept only as metadata; the displayed name is sanitized", async () => {
    const original = "..\\..\\etc/evil\r\nX-Injected: 1<script>.csv";
    const r = await uploadCsv(planner.cookie, csv(1), {}, original);
    expect(r.status).toBe(201);
    const shown: string = r.json.batch.sourceFile.fileName;
    expect(/[\\/\r\n<>:]/.test(shown)).toBe(false);
    expect(shown.endsWith(".csv")).toBe(true);
    const stored = await db.sarinSourceFile.findUniqueOrThrow({ where: { sha256: r.json.batch.sourceFile.sha256 } });
    // Multipart encoding may percent-escape CR/LF in a file name, so the stored original is
    // whatever the server received; it is kept apart from the name that is ever shown.
    expect(stored.originalFileName.includes("evil")).toBe(true);
    expect(stored.sanitizedFileName).toBe(shown);
    // The sanitizer itself, given a raw CR/LF and path segments, yields a header-safe name.
    const direct = sanitizeSarinFileName("../..\\x/evil\r\nSet-Cookie: a=b.csv");
    expect(direct).toBe("evilSet-Cookie_ a=b.csv");
  });

  test("the extension decides CSV case-insensitively; the MIME type is only advisory", async () => {
    expect((await uploadCsv(planner.cookie, csv(1), {}, "sarin.xlsx")).json.error.code).toBe("NOT_A_CSV_FILE");
    expect((await upload({ cookie: planner.cookie, files: [{ bytes: csv(1), name: "SARIN.CSV", type: "application/octet-stream" }] })).status).toBe(201);
  });

  test("the multipart contract is exact: one file, the five fields, nothing else, nothing defaulted", async () => {
    const before = await counts();
    const cases: Array<[string, UploadOptions, string]> = [
      ["two files", { files: [{ bytes: csv(1) }, { bytes: csv(1) }] }, "MULTIPLE_FILES"],
      ["no file", { files: [] }, "FILE_MISSING"],
      ["unknown field", { files: [{ bytes: csv(1) }], fields: { uploadedByUserId: "someone-else" } }, "UNKNOWN_FIELD"],
      ["repeated field", { files: [{ bytes: csv(1) }], fields: { stoneType: ["BLUE", "PINK"] } }, "REPEATED_FIELD"],
      ["no planning date", { files: [{ bytes: csv(1) }], fields: { planningDate: undefined } }, "INVALID_PLANNING_DATE"],
      ["impossible date", { files: [{ bytes: csv(1) }], fields: { planningDate: "2026-02-30" } }, "INVALID_PLANNING_DATE"],
      ["timestamp, not a date", { files: [{ bytes: csv(1) }], fields: { planningDate: "2026-09-26T00:00:00Z" } }, "INVALID_PLANNING_DATE"],
      ["no stone type", { files: [{ bytes: csv(1) }], fields: { stoneType: undefined } }, "INVALID_STONE_TYPE"],
      ["lower-case stone type", { files: [{ bytes: csv(1) }], fields: { stoneType: "blue" } }, "INVALID_STONE_TYPE"],
      ["no country", { files: [{ bytes: csv(1) }], fields: { country: undefined } }, "INVALID_COUNTRY"],
      ["country name", { files: [{ bytes: csv(1) }], fields: { country: "India" } }, "INVALID_COUNTRY"],
      ["bad lab", { files: [{ bytes: csv(1) }], fields: { labId: "../GIA" } }, "INVALID_LAB"],
    ];
    for (const [label, o, code] of cases) {
      const r = await upload({ cookie: planner.cookie, ...o });
      expect([label, r.status, r.json?.error?.code]).toEqual([label, 400, code]);
    }
    resetRateLimits();
    const json = await uploadImport(
      new Request(URL_, { method: "POST", headers: { cookie: planner.cookie, "content-type": "application/json", "content-length": "2" }, body: "{}" }),
      { params: Promise.resolve({}) } as never,
    );
    expect(json.status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  test("a refusal's audit record carries the reason code, never the file's content", async () => {
    const marker = "CONFIDENTIALMARKER";
    await uploadCsv(planner.cookie, `${record(kapan(), 1, { name: marker.repeat(20) })}\n`);
    const a = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_IMPORT_UPLOAD_REJECTED", actorUserId: planner.user.id }, orderBy: { timestamp: "desc" } });
    expect(JSON.parse(a.after!).reasonCode).toBe("FIELD_TOO_LARGE");
    expect(a.after!.includes(marker)).toBe(false);
  });
});

// =========================================================================================
describe("sarin ingestion: strict 11-field contract", () => {
  test("every record is kept with its number, fields and an honest outcome; the first record is data", async () => {
    const k = kapan();
    const valid = record(k, 1);
    const fields11 = valid.split(",");
    const lines = [
      "STONE.Name,RESULT.1.Rough Cut,RESULT.1.ShapeName,Result.1.PolishWeight,RESULT.CUR.Clarity,RESULT.CUR.COLOR,RESULT.CUR.TotalDepth_%,RESULT.CUR.Ratio,RESULT.CUR.Length,RESULT.CUR.Width,RESULT.CUR.TotalDepth_mm",
      valid,
      fields11.slice(0, 10).join(","),
      [...fields11, "extra"].join(","),
      `${valid},`,
      [`"${k}-002, ZZ"`, ...fields11.slice(1)].join(","),
      [`"${k}-""003"" ZZ"`, ...fields11.slice(1)].join(","),
      [`${k}-0"04 ZZ`, ...fields11.slice(1)].join(","),
      [`"${k}-005 ZZ`, ...fields11.slice(1)].join(","),
      "",
    ];
    const r = await uploadCsv(planner.cookie, lines.join("\n") + "\n");
    expect(r.status).toBe(201);
    expect(r.json.batch.counts).toEqual({ records: 10, accepted: 3, quarantined: 1, rejectedStructure: 6 });
    const page = (await rows(planner.cookie, r.json.batch.id, "?pageSize=100")).json.rows;
    const view = page.map((x: any) => [x.sourceRowNumber, x.outcome, x.fieldCount, x.rejectionCodes[0] ?? null]);
    expect(view).toEqual([
      [1, "QUARANTINED", 11, "ROUGH_WEIGHT_INVALID"],
      [2, "ACCEPTED", 11, null],
      [3, "REJECTED_STRUCTURE", 10, "FIELD_COUNT_MISMATCH"],
      [4, "REJECTED_STRUCTURE", 12, "FIELD_COUNT_MISMATCH"],
      [5, "REJECTED_STRUCTURE", 12, "FIELD_COUNT_MISMATCH"],
      [6, "ACCEPTED", 11, null],
      [7, "ACCEPTED", 11, null],
      [8, "REJECTED_STRUCTURE", 0, "MALFORMED_QUOTING"],
      [9, "REJECTED_STRUCTURE", 0, "MALFORMED_QUOTING"],
      [10, "REJECTED_STRUCTURE", 1, "FIELD_COUNT_MISMATCH"],
    ]);
    // The header-looking first record is kept as data, with its text preserved.
    expect(page[0].values.stoneName).toBe("STONE.Name");
    // Wrong field counts keep their fields but get no positional values: nothing is guessed.
    expect(page[2].fields).toEqual(fields11.slice(0, 10));
    expect([page[2].values.stoneName, page[3].values.roughWeight]).toEqual([null, null]);
    expect(page[4].fields[11]).toBe("");
    // Quoting: a comma and a doubled quote inside quotes are data.
    expect([page[5].values.stoneName, page[6].values.stoneName]).toEqual([`${k}-002, ZZ`, `${k}-"003" ZZ`]);
    expect([page[7].fields, page[8].fields]).toEqual([null, null]);
    // Parsed Stone Name identity is not produced in this phase.
    expect(await db.sarinStoneBlock.count({ where: { batchId: r.json.batch.id } })).toBe(0);
  });
});

// =========================================================================================
describe("sarin ingestion: strict decimals", () => {
  test("weights and measurements are read exactly — never rounded, coerced or zeroed", async () => {
    const k = kapan();
    const lines = [
      record(k, 1),
      record(k, 2, { rough: "5.4134" }),
      record(k, 3, { est: "1.2x" }),
      record(k, 4, { est: "1e3" }),
      record(k, 5, { rough: "" }),
      record(k, 6, { est: "-0.5" }),
      record(k, 7, { rough: "0" }),
      record(k, 8, { est: "0" }),
      record(k, 9, { depth: "0", ratio: "0" }),
      record(k, 10, { depth: "abc" }),
      record(k, 11, { ratio: "NaN", length: "Infinity" }),
      record(k, 12, { rough: " 5.4" }),
      record(k, 13, { rough: "5.4", est: "1" }),
      record(k, 14, { depth: "", ratio: "" }),
    ];
    const r = await uploadCsv(planner.cookie, lines.join("\n") + "\n");
    expect(r.status).toBe(201);
    const page = (await rows(planner.cookie, r.json.batch.id, "?pageSize=100")).json.rows;
    const at = (n: number) => page[n - 1];
    expect([at(1).outcome, at(1).values.roughWeight, at(1).values.estimatedWeight]).toEqual(["ACCEPTED", "5.413", "1.664"]);
    expect([at(2).outcome, at(2).rejectionCodes, at(2).values.roughWeight]).toEqual(["QUARANTINED", ["ROUGH_WEIGHT_PRECISION_EXCEEDED"], null]);
    expect([at(3).rejectionCodes, at(3).values.estimatedWeight]).toEqual([["ESTIMATED_WEIGHT_INVALID"], null]);
    expect(at(4).rejectionCodes).toEqual(["ESTIMATED_WEIGHT_INVALID"]);
    expect(at(5).rejectionCodes).toEqual(["ROUGH_WEIGHT_BLANK"]);
    expect([at(6).rejectionCodes, at(6).values.estimatedWeight]).toEqual([["ESTIMATED_WEIGHT_OUT_OF_RANGE"], null]);
    expect([at(7).rejectionCodes, at(7).values.roughWeight]).toEqual([["ROUGH_WEIGHT_OUT_OF_RANGE"], null]);
    expect([at(8).outcome, at(8).values.estimatedWeight]).toEqual(["ACCEPTED", "0.000"]);
    expect([at(9).outcome, at(9).values.depthPct, at(9).values.ratio]).toEqual(["ACCEPTED", "0.000", "0.000"]);
    expect([at(10).rejectionCodes, at(10).values.depthPct]).toEqual([["DEPTH_PCT_INVALID"], null]);
    expect([at(11).rejectionCodes, at(11).values.ratio, at(11).values.length]).toEqual([["RATIO_INVALID", "LENGTH_INVALID"], null, null]);
    expect(at(12).rejectionCodes).toEqual(["ROUGH_WEIGHT_INVALID"]);
    expect([at(13).values.roughWeight, at(13).values.estimatedWeight]).toEqual(["5.400", "1.000"]);
    // Blank measurements are absent, not zero; the contract does not require them.
    expect([at(14).outcome, at(14).values.depthPct, at(14).values.ratio]).toEqual(["ACCEPTED", null, null]);
    // The original text of every rejected value is preserved.
    expect([at(2).fields[1], at(3).fields[3], at(10).fields[6]]).toEqual(["5.4134", "1.2x", "abc"]);
  });
});

// =========================================================================================
describe("sarin ingestion: idempotency and concurrency", () => {
  test("an identical upload returns the same batch without new rows or a second success audit", async () => {
    const content = csv(4);
    const first = await uploadCsv(planner.cookie, content);
    const again = await uploadCsv(planner.cookie, content);
    expect([first.status, again.status, again.json.duplicate, again.json.created]).toEqual([201, 200, true, false]);
    expect(again.json.batch.id).toBe(first.json.batch.id);
    expect(await db.sarinSourceRow.count({ where: { batchId: first.json.batch.id } })).toBe(4);
    expect(await db.sarinSourceFile.count({ where: { sha256: sha256(content) } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SARIN_IMPORT_UPLOADED", entityId: first.json.batch.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SARIN_IMPORT_DUPLICATE_REUSED", entityId: first.json.batch.id } })).toBe(1);
  });

  test("an archived matching import is still the historical record", async () => {
    const content = csv(2);
    const first = (await uploadCsv(planner.cookie, content)).json.batch;
    await db.sarinImportBatch.update({ where: { id: first.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
    const again = await uploadCsv(planner.cookie, content);
    expect([again.status, again.json.duplicate, again.json.batch.id, again.json.batch.status]).toEqual([200, true, first.id, "ARCHIVED"]);
  });

  test("the same bytes as a different type or planning date are distinct imports sharing one source file", async () => {
    const content = csv(2);
    const blue = (await uploadCsv(planner.cookie, content)).json.batch;
    const pink = await uploadCsv(planner.cookie, content, { stoneType: "PINK" });
    const later = await uploadCsv(planner.cookie, content, { planningDate: "2026-09-27" });
    expect([pink.status, later.status]).toEqual([201, 201]);
    expect(new Set([blue.id, pink.json.batch.id, later.json.batch.id]).size).toBe(3);
    expect(await db.sarinSourceFile.count({ where: { sha256: sha256(content) } })).toBe(1);
    expect(await db.sarinSourceRow.count({ where: { batchId: { in: [blue.id, pink.json.batch.id, later.json.batch.id] } } })).toBe(6);
  });

  test("five genuinely concurrent identical uploads produce one file, one batch and one set of rows", async () => {
    const content = csv(300);
    resetRateLimits();
    const bodies = await Promise.all(
      Array.from({ length: 5 }, async () => {
        const fd = new FormData();
        fd.append("file", new File([content], "sarin.csv", { type: "text/csv" }));
        fd.append("stoneType", "BLUE");
        fd.append("country", "IN");
        fd.append("planningDate", "2026-09-26");
        const encoded = new Response(fd);
        return { body: new Uint8Array(await encoded.arrayBuffer()), type: encoded.headers.get("content-type")! };
      }),
    );
    const responses = await Promise.all(
      bodies.map(async ({ body, type }) => {
        const res = await uploadImport(
          new Request(URL_, { method: "POST", headers: { cookie: planner.cookie, "content-type": type, "content-length": String(body.length) }, body }),
          { params: Promise.resolve({}) } as never,
        );
        return { status: res.status, json: await res.json() };
      }),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(responses.map((r) => r.json.batch.id));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(await db.sarinSourceFile.count({ where: { sha256: sha256(content) } })).toBe(1);
    expect(await db.sarinImportBatch.count({ where: { sourceFile: { sha256: sha256(content) } } })).toBe(1);
    expect(await db.sarinSourceRow.count({ where: { batchId: id } })).toBe(300);
    expect(await db.auditLog.count({ where: { action: "SARIN_IMPORT_UPLOADED", entityId: id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "SARIN_IMPORT_DUPLICATE_REUSED", entityId: id } })).toBe(4);
  });

  test("the row insert batch size changes nothing about what is stored", async () => {
    const text = csv(23);
    const bytes = new TextEncoder().encode(text);
    const decoded = decodeSarinSource(bytes, SARIN_INGESTION_LIMITS);
    const records = decoded.lines.map(interpretSarinRecord);
    const actor = {
      userId: planner.user.id,
      scope: { countries: null, labs: null },
      requestId: "batch-size-test",
      audit: async (client: any, input: any) => {
        await client.auditLog.create({ data: { actor: "batch-size-test", actorUserId: planner.user.id, action: input.action, entity: input.entity, entityId: input.entityId ?? null, after: JSON.stringify(input.after ?? null), outcome: input.outcome ?? "SUCCESS" } });
      },
    };
    const stored: string[][] = [];
    for (const [size, date] of [[1, "2026-10-01"], [7, "2026-10-02"], [1000, "2026-10-03"]] as const) {
      const request = { bytes, originalFileName: "sarin.csv", sanitizedFileName: "sarin.csv", stoneType: "BLUE" as const, country: "IN", labId: null, planningDate: date };
      const result = await ingestSarinSource(actor, request, { lines: decoded.lines, records, encoding: decoded.encoding }, { rowInsertBatchSize: size, transactionTimeoutMs: 60_000 });
      expect(result.created).toBe(true);
      const r = await db.sarinSourceRow.findMany({ where: { batchId: result.batch.id }, orderBy: { sourceRowNumber: "asc" } });
      stored.push(r.map((x) => `${x.sourceRowNumber}|${x.rowHash}|${x.outcome}|${x.rawFieldsJson}|${x.roughWeight?.toFixed(3)}`));
    }
    expect(stored[0]).toHaveLength(23);
    expect(stored[1]).toEqual(stored[0]);
    expect(stored[2]).toEqual(stored[0]);
  });
});

// =========================================================================================
describe("sarin ingestion: transaction rollback", () => {
  test("a failure after rows were inserted leaves nothing behind; the failure is audited; a retry succeeds", async () => {
    const content = csv(2500);
    const hash = sha256(content);
    // A real database failure inside the transaction, after two full insert batches.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_inject_row_failure() RETURNS trigger AS $$
      BEGIN
        IF NEW."sourceRowNumber" = 2100 THEN RAISE EXCEPTION 'injected ingestion failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_inject_row_failure BEFORE INSERT ON "SarinSourceRow" FOR EACH ROW EXECUTE FUNCTION test_inject_row_failure()`);
    let failed: Awaited<ReturnType<typeof uploadCsv>>;
    try {
      failed = await uploadCsv(planner.cookie, content);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_inject_row_failure ON "SarinSourceRow"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_inject_row_failure()`);
    }
    expect([failed.status, failed.json.error.code]).toEqual([500, "UPLOAD_NOT_STORED"]);
    expect(/injected|at .*\.ts|SarinSourceRow|node_modules/.test(failed.text)).toBe(false);

    expect(await db.sarinSourceFile.count({ where: { sha256: hash } })).toBe(0);
    expect(await db.sarinImportBatch.count({ where: { sourceFile: { sha256: hash } } })).toBe(0);
    const orphanRows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "SarinSourceRow" r JOIN "SarinImportBatch" b ON b.id = r."batchId" JOIN "SarinSourceFile" f ON f.id = b."sourceFileId" WHERE f.sha256 = ${hash}`;
    expect(orphanRows.map((x) => Number(x.n))).toEqual([0]);
    const audits = await db.auditLog.findMany({ where: { actorUserId: planner.user.id, after: { contains: hash.slice(0, 12) } } });
    expect(audits.map((a) => [a.action, a.outcome])).toEqual([["SARIN_IMPORT_UPLOAD_FAILED", "FAILED"]]);

    const retry = await uploadCsv(planner.cookie, content);
    expect([retry.status, retry.json.created, retry.json.batch.counts.records]).toEqual([201, true, 2500]);
    expect(await db.sarinSourceRow.count({ where: { batchId: retry.json.batch.id } })).toBe(2500);
  });
});

// =========================================================================================
describe("sarin ingestion: bounded history and row pages", () => {
  test("row pages are ordered, bounded, filterable and report whether more remain", async () => {
    const k = kapan();
    const lines = Array.from({ length: 1200 }, (_, i) => record(k, i + 1, i % 100 === 99 ? { rough: "bad" } : {}));
    const b = (await uploadCsv(planner.cookie, lines.join("\n") + "\n")).json.batch;
    expect(b.counts).toEqual({ records: 1200, accepted: 1188, quarantined: 12, rejectedStructure: 0 });

    const first = await rows(planner.cookie, b.id);
    expect([first.status, first.json.rows.length, first.json.total, first.json.hasMore]).toEqual([200, 100, 1200, true]);
    const p1 = await rows(planner.cookie, b.id, "?pageSize=500&page=1");
    const p3 = await rows(planner.cookie, b.id, "?pageSize=500&page=3");
    expect([p1.json.rows.length, p1.json.hasMore, p3.json.rows.length, p3.json.hasMore]).toEqual([500, true, 200, false]);
    expect(p1.json.rows.map((r: any) => r.sourceRowNumber)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    expect(p3.json.rows[199].sourceRowNumber).toBe(1200);

    expect((await rows(planner.cookie, b.id, "?pageSize=501")).status).toBe(400);
    expect((await rows(planner.cookie, b.id, "?outcome=BOGUS")).status).toBe(400);
    const q = await rows(planner.cookie, b.id, "?outcome=QUARANTINED");
    expect([q.json.total, q.json.rows.every((r: any) => r.outcome === "QUARANTINED")]).toEqual([12, true]);

    const d = await detail(planner.cookie, b.id);
    expect(Object.keys(d.json.batch).includes("rows")).toBe(false);
    expect(JSON.stringify(d.json).includes("content")).toBe(false);
  });

  test("history is paginated with an explicit ceiling, deterministic order and validated filters", async () => {
    expect((await list(planner.cookie, "?pageSize=101")).status).toBe(400);
    expect((await list(planner.cookie, "?status=DONE")).status).toBe(400);
    expect((await list(planner.cookie, "?planningDate=2026-13-01")).status).toBe(400);
    const a = await list(planner.cookie, "?pageSize=2&page=1");
    const b = await list(planner.cookie, "?pageSize=2&page=2");
    expect([a.status, a.json.rows.length, a.json.hasMore]).toEqual([200, 2, true]);
    const ordered = [...a.json.rows, ...b.json.rows].map((r: any) => r.createdAt);
    expect(ordered).toEqual([...ordered].sort().reverse());
    const pink = await list(planner.cookie, "?stoneType=PINK&pageSize=100");
    expect(pink.json.rows.every((r: any) => r.stoneType === "PINK")).toBe(true);
    expect(pink.json.total).toBe(await db.sarinImportBatch.count({ where: { stoneType: "PINK" } }));
  });
});
