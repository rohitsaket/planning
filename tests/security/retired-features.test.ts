// Retired features stay retired: stock strategy, reorder signals, transfer analysis, forecasting
// and predictive models, the reports library, realtime broadcasts, the generic settings page
// with its feature flags, the shadow projection of raw Fantasy batches, and the pages that
// fronted them. Their routes and modules do not exist, no page requests them, their permissions
// cannot be granted or take effect, and the history that mentions them is still readable.
// Pages are rendered from their real components and every request is answered by the real
// route handler in the isolated planning_sectest database.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { ComponentType } from "react";
import { POST as rolesPost, GET as listRoles } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { GET as auditGet } from "@/app/api/admin/audit/route";
import { isPermission } from "@/lib/auth/permissions";
import { resolveViewAlias, useNavStore, type ViewId } from "@/stores/nav-store";
import { MappingsView, MAPPINGS_TABS } from "@/components/diamond/views/consolidated/mappings-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
import { OutOfScopeView } from "@/components/diamond/shared/out-of-scope";

const RETIRED_PERMISSIONS = [
  "forecast.run", "forecast.publish", "forecast.methodology.read", "notification.broadcast",
  "feature_flag.read", "feature_flag.manage",
  "fantasy.projection.read", "fantasy.projection.run", "fantasy.projection.recover",
];
const RETIRED_API_DIRS = [
  "analysis/reorder-signals",
  "analysis/transfer-candidates",
  "analysis/anomalies",
  "analysis/yield-prediction",
  "analysis/wip",
  "forecast",
  "reports",
  "audit/recent",
  "notifications/broadcast",
  "traceability",
  "fantasy/departments",
  "fantasy/locations",
  "admin/feature-flags",
  "fantasy/projection",
];
// Modules that served only a retired feature.
const RETIRED_MODULES = [
  "src/lib/analysis/reorder-signals.ts",
  "src/lib/analysis/business-language.ts",
  "src/lib/fantasy/projection.ts",
  "src/lib/fantasy/projection-provenance.ts",
  "src/lib/fantasy/projection-reconciliation.ts",
  "src/lib/fantasy/projection-recovery.ts",
  "src/lib/fantasy/downstream-source-policy.ts",
  "src/components/diamond/views/feature-flags-view.tsx",
];
const RETIRED_VIEWS = [
  "stock-strategy",
  "analysis-reorder-signals",
  "transfer-analyzer",
  "data-science-forecasting",
  "data-science-predictive-models",
  "data-science-prediction-monitoring",
  "data-science-anomaly-detection",
  "data-science-yield-prediction",
  "data-science-forecast",
  "data-science-models",
  "data-science-forecast-accuracy",
  "analysis-forecast",
  "reports",
  "admin-system-settings",
];
const RETIRED_FLAGS = ["FF_COLOR_DIMENSION", "FF_CLARITY_DIMENSION", "FF_TREATMENT_DIMENSION", "FF_FORECAST_AUTO_ORDER", "FF_PLANNER_SELF_APPROVE", "FF_TRANSFER_AUTO"];
const WITHDRAW_FEATURES = "prisma/migrations/20261001090000_withdraw_retired_feature_permissions/migration.sql";
const APPROVAL_POLICY = "prisma/migrations/20261002090000_approval_policy_replaces_feature_flags/migration.sql";
const WITHDRAW_PROJECTION = "prisma/migrations/20261002091000_withdraw_shadow_projection_permissions/migration.sql";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Runs a migration's statements, as `migrate deploy` would. */
async function runMigration(file: string) {
  const sql = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
  for (const statement of sql.split(";").filter((s) => s.trim())) await db.$executeRawUnsafe(statement);
}

async function createRole(code: string, permissions: string[]) {
  resetRateLimits();
  return call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: code, permissions } });
}

async function renderAs(view: ComponentType<object>, u: User, tab: string | null) {
  const nav = useNavStore.getInitialState();
  const saved = nav.tab;
  nav.tab = tab;
  try {
    return await renderPage(view, {}, await sessionUser(u.cookie), u.cookie);
  } finally {
    nav.tab = saved;
  }
}

beforeAll(async () => {
  root = await makeUser(`retired.root.${Date.now().toString(36)}`, "SUPER_ADMIN");
});

describe("retired routes and pages are gone", () => {
  test("no route or module exists for a retired feature", () => {
    for (const dir of RETIRED_API_DIRS) expect([dir, existsSync(join("src/app/api", dir))]).toEqual([dir, false]);
    for (const file of RETIRED_MODULES) expect([file, existsSync(file)]).toEqual([file, false]);
  });

  test("no application source requests a retired API or opens a realtime socket", () => {
    const offenders: string[] = [];
    const retired = new RegExp(`/api/(${RETIRED_API_DIRS.map((d) => d.replace("/", "\\/")).join("|")})(?![\\w-])`);
    for (const file of sourceFiles("src")) {
      const text = readFileSync(file, "utf8");
      if (retired.test(text) || /socket\.io/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  test("no application source names a retired setting, production-order automation or automatic transfer", () => {
    const offenders = sourceFiles("src").filter((file) => /FF_[A-Z_]+|AUTO_ORDER|TRANSFER_AUTO|feature_flag\.|fantasy\.projection\./.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("a link to a retired page, including System Settings, resolves to Not available, which requests no data", async () => {
    for (const id of RETIRED_VIEWS) expect([id, resolveViewAlias(id as ViewId).view]).toEqual([id, "out-of-scope"]);
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, null);
    expect(page.text).toContain("Not available");
    expect(page.requested).toEqual([]);
  });

  test("an old Feature Flags link opens the Approval Policy on Users & Access → Permissions", () => {
    expect(resolveViewAlias("admin-feature-flags" as ViewId)).toEqual({ view: "admin-users-access", tab: "permissions" });
    expect(MAPPINGS_TABS.map((t) => t.id)).not.toContain("feature-flags");
  });
});

describe("retired permissions cannot be granted or take effect", () => {
  test("the catalogue no longer knows them", () => {
    for (const code of RETIRED_PERMISSIONS) expect([code, isPermission(code)]).toEqual([code, false]);
  });

  test("creating a role with a retired permission is refused and writes nothing", async () => {
    for (const code of RETIRED_PERMISSIONS) {
      const roleCode = `RETIRED_${code.replace(/\W/g, "_").toUpperCase()}`;
      const res = await createRole(roleCode, ["analysis.read", code]);
      expect([code, res.status]).toEqual([code, 400]);
      expect(await db.role.count({ where: { code: roleCode } })).toBe(0);
    }
  });

  test("a grant left over from before the withdrawal gives no access, and the migrations remove it", async () => {
    const roleCode = `RETIRED_LEFTOVER_${Date.now().toString(36).toUpperCase()}`;
    const res = await createRole(roleCode, ["analysis.read"]);
    expect(res.status).toBe(200);
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    await db.rolePermission.createMany({ data: RETIRED_PERMISSIONS.map((permissionCode) => ({ roleId: role.id, permissionCode, reason: "pre-withdrawal grant" })) });
    const u = await makeUser(`retired.leftover.${Date.now().toString(36)}`, "VIEWER");
    resetRateLimits();
    expect((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [roleCode] } })).status).toBe(200);

    const session = await sessionUser(u.cookie);
    expect(session.permissions.includes("analysis.read")).toBe(true);
    for (const code of RETIRED_PERMISSIONS) expect([code, (session.permissions as string[]).includes(code)]).toEqual([code, false]);

    // Running the withdrawals twice is safe: they touch only the retired grants. Viewing the
    // old settings carries over as viewing the approval policy; nothing else survives.
    for (let run = 0; run < 2; run++) for (const file of [WITHDRAW_FEATURES, APPROVAL_POLICY, WITHDRAW_PROJECTION]) await runMigration(file);
    const left = await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } });
    expect(left.map((p) => p.permissionCode).sort()).toEqual(["analysis.read", "approval_policy.read"]);
  });
});

describe("retired settings", () => {
  test("changing the old settings does not become changing the approval policy", async () => {
    const roleCode = `RETIRED_SETTINGS_${Date.now().toString(36).toUpperCase()}`;
    const res = await createRole(roleCode, ["analysis.read"]);
    expect(res.status).toBe(200);
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionCode: "feature_flag.manage" } });
    await runMigration(APPROVAL_POLICY);
    const codes = (await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } })).map((p) => p.permissionCode);
    expect(codes).toEqual(["analysis.read"]);
  });

  test("retired settings rows left in a database are removed, and the approval policy row is kept", async () => {
    await db.featureFlag.createMany({ data: RETIRED_FLAGS.map((code) => ({ code, name: code, enabled: true })), skipDuplicates: true });
    const policy = await db.featureFlag.upsert({ where: { code: "SOD_PLANNER_APPROVER" }, create: { code: "SOD_PLANNER_APPROVER", name: "Require separate approver", enabled: true }, update: {} });
    await runMigration(APPROVAL_POLICY);
    const left = (await db.featureFlag.findMany({ select: { code: true } })).map((f) => f.code);
    expect(left.filter((c) => RETIRED_FLAGS.includes(c))).toEqual([]);
    expect(left).toContain("SOD_PLANNER_APPROVER");
    await db.featureFlag.delete({ where: { id: policy.id } });
  });

  test("Mappings offers no settings or planning-dimension controls, even from an old link", async () => {
    const page = await renderAs(MappingsView as ComponentType<object>, root, "feature-flags");
    expect(/Feature Flags|Planning Dimensions|Color categorization|Treatment categorization/.test(page.text)).toBe(false);
    expect(page.requested.some((r) => r.startsWith("/api/admin/feature-flags"))).toBe(false);
  });

  test("Super Admin is still not an assignable role", async () => {
    resetRateLimits();
    const roles = (await call(listRoles, { cookie: root.cookie, path: "/api/admin/roles" })).json.roles as Array<{ code: string }>;
    expect(roles.some((r) => r.code === "SUPER_ADMIN")).toBe(false);
  });
});

describe("history that mentions retired features is kept", () => {
  test("audit rows about retired permissions and settings are still listed and rendered", async () => {
    const permissionEntry = await db.auditLog.create({
      data: {
        actor: "historical.admin",
        action: "ROLE_PERMISSIONS_CHANGED",
        entity: "Role",
        entityId: "historical-role",
        before: JSON.stringify({ permissions: ["analysis.read"] }),
        after: JSON.stringify({ permissions: ["analysis.read", "forecast.run", "notification.broadcast"] }),
        reason: "Granted forecast.run for the retired forecasting page",
      },
    });
    const flagEntry = await db.auditLog.create({
      data: {
        actor: "historical.admin",
        action: "FEATURE_FLAG_TOGGLE",
        entity: "FeatureFlag",
        entityId: "historical-flag",
        before: JSON.stringify({ code: "FF_TRANSFER_AUTO", enabled: false }),
        after: JSON.stringify({ code: "FF_TRANSFER_AUTO", enabled: true }),
        reason: "Flag set to true",
      },
    });
    resetRateLimits();
    const res = await call(auditGet, { cookie: root.cookie, path: "/api/admin/audit?action=ROLE_PERMISSIONS_CHANGED" });
    expect(res.status).toBe(200);
    const row = (res.json.rows as Array<{ id: string; reason: string }>).find((r) => r.id === permissionEntry.id);
    expect(row?.reason).toBe("Granted forecast.run for the retired forecasting page");
    resetRateLimits();
    const flags = await call(auditGet, { cookie: root.cookie, path: "/api/admin/audit?entity=FeatureFlag" });
    expect([flags.status, (flags.json.rows as Array<{ id: string }>).some((r) => r.id === flagEntry.id)]).toEqual([200, true]);

    const page = await renderAs(AuditLogView as ComponentType<object>, root, null);
    expect(page.text).toContain("Granted forecast.run for the retired forecasting page");
  });
});
