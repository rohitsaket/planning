import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeRough, makeUser, resetDb } from "./helpers";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { GET as sales } from "@/app/api/analysis/sales/route";
import { GET as auditRecent } from "@/app/api/audit/recent/route";
import { GET as cases } from "@/app/api/planning/cases/route";
import { GET as requirements } from "@/app/api/requirements/route";
import { PAGE_DEFAULT, PAGE_MAX, SCAN_MAX, scanned } from "@/lib/api/with-api";

let admin: Awaited<ReturnType<typeof makeUser>>, planner: typeof admin, viewer: typeof admin, approver: typeof admin;
beforeAll(async () => {
  await resetDb();
  admin = await makeUser("vadmin", "ADMIN");
  planner = await makeUser("vplanner", "PLANNER");
  viewer = await makeUser("vviewer", "VIEWER");
  // ADMIN deliberately lacks plan.approve, so it is refused before the body is ever
  // parsed. Body-validation behaviour has to be exercised by a principal that is
  // actually authorized for the route.
  approver = await makeUser("vapprover", "PLANNING_MANAGER");
  await makeRough();
  for (let i = 0; i < 3; i++) await makeCase();
});

describe("input handling (REL-002)", () => {
  test("malformed JSON → 400, not 500", async () => {
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, raw: "{not json" });
    expect([r.status, r.json.error.code]).toEqual([400, "BAD_REQUEST"]);
  });
  test("wrong types / missing fields → 400 with field details, no stack", async () => {
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: 42, action: "explode" } });
    expect([r.status, r.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect(JSON.stringify(r.json)).not.toMatch(/at .*\.ts|node_modules/);
  });
  test("oversized JSON body → 413", async () => {
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, raw: JSON.stringify({ caseId: "x", action: "approve", comment: "a".repeat(80_000) }) });
    expect(r.status).toBe(413);
  });
  test("cross-origin state-changing request → 403", async () => {
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: "x", action: "approve" }, headers: { origin: "https://evil.example" } });
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
