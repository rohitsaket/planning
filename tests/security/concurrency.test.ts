import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeRough, makeUser, resetDb } from "./helpers";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { POST as reserve } from "@/app/api/planning/reservations/route";
import { POST as replan } from "@/app/api/planning/cases/[id]/replan/route";
import { allocateRequirement } from "@/lib/domain/allocation";

let planners: Awaited<ReturnType<typeof makeUser>>[] = [];
let approvers: typeof planners = [];
beforeAll(async () => {
  await resetDb();
  for (let i = 0; i < 6; i++) planners.push(await makeUser(`cplanner${i}`, "PLANNER"));
  for (let i = 0; i < 2; i++) approvers.push(await makeUser(`capprover${i}`, "PLANNING_MANAGER"));
});
const tally = (codes: number[]) => codes.reduce<Record<number, number>>((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});

describe("concurrency guarantees", () => {
  test("6 planners reserve the same rough at once → exactly one 200, the rest 409, one active row", async () => {
    const rough = await makeRough();
    const codes = (await Promise.all(planners.map((p) => call(reserve, { method: "POST", cookie: p.cookie, body: { roughId: rough.id } })))).map((r) => r.status);
    expect(tally(codes)).toEqual({ 200: 1, 409: 5 });
    expect(await db.roughReservation.count({ where: { roughId: rough.id } })).toBe(1);
  });
  test("database refuses a second active reservation even if application checks are bypassed", async () => {
    const rough = await makeRough();
    await db.roughReservation.create({ data: { roughId: rough.id, status: "RESERVED", reservedBy: "a", activeRoughKey: rough.id } });
    const second = (async () => { await db.roughReservation.create({ data: { roughId: rough.id, status: "RESERVED", reservedBy: "b", activeRoughKey: rough.id } }); })();
    await expect(second).rejects.toThrow();
  });
  test("two simultaneous replans → one 200, one 409, version numbers unique", async () => {
    const c = await makeCase({ status: "APPROVED" });
    const codes = (await Promise.all(planners.slice(0, 2).map((p) => call(replan, { method: "POST", cookie: p.cookie, params: { id: c.caseId }, body: { reason: "concurrent replan test" } })))).map((r) => r.status);
    expect(tally(codes)).toEqual({ 200: 1, 409: 1 });
    const versions = await db.planVersion.findMany({ where: { planningCaseId: c.caseId }, orderBy: { versionNumber: "asc" } });
    expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(versions[0].status).toBe("SUPERSEDED");
    expect((await db.planningCase.findUnique({ where: { id: c.caseId } }))?.currentVersion).toBe(2);
  });
  test("database refuses a duplicate (case, versionNumber)", async () => {
    const c = await makeCase();
    const dup = (async () => { await db.planVersion.create({ data: { planningCaseId: c.caseId, versionNumber: 1, createdBy: "x" } }); })();
    await expect(dup).rejects.toThrow();
  });
  test("two simultaneous approvals of one case → one 200, one 409, one audit row", async () => {
    const c = await makeCase();
    const codes = (await Promise.all(approvers.map((a) => call(approvals, { method: "POST", cookie: a.cookie, body: { caseId: c.caseId, action: "approve" } })))).map((r) => r.status);
    expect(tally(codes)).toEqual({ 200: 1, 409: 1 });
    expect(await db.auditLog.count({ where: { action: "PLAN_APPROVED", entityId: c.caseId } })).toBe(1);
  });
  test("approve racing a replan → the case never ends APPROVED on a superseded version", async () => {
    const c = await makeCase();
    await Promise.all([
      call(approvals, { method: "POST", cookie: approvers[0].cookie, body: { caseId: c.caseId, action: "approve" } }),
      call(replan, { method: "POST", cookie: planners[0].cookie, params: { id: c.caseId }, body: { reason: "race with approval" } }),
    ]);
    const row = await db.planningCase.findUnique({ where: { id: c.caseId } });
    // Either order is legal (approve→replan or replan→approve-rejected); both end in REPLAN_REQUIRED v2 or APPROVED v1.
    expect(["APPROVED@1", "REPLAN_REQUIRED@2"]).toContain(`${row?.status}@${row?.currentVersion}`);
  });
  test("requirement remaining = 2, two concurrent allocations of 2 → only one succeeds, never over-allocated", async () => {
    const req = await db.requirement.create({ data: { requirementCode: `REQ-C-${Date.now()}`, type: "CUSTOMER_ORDER", groupCode: "G", companyCode: "C", country: "IN", branch: "B", requiredQty: 2, remainingUnplanned: 2 } });
    const results = await Promise.allSettled([0, 1].map((i) => db.$transaction(async (tx) => { await allocateRequirement(tx, { requirementId: req.id, qty: 2, allocatedBy: `u${i}` }); })));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const after = await db.requirement.findUnique({ where: { id: req.id } });
    expect(after?.remainingUnplanned).toBe(0);
    const sum = await db.requirementAllocation.aggregate({ where: { requirementId: req.id }, _sum: { allocatedQty: true } });
    expect(sum._sum.allocatedQty).toBe(2);
  });
});
