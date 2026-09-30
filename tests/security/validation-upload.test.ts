import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { POST as priority } from "@/app/api/requirements/[id]/priority/route";
import { GET as sales } from "@/app/api/analysis/sales/route";
import { GET as issues } from "@/app/api/data-quality/route";
import { GET as requirements } from "@/app/api/requirements/route";
import { PAGE_DEFAULT, PAGE_MAX, SCAN_MAX, scanned } from "@/lib/api/with-api";

let admin: Awaited<ReturnType<typeof makeUser>>, planner: typeof admin, viewer: typeof admin, overrider: typeof admin;
let requirementId = "";
beforeAll(async () => {
  await resetDb();
  admin = await makeUser("vadmin", "ADMIN");
  planner = await makeUser("vplanner", "PLANNER");
  viewer = await makeUser("vviewer", "VIEWER");
  // Body validation is exercised by a principal that is authorized for the route, so the
  // request reaches parsing rather than being refused first.
  overrider = await makeUser("voverrider", "ANALYSIS_MANAGER");
  requirementId = (await db.requirement.create({ data: { requirementCode: `REQ-V-${Date.now()}`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "B", requiredQty: 2 } })).id;
  // Three recorded import issues, enough to page through two at a time.
  await db.dataQualityIssue.deleteMany({});
  await db.dataQualityIssue.createMany({
    data: [0, 1, 2].map((i) => ({ issueCode: `DQ-V-${i}`, source: "FANTASY", entity: "LOT", recordId: `LOT-V-${i}`, rule: "UNMAPPED_LAB_WARNING", message: `paging check ${i}`, severity: "WARNING", status: "OPEN" })),
  });
});

describe("input handling (REL-002)", () => {
  test("malformed JSON → 400, not 500", async () => {
    const r = await call(priority, { method: "POST", cookie: overrider.cookie, params: { id: requirementId }, raw: "{not json" });
    expect([r.status, r.json.error.code]).toEqual([400, "BAD_REQUEST"]);
  });
  test("wrong types / missing fields → 400 with field details, no stack", async () => {
    const r = await call(priority, { method: "POST", cookie: overrider.cookie, params: { id: requirementId }, body: { priority: "EXPLODE", reason: 42 } });
    expect([r.status, r.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect(JSON.stringify(r.json)).not.toMatch(/at .*\.ts|node_modules/);
  });
  test("oversized JSON body → 413", async () => {
    const r = await call(priority, { method: "POST", cookie: overrider.cookie, params: { id: requirementId }, raw: JSON.stringify({ priority: "HIGH", reason: "a".repeat(80_000) }) });
    expect(r.status).toBe(413);
  });
  test("cross-origin state-changing request → 403", async () => {
    const r = await call(priority, { method: "POST", cookie: overrider.cookie, params: { id: requirementId }, body: { priority: "HIGH", reason: "cross-origin check" }, headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
  });
  for (const bad of ["abc", "-5", "0", "1e9", "99999", "12.5", ""]) {
    test(`windowDays=${JSON.stringify(bad)} → ${bad === "" ? "default" : "400"}`, async () => {
      const r = await call(sales, { cookie: admin.cookie, path: `/api/analysis/sales?windowDays=${encodeURIComponent(bad)}` });
      expect(r.status).toBe(bad === "" ? 200 : 400);
    });
  }
});

describe("pagination (REL-001)", () => {
  test("in-memory aggregation ceiling fails loudly instead of truncating totals", () => {
    expect(scanned(new Array(SCAN_MAX - 1).fill(0)).length).toBe(SCAN_MAX - 1);
    expect(() => scanned(new Array(SCAN_MAX).fill(0))).toThrow(/larger than the report can process/);
  });
  test("default page is bounded and reports paging metadata", async () => {
    const r = await call(issues, { cookie: admin.cookie, path: "/api/data-quality" });
    expect(r.status).toBe(200);
    expect([r.json.paging.page, r.json.paging.pageSize, r.json.paging.hasMore]).toEqual([1, PAGE_DEFAULT, false]);
  });
  test("pageSize=2 → 2 rows + hasMore; next page returns the rest; empty page is empty", async () => {
    const p1 = await call(issues, { cookie: admin.cookie, path: "/api/data-quality?pageSize=2" });
    expect([p1.json.rows.length, p1.json.paging.hasMore]).toEqual([2, true]);
    const p2 = await call(issues, { cookie: admin.cookie, path: "/api/data-quality?pageSize=2&page=2" });
    expect([p2.json.rows.length, p2.json.paging.hasMore]).toEqual([1, false]);
    expect(p2.json.rows[0].id).not.toBe(p1.json.rows[0].id);
    const p9 = await call(issues, { cookie: admin.cookie, path: "/api/data-quality?pageSize=2&page=9" });
    expect(p9.json.rows).toEqual([]);
  });
  test("maximum accepted, over-limit and junk rejected; filters still apply", async () => {
    expect((await call(issues, { cookie: admin.cookie, path: `/api/data-quality?pageSize=${PAGE_MAX}` })).status).toBe(200);
    expect((await call(issues, { cookie: admin.cookie, path: `/api/data-quality?pageSize=${PAGE_MAX + 1}` })).status).toBe(400);
    expect((await call(issues, { cookie: admin.cookie, path: "/api/data-quality?page=0" })).status).toBe(400);
    expect((await call(requirements, { cookie: admin.cookie, path: "/api/requirements?pageSize=501" })).status).toBe(400);
    const f = await call(issues, { cookie: admin.cookie, path: "/api/data-quality?search=no-such-record-anywhere" });
    expect(f.json.rows).toEqual([]);
  });
});
