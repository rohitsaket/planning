// Password change: the forced change after a temporary password, and the voluntary change from
// the account menu. Every request goes through the real route handlers against the isolated
// planning_sectest database; the forced screen is rendered from the real AuthGate.

import { createElement, type ComponentType, type ReactNode } from "react";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, testPassword } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { passwordChangeProblems } from "@/lib/auth/password-policy";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as changePassword } from "@/app/api/auth/password/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as users, POST as usersPost } from "@/app/api/admin/users/route";
import { AuthGate } from "@/components/auth/auth-gate";
import { OverviewView } from "@/components/diamond/views/consolidated/overview-view";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
const NEW_PASSWORD = "Closeout-Permanent-2026!";

/** The session cookie a response set, as the browser would store it. */
function sessionFrom(headers: Headers): string | null {
  const match = (headers.get("set-cookie") ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match && match[1] ? `${SESSION_COOKIE}=${match[1]}` : null;
}

async function signIn(username: string, password: string) {
  resetRateLimits();
  const res = await call(login, { method: "POST", path: "/api/auth/login", body: { username, password } });
  return { ...res, cookie: sessionFrom(res.headers) };
}

async function change(cookie: string | null, currentPassword: string, newPassword: string) {
  resetRateLimits();
  const res = await call(changePassword, { method: "POST", path: "/api/auth/password", cookie: cookie ?? undefined, body: { currentPassword, newPassword } });
  return { ...res, cookie: sessionFrom(res.headers) };
}

const whoAmI = async (cookie: string) => {
  resetRateLimits();
  return call(me, { path: "/api/auth/me", cookie });
};

/** An account on a server-issued temporary password, and that password. */
async function temporaryAccount(name: string) {
  const u = await makeUser(name, "VIEWER");
  resetRateLimits();
  const res = await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "resetPassword", id: u.user.id } });
  if (res.status !== 200) throw new Error(`reset failed ${res.status}`);
  return { username: name, temporary: res.json.temporaryPassword as string };
}

/** Collects everything the application logs while `work` runs. */
async function captureLogs(work: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const keep = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  Object.assign(console, { log: keep, warn: keep, error: keep });
  try {
    await work();
  } finally {
    Object.assign(console, original);
  }
  return lines.join("\n");
}

beforeAll(async () => {
  root = await makeUser(`pw.root.${Date.now().toString(36)}`, "SUPER_ADMIN");
});

describe("forced password change after a temporary password", () => {
  test("sign-in succeeds but the session is restricted to identity, password change and sign-out", async () => {
    const account = await temporaryAccount("pw.forced.a");
    const session = await signIn(account.username, account.temporary);
    expect([session.status, session.json.user.mustChangePassword, !!session.cookie]).toEqual([200, true, true]);

    const identity = await whoAmI(session.cookie!);
    expect([identity.status, identity.json.user.mustChangePassword]).toEqual([200, true]);
    resetRateLimits();
    expect((await call(dashboard, { path: "/api/dashboard", cookie: session.cookie! })).status).toBe(403);
    resetRateLimits();
    expect((await call(users, { path: "/api/admin/users", cookie: session.cookie! })).status).toBe(403);
  });

  test("the application shows only the Set your password screen, with no way into a page", async () => {
    const account = await temporaryAccount("pw.forced.b");
    const session = await signIn(account.username, account.temporary);
    const user = await sessionUser(session.cookie!);
    const Gate = AuthGate as ComponentType<{ children: ReactNode }>;
    const page = await renderPage(Gate, { children: createElement(OverviewView) }, user, session.cookie!);
    for (const label of ["Set your password", "temporary password", "Temporary password", "New password", "Confirm new password", "At least 12 characters", "Show new password", "Change password", "Sign out"]) {
      expect([label, page.text.includes(label)]).toEqual([label, true]);
    }
    // Nothing of the application behind it is rendered or requested.
    expect(/Overview|Workbook Import|Planning Workbench/.test(page.text)).toBe(false);
    expect(page.requested).toEqual([]);
  });

  test("the form's checks: required current password, length, reuse and confirmation", () => {
    expect(passwordChangeProblems({ current: "", next: NEW_PASSWORD, confirm: NEW_PASSWORD }, "temporary password")).toEqual({ current: "Enter your temporary password." });
    expect(passwordChangeProblems({ current: "old-password-1", next: "short", confirm: "short" })).toEqual({ next: "Use at least 12 characters." });
    expect(passwordChangeProblems({ current: NEW_PASSWORD, next: NEW_PASSWORD, confirm: NEW_PASSWORD })).toEqual({ next: "Choose a password different from the current one." });
    expect(passwordChangeProblems({ current: "old-password-1", next: NEW_PASSWORD, confirm: `${NEW_PASSWORD}x` })).toEqual({ confirm: "The passwords do not match." });
    expect(passwordChangeProblems({ current: "old-password-1", next: NEW_PASSWORD, confirm: NEW_PASSWORD })).toEqual({});
  });

  test("the server refuses a wrong temporary password, a short password and reuse, and the restriction stays", async () => {
    const account = await temporaryAccount("pw.forced.c");
    const session = await signIn(account.username, account.temporary);
    const wrong = await change(session.cookie, "not-the-temporary-password", NEW_PASSWORD);
    expect([wrong.status, wrong.json.error.message]).toEqual([400, "The current password is not correct."]);
    const short = await change(session.cookie, account.temporary, "short");
    expect([short.status, short.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    const reused = await change(session.cookie, account.temporary, account.temporary);
    expect([reused.status, reused.json.error.message]).toEqual([400, "The new password must be different from the current one."]);
    expect((await whoAmI(session.cookie!)).json.user.mustChangePassword).toBe(true);
    expect(await db.auditLog.count({ where: { action: "USER_PASSWORD_CHANGED", actor: account.username } })).toBe(0);
  });

  test("a successful change rotates the session, lifts the restriction and retires the temporary password", async () => {
    const account = await temporaryAccount("pw.forced.d");
    const other = await signIn(account.username, account.temporary); // a second device
    const session = await signIn(account.username, account.temporary);

    let changed: Awaited<ReturnType<typeof change>> | null = null;
    const logs = await captureLogs(async () => {
      changed = await change(session.cookie, account.temporary, NEW_PASSWORD);
    });
    expect([changed!.status, changed!.json]).toEqual([200, { ok: true, mustChangePassword: false }]);
    expect(changed!.cookie && changed!.cookie !== session.cookie).toBe(true);

    // The session that made the change and the other device are both ended; the new one works.
    expect((await whoAmI(session.cookie!)).status).toBe(401);
    expect((await whoAmI(other.cookie!)).status).toBe(401);
    const identity = await whoAmI(changed!.cookie!);
    expect([identity.status, identity.json.user.mustChangePassword]).toEqual([200, false]);
    resetRateLimits();
    expect((await call(dashboard, { path: "/api/dashboard", cookie: changed!.cookie! })).status).toBe(200);

    expect((await signIn(account.username, account.temporary)).status).toBe(401);
    const again = await signIn(account.username, NEW_PASSWORD);
    expect([again.status, again.json.user.mustChangePassword]).toEqual([200, false]);

    // Neither password, nor anything derived from one, reaches a response, a log line or the audit record.
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "USER_PASSWORD_CHANGED", actor: account.username } });
    const stored = JSON.stringify(audit);
    const stateHash = (await db.user.findUniqueOrThrow({ where: { username: account.username } })).passwordHash;
    for (const secret of [account.temporary, NEW_PASSWORD, stateHash, "scrypt$"]) {
      expect([stored.includes(secret), logs.includes(secret), JSON.stringify(changed!.json).includes(secret)]).toEqual([false, false, false]);
    }
    expect([audit.before, audit.after, audit.category]).toEqual([JSON.stringify({ mustChangePassword: true }), JSON.stringify({ mustChangePassword: false }), "SECURITY"]);
  });

  test("signing out from the forced screen ends the restricted session", async () => {
    const account = await temporaryAccount("pw.forced.e");
    const session = await signIn(account.username, account.temporary);
    resetRateLimits();
    const out = await call(logout, { method: "POST", path: "/api/auth/logout", cookie: session.cookie! });
    expect(out.status).toBe(200);
    expect((await whoAmI(session.cookie!)).status).toBe(401);
    expect((await db.user.findUniqueOrThrow({ where: { username: account.username } })).mustChangePassword).toBe(true);
  });
});

describe("voluntary password change", () => {
  test("anonymous callers are refused", async () => {
    expect((await change(null, testPassword(), NEW_PASSWORD)).status).toBe(401);
  });

  test("the current password is required and verified", async () => {
    const u = await makeUser("pw.voluntary.a", "VIEWER");
    const wrong = await change(u.cookie, "not-my-password-at-all", NEW_PASSWORD);
    expect(wrong.status).toBe(400);
    const missing = await change(u.cookie, "", NEW_PASSWORD);
    expect([missing.status, missing.json.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect((await whoAmI(u.cookie)).status).toBe(200);
  });

  test("a change keeps this browser signed in on a new session and signs out every other one", async () => {
    const u = await makeUser("pw.voluntary.b", "VIEWER");
    const other = await signIn("pw.voluntary.b", testPassword());
    const changed = await change(u.cookie, testPassword(), NEW_PASSWORD);
    expect(changed.status).toBe(200);
    expect([(await whoAmI(u.cookie)).status, (await whoAmI(other.cookie!)).status, (await whoAmI(changed.cookie!)).status]).toEqual([401, 401, 200]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "USER_PASSWORD_CHANGED", entityId: u.user.id } });
    expect([audit.actor, JSON.stringify(audit).includes(NEW_PASSWORD), JSON.stringify(audit).includes(testPassword())]).toEqual(["pw.voluntary.b", false, false]);
  });
});
