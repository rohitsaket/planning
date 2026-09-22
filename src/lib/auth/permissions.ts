// Single source of truth for roles and permissions.
// Enforced on the server by withApi(); the Users & RBAC view only displays it.

// Export permissions are deliberately granular per domain: exporting a dataset is a
// separate decision from reading it on screen, and demand.export must never be used
// as a generic application-wide export permission.
export const PERMISSIONS = [
  "analysis.read",
  "analysis.export",
  "sales.read",
  "sales.export",
  "customers.read",
  "customers.export",
  "orders.read",
  "orders.export",
  "requirement.read",
  "requirement.create",
  "requirement.override",
  "requirement.export",
  "plan.read",
  "plan.create",
  "plan.select",
  "plan.approve",
  "plan.replan",
  "plan.export",
  "rough.read",
  "rough.reserve",
  "demand.run",
  "demand.unlock",
  "demand.trace",
  "demand.export",
  "forecast.run",
  "forecast.publish",
  "fantasy.read",
  "fantasy.sync",
  "fantasy.export",
  "overall.read",
  "overall.export",
  "data_quality.read",
  "data_quality.manage",
  "data_quality.export",
  "config.read",
  "config.export",
  "business_rule.read",
  "business_rule.manage",
  "feature_flag.read",
  "feature_flag.manage",
  "notification.read",
  "notification.broadcast",
  "audit.read",
  "audit.export",
  "user.manage",
] as const;

/** Every permission that authorizes an export. Used by tests and the admin matrix. */
export const EXPORT_PERMISSIONS = [
  "analysis.export",
  "sales.export",
  "customers.export",
  "orders.export",
  "requirement.export",
  "plan.export",
  "demand.export",
  "fantasy.export",
  "overall.export",
  "data_quality.export",
  "config.export",
  "audit.export",
] as const satisfies readonly (typeof PERMISSIONS)[number][];

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "ANALYSIS_MANAGER",
  "DATA_ANALYST",
  "DATA_SCIENTIST",
  "PLANNING_MANAGER",
  "PLANNER",
  "PLANNING_VIEWER",
  "MFG_MANAGER",
  "MFG_VIEWER",
  "SALES_MANAGER",
  "SALES_VIEWER",
  "FANTASY_INTEGRATION",
  "AUDITOR",
  "VIEWER",
] as const;

export type Role = (typeof ROLES)[number];

const ALL = [...PERMISSIONS] as Permission[];
const BASE: Permission[] = ["notification.read"];
const PLANNING_READ: Permission[] = ["analysis.read", "requirement.read", "plan.read", "rough.read", "fantasy.read", "overall.read", "data_quality.read", "config.read"];
const COMMERCIAL_READ: Permission[] = ["sales.read", "customers.read", "orders.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  // ADMIN has administrative and operational powers (including demand.run, demand.unlock, demand.trace, demand.export)
  // but must NOT automatically receive planning approval (plan.approve), rule management (business_rule.manage),
  // or feature flag management (feature_flag.manage).
  ADMIN: ALL.filter((p) => p !== "business_rule.manage" && p !== "feature_flag.manage" && p !== "plan.approve"),
  ANALYSIS_MANAGER: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "requirement.create", "requirement.override", "demand.run", "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "requirement.export", "fantasy.export", "data_quality.manage", "data_quality.export", "business_rule.read", "audit.read"],
  DATA_ANALYST: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "data_quality.read", "data_quality.export", "audit.read"],
  DATA_SCIENTIST: [...BASE, ...PLANNING_READ, "sales.read", "demand.trace", "demand.export", "forecast.run", "forecast.publish", "overall.export", "analysis.export", "sales.export", "data_quality.read", "audit.read"],
  // Explicitly authorized planning approval authority
  PLANNING_MANAGER: [...BASE, ...PLANNING_READ, "orders.read", "demand.trace", "plan.create", "plan.select", "plan.approve", "plan.replan", "rough.reserve", "overall.export", "analysis.export", "plan.export", "requirement.export", "business_rule.read", "audit.read"],
  PLANNER: [...BASE, ...PLANNING_READ, "orders.read", "plan.create", "plan.select", "plan.replan", "rough.reserve", "plan.export"],
  PLANNING_VIEWER: [...BASE, ...PLANNING_READ],
  MFG_MANAGER: [...BASE, ...PLANNING_READ, "analysis.export", "audit.read"],
  MFG_VIEWER: [...BASE, "analysis.read", "plan.read", "rough.read", "fantasy.read", "overall.read"],
  SALES_MANAGER: [...BASE, "analysis.read", "requirement.read", ...COMMERCIAL_READ, "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "audit.read"],
  SALES_VIEWER: [...BASE, "analysis.read", ...COMMERCIAL_READ],
  // Fantasy Integration role: sync & data access only; no exports, notification broadcast or planning approval
  FANTASY_INTEGRATION: ["fantasy.read", "fantasy.sync", "overall.read", "data_quality.read"],
  AUDITOR: [...BASE, "audit.read", "audit.export", "overall.read", "data_quality.read", "business_rule.read", "feature_flag.read", "config.read", "config.export"],
  VIEWER: [...BASE, "analysis.read", "requirement.read", "plan.read", "rough.read", "overall.read"],
};

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

// Unknown role → no permissions (deny by default).
export function permissionsFor(role: string): Permission[] {
  return isRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
