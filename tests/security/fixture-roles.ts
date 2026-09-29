// Test-only access profiles. Super Admin is the application's only built-in role; every
// narrower profile is a custom role. The security suites need least-privilege principals
// to prove denials, so these fixtures recreate, as custom roles (Role rows with
// isSystem = false and explicit RolePermission rows), the profiles the retired system roles
// used to carry. They exist only in the isolated test database.

import { db } from "@/lib/db";
import { permissionsFor, ROLES, type Permission } from "@/lib/auth/permissions";

const BASE: Permission[] = ["notification.read"];
const NOTIFICATION_TRIAGE: Permission[] = ["notification.manage"];
const PLANNING_READ: Permission[] = ["analysis.read", "requirement.read", "plan.read", "rough.read", "fantasy.read", "overall.read", "data_quality.read", "config.read"];
const COMMERCIAL_READ: Permission[] = ["sales.read", "customers.read", "orders.read"];
const SARIN_READ: Permission[] = ["sarin.import.read"];
const SARIN_PLANNING: Permission[] = [...SARIN_READ, "sarin.import.upload", "sarin.import.validate", "sarin.issue.review", "sarin.output.generate", "sarin.output.export"];
const ADMIN_WITHHELD = new Set<Permission>([
  "approval_policy.manage", "plan.approve", "role.manage", "role.permissions.assign", "user.super_admin.assign", "user.scope.assign",
  "fantasy.sync.run", "fantasy.sync.retry", "fantasy.sync.unlock", "demand.run", "sarin.import.upload", "sarin.import.validate", "sarin.issue.review", "sarin.issue.override", "sarin.output.generate", "sarin.output.export", "sarin.mapping.read", "sarin.mapping.manage",
]);

export const FIXTURE_ROLE_PERMISSIONS = {
  ADMIN: permissionsFor("SUPER_ADMIN").filter((p) => !ADMIN_WITHHELD.has(p)),
  ANALYSIS_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, ...COMMERCIAL_READ, "requirement.create", "requirement.override", "demand.run", "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "requirement.export", "fantasy.export", "data_quality.export", "audit.read"],
  DATA_ANALYST: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "data_quality.read", "data_quality.export", "audit.read"],
  DATA_SCIENTIST: [...BASE, ...PLANNING_READ, "sales.read", "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "data_quality.read", "audit.read"],
  PLANNING_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, ...SARIN_PLANNING, "orders.read", "demand.trace", "plan.create", "plan.select", "plan.approve", "plan.replan", "rough.reserve", "overall.export", "analysis.export", "plan.export", "requirement.export", "audit.read", "sarin.issue.override", "sarin.output.approve"],
  PLANNER: [...BASE, ...PLANNING_READ, ...SARIN_PLANNING, "orders.read", "plan.create", "plan.select", "plan.replan", "rough.reserve", "plan.export"],
  PLANNING_VIEWER: [...BASE, ...PLANNING_READ, ...SARIN_READ],
  MFG_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, ...SARIN_READ, "analysis.export", "audit.read"],
  MFG_VIEWER: [...BASE, "analysis.read", "plan.read", "rough.read", "fantasy.read", "overall.read"],
  SALES_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, "analysis.read", "requirement.read", ...COMMERCIAL_READ, "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "audit.read"],
  SALES_VIEWER: [...BASE, "analysis.read", ...COMMERCIAL_READ],
  FANTASY_INTEGRATION: ["fantasy.read", "fantasy.sync.run", "fantasy.sync.retry", "overall.read", "data_quality.read"],
  AUDITOR: [...BASE, ...SARIN_READ, "audit.read", "audit.export", "overall.read", "data_quality.read", "approval_policy.read", "config.read", "config.export"],
  VIEWER: [...BASE, "analysis.read", "requirement.read", "plan.read", "rough.read", "overall.read"],
} as const satisfies Record<string, readonly Permission[]>;

export type FixtureRole = keyof typeof FIXTURE_ROLE_PERMISSIONS;
/** Super Admin (built in) or one of the fixture custom roles. */
export type TestRole = (typeof ROLES)[number] | FixtureRole;
export const FIXTURE_ROLES = Object.keys(FIXTURE_ROLE_PERMISSIONS) as FixtureRole[];
export const TEST_ROLES: readonly TestRole[] = [...ROLES, ...FIXTURE_ROLES];

/** What a test user holding this role may do: Super Admin from the application, a fixture from its definition. */
export function testPermissionsFor(role: string): Permission[] {
  if (role in FIXTURE_ROLE_PERMISSIONS) return [...FIXTURE_ROLE_PERMISSIONS[role as FixtureRole]];
  return permissionsFor(role);
}
export const testHasPermission = (role: string, permission: Permission) => testPermissionsFor(role).includes(permission);

const synced = new Set<string>();
/**
 * The fixture's custom role in the test database, active and holding exactly its
 * permissions. Synchronized once per process; returns its id.
 */
export async function ensureFixtureRole(role: FixtureRole): Promise<string> {
  const want = FIXTURE_ROLE_PERMISSIONS[role] as readonly Permission[];
  const row = await db.role.upsert({
    where: { code: role },
    update: synced.has(role) ? {} : { status: "ACTIVE", isSystem: false },
    create: { code: role, name: `${role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase())} (test)`, description: "Test fixture custom role", isSystem: false, status: "ACTIVE" },
    select: { id: true },
  });
  if (!synced.has(role)) {
    await db.rolePermission.deleteMany({ where: { roleId: row.id, permissionCode: { notIn: [...want] } } });
    await db.rolePermission.createMany({ data: want.map((permissionCode) => ({ roleId: row.id, permissionCode })), skipDuplicates: true });
    synced.add(role);
  }
  return row.id;
}
