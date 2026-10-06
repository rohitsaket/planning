import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as listRoles, POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { GET as listRequests, POST as decideRequest } from "@/app/api/admin/access-requests/route";
import { ROLES } from "@/lib/auth/permissions";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, admin: User, customCode: string;
const PASSWORD = "Str0ng-Test-Passphrase-42";
const post = (h: any, cookie: string, body: unknown) => {
  resetRateLimits();
  return call(h, { method: "POST", cookie, body });
};
const get = (h: any, cookie: string, path: string) => {
  resetRateLimits();
  return call(h, { cookie, path });
};
let seq = 0;
const pending = async () => {
  const username = `ssr.req.${++seq}.${Date.now().toString(36)}`;
  return db.accessRequest.create({ data: { username, displayName: `Applicant ${seq}`, justification: "Needs read access for planning review", pendingKey: username } });
};

beforeAll(async () => {
  await resetDb();
  root = await makeUser("ssr.root", "SUPER_ADMIN");
  admin = await makeUser("ssr.admin", "ADMIN");
  customCode = `SSR_READER_${Date.now().toString(36).toUpperCase()}`;
  const created = await post(rolesPost, root.cookie, { op: "createRole", code: customCode, name: "Mappings Reader", permissions: ["config.read", "analysis.read"] });
  if (created.status !== 200) throw new Error(`createRole ${created.status}`);
});

describe("single system role", () => {
  test("Super Admin is the one system role, kept out of the role list; its code cannot be taken by a custom role", async () => {
    expect([...ROLES]).toEqual(["SUPER_ADMIN"]);
    expect((await db.role.findMany({ where: { isSystem: true }, select: { code: true } })).map((r) => r.code)).toEqual(["SUPER_ADMIN"]);
    const roles = (await get(listRoles, root.cookie, "/api/admin/roles")).json.roles as Array<{ code: string }>;
    expect([roles.some((r) => r.code === "SUPER_ADMIN"), roles.some((r) => r.code === customCode)]).toEqual([false, true]);
    const clash = await post(rolesPost, root.cookie, { op: "createRole", code: "SUPER_ADMIN", name: "Imposter", permissions: ["config.read"] });
    expect(clash.status).toBe(409);
  });

  test("an account is created only with an explicitly chosen role; custom roles are assignable; Super Admin never is", async () => {
    const before = await db.user.count();
    const none = await post(usersPost, admin.cookie, { op: "create", username: "ssr.norole", displayName: "No Role", password: PASSWORD });
    expect(none.status).toBe(400);
    expect(await db.user.count()).toBe(before);

    const withCustom = await post(usersPost, admin.cookie, { op: "create", username: "ssr.custom", displayName: "Custom", password: PASSWORD, roles: [customCode] });
    expect(withCustom.status).toBe(200);
    const assigned = await db.userRole.findMany({ where: { userId: withCustom.json.id }, select: { role: { select: { code: true } } } });
    expect(assigned.map((a) => a.role.code)).toEqual([customCode]);

    for (const actor of [admin, root]) {
      const superAdmin = await post(usersPost, actor.cookie, { op: "create", username: "ssr.super", displayName: "Super", password: PASSWORD, roles: ["SUPER_ADMIN"] });
      expect([superAdmin.status, superAdmin.json.error.code]).toEqual([403, "SUPER_ADMIN_SERVER_ONLY"]);
    }
    expect(await db.user.count({ where: { username: "ssr.super" } })).toBe(0);
    const unknown = await post(usersPost, root.cookie, { op: "create", username: "ssr.unknown", displayName: "Unknown", password: PASSWORD, roles: ["PLANNER_RETIRED_X"] });
    expect([unknown.status, unknown.json.error.code]).toEqual([400, "UNKNOWN_ROLE"]);
  });

  test("access-request approval offers and grants custom roles only — never Super Admin or an unknown code", async () => {
    const asAdmin = (await get(listRequests, admin.cookie, "/api/admin/access-requests")).json.assignableRoles.map((r: any) => r.code);
    const asRoot = (await get(listRequests, root.cookie, "/api/admin/access-requests")).json.assignableRoles.map((r: any) => r.code);
    expect([asAdmin.includes("SUPER_ADMIN"), asAdmin.includes(customCode), asRoot.includes("SUPER_ADMIN"), asRoot.includes(customCode)]).toEqual([false, true, false, true]);

    const r1 = await pending();
    const approved = await post(decideRequest, admin.cookie, { op: "approve", id: r1.id, role: customCode });
    expect([approved.status, approved.json.user.role]).toEqual([200, customCode]);
    const u1 = await db.user.findUniqueOrThrow({ where: { username: r1.username }, select: { roleAssignments: { select: { role: { select: { code: true } } } } } });
    expect(u1.roleAssignments.map((a) => a.role.code)).toEqual([customCode]);

    const r2 = await pending();
    expect((await post(decideRequest, admin.cookie, { op: "approve", id: r2.id, role: "SUPER_ADMIN" })).status).toBe(403);
    expect((await post(decideRequest, root.cookie, { op: "approve", id: r2.id, role: "SUPER_ADMIN" })).status).toBe(403);
    const unknown = await post(decideRequest, root.cookie, { op: "approve", id: r2.id, role: "SSR_NO_SUCH_ROLE" });
    expect([unknown.status, unknown.json.error.code]).toEqual([400, "UNKNOWN_ROLE"]);
    expect((await post(decideRequest, root.cookie, { op: "approve", id: r2.id, role: "viewer" })).status).toBe(400);
    const still = await db.accessRequest.findUniqueOrThrow({ where: { id: r2.id } });
    expect([still.status, await db.user.count({ where: { username: r2.username } })]).toEqual(["PENDING", 0]);
  });

  test("a retired role code grants nothing, as an assignment or as the legacy column", async () => {
    const u = await db.user.create({ data: { username: "ssr.legacy.planner", displayName: "Legacy", role: "PLANNER", passwordHash: "x" } });
    const { token } = await createSession(u.id, { ip: null, userAgent: "test" });
    const r = await get(me, `${SESSION_COOKIE}=${token}`, "/api/auth/me");
    expect([r.status, r.json.user.permissions]).toEqual([200, []]);
  });
});
