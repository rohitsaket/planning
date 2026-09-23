import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb, testPassword } from "./helpers";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as customers } from "@/app/api/analysis/customers/route";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { resetRateLimits } from "@/lib/api/rate-limit";

beforeAll(resetDb);

describe("authentication (SEC-001)", () => {
  test("anonymous GET of a protected route → 401 with the error contract", async () => {
    const r = await call(customers);
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHENTICATED");
    expect(typeof r.json.error.requestId).toBe("string");
  });
  test("anonymous POST of a protected route → 401", async () => {
    expect((await call(approvals, { method: "POST", body: { caseId: "x", action: "approve" } })).status).toBe(401);
  });
  test("forged / unknown session token → 401", async () => {
    expect((await call(customers, { cookie: "dp_session=not-a-real-token" })).status).toBe(401);
  });
  test("identity headers from the client are ignored → 401", async () => {
    const r = await call(customers, { headers: { "x-user": "admin", "x-role": "SUPER_ADMIN", authorization: "Bearer anything" } });
    expect(r.status).toBe(401);
  });
  test("expired session → 401", async () => {
    const u = await makeUser("expired.user", "ADMIN");
    await db.session.update({ where: { id: u.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(me, { cookie: u.cookie })).status).toBe(401);
  });
  test("idle-timed-out session → 401", async () => {
    const u = await makeUser("idle.user", "ADMIN");
    await db.session.update({ where: { id: u.session.id }, data: { lastSeenAt: new Date(Date.now() - 3 * 3600_000) } });
    expect((await call(me, { cookie: u.cookie })).status).toBe(401);
  });
  test("disabled user is rejected even with a live session → 401", async () => {
    const u = await makeUser("disabled.user", "ADMIN");
    expect((await call(me, { cookie: u.cookie })).status).toBe(200);
    await db.user.update({ where: { id: u.user.id }, data: { status: "DISABLED" } });
    expect((await call(me, { cookie: u.cookie })).status).toBe(401);
  });
  test("logout revokes the session server-side", async () => {
    const u = await makeUser("logout.user", "VIEWER");
    expect((await call(logout, { method: "POST", cookie: u.cookie })).status).toBe(200);
    expect((await call(me, { cookie: u.cookie })).status).toBe(401);
  });
  test("login: correct password → HttpOnly SameSite cookie; wrong password → 401; disabled → 401", async () => {
    const u = await makeUser("login.user", "PLANNER");
    const good = await call(login, { method: "POST", body: { username: "login.user", password: testPassword() } });
    expect(good.status).toBe(200);
    const cookie = good.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(JSON.stringify(good.json)).not.toContain("passwordHash");
    expect((await call(me, { cookie: cookie.split(";")[0] })).json.user.username).toBe("login.user");
    expect((await call(login, { method: "POST", body: { username: "login.user", password: "wrong-password-123" } })).status).toBe(401);
    expect((await call(login, { method: "POST", body: { username: "no.such.user", password: "wrong-password-123" } })).status).toBe(401);
    await db.user.update({ where: { id: u.user.id }, data: { status: "DISABLED" } });
    expect((await call(login, { method: "POST", body: { username: "login.user", password: testPassword() } })).status).toBe(401);
  });
  test("account locks after repeated failures; login endpoint is rate limited", async () => {
    await makeUser("lock.user", "VIEWER");
    resetRateLimits();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await call(login, { method: "POST", body: { username: "lock.user", password: "bad-password-xyz" } })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    resetRateLimits();
    // 10 failures locked the account: the right password is refused while locked.
    expect((await call(login, { method: "POST", body: { username: "lock.user", password: testPassword() } })).status).toBe(401);
    const failures = await db.auditLog.count({ where: { action: "LOGIN_FAILED" } });
    expect(failures).toBeGreaterThan(0);
  });
});
