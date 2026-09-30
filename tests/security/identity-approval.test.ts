// Identity and transaction integrity on a live mutation. The legacy approval, replan and
// reservation routes these checks once covered are retired (see retired-features.test.ts);
// the same guarantees are held here against the requirement priority override.
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { POST as priority } from "@/app/api/requirements/[id]/priority/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";

let manager: Awaited<ReturnType<typeof makeUser>>;
beforeAll(async () => {
  await resetDb();
  manager = await makeUser("analysis.mgr", "ANALYSIS_MANAGER");
});
const lastAudit = (action: string) => db.auditLog.findFirst({ where: { action }, orderBy: { timestamp: "desc" } });
const makeRequirement = () =>
  db.requirement.create({ data: { requirementCode: `REQ-T-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "B", requiredQty: 2 } });

describe("identity integrity (SEC-002): body identity fields never become the actor", () => {
  test("actor forged in a priority override body → the session user is recorded", async () => {
    const req = await makeRequirement();
    const r = await call(priority, { method: "POST", cookie: manager.cookie, params: { id: req.id }, body: { priority: "HIGH", reason: "customer escalation", actor: "admin", updatedBy: "admin" } });
    expect(r.status).toBe(200);
    expect((await db.requirement.findUnique({ where: { id: req.id } }))?.updatedBy).toBe("analysis.mgr");
    const a = await lastAudit("REQUIREMENT_PRIORITY_OVERRIDE");
    expect([a?.actor, a?.actorUserId]).toEqual(["analysis.mgr", manager.user.id]);
  });

  test("privileged admin changes: ADMIN (no manage permission) → 403, nothing written", async () => {
    const admin = await makeUser("admin1", "ADMIN");
    const code = `IDENTITY_${Date.now().toString(36).toUpperCase()}`;
    const r = await call(rolesPost, { method: "POST", cookie: admin.cookie, body: { op: "createRole", code, name: code, permissions: [] } });
    expect(r.status).toBe(403);
    expect(await db.role.count({ where: { code } })).toBe(0);
  });
});

describe("transaction integrity (SEC-007)", () => {
  test("if the audit write fails, the override is not persisted and no internals leak", async () => {
    const req = await makeRequirement();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION sectest_fail_audit() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'REQUIREMENT_PRIORITY_OVERRIDE' THEN RAISE EXCEPTION 'sectest forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sectest_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sectest_fail_audit()`);
    try {
      const r = await call(priority, { method: "POST", cookie: manager.cookie, params: { id: req.id }, body: { priority: "CRITICAL", reason: "rollback check" } });
      expect(r.status).toBe(500);
      expect(r.json.error.message).toBe("An unexpected error occurred.");
      expect(JSON.stringify(r.json)).not.toContain("sectest forced failure");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER sectest_fail_audit ON "AuditLog"`);
    }
    const row = await db.requirement.findUniqueOrThrow({ where: { id: req.id } });
    expect([row.requirementPriority, row.updatedBy]).toEqual([null, null]);
  });
});
