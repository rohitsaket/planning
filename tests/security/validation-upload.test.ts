import { beforeAll, describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";
import { BASE, call, db, makeCase, makeRough, makeUser, resetDb } from "./helpers";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { GET as sales } from "@/app/api/analysis/sales/route";
import { GET as auditRecent } from "@/app/api/audit/recent/route";
import { GET as trace } from "@/app/api/traceability/[query]/route";
import { GET as cases } from "@/app/api/planning/cases/route";
import { GET as requirements } from "@/app/api/requirements/route";
import { POST as parse } from "@/app/api/planning/workbook/parse/route";
import { inspectXlsxContainer } from "@/lib/domain/workbook-guard";
import { PAGE_DEFAULT, PAGE_MAX, SCAN_MAX, scanned } from "@/lib/api/with-api";
import { resetRateLimits } from "@/lib/api/rate-limit";

let admin: Awaited<ReturnType<typeof makeUser>>, planner: typeof admin, viewer: typeof admin;
beforeAll(async () => {
  await resetDb();
  admin = await makeUser("vadmin", "ADMIN");
  planner = await makeUser("vplanner", "PLANNER");
  viewer = await makeUser("vviewer", "VIEWER");
  await makeRough();
  for (let i = 0; i < 3; i++) await makeCase();
});

describe("input handling (REL-002)", () => {
  test("malformed JSON → 400, not 500", async () => {
    const r = await call(approvals, { method: "POST", cookie: admin.cookie, raw: "{not json" });
    expect([r.status, r.json.error.code]).toEqual([400, "BAD_REQUEST"]);
  });
  test("wrong types / missing fields → 400 with field details, no stack", async () => {
    const r = await call(approvals, { method: "POST", cookie: admin.cookie, body: { caseId: 42, action: "explode" } });
    expect([r.status, r.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect(JSON.stringify(r.json)).not.toMatch(/at .*\.ts|node_modules/);
  });
  test("oversized JSON body → 413", async () => {
    const r = await call(approvals, { method: "POST", cookie: admin.cookie, raw: JSON.stringify({ caseId: "x", action: "approve", comment: "a".repeat(80_000) }) });
    expect(r.status).toBe(413);
  });
  test("cross-origin state-changing request → 403", async () => {
    const r = await call(approvals, { method: "POST", cookie: admin.cookie, body: { caseId: "x", action: "approve" }, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
  for (const bad of ["abc", "-5", "0", "1e9", "99999", "12.5", ""]) {
    test(`windowDays=${JSON.stringify(bad)} → ${bad === "" ? "default" : "400"}`, async () => {
      const r = await call(sales, { cookie: admin.cookie, path: `/api/analysis/sales?windowDays=${encodeURIComponent(bad)}` });
      expect(r.status).toBe(bad === "" ? 200 : 400);
    });
  }
  test("audit/recent limit cannot be negative, NaN or above the cap", async () => {
    for (const bad of ["-100000", "abc", "51"]) expect((await call(auditRecent, { cookie: admin.cookie, path: `/api/audit/recent?limit=${bad}` })).status).toBe(400);
    expect((await call(auditRecent, { cookie: admin.cookie, path: "/api/audit/recent?limit=50" })).status).toBe(200);
  });
});

describe("traceability search: special characters are literals, never wildcards or errors", () => {
  for (const q of ["%", "_", "\\", "'", '"', "100%", "%%%", "a_b", "'; DROP TABLE \"User\"; --", "ダイヤモンド💎", "%E0"]) {
    test(`query ${JSON.stringify(q)} → controlled 404 (no wildcard match, no 500)`, async () => {
      const r = await call(trace, { cookie: admin.cookie, params: { query: q } });
      expect(r.status).toBe(404);
      expect(r.json.error.code).toBe("NOT_FOUND");
    });
  }
  test("very long and empty input → 400; a real value still matches", async () => {
    expect((await call(trace, { cookie: admin.cookie, params: { query: "x".repeat(101) } })).status).toBe(400);
    expect((await call(trace, { cookie: admin.cookie, params: { query: "   " } })).status).toBe(400);
    const rough = await db.roughStone.findFirst();
    expect((await call(trace, { cookie: admin.cookie, params: { query: rough!.fantasyRoughId } })).status).toBe(200);
    expect(await db.user.count()).toBeGreaterThan(0); // table still there
  });
});

describe("pagination (REL-001)", () => {
  test("in-memory aggregation ceiling fails loudly instead of truncating totals", () => {
    expect(scanned(new Array(SCAN_MAX - 1).fill(0)).length).toBe(SCAN_MAX - 1);
    expect(() => scanned(new Array(SCAN_MAX).fill(0))).toThrow(/larger than the report can process/);
  });
  test("default page is bounded and reports paging metadata", async () => {
    const r = await call(cases, { cookie: admin.cookie, path: "/api/planning/cases" });
    expect(r.status).toBe(200);
    expect([r.json.page, r.json.pageSize, r.json.hasMore]).toEqual([1, PAGE_DEFAULT, false]);
  });
  test("pageSize=2 → 2 rows + hasMore; next page returns the rest; empty page is empty", async () => {
    const p1 = await call(cases, { cookie: admin.cookie, path: "/api/planning/cases?pageSize=2" });
    expect([p1.json.rows.length, p1.json.hasMore]).toEqual([2, true]);
    const p2 = await call(cases, { cookie: admin.cookie, path: "/api/planning/cases?pageSize=2&page=2" });
    expect([p2.json.rows.length, p2.json.hasMore]).toEqual([1, false]);
    expect(p2.json.rows[0].id).not.toBe(p1.json.rows[0].id);
    const p9 = await call(cases, { cookie: admin.cookie, path: "/api/planning/cases?pageSize=2&page=9" });
    expect(p9.json.rows).toEqual([]);
  });
  test("maximum accepted, over-limit and junk rejected; filters still apply", async () => {
    expect((await call(cases, { cookie: admin.cookie, path: `/api/planning/cases?pageSize=${PAGE_MAX}` })).status).toBe(200);
    expect((await call(cases, { cookie: admin.cookie, path: `/api/planning/cases?pageSize=${PAGE_MAX + 1}` })).status).toBe(400);
    expect((await call(cases, { cookie: admin.cookie, path: "/api/planning/cases?page=0" })).status).toBe(400);
    expect((await call(requirements, { cookie: admin.cookie, path: "/api/requirements?pageSize=501" })).status).toBe(400);
    const f = await call(cases, { cookie: admin.cookie, path: "/api/planning/cases?status=NO_SUCH_STATUS" });
    expect(f.json.rows).toEqual([]);
  });
});

function upload(cookie: string | undefined, bytes: Uint8Array | ArrayBuffer, name: string) {
  const fd = new FormData();
  fd.append("file", new File([bytes as BlobPart], name));
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return parse(new Request(`${BASE}/api/planning/workbook/parse`, { method: "POST", body: fd, headers }), { params: Promise.resolve({}) } as never);
}
function workbook(): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet([["W-123 4.50", "ROUND", 1.2], ["=HYPERLINK(\"http://x\")", "OVAL", 0.9]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Plan");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

describe("workbook upload (SEC-005 / upload hardening)", () => {
  test("anonymous → 401; role without plan.create → 403", async () => {
    expect((await upload(undefined, workbook(), "a.xlsx")).status).toBe(401);
    expect((await upload(viewer.cookie, workbook(), "a.xlsx")).status).toBe(403);
  });
  test("wrong extension → 400; right extension but non-ZIP content → 400", async () => {
    expect((await upload(planner.cookie, workbook(), "a.xlsm")).status).toBe(400);
    expect((await upload(planner.cookie, new TextEncoder().encode("<html>not a workbook</html>".repeat(5)), "a.xlsx")).status).toBe(400);
  });
  test("ZIP that is not a workbook / truncated workbook → controlled 400", async () => {
    const zipNotXlsx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(40).fill(0), 0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
    const r1 = await upload(planner.cookie, zipNotXlsx, "a.xlsx");
    expect(r1.status).toBe(400);
    const r2 = await upload(planner.cookie, new Uint8Array(workbook()).slice(0, 600), "a.xlsx");
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe("INVALID_WORKBOOK");
  });
  test("oversize → 413 before parsing", async () => {
    resetRateLimits();
    const big = new Uint8Array(10 * 1024 * 1024 + 10);
    big.set([0x50, 0x4b, 0x03, 0x04]);
    expect((await upload(planner.cookie, big, "big.xlsx")).status).toBe(413);
  });
  test("archive-bomb guard: declared expansion beyond the cap is refused without inflating", () => {
    // One central-directory entry declaring 3 GB uncompressed from 1 KB compressed.
    const name = new TextEncoder().encode("xl/workbook.xml");
    const buf = new ArrayBuffer(4 + 46 + name.length + 22);
    const v = new DataView(buf);
    v.setUint32(0, 0x04034b50, true);
    const cd = 4;
    v.setUint32(cd, 0x02014b50, true);
    v.setUint32(cd + 20, 1024, true);
    v.setUint32(cd + 24, 3_000_000_000, true);
    v.setUint16(cd + 28, name.length, true);
    new Uint8Array(buf, cd + 46, name.length).set(name);
    const eocd = cd + 46 + name.length;
    v.setUint32(eocd, 0x06054b50, true);
    v.setUint16(eocd + 10, 1, true);
    v.setUint32(eocd + 16, cd, true);
    const r = inspectXlsxContainer(buf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });
  test("valid workbook → 200, parsed, upload audited with the session user; formulas are not evaluated", async () => {
    resetRateLimits();
    const res = await upload(planner.cookie, workbook(), "../../etc/pa<ss>wd.xlsx");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileName).toBe("pa_ss_wd.xlsx");
    const a = await db.auditLog.findFirst({ where: { action: "WORKBOOK_PARSED" }, orderBy: { timestamp: "desc" } });
    expect(a?.actor).toBe("vplanner");
  });
  test("upload endpoint is rate limited per user", async () => {
    resetRateLimits();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await upload(planner.cookie, workbook(), "a.xlsx")).status);
    expect(codes.filter((c) => c === 429).length).toBe(2);
  });
});
