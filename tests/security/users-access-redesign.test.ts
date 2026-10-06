// Users and Access: account management, role permissions chosen by a Super Admin, and the
// two-tab page. Every case crosses the real route handler (or renders the real page against
// the real handlers) under a real session in the isolated planning_sectest database.

import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, ensureCountryRegistry, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { ensureFixtureRole } from "./fixture-roles";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as listRoles, POST as rolesPost } from "@/app/api/admin/roles/route";
import { GET as listUsers, POST as usersPost } from "@/app/api/admin/users/route";
import { GET as userHistory } from "@/app/api/admin/users/[id]/history/route";
import { POST as decideRequest } from "@/app/api/admin/access-requests/route";
import { PERMISSIONS, permissionsFor } from "@/lib/auth/permissions";
import { catalogCoverage, PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";
import { UsersAccessView, USERS_ACCESS_TABS } from "@/components/diamond/views/consolidated/users-access-view";
import { PermissionEditor } from "@/components/diamond/views/users-access/permission-editor";
import { UserAccessInspector } from "@/components/diamond/views/users-access/user-access-inspector";
import { useNavStore } from "@/stores/nav-store";
import { useAccessFocusStore } from "@/stores/access-focus-store";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

type User = Awaited<ReturnType<typeof makeUser>>;
const post = (h: any, cookie: string, body: unknown) => {
  resetRateLimits();
  return call(h, { method: "POST", cookie, body });
};
const get = (h: any, cookie: string, pathAndQuery: string, params: Record<string, string> = {}) => {
  resetRateLimits();
  return call(h, { cookie, path: pathAndQuery, params });
};
const roleByCode = (code: string) => db.role.findUniqueOrThrow({ where: { code } });
const auditRows = (entityId: string, action: string) => db.auditLog.findMany({ where: { entityId, action }, orderBy: { timestamp: "asc" } });
let seq = 0;
const code = (stem: string) => `UAR_${stem}_${(++seq).toString(36).toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;

let root: User, admin: User, viewer: User;

/** A custom role created by the Super Admin through the real route. */
async function customRole(stem: string, permissions: string[]) {
  const c = code(stem);
  const res = await post(rolesPost, root.cookie, { op: "createRole", code: c, name: `UAR ${stem} ${seq}`, permissions });
  if (res.status !== 200) throw new Error(`createRole ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.role as { id: string; code: string; name: string; version: number; permissions: string[] };
}
/** A signed-in user holding only the given role code, assigned through the real route. */
async function userWithRole(name: string, roleCode: string) {
  const u = await makeUser(name, "VIEWER");
  const res = await post(usersPost, root.cookie, { op: "setRoles", id: u.user.id, roles: [roleCode] });
  if (res.status !== 200) throw new Error(`setRoles ${res.status} ${JSON.stringify(res.json)}`);
  return u;
}

beforeAll(async () => {
  await resetDb();
  await ensureCountryRegistry(["ZS", "ZT"]);
  await ensureLabRegistry(["LAB-ALPHA", "LAB-BETA"]);
  root = await makeUser("uar.root", "SUPER_ADMIN");
  admin = await makeUser("uar.admin", "ADMIN");
  viewer = await makeUser("uar.viewer", "VIEWER");
  for (const fixture of ["PLANNING_VIEWER", "SALES_VIEWER"] as const) await ensureFixtureRole(fixture);
});

// =========================================================================================
describe("users and access: the permission catalogue", () => {
  test("1. every permission is described exactly once, with safe metadata only", async () => {
    expect(catalogCoverage()).toEqual({ missing: [], unknown: [], duplicated: [] });
    const res = await get(listRoles, root.cookie, "/api/admin/roles");
    expect(res.status).toBe(200);
    const served = res.json.catalog.permissions as Array<Record<string, unknown>>;
    expect(served.length).toBe(PERMISSIONS.length);
    expect(served.every((p) => JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["area", "capability", "id", "label", "sensitive"]))).toBe(true);
    expect(res.json.catalog.areas.every((a: string) => served.some((p) => p.area === a))).toBe(true);
  });

  test("2. approvals, exports, overrides and unlocks are sensitive; no plan-approval permission exists", () => {
    const risky = PERMISSION_CATALOG.filter((p) => ["Approve", "Export", "Override", "Unlock"].includes(p.capability));
    expect(risky.length).toBeGreaterThan(0);
    expect(risky.filter((p) => !p.sensitive).map((p) => p.id)).toEqual([]);
    expect(PERMISSION_CATALOG.find((p) => p.id === "access_request.review")?.sensitive).toBe(true);
    // The legacy planning and Sarin approval permissions are retired: none is assignable.
    for (const retired of ["plan.approve", "sarin.output.approve", "approval_policy.manage"]) expect([retired, (PERMISSIONS as readonly string[]).includes(retired)]).toEqual([retired, false]);
  });

  test("3. reading roles needs role.read; the page is told who may edit permissions", async () => {
    expect((await get(listRoles, viewer.cookie, "/api/admin/roles")).status).toBe(403);
    const asRoot = (await get(listRoles, root.cookie, "/api/admin/roles")).json;
    const asAdmin = (await get(listRoles, admin.cookie, "/api/admin/roles")).json;
    expect([asRoot.canEditPermissions, asAdmin.canEditPermissions]).toEqual([true, false]);
  });
});

// =========================================================================================
describe("users and access: role permissions are chosen by a Super Admin", () => {
  test("4. Super Admin is kept out of the role list and nobody can edit or retire it through the API", async () => {
    const sa = await roleByCode("SUPER_ADMIN");
    const roles = (await get(listRoles, root.cookie, "/api/admin/roles")).json.roles as Array<Record<string, unknown>>;
    expect(roles.some((r) => r.code === "SUPER_ADMIN")).toBe(false);
    expect(roles.every((r) => !("isSystem" in r) && !("isProtected" in r))).toBe(true);
    for (const change of [{ permissions: ["config.read"] }, { status: "INACTIVE" }, { name: "Renamed" }]) {
      const res = await post(rolesPost, root.cookie, { op: "updateRole", id: sa.id, version: sa.version, ...change });
      expect(res.status).toBe(400);
    }
    expect((await roleByCode("SUPER_ADMIN")).version).toBe(sa.version);
  });

  test("5. a Super Admin chooses permissions; the save reports and audits exactly what changed", async () => {
    const role = await customRole("EDIT", ["config.read", "analysis.read"]);
    const holder = await userWithRole("uar.holder.edit", role.code);
    const res = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: ["analysis.read", "data_quality.read", "audit.read"] });
    expect(res.status).toBe(200);
    expect([res.json.changed, [...res.json.added].sort(), res.json.removed, res.json.affectedUsers, res.json.role.version]).toEqual([true, ["audit.read", "data_quality.read"], ["config.read"], 1, role.version + 1]);
    const rows = await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } });
    expect(rows.map((r) => r.permissionCode).sort()).toEqual(["analysis.read", "audit.read", "data_quality.read"]);
    const [audit] = await auditRows(role.id, "ROLE_PERMISSIONS_CHANGED");
    const after = JSON.parse(audit.after!);
    expect([audit.actorUserId, JSON.parse(audit.before!).permissions, after.affectedUsers, after.version, after.removed]).toEqual([root.user.id, ["analysis.read", "config.read"], 1, role.version + 1, ["config.read"]]);
    expect(holder.user.id.length).toBeGreaterThan(0);
  });

  test("6. an assigned user's access changes on their next request, without signing in again", async () => {
    const role = await customRole("LIVE", ["analysis.read"]);
    const u = await userWithRole("uar.live", role.code);
    expect((await get(listUsers, u.cookie, "/api/admin/users")).status).toBe(403);
    const r = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: ["analysis.read", "user.read"] });
    expect(r.status).toBe(200);
    expect((await get(listUsers, u.cookie, "/api/admin/users")).status).toBe(200);
    expect((await get(me, u.cookie, "/api/auth/me")).json.user.permissions.includes("user.read")).toBe(true);
    // And removal is just as immediate.
    await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: r.json.role.version, permissions: ["analysis.read"] });
    expect((await get(listUsers, u.cookie, "/api/admin/users")).status).toBe(403);
  });

  test("7. nobody but a Super Admin can choose permissions — not even a holder of role.manage and role.permissions.assign", async () => {
    const role = await customRole("TARGET", ["analysis.read"]);
    const manager = await userWithRole("uar.rolemgr", (await customRole("ROLEMGR", ["role.read", "role.manage", "role.permissions.assign", "analysis.read"])).code);
    const denied = await post(rolesPost, manager.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: ["analysis.read", "config.read"] });
    expect(denied.status).toBe(403);
    expect((await post(rolesPost, manager.cookie, { op: "createRole", code: code("SNEAK"), name: "Sneak", permissions: ["config.read"] })).status).toBe(403);
    expect((await post(rolesPost, admin.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: [] })).status).toBe(403);
    // Renaming is role management, not a permission choice.
    const renamed = await post(rolesPost, manager.cookie, { op: "updateRole", id: role.id, version: role.version, name: "Renamed Target", description: "Clearer" });
    expect([renamed.status, renamed.json.role.name, renamed.json.role.permissions]).toEqual([200, "Renamed Target", ["analysis.read"]]);
  });

  test("8. a stale version is refused and changes nothing", async () => {
    const role = await customRole("STALE", ["analysis.read"]);
    await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, name: "First writer" });
    const stale = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: ["config.read"] });
    expect([stale.status, stale.json.error.code]).toEqual([409, "STALE_ROLE"]);
    const rows = await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } });
    expect(rows.map((r) => r.permissionCode)).toEqual(["analysis.read"]);
  });

  test("9. two editors saving the same version at the same moment: exactly one wins", async () => {
    const role = await customRole("RACE", ["analysis.read"]);
    resetRateLimits();
    const [a, b] = await Promise.all([
      call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "updateRole", id: role.id, version: role.version, permissions: ["analysis.read", "config.read"] } }),
      call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "updateRole", id: role.id, version: role.version, permissions: ["analysis.read", "fantasy.read"] } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const after = await db.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: true } });
    expect(after.version).toBe(role.version + 1);
    expect(after.permissions.length).toBe(2);
    expect((await auditRows(role.id, "ROLE_PERMISSIONS_CHANGED")).length).toBe(1);
  });

  test("10. saving what is already stored is a no-op: no version, no audit", async () => {
    const role = await customRole("SAME", ["analysis.read", "config.read"]);
    const res = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, permissions: ["config.read", "analysis.read"] });
    expect([res.status, res.json.changed]).toEqual([200, false]);
    expect((await db.role.findUniqueOrThrow({ where: { id: role.id } })).version).toBe(role.version);
    expect((await auditRows(role.id, "ROLE_PERMISSIONS_CHANGED")).length).toBe(0);
  });

  test("11. a failure inside the save rolls everything back", async () => {
    const role = await customRole("ROLLBACK", ["analysis.read", "config.read"]);
    // A real failure inside the transaction: this test database refuses one insert.
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION uar_refuse_insert() RETURNS trigger AS $$ BEGIN IF NEW."permissionCode" = 'audit.export' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER uar_refuse BEFORE INSERT ON "RolePermission" FOR EACH ROW EXECUTE FUNCTION uar_refuse_insert()`);
    try {
      const res = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, name: "Should not stick", permissions: ["analysis.read", "audit.export"] });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.json)).not.toMatch(/injected failure|RolePermission|uar_refuse/);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS uar_refuse ON "RolePermission"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS uar_refuse_insert()`);
    }
    const after = await db.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: true } });
    expect([after.version, after.name, after.permissions.map((p) => p.permissionCode).sort()]).toEqual([role.version, role.name, ["analysis.read", "config.read"]]);
    expect((await auditRows(role.id, "ROLE_PERMISSIONS_CHANGED")).length).toBe(0);
  });

  test("12. roles are retired, never deleted; an assigned role cannot be retired", async () => {
    const role = await customRole("RETIRE", ["analysis.read"]);
    const holder = await userWithRole("uar.retire.holder", role.code);
    const inUse = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, status: "INACTIVE" });
    expect([inUse.status, inUse.json.error.code]).toEqual([409, "ROLE_IN_USE"]);
    expect((await post(rolesPost, root.cookie, { op: "deleteRole", id: role.id })).status).toBe(400);
    await post(usersPost, root.cookie, { op: "setRoles", id: holder.user.id, roles: ["VIEWER"] });
    const retired = await post(rolesPost, root.cookie, { op: "updateRole", id: role.id, version: role.version, status: "INACTIVE" });
    expect([retired.status, retired.json.role.status]).toEqual([200, "INACTIVE"]);
    const assign = await post(usersPost, root.cookie, { op: "setRoles", id: holder.user.id, roles: [role.code] });
    expect([assign.status, assign.json.error.code]).toEqual([400, "INACTIVE_ROLE"]);
    expect(await db.role.count({ where: { id: role.id } })).toBe(1);
  });

  test("13. an unknown permission is rejected; a copy carries exactly the source's permissions", async () => {
    expect((await post(rolesPost, root.cookie, { op: "createRole", code: code("BAD"), name: "Bad", permissions: ["config.read", "everything.all"] })).status).toBe(400);
    const source = await customRole("SOURCE", ["analysis.read", "config.read", "fantasy.read"]);
    const copy = await customRole("COPY", source.permissions);
    expect(copy.permissions).toEqual(source.permissions);
  });
});

// =========================================================================================
describe("users and access: accounts", () => {
  test("14. reading accounts needs user.read; search runs on the server and nothing secret is returned", async () => {
    expect((await get(listUsers, viewer.cookie, "/api/admin/users")).status).toBe(403);
    const found = await get(listUsers, root.cookie, "/api/admin/users?q=UAR.ADMIN");
    expect([found.status, found.json.rows.map((r: any) => r.username)]).toEqual([200, ["uar.admin"]]);
    const byId = await get(listUsers, root.cookie, `/api/admin/users?id=${admin.user.id}`);
    expect(byId.json.rows.map((r: any) => r.id)).toEqual([admin.user.id]);
    expect((await get(listUsers, root.cookie, "/api/admin/users?id=bad%20id")).status).toBe(400);
    expect(JSON.stringify(found.json)).not.toMatch(/passwordHash|scrypt\$/);
  });

  test("15. Add User issues a one-time temporary password and the account shows as Invited", async () => {
    const res = await post(usersPost, root.cookie, { op: "create", username: "uar.invited", displayName: "Invited Person", roles: ["VIEWER"] });
    expect(res.status).toBe(200);
    expect(typeof res.json.temporaryPassword).toBe("string");
    expect(res.json.temporaryPassword.length).toBeGreaterThanOrEqual(20);
    const row = (await get(listUsers, root.cookie, "/api/admin/users?q=uar.invited")).json.rows[0];
    expect([row.displayStatus, row.mustChangePassword, row.status]).toEqual(["INVITED", true, "ACTIVE"]);
    const [audit] = await auditRows(res.json.id, "USER_CREATED");
    expect(JSON.parse(audit.after!).activation).toBe("TEMPORARY_PASSWORD_ISSUED");
    expect(audit.after!.includes(res.json.temporaryPassword)).toBe(false);
  });

  test("16. an initial scope is stored with the account, only from registered values and with its own authority", async () => {
    const ok = await post(usersPost, root.cookie, { op: "create", username: "uar.scoped", displayName: "Scoped", roles: ["VIEWER"], scope: { countries: ["ZS"], labs: ["LAB-ALPHA"] } });
    expect(ok.status).toBe(200);
    const rows = await db.userAccessScope.findMany({ where: { userId: ok.json.id }, select: { dimension: true, value: true }, orderBy: { dimension: "asc" } });
    expect(rows).toEqual([{ dimension: "COUNTRY", value: "ZS" }, { dimension: "LAB", value: "LAB-ALPHA" }]);
    const unknown = await post(usersPost, root.cookie, { op: "create", username: "uar.badscope", displayName: "Bad", roles: ["VIEWER"], scope: { countries: ["QQ"], labs: [] } });
    expect(unknown.status).toBe(400);
    const noAuthority = await post(usersPost, admin.cookie, { op: "create", username: "uar.adminscope", displayName: "Nope", roles: ["VIEWER"], scope: { countries: ["ZS"], labs: [] } });
    expect(noAuthority.status).toBe(403);
    expect(await db.user.count({ where: { username: { in: ["uar.badscope", "uar.adminscope"] } } })).toBe(0);
  });

  test("17. a non-Super Admin cannot hand out a role carrying access they do not hold", async () => {
    // demand.run is withheld from the ADMIN fixture, so ADMIN cannot hand it out.
    const approver = await customRole("APPROVER", ["config.read", "demand.run"]);
    const reader = await customRole("READER", ["config.read"]);
    const create = await post(usersPost, admin.cookie, { op: "create", username: "uar.escalate", displayName: "Escalate", roles: [approver.code] });
    expect([create.status, create.json.error.code]).toEqual([403, "NOT_DELEGABLE"]);
    expect(await db.user.count({ where: { username: "uar.escalate" } })).toBe(0);
    const target = await makeUser("uar.delegate.target", "VIEWER");
    expect((await post(usersPost, admin.cookie, { op: "setRoles", id: target.user.id, roles: [approver.code] })).status).toBe(403);
    expect((await post(usersPost, admin.cookie, { op: "setRoles", id: target.user.id, roles: [reader.code] })).status).toBe(200);
    // The Super Admin may choose freely.
    expect((await post(usersPost, root.cookie, { op: "setRoles", id: target.user.id, roles: [approver.code] })).status).toBe(200);
  });

  test("18. Super Admin is never granted or removed through the admin API, even by a Super Admin; nobody changes their own roles", async () => {
    const target = await makeUser("uar.promote.target", "VIEWER");
    for (const actor of [admin, root]) {
      const grant = await post(usersPost, actor.cookie, { op: "setRoles", id: target.user.id, roles: ["SUPER_ADMIN"] });
      expect([grant.status, grant.json.error.code]).toEqual([403, "SUPER_ADMIN_SERVER_ONLY"]);
    }
    expect((await post(usersPost, admin.cookie, { op: "setRoles", id: admin.user.id, roles: ["ADMIN", "SUPER_ADMIN"] })).status).toBe(403);
    expect((await post(usersPost, root.cookie, { op: "setRoles", id: root.user.id, roles: ["SUPER_ADMIN", "VIEWER"] })).status).toBe(403);
    // Nor are the roles of another Super Admin account changed from here.
    const otherSuper = await makeUser("uar.other.super", "SUPER_ADMIN");
    const strip = await post(usersPost, root.cookie, { op: "setRoles", id: otherSuper.user.id, roles: ["VIEWER"] });
    expect([strip.status, strip.json.error.code]).toEqual([403, "SUPER_ADMIN_SERVER_ONLY"]);
    await db.user.update({ where: { id: otherSuper.user.id }, data: { status: "DISABLED" } });
    expect((await db.userRole.findMany({ where: { userId: target.user.id }, include: { role: true } })).map((a) => a.role.code)).toEqual(["VIEWER"]);
  });

  test("19. an access-request reviewer cannot approve into a role above their own access", async () => {
    const approver = await customRole("REQAPPROVER", ["config.read", "demand.run"]);
    const req = await db.accessRequest.create({ data: { username: `uar.req.${Date.now().toString(36)}`, displayName: "Applicant", justification: "Needs planning access for review", pendingKey: `uar-req-${Date.now()}` } });
    const denied = await post(decideRequest, admin.cookie, { op: "approve", id: req.id, role: approver.code });
    expect(denied.status).toBe(403);
    expect((await db.accessRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
    expect(await db.user.count({ where: { username: req.username } })).toBe(0);
  });

  test("20. scope grants cannot exceed the granter's own scope", async () => {
    const scoper = await userWithRole("uar.scoper", (await customRole("SCOPER", ["user.read", "user.scope.assign", "user.scope.read"])).code);
    await post(usersPost, root.cookie, { op: "setScope", id: scoper.user.id, countries: ["ZS"], labs: [], reason: "limit the scoper" });
    const target = await makeUser("uar.scope.target", "VIEWER");
    const wider = await post(usersPost, scoper.cookie, { op: "setScope", id: target.user.id, countries: ["ZT"], labs: [], reason: "try another country" });
    const unrestricted = await post(usersPost, scoper.cookie, { op: "setScope", id: target.user.id, countries: [], labs: [], reason: "try everything" });
    const inside = await post(usersPost, scoper.cookie, { op: "setScope", id: target.user.id, countries: ["ZS"], labs: [], reason: "within my own" });
    expect([wider.status, unrestricted.status, inside.status]).toEqual([403, 403, 200]);
    // The selectors are offered only what the granter could grant.
    const options = (await get(listUsers, scoper.cookie, "/api/admin/users")).json.scopeOptions;
    expect(options.countries.map((c: any) => c.code)).toEqual(["ZS"]);
  });

  test("21. the final active Super Admin cannot be suspended or disabled, and its role is never changed here", async () => {
    const assignerRole = await customRole("SAASSIGN", ["user.read", "user.roles.assign", "user.status.manage", "user.super_admin.assign"]);
    const assigner = await userWithRole("uar.saassigner", assignerRole.code);
    for (const status of ["SUSPENDED", "DISABLED"]) {
      const res = await post(usersPost, assigner.cookie, { op: "setStatus", id: root.user.id, status });
      expect([res.status, res.json.error.code]).toEqual([409, "LAST_SUPER_ADMIN"]);
    }
    const strip = await post(usersPost, assigner.cookie, { op: "setRoles", id: root.user.id, roles: [assignerRole.code] });
    expect([strip.status, strip.json.error.code]).toEqual([403, "SUPER_ADMIN_SERVER_ONLY"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: root.user.id } })).status).toBe("ACTIVE");
    expect((await db.userRole.findMany({ where: { userId: root.user.id }, include: { role: true } })).map((a) => a.role.code)).toEqual(["SUPER_ADMIN"]);
  });

  test("22. with two Super Admins suspended at once, exactly one suspension succeeds", async () => {
    const assigner = await userWithRole("uar.saassigner2", (await customRole("SAASSIGN2", ["user.read", "user.roles.assign", "user.status.manage", "user.super_admin.assign"])).code);
    const second = await makeUser("uar.root2", "SUPER_ADMIN");
    resetRateLimits();
    const [a, b] = await Promise.all([
      call(usersPost, { method: "POST", cookie: assigner.cookie, body: { op: "setStatus", id: root.user.id, status: "SUSPENDED" } }),
      call(usersPost, { method: "POST", cookie: assigner.cookie, body: { op: "setStatus", id: second.user.id, status: "SUSPENDED" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const active = await db.user.count({ where: { id: { in: [root.user.id, second.user.id] }, status: "ACTIVE" } });
    expect(active).toBe(1);
    // Restore the fixture Super Admin for the rest of the suite.
    await db.user.updateMany({ where: { id: { in: [root.user.id, second.user.id] } }, data: { status: "ACTIVE", suspendedAt: null } });
    const { createSession, SESSION_COOKIE } = await import("@/lib/auth/session");
    const { token } = await createSession(root.user.id, { ip: null, userAgent: "test" });
    root = { ...root, cookie: `${SESSION_COOKIE}=${token}` };
  });

  test("23. accounts with history are never hard-deleted; disabling keeps them", async () => {
    const leaver = await makeUser("uar.leaver", "VIEWER");
    expect((await post(usersPost, root.cookie, { op: "delete", id: leaver.user.id })).status).toBe(400);
    const disabled = await post(usersPost, root.cookie, { op: "setStatus", id: leaver.user.id, status: "DISABLED" });
    expect(disabled.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: leaver.user.id } })).status).toBe("DISABLED");
  });

  test("24. a server-issued password reset signs the account out and forces a new password", async () => {
    const u = await makeUser("uar.reset", "VIEWER");
    const res = await post(usersPost, root.cookie, { op: "resetPassword", id: u.user.id });
    expect([res.status, typeof res.json.temporaryPassword, res.json.revokedSessions >= 1]).toEqual([200, "string", true]);
    expect((await get(me, u.cookie, "/api/auth/me")).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.user.id } })).mustChangePassword).toBe(true);
  });

  test("25. an account's access history lists role, scope and status changes without raw audit detail", async () => {
    const u = await makeUser("uar.history", "VIEWER");
    await post(usersPost, root.cookie, { op: "setRoles", id: u.user.id, roles: ["PLANNING_VIEWER"] });
    await post(usersPost, root.cookie, { op: "setScope", id: u.user.id, countries: ["ZS"], labs: [], reason: "regional access" });
    await post(usersPost, root.cookie, { op: "setStatus", id: u.user.id, status: "SUSPENDED" });
    const res = await get(userHistory, root.cookie, `/api/admin/users/${u.user.id}/history`, { id: u.user.id });
    expect(res.status).toBe(200);
    expect(res.json.rows.map((r: any) => r.action)).toEqual(["USER_STATUS_CHANGE", "USER_ACCESS_SCOPE_CHANGE", "USER_ROLE_CHANGE"]);
    expect(res.json.rows[2].after.roles).toEqual(["PLANNING_VIEWER"]);
    expect(res.json.rows[1].after.countries).toEqual(["ZS"]);
    expect(Object.keys(res.json.rows[0]).sort()).toEqual(["action", "actor", "after", "at", "before", "outcome", "reason"]);
    expect(JSON.stringify(res.json)).not.toMatch(/sourceIp|sessionId|requestId|actorUserId/);
    expect((await get(userHistory, viewer.cookie, `/api/admin/users/${u.user.id}/history`, { id: u.user.id })).status).toBe(403);
    expect((await get(userHistory, root.cookie, "/api/admin/users/nobody/history", { id: "nobody" })).status).toBe(404);
  });

  test("26. a role-assignment change is transactional and audited with before and after", async () => {
    const u = await makeUser("uar.audited", "VIEWER");
    await post(usersPost, root.cookie, { op: "setRoles", id: u.user.id, roles: ["PLANNING_VIEWER", "SALES_VIEWER"] });
    const [audit] = await auditRows(u.user.id, "USER_ROLE_CHANGE");
    expect([JSON.parse(audit.before!).roles, JSON.parse(audit.after!).roles.sort(), audit.category]).toEqual([["VIEWER"], ["PLANNING_VIEWER", "SALES_VIEWER"], "SECURITY"]);
    // A refused assignment writes nothing.
    const before = await db.userRole.count({ where: { userId: u.user.id } });
    expect((await post(usersPost, root.cookie, { op: "setRoles", id: u.user.id, roles: ["PLANNING_VIEWER", "NO_SUCH_ROLE_UAR"] })).status).toBe(400);
    expect(await db.userRole.count({ where: { userId: u.user.id } })).toBe(before);
  });

  test("27. an administrator never receives retired approvals or permission assignment", async () => {
    const perms = (await get(me, admin.cookie, "/api/auth/me")).json.user.permissions as string[];
    expect([perms.includes("plan.approve"), perms.includes("sarin.output.approve"), perms.includes("role.permissions.assign")]).toEqual([false, false, false]);
  });
});

// =========================================================================================
describe("users and access: the page", () => {
  const renderAs = async (u: User, tab: "users" | "permissions" | null, focusUserId: string | null = null) => {
    const s = await sessionUser(u.cookie);
    const nav = useNavStore.getInitialState();
    const focus = useAccessFocusStore.getInitialState();
    const saved = { tab: nav.tab, view: nav.view, focusUserId: focus.focusUserId };
    Object.assign(nav, { view: "admin-users-access", tab });
    Object.assign(focus, { focusUserId });
    try {
      return await renderPage(UsersAccessView, {}, s, u.cookie);
    } finally {
      Object.assign(nav, { view: saved.view, tab: saved.tab });
      Object.assign(focus, { focusUserId: saved.focusUserId });
    }
  };
  afterAll(() => {
    useNavStore.getInitialState().tab = null;
  });

  test("28. exactly two tabs, Users and Permissions; none of the old tabs remain", async () => {
    expect(USERS_ACCESS_TABS.map((t) => t.label)).toEqual(["Users", "Permissions"]);
    const page = await renderAs(root, null);
    const tabs = [...page.html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    expect(tabs).toEqual(["Users", "Permissions"]);
    for (const old of ["User Directory", "Roles & Policies", "Permission Matrix", "Permission Catalog", "Users & Roles"]) expect([old, page.text.includes(old)]).toEqual([old, false]);
  });

  test("29. the Users tab lists accounts with status, roles, scope, last sign-in and access; Add user for account creators", async () => {
    const page = await renderAs(root, "users");
    for (const label of ["Add user", "Details", "Last sign-in", "Invited", "Access requests", "Search name, username or email"]) expect([label, page.text.includes(label)]).toEqual([label, true]);
    expect(page.requested.some((r) => r.startsWith("/api/admin/users?"))).toBe(true);
    // No permission codes or database ids on screen.
    expect(/\b(user|role|plan|sarin)\.[a-z_]+(\.[a-z_]+)?\b/.test(page.text)).toBe(false);
    expect(page.text.includes(root.user.id)).toBe(false);
  });

  test("30. a viewer without account access sees neither tab's content", async () => {
    const page = await renderAs(viewer, "users");
    expect([page.text.includes("Add user"), page.text.includes("uar.admin"), /Access Restricted/.test(page.text)]).toEqual([false, false, true]);
  });

  test("31. the Permissions tab lists custom roles only; Super Admin is not shown or offered", async () => {
    const page = await renderAs(root, "permissions");
    for (const label of ["New role", "Expand all", "Collapse all", "Sensitive", "Check a user's access", "Select safe read-only", "Review and save"]) expect([label, page.text.includes(label)]).toEqual([label, true]);
    expect([page.text.includes("Protected system role"), /Super Admin \d+ permissions/.test(page.text)]).toEqual([false, false]);
    expect(/Select all\b/i.test(page.text)).toBe(false);
  });

  test("32. an administrator sees role permissions but is told only a Super Admin can choose them", async () => {
    const page = await renderAs(admin, "permissions");
    expect([page.text.includes("Only a Super Admin can choose role permissions"), page.text.includes("New role"), page.text.includes("Review and save")]).toEqual([true, false, false]);
  });

  test("33. the permission editor shows plain-language labels grouped by area, never codes", () => {
    const html = renderToStaticMarkup(
      createElement(PermissionEditor, {
        areas: ["Mappings", "Workbook Import"],
        catalog: PERMISSION_CATALOG.filter((p) => p.area === "Mappings" || p.area === "Workbook Import"),
        selected: new Set(["sarin.mapping.read", "sarin.mapping.manage"]),
        baseline: new Set(["sarin.mapping.read"]),
        onChange: () => {},
        readOnly: false,
      }),
    );
    const text = html.replace(/<[^>]+>/g, " ");
    for (const label of ["Manage Sarin shape mappings", "View Sarin shape mappings", "Export Sarin output", "Select safe read-only", "Clear group", "Added"]) expect([label, text.includes(label)]).toEqual([label, true]);
    expect(/sarin\.mapping\.manage|sarin\.output\.export|sarin\.mapping\.read/.test(text)).toBe(false);
  });

  test("34. the access inspector explains each permission by the role that grants it", () => {
    const html = renderToStaticMarkup(
      createElement(UserAccessInspector, {
        user: { id: "u-internal-id", name: "Asha", username: "asha", email: "", roles: ["R1"], status: "ACTIVE", displayStatus: "ACTIVE", lastActive: null, permissionCount: 2, permissions: ["config.read", "analysis.read"], createdAt: new Date(0).toISOString(), mustChangePassword: false, accessScope: { countries: ["ZS"], labs: [], unrestricted: false } },
        roles: [{ id: "r-internal-id", code: "R1", name: "Mappings Reader", description: null, status: "ACTIVE", version: 1, permissions: ["config.read", "analysis.read"], userCount: 1, createdAt: new Date(0).toISOString() }],
        catalog: [...PERMISSION_CATALOG],
        areas: ["Analysis", "Mappings", "Workbook Import"],
        onClose: () => {},
        onSelectRole: () => {},
      }),
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect([text.includes("Granted by: Mappings Reader"), text.includes("Countries: ZS"), /Not held: .*Review access requests/.test(text)]).toEqual([true, true, true]);
    expect([html.includes("u-internal-id"), html.includes("r-internal-id")]).toEqual([false, false]);
  });

  test("35. Manage Access opens the Permissions tab with that user's access explained", async () => {
    const page = await renderAs(root, "permissions", admin.user.id);
    expect(page.text.includes("Access of uar.admin")).toBe(true);
    expect(page.text.includes("Granted by:")).toBe(true);
  });

  test("36. the replaced pages and their client-side permission list are gone", () => {
    const views = path.join(process.cwd(), "src", "components", "diamond", "views");
    expect([existsSync(path.join(views, "users-view.tsx")), existsSync(path.join(views, "access-requests-view.tsx"))]).toEqual([false, false]);
    const dir = path.join(views, "users-access");
    const source = readdirSync(dir).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    // The page takes its permission vocabulary from the server catalogue, not a copy of its own.
    expect(/PERMISSION_METAS|from "@\/lib\/auth\/permissions"/.test(source)).toBe(false);
  });
});
