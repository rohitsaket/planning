// Identity, authorization and transaction integrity on a maintained real write: the Sarin
// shape-mapping catalog (POST /api/planning/sarin/shape-mappings, DELETE …/[ruleId]). The
// retired requirement-priority override used to carry these checks (see retired-features).
//
// Registered after the Sarin suites: a save adds a catalog snapshot, and the baseline suite
// must meet the catalog as a fresh installation has it. Every mapping added here uses its own
// shape name and is removed again through the real route, so the catalog's content is
// unchanged when the suite ends.

import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser } from "./helpers";
import { effectiveSnapshotId } from "./sarin-catalog";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { DELETE as removeMapping } from "@/app/api/planning/sarin/shape-mappings/[ruleId]/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";

type User = Awaited<ReturnType<typeof makeUser>>;
let mapper: User, admin: User, planner: User;
const PREFIX = `SECTEST IDENTITY ${Date.now().toString(36).toUpperCase()}`;
const mapping = (suffix: string, extra: Record<string, unknown> = {}) => ({ sarinShape: `${PREFIX} ${suffix}`, fantasyShape: "Round", applyTo: "ALL_RATIOS", ...extra });
const save = (u: User | null, body: unknown) => {
  resetRateLimits();
  return call(saveMapping, { method: "POST", ...(u ? { cookie: u.cookie } : {}), body });
};
const ruleIds = async () => {
  resetRateLimits();
  const catalog = await call(readCatalog, { cookie: mapper.cookie, path: "/api/planning/sarin/shape-mappings" });
  return (catalog.json.mappings as Array<{ id: string; sarinShape: string }>).filter((m) => m.sarinShape.startsWith(PREFIX));
};
const savedAudits = () => db.auditLog.count({ where: { action: "SARIN_MAPPING_SAVED" } });

beforeAll(async () => {
  const stamp = Date.now().toString(36);
  mapper = await makeUser(`identity.mapper.${stamp}`, "SUPER_ADMIN");
  admin = await makeUser(`identity.admin.${stamp}`, "ADMIN");
  planner = await makeUser(`identity.planner.${stamp}`, "PLANNER");
});

describe("identity integrity (SEC-002): body identity fields never become the actor", () => {
  test("identity fields in the body are refused outright, and nothing is written", async () => {
    const before = [await effectiveSnapshotId(), await savedAudits()];
    const r = await save(mapper, mapping("FORGED", { actor: "admin", userId: admin.user.id, changedByUserId: admin.user.id }));
    expect([r.status, r.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect([await effectiveSnapshotId(), await savedAudits()]).toEqual(before);
  });

  test("a save is attributed to the session user, in the audit log and on the stored rule", async () => {
    const r = await save(mapper, mapping("ATTRIBUTED"));
    expect([r.status, r.json.changed]).toEqual([200, true]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_MAPPING_SAVED" }, orderBy: { timestamp: "desc" } });
    expect([audit.actor, audit.actorUserId, JSON.parse(audit.after!).sarinShape]).toEqual([mapper.user.username, mapper.user.id, `${PREFIX} ATTRIBUTED`]);
    const rule = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { sourceRawShape: `${PREFIX} ATTRIBUTED`, mappingSet: { status: "EFFECTIVE" } } });
    expect(rule.changedByUserId).toBe(mapper.user.id);
  });
});

describe("server-side authorization on the write", () => {
  test("anonymous, an administrator without the mapping permission, and a planner are refused; nothing is written", async () => {
    const before = [await effectiveSnapshotId(), await savedAudits()];
    expect((await save(null, mapping("ANON"))).status).toBe(401);
    expect((await save(admin, mapping("ADMIN"))).status).toBe(403);
    expect((await save(planner, mapping("PLANNER"))).status).toBe(403);
    resetRateLimits();
    expect((await call(removeMapping, { method: "DELETE", cookie: planner.cookie, params: { ruleId: "any-rule" } })).status).toBe(403);
    expect([await effectiveSnapshotId(), await savedAudits()]).toEqual(before);
  });

  test("privileged admin changes: ADMIN (no manage permission) → 403, nothing written", async () => {
    const code = `IDENTITY_${Date.now().toString(36).toUpperCase()}`;
    resetRateLimits();
    const r = await call(rolesPost, { method: "POST", cookie: admin.cookie, body: { op: "createRole", code, name: code, permissions: [] } });
    expect(r.status).toBe(403);
    expect(await db.role.count({ where: { code } })).toBe(0);
  });
});

describe("transaction integrity (SEC-007)", () => {
  // Suite-level, so it runs straight after these tests — module-level teardown runs only after
  // every suite, when later suites have already reset the accounts this one signs in with.
  afterAll(async () => {
    for (const r of await ruleIds()) {
      resetRateLimits();
      const removed = await call(removeMapping, { method: "DELETE", cookie: mapper.cookie, params: { ruleId: r.id } });
      if (removed.status !== 200) throw new Error(`mapping cleanup failed ${removed.status}`);
    }
    expect(await ruleIds()).toEqual([]);
  });

  test("if the audit write fails, the mapping and its snapshot are not persisted and no internals leak", async () => {
    const before = await effectiveSnapshotId();
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION sectest_fail_audit() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'SARIN_MAPPING_SAVED' THEN RAISE EXCEPTION 'sectest forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER sectest_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sectest_fail_audit()`);
    try {
      const r = await save(mapper, mapping("ROLLBACK"));
      expect(r.status).toBe(500);
      expect(r.json.error.message).toBe("An unexpected error occurred.");
      expect(JSON.stringify(r.json)).not.toContain("sectest forced failure");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER sectest_fail_audit ON "AuditLog"`);
    }
    expect(await effectiveSnapshotId()).toBe(before);
    expect(await db.sarinShapeMappingRule.count({ where: { sourceRawShape: `${PREFIX} ROLLBACK` } })).toBe(0);
  });

  test("removing a mapping is audited to the session user as well", async () => {
    const [rule] = (await ruleIds()).filter((m) => m.sarinShape === `${PREFIX} ATTRIBUTED`);
    resetRateLimits();
    const r = await call(removeMapping, { method: "DELETE", cookie: mapper.cookie, params: { ruleId: rule.id } });
    expect(r.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_MAPPING_REMOVED" }, orderBy: { timestamp: "desc" } });
    expect([audit.actor, audit.actorUserId]).toEqual([mapper.user.username, mapper.user.id]);
  });
});
