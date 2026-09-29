// Plan approval policy: whether the planner of a case may approve it. Enforced by the approval
// route on the server; viewed and changed from Users & Access → Permissions with separate
// permissions. Real route handlers, real sessions, isolated planning_sectest database.

import type { ComponentType } from "react";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeUser } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as policyGet, POST as policyPost } from "@/app/api/admin/approval-policy/route";
import { POST as approvals } from "@/app/api/planning/approvals/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { SEPARATE_APPROVER_POLICY_CODE } from "@/lib/planning/approval-policy";
import { useNavStore } from "@/stores/nav-store";
import { UsersAccessView } from "@/components/diamond/views/consolidated/users-access-view";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
let approver: User;

async function userWith(name: string, permissions: string[]): Promise<User> {
  const u = await makeUser(name, "VIEWER");
  const code = `POLICY_${name.toUpperCase().replace(/[^A-Z]/g, "_")}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: code, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

async function setPolicy(cookie: string, requireSeparateApprover: boolean, reason = "policy test change") {
  resetRateLimits();
  return call(policyPost, { method: "POST", path: "/api/admin/approval-policy", cookie, body: { requireSeparateApprover, reason } });
}

async function readPolicy(cookie?: string) {
  resetRateLimits();
  return call(policyGet, { path: "/api/admin/approval-policy", cookie });
}

async function approveOwn() {
  const c = await makeCase({ planner: "Policy Approver" }); // the approver's own display name
  resetRateLimits();
  return call(approvals, { method: "POST", cookie: approver.cookie, body: { caseId: c.caseId, action: "approve" } });
}

async function renderPermissions(u: User) {
  const nav = useNavStore.getInitialState();
  const saved = nav.tab;
  nav.tab = "permissions";
  try {
    return await renderPage(UsersAccessView as ComponentType<object>, {}, await sessionUser(u.cookie), u.cookie);
  } finally {
    nav.tab = saved;
  }
}

beforeAll(async () => {
  await db.featureFlag.deleteMany({ where: { code: SEPARATE_APPROVER_POLICY_CODE } });
  root = await makeUser(`policy.root.${Date.now().toString(36)}`, "SUPER_ADMIN");
  approver = await makeUser(`policy.approver.${Date.now().toString(36)}`, "PLANNING_MANAGER", "Policy Approver");
});

describe("separation of duties is enforced on the server", () => {
  test("with no stored policy a planner cannot approve their own plan", async () => {
    expect((await readPolicy(root.cookie)).json).toEqual({ requireSeparateApprover: true, changedAt: null });
    const r = await approveOwn();
    expect([r.status, r.json.error.message]).toEqual([403, "Separation of duties: the planner of a case cannot approve or reject it."]);
  });

  test("switching the policy off allows it; switching it on refuses it again", async () => {
    expect((await setPolicy(root.cookie, false, "single-person pilot site")).status).toBe(200);
    expect((await approveOwn()).status).toBe(200);
    expect((await setPolicy(root.cookie, true, "pilot finished")).status).toBe(200);
    expect((await approveOwn()).status).toBe(403);
    const audits = await db.auditLog.findMany({ where: { action: "APPROVAL_POLICY_CHANGED" }, orderBy: { timestamp: "asc" }, select: { actor: true, entity: true, before: true, after: true, reason: true, category: true } });
    expect(audits.slice(-2)).toEqual([
      { actor: root.user.username, entity: "ApprovalPolicy", before: '{"requireSeparateApprover":true}', after: '{"requireSeparateApprover":false}', reason: "single-person pilot site", category: "SECURITY" },
      { actor: root.user.username, entity: "ApprovalPolicy", before: '{"requireSeparateApprover":false}', after: '{"requireSeparateApprover":true}', reason: "pilot finished", category: "SECURITY" },
    ]);
  });
});

describe("viewing and changing the policy follow RBAC", () => {
  test("anonymous, unrelated and plan-approving users cannot read or change it", async () => {
    expect((await readPolicy()).status).toBe(401);
    const unrelated = await userWith("unrelated", ["analysis.read"]);
    expect([(await readPolicy(unrelated.cookie)).status, (await setPolicy(unrelated.cookie, false)).status]).toEqual([403, 403]);
    // Approving plans does not include deciding who may approve them.
    expect([(await readPolicy(approver.cookie)).status, (await setPolicy(approver.cookie, false)).status]).toEqual([403, 403]);
  });

  test("a reader sees the state but cannot change it; a manager can, only with a reason", async () => {
    const reader = await userWith("reader", ["approval_policy.read"]);
    expect([(await readPolicy(reader.cookie)).status, (await setPolicy(reader.cookie, false)).status]).toEqual([200, 403]);
    const manager = await userWith("manager", ["approval_policy.read", "approval_policy.manage"]);
    resetRateLimits();
    const noReason = await call(policyPost, { method: "POST", path: "/api/admin/approval-policy", cookie: manager.cookie, body: { requireSeparateApprover: false } });
    expect(noReason.status).toBe(400);
    expect((await readPolicy(root.cookie)).json.requireSeparateApprover).toBe(true);
    expect((await setPolicy(manager.cookie, true, "reconfirmed by manager")).status).toBe(200);
  });

  test("Users & Access → Permissions shows the policy in business wording, with the control only for managers", async () => {
    const reader = await userWith("pagereader", ["approval_policy.read"]);
    const readerPage = await renderPermissions(reader);
    for (const text of ["Approval Policy", "Require a different user to approve a plan", "Separation of duties", "On — a separate approver is required"]) {
      expect([text, readerPage.text.includes(text)]).toEqual([text, true]);
    }
    // No role editor for a policy-only reader, no change control, and no roles request.
    expect([readerPage.text.includes("Turn off"), readerPage.requested.some((r) => r.startsWith("/api/admin/roles"))]).toEqual([false, false]);
    expect(/feature flag|FF_|SOD_PLANNER/i.test(readerPage.text)).toBe(false);

    const managerPage = await renderPermissions(root);
    expect([managerPage.text.includes("Turn off"), managerPage.text.includes("Roles")]).toEqual([true, true]);

    const unrelated = await userWith("pageunrelated", ["role.read"]);
    const rolesOnly = await renderPermissions(unrelated);
    expect([rolesOnly.text.includes("Approval Policy"), rolesOnly.requested.some((r) => r.startsWith("/api/admin/approval-policy"))]).toEqual([false, false]);
  });
});
