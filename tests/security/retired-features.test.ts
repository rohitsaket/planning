import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeUser } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { ComponentType } from "react";
import { POST as rolesPost, GET as listRoles } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { GET as auditGet } from "@/app/api/admin/audit/route";
import { GET as notificationsGet, POST as notificationsPost } from "@/app/api/notifications/route";
import { GET as fantasyPolished } from "@/app/api/fantasy/polished/route";
import { GET as fantasySync } from "@/app/api/fantasy/sync/route";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { FANTASY_DATA_TABS } from "@/components/diamond/views/consolidated/fantasy-data-view";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { isPermission, PERMISSIONS, permissionsFor } from "@/lib/auth/permissions";
import { PERMISSION_CATALOG } from "@/lib/auth/permission-catalog";
import { resolveViewAlias, useNavStore, type ViewId } from "@/stores/nav-store";
import { MappingsView, MAPPINGS_TABS } from "@/components/diamond/views/consolidated/mappings-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
import { OutOfScopeView } from "@/components/diamond/shared/out-of-scope";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as loginContext } from "@/app/api/public/login-context/route";
import { BrandingPanel } from "@/components/auth/login/branding-panel";
import { visibleText } from "./ui-render";

const RETIRED_PERMISSIONS = [
  "forecast.run", "forecast.publish", "forecast.methodology.read", "notification.broadcast",
  "feature_flag.read", "feature_flag.manage",
  "fantasy.projection.read", "fantasy.projection.run", "fantasy.projection.recover",
];
const LEGACY_PLANNING_PERMISSIONS = [
  "plan.read", "plan.create", "plan.select", "plan.approve", "plan.replan", "plan.export",
  "rough.reserve", "sarin.output.approve", "approval_policy.read", "approval_policy.manage",
];
const ROUGH_STOCK_PERMISSIONS = ["rough.read"];
const REQUIREMENT_PERMISSIONS = ["requirement.read", "requirement.create", "requirement.override", "requirement.export", "orders.export"];
const ALL_RETIRED = [...RETIRED_PERMISSIONS, ...LEGACY_PLANNING_PERMISSIONS, ...ROUGH_STOCK_PERMISSIONS, ...REQUIREMENT_PERMISSIONS];
const REQUIREMENT_VIEWS = ["requirements-matrix", "requirements-priority-queue", "orders-exceptions", "replenishment-allocation", "requirements-orders", "requirements-replenishment", "requirements-backorders", "requirements-special", "requirements-forecast-signals", "requirements-allocation", "analysis-orders"];
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
  "planning/cases",
  "planning/compare",
  "planning/pieces",
  "planning/workbench",
  "planning/reservations",
  "planning/approvals",
  "planning/rough",
  "fantasy/rough",
  "requirements",
  "analysis/orders",
  "admin/approval-policy",
];
const RETIRED_MODULES = [
  "src/lib/analysis/reorder-signals.ts",
  "src/lib/analysis/business-language.ts",
  "src/lib/fantasy/projection.ts",
  "src/lib/fantasy/projection-provenance.ts",
  "src/lib/fantasy/projection-reconciliation.ts",
  "src/lib/fantasy/projection-recovery.ts",
  "src/lib/fantasy/downstream-source-policy.ts",
  "src/components/diamond/views/feature-flags-view.tsx",
  "src/components/diamond/views/planning-cases-view.tsx",
  "src/components/diamond/views/planning-workbench-view.tsx",
  "src/components/diamond/views/plan-comparison-view.tsx",
  "src/components/diamond/views/planned-pieces-view.tsx",
  "src/components/diamond/views/reservations-view.tsx",
  "src/components/diamond/views/approval-queue-view.tsx",
  "src/components/diamond/views/rough-availability-view.tsx",
  "src/components/diamond/views/fantasy-rough-view.tsx",
  "prisma/seed.ts",
  "src/components/diamond/views/requirements-matrix-view.tsx",
  "src/components/diamond/views/priority-queue-view.tsx",
  "src/components/diamond/views/orders-view.tsx",
  "src/components/diamond/views/consolidated/orders-exceptions-view.tsx",
  "src/components/diamond/views/consolidated/replenishment-allocation-view.tsx",
  "src/stores/saved-views.ts",
  "src/lib/domain/requirement-need.ts",
  "src/components/diamond/views/consolidated/planning-workbench-host-view.tsx",
  "src/components/diamond/views/users-access/approval-policy-section.tsx",
  "src/lib/planning/approval-policy.ts",
  "src/lib/domain/allocation.ts",
  "src/lib/domain/validation-warnings.ts",
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
  "admin-feature-flags",
  "planning-workbench",
  "planning-comparison",
  "planning-cases",
  "planning-planned-pieces",
  "planning-reservations",
  "planning-approval-queue",
  "planning-rough-availability",
];
const RETIRED_FLAGS = ["FF_COLOR_DIMENSION", "FF_CLARITY_DIMENSION", "FF_TREATMENT_DIMENSION", "FF_FORECAST_AUTO_ORDER", "FF_PLANNER_SELF_APPROVE", "FF_TRANSFER_AUTO"];
const WITHDRAW_FEATURES = "prisma/migrations/20261001090000_withdraw_retired_feature_permissions/migration.sql";
const APPROVAL_POLICY = "prisma/migrations/20261002090000_approval_policy_replaces_feature_flags/migration.sql";
const WITHDRAW_PROJECTION = "prisma/migrations/20261002091000_withdraw_shadow_projection_permissions/migration.sql";
const RETIRE_PLANNING = "prisma/migrations/20261003090000_retire_legacy_planning_permissions/migration.sql";
const RESTORE_PLANNING = "prisma/migrations/20261003090000_retire_legacy_planning_permissions/down.sql";
const RETIRE_ROUGH = "prisma/migrations/20261004090000_withdraw_rough_read_permission/migration.sql";
const RESTORE_ROUGH = "prisma/migrations/20261004090000_withdraw_rough_read_permission/down.sql";
const RETIRE_REQUIREMENTS = "prisma/migrations/20261005090000_withdraw_requirement_permissions/migration.sql";
const RESTORE_REQUIREMENTS = "prisma/migrations/20261005090000_withdraw_requirement_permissions/down.sql";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

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

  test("old rough links — Rough Availability, Fantasy Rough, the live Fantasy page — say no rough-stock source is configured, and request nothing", async () => {
    const ROUGH = { view: "out-of-scope", tab: "rough-stock" };
    for (const [id, tab] of [["planning-rough-availability", null], ["fantasy-rough", null], ["fantasy-live", null], ["fantasy-live", "rough"]] as const) {
      expect([id, tab, resolveViewAlias(id as ViewId, tab)]).toEqual([id, tab, ROUGH]);
    }
    expect(resolveViewAlias("fantasy-live" as ViewId, "polished")).toEqual({ view: "fantasy-data", tab: "current" });
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, ROUGH.tab);
    expect([page.text.includes("Not available"), page.text.includes("No authoritative rough-stock source is configured.")]).toEqual([true, true]);
    expect(page.requested).toEqual([]);
  });

  test("old Requirements links — its four pages and every hidden order view — say requirement and order workflows are not configured, and request nothing", async () => {
    const TARGET = { view: "out-of-scope", tab: "requirements" };
    for (const id of REQUIREMENT_VIEWS) expect([id, resolveViewAlias(id as ViewId)]).toEqual([id, TARGET]);
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, TARGET.tab);
    expect([page.text.includes("Not available"), page.text.includes("Requirements and order workflows are not configured for this planning utility.")]).toEqual([true, true]);
    expect(page.requested).toEqual([]);
    for (const id of REQUIREMENT_VIEWS) expect([id, isViewAuthorized(permissionsFor("SUPER_ADMIN") as string[], id)]).toEqual([id, false]);
  });

  test("Fantasy Data offers no rough stock, and synchronization presents no rough mirror as live stock", async () => {
    expect(FANTASY_DATA_TABS.map((t) => [t.id, t.permission])).toEqual([["current", "fantasy.read"], ["integration", "fantasy.read"], ["history", "overall.read"]]);
    resetRateLimits();
    const sync = await call(fantasySync, { cookie: root.cookie, path: "/api/fantasy/sync" });
    expect(sync.status).toBe(200);
    expect(["fantasyRoughCount" in sync.json.reconciliation, (sync.json.summary as Array<{ entity: string }>).map((s) => s.entity).includes("Rough Stock")]).toEqual([false, false]);
    const page = await renderAs(FantasySyncView as ComponentType<object>, root, null);
    expect(/Current Rough|Rough Stock|rough stock/i.test(page.text)).toBe(false);
    expect(page.requested.some((r) => r.startsWith("/api/fantasy/rough"))).toBe(false);
  });

  test("an old Feature Flags link is Not available: the approval policy it last opened is retired", () => {
    expect(resolveViewAlias("admin-feature-flags" as ViewId)).toEqual({ view: "out-of-scope", tab: null });
    expect(MAPPINGS_TABS.map((t) => t.id)).not.toContain("feature-flags");
  });
});

describe("retired permissions cannot be granted or take effect", () => {
  test("the catalogue no longer knows them, and Super Admin does not hold them", () => {
    for (const code of ALL_RETIRED) {
      expect([code, isPermission(code), PERMISSION_CATALOG.some((p) => p.id === code), (permissionsFor("SUPER_ADMIN") as string[]).includes(code)]).toEqual([code, false, false, false]);
    }
    expect(PERMISSION_CATALOG.some((p) => (p.area as string) === "Planning")).toBe(false);
  });

  test("the permissions that stay are unchanged: Sarin work and Fantasy polished and historical data", () => {
    for (const code of ["fantasy.read", "overall.read", "fantasy.export", "orders.read", "sarin.import.read", "sarin.import.upload", "sarin.import.validate", "sarin.issue.review", "sarin.issue.override", "sarin.output.generate", "sarin.output.export", "sarin.mapping.read", "sarin.mapping.manage"]) {
      expect([code, (PERMISSIONS as readonly string[]).includes(code)]).toEqual([code, true]);
    }
  });

  test("creating a role with a retired permission is refused and writes nothing", async () => {
    for (const code of ALL_RETIRED) {
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
    const leftovers = ALL_RETIRED.filter((code) => code !== "approval_policy.read");
    await db.rolePermission.createMany({ data: leftovers.map((permissionCode) => ({ roleId: role.id, permissionCode, reason: "pre-withdrawal grant" })) });
    const u = await makeUser(`retired.leftover.${Date.now().toString(36)}`, "VIEWER");
    resetRateLimits();
    expect((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [roleCode] } })).status).toBe(200);

    const session = await sessionUser(u.cookie);
    expect(session.permissions.includes("analysis.read")).toBe(true);
    for (const code of ALL_RETIRED) expect([code, (session.permissions as string[]).includes(code)]).toEqual([code, false]);

    expect(isViewAuthorized(session.permissions as string[], "fantasy-data")).toBe(false);
    resetRateLimits();
    expect((await call(fantasyPolished, { cookie: u.cookie, path: "/api/fantasy/polished" })).status).toBe(403);

    for (let run = 0; run < 2; run++) for (const file of [WITHDRAW_FEATURES, APPROVAL_POLICY, WITHDRAW_PROJECTION, RETIRE_PLANNING, RETIRE_ROUGH, RETIRE_REQUIREMENTS]) await runMigration(file);
    const left = await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } });
    expect(left.map((p) => p.permissionCode).sort()).toEqual(["analysis.read"]);
  });

  test("the legacy planning withdrawal records each grant, can be rolled back exactly, and reapplied", async () => {
    const roleCode = `RETIRED_PLAN_${Date.now().toString(36).toUpperCase()}`;
    expect((await createRole(roleCode, ["analysis.read", "fantasy.read"])).status).toBe(200);
    const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const assignedAt = new Date("2026-01-15T10:00:00.000Z");
    await db.rolePermission.createMany({ data: ["plan.approve", "rough.reserve"].map((permissionCode) => ({ roleId: role.id, permissionCode, assignedAt, reason: "granted before retirement" })) });
    const original = await db.rolePermission.findMany({ where: { roleId: role.id }, orderBy: { permissionCode: "asc" } });
    const codes = async () => (await db.rolePermission.findMany({ where: { roleId: role.id }, select: { permissionCode: true } })).map((p) => p.permissionCode).sort();
    const withdrawals = () => db.auditLog.count({ where: { action: "ROLE_PERMISSION_WITHDRAWN", entityId: role.id } });

    await runMigration(RETIRE_PLANNING);
    expect(await codes()).toEqual(["analysis.read", "fantasy.read"]);
    expect(await withdrawals()).toBe(2);
    await runMigration(RETIRE_PLANNING);
    expect([await codes(), await withdrawals()]).toEqual([["analysis.read", "fantasy.read"], 2]);

    await runMigration(RESTORE_PLANNING);
    const restored = await db.rolePermission.findMany({ where: { roleId: role.id }, orderBy: { permissionCode: "asc" } });
    expect(restored).toEqual(original);
    await runMigration(RESTORE_PLANNING);
    expect((await codes()).length).toBe(4);

    await runMigration(RETIRE_PLANNING);
    expect([await codes(), await withdrawals()]).toEqual([["analysis.read", "fantasy.read"], 4]);
  });

  test("the requirement and order-export withdrawal records each grant in UTC, keeps orders.read, rolls back exactly and reapplies", async () => {
    const code = `RETIRED_REQ_${Date.now().toString(36).toUpperCase()}`;
    expect((await createRole(code, ["analysis.read", "orders.read"])).status).toBe(200);
    const role = await db.role.findUniqueOrThrow({ where: { code } });
    const assignedAt = new Date("2026-03-01T09:15:00.000Z");
    await db.rolePermission.createMany({ data: REQUIREMENT_PERMISSIONS.map((permissionCode) => ({ roleId: role.id, permissionCode, assignedAt, assignedByUserId: "historical-admin", reason: `granted ${permissionCode}` })) });
    const grants = () => db.rolePermission.findMany({ where: { roleId: role.id }, orderBy: { permissionCode: "asc" } });
    const original = await grants();
    const withdrawn = () => db.auditLog.findMany({ where: { action: "ROLE_PERMISSION_WITHDRAWN", correlationId: "20261005090000_withdraw_requirement_permissions", entityId: role.id } });

    const startedAt = Date.now();
    await runMigration(RETIRE_REQUIREMENTS);
    expect((await grants()).map((g) => g.permissionCode)).toEqual(["analysis.read", "orders.read"]);
    const records = await withdrawn();
    expect(records.map((r) => JSON.parse(r.before!).permissionCode).sort()).toEqual([...REQUIREMENT_PERMISSIONS].sort());
    for (const r of records) expect(Math.abs(r.timestamp.getTime() - startedAt) < 60_000).toBe(true);

    await runMigration(RETIRE_REQUIREMENTS);
    expect([(await grants()).length, (await withdrawn()).length]).toEqual([2, 5]);
    await runMigration(RESTORE_REQUIREMENTS);
    expect(await grants()).toEqual(original);
    await runMigration(RESTORE_REQUIREMENTS);
    expect((await grants()).length).toBe(original.length);
    await runMigration(RETIRE_REQUIREMENTS);
    expect([(await grants()).map((g) => g.permissionCode), (await withdrawn()).length]).toEqual([["analysis.read", "orders.read"], 10]);
  });

  test("the rough.read withdrawal records each grant in UTC, touches no other grant, rolls back exactly and reapplies", async () => {
    const stamp = Date.now().toString(36).toUpperCase();
    const roleCodes = [`RETIRED_ROUGH_A_${stamp}`, `RETIRED_ROUGH_B_${stamp}`];
    const roles: Array<{ id: string }> = [];
    for (const code of roleCodes) {
      expect((await createRole(code, ["analysis.read", "fantasy.read"])).status).toBe(200);
      roles.push(await db.role.findUniqueOrThrow({ where: { code } }));
    }
    const assignedAt = new Date("2026-02-01T08:30:00.000Z");
    await db.rolePermission.createMany({
      data: [
        { roleId: roles[0].id, permissionCode: "rough.read", assignedAt, assignedByUserId: "historical-admin", reason: "rough stock reader" },
        { roleId: roles[1].id, permissionCode: "rough.read", assignedAt, reason: "second reader" },
        { roleId: roles[1].id, permissionCode: "plan.read", assignedAt, reason: "not this migration's concern" },
      ],
    });
    const ids = roles.map((r) => r.id);
    const grants = () => db.rolePermission.findMany({ where: { roleId: { in: ids } }, orderBy: [{ roleId: "asc" }, { permissionCode: "asc" }] });
    const original = await grants();
    const withdrawn = () => db.auditLog.findMany({ where: { action: "ROLE_PERMISSION_WITHDRAWN", correlationId: "20261004090000_withdraw_rough_read_permission", entityId: { in: ids } } });

    const startedAt = Date.now();
    await runMigration(RETIRE_ROUGH);
    const left = (await grants()).map((g) => `${g.roleId === ids[0] ? "A" : "B"}:${g.permissionCode}`).sort();
    expect(left).toEqual(["A:analysis.read", "A:fantasy.read", "B:analysis.read", "B:fantasy.read", "B:plan.read"]);
    const records = await withdrawn();
    expect(records.map((r) => JSON.parse(r.before!).permissionCode)).toEqual(["rough.read", "rough.read"]);
    for (const r of records) expect(Math.abs(r.timestamp.getTime() - startedAt) < 60_000).toBe(true);

    await runMigration(RETIRE_ROUGH);
    expect([(await grants()).length, (await withdrawn()).length]).toEqual([5, 2]);

    await runMigration(RESTORE_ROUGH);
    expect(await grants()).toEqual(original);
    await runMigration(RESTORE_ROUGH);
    expect((await grants()).length).toBe(original.length);

    await runMigration(RETIRE_ROUGH);
    expect([(await grants()).length, (await withdrawn()).length]).toEqual([5, 4]);
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

  test("retired settings rows left in a database are removed; the stored approval policy row is kept as history", async () => {
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

describe("legacy planning notifications are history, not work", () => {
  test("retired plan-approval notifications are kept but never listed or actionable", async () => {
    const stamp = Date.now().toString(36);
    const retired = await Promise.all(["PLAN_APPROVAL_PENDING", "REPLAN_REQUIRED"].map((type) =>
      db.notification.create({ data: { type, title: `Legacy ${type} ${stamp}`, message: "Plan awaiting approval", severity: "INFO", read: false } }),
    ));
    const live = await db.notification.create({ data: { type: "FANTASY_SYNC_FAILURE", title: `Live ${stamp}`, message: "Synchronization failed", severity: "ERROR", read: false } });

    resetRateLimits();
    const listed = (await call(notificationsGet, { cookie: root.cookie, path: "/api/notifications" })).json.rows as Array<{ id: string; type: string }>;
    expect(listed.some((n) => n.id === live.id)).toBe(true);
    expect(listed.filter((n) => n.type === "PLAN_APPROVAL_PENDING" || n.type === "REPLAN_REQUIRED")).toEqual([]);

    for (const n of retired) {
      resetRateLimits();
      const res = await call(notificationsPost, { method: "POST", cookie: root.cookie, body: { id: n.id, read: true } });
      expect([n.type, res.status]).toEqual([n.type, 404]);
      expect((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).read).toBe(false);
    }
    resetRateLimits();
    expect((await call(notificationsPost, { method: "POST", cookie: root.cookie, body: { id: live.id, read: true } })).status).toBe(200);
    expect(await db.notification.count({ where: { id: { in: retired.map((n) => n.id) } } })).toBe(2);
  });

  test("no application source creates a retired notification type", () => {
    const offenders = sourceFiles("src").filter((file) => /type:\s*"(PLAN_APPROVAL_PENDING|REPLAN_REQUIRED)"/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    expect(/PLAN_APPROVAL_PENDING|REPLAN_REQUIRED|planningCase\.create|planOption\.create|planOptionPiece\.create|roughReservation\.create|roughStone\.create/.test(readFileSync("scripts/test-demo-fixture.ts", "utf8"))).toBe(false);
  });
});

describe("legacy planning history stays readable", () => {
  test("plan approval and reservation audit rows are listed and rendered; the planning records remain", async () => {
    const c = await makeCase({ status: "APPROVED" });
    await db.roughReservation.create({ data: { roughId: c.roughId, status: "RELEASED", reservedBy: "historical.planner" } });
    const entries = await Promise.all([
      ["PLAN_APPROVED", "PlanningCase", "Approved option 1 for the historical case"],
      ["PLAN_REPLAN_REQUESTED", "PlanningCase", "Replanning requested on the historical case"],
      ["RESERVATION_CREATED", "RoughReservation", "Soft reservation for the historical case"],
    ].map(([action, entity, reason]) => db.auditLog.create({ data: { actor: "historical.planner", action, entity, entityId: c.caseId, reason } })));

    for (const e of entries) {
      resetRateLimits();
      const res = await call(auditGet, { cookie: root.cookie, path: `/api/admin/audit?action=${e.action}` });
      expect([e.action, res.status, (res.json.rows as Array<{ id: string; reason: string }>).find((r) => r.id === e.id)?.reason]).toEqual([e.action, 200, e.reason]);
    }
    const roughEntry = await db.auditLog.create({ data: { actor: "historical.planner", action: "ROUGH_STATUS_CHANGED", entity: "RoughStone", entityId: c.roughId, reason: "Historical rough stone status change" } });
    resetRateLimits();
    const roughRes = await call(auditGet, { cookie: root.cookie, path: "/api/admin/audit?entity=RoughStone" });
    expect([roughRes.status, (roughRes.json.rows as Array<{ id: string }>).some((r) => r.id === roughEntry.id)]).toEqual([200, true]);
    const page = await renderAs(AuditLogView as ComponentType<object>, root, null);
    expect([page.text.includes("Soft reservation for the historical case"), page.text.includes("Historical rough stone status change"), page.text.includes("Rough Inventory")]).toEqual([true, true, true]);

    expect([await db.planningCase.count({ where: { id: c.caseId } }), await db.planOption.count({ where: { id: { in: c.optionIds } } }), await db.roughReservation.count({ where: { roughId: c.roughId } }), await db.roughStone.count({ where: { id: c.roughId } })]).toEqual([1, 2, 1, 1]);
  });
});

describe("Requirements history stays in place and readable", () => {
  test("requirement, allocation, order, line and customer rows survive the permission withdrawal; a past priority override still lists and renders", async () => {
    const stamp = Date.now().toString(36).toUpperCase();
    const requirement = await db.requirement.create({ data: { requirementCode: `REQ-HIST-${stamp}`, type: "CUSTOMER_ORDER", groupCode: "G", companyCode: "C", country: "IN", branch: "SRT", requiredQty: 3, requirementPriority: "HIGH" } });
    const customer = await db.customer.create({ data: { customerCode: `CUST-HIST-${stamp}`, name: "Historical Customer", country: "IN", branch: "SRT" } });
    const order = await db.salesOrder.create({ data: { orderNumber: `SO-HIST-${stamp}`, customerId: customer.id, country: "IN", branch: "SRT", orderDate: new Date() } });
    await db.salesOrderLine.create({ data: { orderId: order.id, lineNo: 1, shape: "ROUND", qtyOrdered: 2 } });
    const counts = async () => [await db.requirement.count(), await db.requirementAllocation.count(), await db.salesOrder.count(), await db.salesOrderLine.count(), await db.customer.count()];
    const before = await counts();
    await runMigration(RETIRE_REQUIREMENTS);
    expect(await counts()).toEqual(before);

    const override = await db.auditLog.create({ data: { actor: "historical.manager", action: "REQUIREMENT_PRIORITY_OVERRIDE", entity: "Requirement", entityId: requirement.id, reason: "Historical priority override", before: JSON.stringify({ priority: "NORMAL" }), after: JSON.stringify({ priority: "HIGH" }) } });
    resetRateLimits();
    const res = await call(auditGet, { cookie: root.cookie, path: "/api/admin/audit?entity=Requirement" });
    expect([res.status, (res.json.rows as Array<{ id: string }>).some((r) => r.id === override.id)]).toEqual([200, true]);
    const page = await renderAs(AuditLogView as ComponentType<object>, root, null);
    expect([page.text.includes("Historical priority override"), page.text.includes("Requirements")]).toEqual([true, true]);
  });
});

describe("the public sign-in page advertises only what exists", () => {
  test("the anonymous login context and the rendered branding panel list Analysis and Planning, and no Traceability or Requirements", async () => {
    resetRateLimits();
    const res = await call(loginContext, { path: "/api/public/login-context" });
    expect([res.status, res.json.modules]).toEqual([200, ["Analysis", "Planning"]]);
    const html = renderToStaticMarkup(createElement(BrandingPanel, {
      brand: res.json.branding,
      modules: res.json.modules,
      motivation: { title: "Daily motivation", quote: "Measure twice, cut once." },
      version: res.json.version,
    }));
    const text = visibleText(html);
    expect([text.includes("Analysis"), text.includes("Planning")]).toEqual([true, true]);
    expect(/traceab|requirement/i.test(text)).toBe(false);
  });

  test("the page metadata and branding source name no retired module (static)", () => {
    for (const file of ["src/app/layout.tsx", "src/lib/branding.ts", "src/components/auth/login/branding-panel.tsx"]) {
      expect([file, /Traceab|traceab|Requirement|requirement engine|rough planning/.test(readFileSync(file, "utf8"))]).toEqual([file, false]);
    }
  });
});
