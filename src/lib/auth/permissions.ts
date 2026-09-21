// Single source of truth for roles and permissions.
// Enforced on the server by withApi(); the Users & RBAC view only displays it.

export const PERMISSIONS = [
  "analysis.read",
  "sales.read",
  "customers.read",
  "orders.read",
  "requirement.read",
  "requirement.create",
  "requirement.override",
  "plan.read",
  "plan.create",
  "plan.select",
  "plan.approve",
  "plan.replan",
  "rough.read",
  "rough.reserve",
  "demand.run",
  "forecast.run",
  "forecast.publish",
  "fantasy.read",
  "fantasy.sync",
  "overall.read",
  "overall.export",
  "config.read",
  "business_rule.read",
  "business_rule.manage",
  "feature_flag.read",
  "feature_flag.manage",
  "notification.read",
  "notification.broadcast",
  "audit.read",
  "user.manage",
] as const;

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
const PLANNING_READ: Permission[] = ["analysis.read", "requirement.read", "plan.read", "rough.read", "fantasy.read", "overall.read", "config.read"];
const COMMERCIAL_READ: Permission[] = ["sales.read", "customers.read", "orders.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  // Rule and flag changes stay Super Admin only (existing convention in the RBAC view).
  ADMIN: ALL.filter((p) => p !== "business_rule.manage" && p !== "feature_flag.manage"),
  ANALYSIS_MANAGER: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "requirement.create", "requirement.override", "demand.run", "overall.export", "business_rule.read", "audit.read"],
  DATA_ANALYST: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "overall.export", "audit.read"],
  DATA_SCIENTIST: [...BASE, ...PLANNING_READ, "sales.read", "forecast.run", "forecast.publish", "overall.export", "audit.read"],
  PLANNING_MANAGER: [...BASE, ...PLANNING_READ, "orders.read", "plan.create", "plan.select", "plan.approve", "plan.replan", "rough.reserve", "overall.export", "business_rule.read", "audit.read"],
  PLANNER: [...BASE, ...PLANNING_READ, "orders.read", "plan.create", "plan.select", "plan.replan", "rough.reserve"],
  PLANNING_VIEWER: [...BASE, ...PLANNING_READ],
  MFG_MANAGER: [...BASE, ...PLANNING_READ, "audit.read"],
  MFG_VIEWER: [...BASE, "analysis.read", "plan.read", "rough.read", "fantasy.read", "overall.read"],
  SALES_MANAGER: [...BASE, "analysis.read", "requirement.read", ...COMMERCIAL_READ, "overall.export", "audit.read"],
  SALES_VIEWER: [...BASE, "analysis.read", ...COMMERCIAL_READ],
  FANTASY_INTEGRATION: ["fantasy.read", "fantasy.sync", "overall.read", "notification.broadcast"],
  AUDITOR: [...BASE, "audit.read", "overall.read", "business_rule.read", "feature_flag.read", "config.read"],
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
