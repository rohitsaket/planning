import { beforeAll, describe, expect, test } from "bun:test";
import { call, db, makeCase, makeRough, makeUser, resetDb } from "./helpers";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { POST as reserve } from "@/app/api/planning/reservations/route";
import { POST as replan } from "@/app/api/planning/cases/[id]/replan/route";
import { POST as priority } from "@/app/api/requirements/[id]/priority/route";
import { POST as flags } from "@/app/api/admin/feature-flags/route";
import { POST as rules } from "@/app/api/admin/business-rules/route";

let planner: Awaited<ReturnType<typeof makeUser>>, approver: typeof planner, viewer: typeof planner, root: typeof planner;
beforeAll(async () => {
  await resetDb();
  planner = await makeUser("planner1", "PLANNER", "Planner One");
  approver = await makeUser("approver1", "PLANNING_MANAGER", "Approver One");
  viewer = await makeUser("viewer1", "VIEWER");
  root = await makeUser("root1", "SUPER_ADMIN");
});
const lastAudit = (action: string) => db.auditLog.findFirst({ where: { action }, orderBy: { timestamp: "desc" } });

describe("identity integrity (SEC-002): body identity fields never become the actor", () => {
  test("approver forged in body → persisted approver is the session user", async () => {
    const c = await makeCase();
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve", approver: "admin", actor: "admin", approvedBy: "admin" } });
    expect(r.status).toBe(200);
    const row = await db.planningCase.findUnique({ where: { id: c.caseId } });
    expect(row?.approvedBy).toBe("approver1");
    const opt = await db.planOption.findUnique({ where: { id: c.optionIds[0] } });
    expect(opt?.approvedBy).toBe("approver1");
    const a = await lastAudit("PLAN_APPROVED");
    expect([a?.actor, a?.actorUserId, a?.actorRole]).toEqual(["approver1", approver.user.id, "PLANNING_MANAGER"]);
    expect(a?.requestId).toBeTruthy();
    expect(a?.before).toContain("APPROVAL_PENDING");
  });
  test("reservedBy forged in body → persisted reserver is the session user", async () => {
    const rough = await makeRough();
    const r = await call(reserve, { method: "POST", cookie: planner.cookie, body: { roughId: rough.id, reservedBy: "admin" } });
    expect(r.status).toBe(200);
    const res = await db.roughReservation.findFirst({ where: { roughId: rough.id } });
    expect([res?.reservedBy, res?.reservedByUserId]).toEqual(["planner1", planner.user.id]);
    expect((await lastAudit("RESERVATION"))?.actor).toBe("planner1");
  });
  test("actor forged in replan / priority / flag / rule bodies → session user recorded", async () => {
    const c = await makeCase({ status: "APPROVED" });
    expect((await call(replan, { method: "POST", cookie: planner.cookie, params: { id: c.caseId }, body: { reason: "yield below threshold", actor: "admin" } })).status).toBe(200);
    expect((await lastAudit("PLAN_REPLAN"))?.actor).toBe("planner1");
    expect((await db.planVersion.findFirst({ where: { planningCaseId: c.caseId, versionNumber: 2 } }))?.createdBy).toBe("planner1");

    const req = await db.requirement.create({ data: { requirementCode: `REQ-T-${Date.now()}`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "B", requiredQty: 2 } });
    const mgr = await makeUser("analysis.mgr", "ANALYSIS_MANAGER");
    expect((await call(priority, { method: "POST", cookie: mgr.cookie, params: { id: req.id }, body: { priority: "HIGH", reason: "customer escalation", actor: "admin" } })).status).toBe(200);
    expect((await db.requirement.findUnique({ where: { id: req.id } }))?.updatedBy).toBe("analysis.mgr");

    const flag = await db.featureFlag.create({ data: { code: `F_${Date.now()}`, name: "f" } });
    expect((await call(flags, { method: "POST", cookie: root.cookie, body: { id: flag.id, enabled: true, actor: "someone.else" } })).status).toBe(200);
    const fa = await lastAudit("FEATURE_FLAG_TOGGLE");
    expect(fa?.actor).toBe("root1");
    expect(fa?.before).toContain("false");

    const rule = await db.businessRule.create({ data: { ruleId: `BR-${Date.now()}`, domain: "d", name: "n", version: "1", effectiveDate: new Date() } });
    expect((await call(rules, { method: "POST", cookie: root.cookie, body: { id: rule.id, status: "CONFIRMED", approver: "ceo" } })).status).toBe(200);
    expect((await db.businessRule.findUnique({ where: { id: rule.id } }))?.approvedBy).toBe("root1");
  });
  test("privileged admin changes: ADMIN (no manage permission) and viewer → 403, invalid enum → 400", async () => {
    const admin = await makeUser("admin1", "ADMIN");
    const flag = await db.featureFlag.create({ data: { code: `F2_${Date.now()}`, name: "f" } });
    expect((await call(flags, { method: "POST", cookie: admin.cookie, body: { id: flag.id, enabled: true } })).status).toBe(403);
    expect((await call(rules, { method: "POST", cookie: viewer.cookie, body: { id: "x", status: "CONFIRMED" } })).status).toBe(403);
    expect((await call(rules, { method: "POST", cookie: root.cookie, body: { id: "x", status: "ANYTHING" } })).status).toBe(400);
  });
});

describe("approval integrity (SEC-007)", () => {
  for (const status of ["REJECTED", "CANCELLED", "SUPERSEDED", "APPROVED", "RELEASED_TO_MANUFACTURING", "REPLAN_REQUIRED", "DRAFT"]) {
    test(`case in ${status} cannot be approved → 409, state unchanged`, async () => {
      const c = await makeCase({ status });
      const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
      expect(r.status).toBe(409);
      expect(r.json.error.code).toBe("INVALID_CASE_STATE");
      expect((await db.planningCase.findUnique({ where: { id: c.caseId } }))?.status).toBe(status);
    });
  }
  test("reject then approve: the rejected plan does not come back", async () => {
    const c = await makeCase();
    expect((await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "reject", comment: "no" } })).status).toBe(200);
    expect((await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } })).status).toBe(409);
    expect((await db.planningCase.findUnique({ where: { id: c.caseId } }))?.status).toBe("REJECTED");
  });
  test("superseded current version → 409", async () => {
    const c = await makeCase();
    await db.planVersion.update({ where: { id: c.versionId }, data: { status: "SUPERSEDED", supersededAt: new Date() } });
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
    expect([r.status, r.json.error.code]).toEqual([409, "VERSION_NOT_CURRENT"]);
  });
  test("selected option from another case/version → 409", async () => {
    const a = await makeCase();
    const b = await makeCase();
    await db.planningCase.update({ where: { id: a.caseId }, data: { selectedOptionId: b.optionIds[0] } });
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: a.caseId, action: "approve" } });
    expect([r.status, r.json.error.code]).toEqual([409, "OPTION_NOT_IN_CURRENT_VERSION"]);
  });
  test("no selected option → 409 (no silent fallback to the first option)", async () => {
    const c = await makeCase({ status: "READY_FOR_REVIEW", select: false });
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
    expect([r.status, r.json.error.code]).toEqual([409, "OPTION_NOT_SELECTED"]);
    const ok = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve", optionId: c.optionIds[1] } });
    expect(ok.status).toBe(200);
    expect((await db.planningCase.findUnique({ where: { id: c.caseId } }))?.selectedOptionId).toBe(c.optionIds[1]);
  });
  test("rough actively reserved for another case → 409", async () => {
    const other = await makeCase();
    const mine = await makeCase({ roughId: other.roughId });
    await db.roughReservation.create({ data: { roughId: other.roughId, planningCaseId: other.caseId, status: "RESERVED", reservedBy: "x", activeRoughKey: other.roughId } });
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: mine.caseId, action: "approve" } });
    expect([r.status, r.json.error.code]).toEqual([409, "ROUGH_RESERVED_ELSEWHERE"]);
  });
  test("separation of duties: the case planner cannot approve (403); switching the flag off allows it", async () => {
    const c = await makeCase({ planner: "Approver One" }); // matches approver1's display name
    const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
    expect(r.status).toBe(403);
    await db.featureFlag.create({ data: { code: "SOD_PLANNER_APPROVER", name: "SoD", enabled: false } });
    expect((await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } })).status).toBe(200);
    await db.featureFlag.delete({ where: { code: "SOD_PLANNER_APPROVER" } });
  });
  test("planner (no plan.approve) → 403; unknown case → 404", async () => {
    const c = await makeCase();
    expect((await call(approvals, { method: "POST", cookie: planner.cookie, body: { caseId: c.caseId, action: "approve" } })).status).toBe(403);
    expect((await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: "missing", action: "approve" } })).status).toBe(404);
  });
  test("transaction integrity: if the audit write fails, nothing is persisted", async () => {
    const c = await makeCase();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION sectest_fail_audit() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'PLAN_APPROVED' THEN RAISE EXCEPTION 'sectest forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sectest_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sectest_fail_audit()`);
    try {
      const r = await call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
      expect(r.status).toBe(500);
      expect(r.json.error.message).toBe("An unexpected error occurred."); // no internals leaked
      expect(JSON.stringify(r.json)).not.toContain("sectest forced failure");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER sectest_fail_audit ON "AuditLog"`);
    }
    const row = await db.planningCase.findUnique({ where: { id: c.caseId } });
    expect([row?.status, row?.approvedBy]).toEqual(["APPROVAL_PENDING", null]);
    expect((await db.planOption.findUnique({ where: { id: c.optionIds[0] } }))?.approvalStatus).toBe("DRAFT");
  });
});
