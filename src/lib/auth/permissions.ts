export const PERMISSIONS = [
  "analysis.read",
  "analysis.export",
  "sales.read",
  "sales.export",
  "customers.read",
  "customers.export",
  "orders.read",
  "demand.run",
  "demand.trace",
  "demand.export",
  "fantasy.read",
  "fantasy.sync.run",
  "fantasy.sync.retry",
  "fantasy.sync.unlock",
  "fantasy.export",
  "overall.read",
  "overall.export",
  "data_quality.read",
  "data_quality.export",
  "config.read",
  "config.export",
  "notification.read",
  "notification.manage",
  "audit.read",
  "audit.export",

  "user.read",
  "user.create",
  "user.update",
  "user.status.manage",
  "user.roles.assign",
  "user.password.reset",
  "user.sessions.read",
  "user.sessions.revoke",
  "user.scope.read",
  "user.scope.assign",
  "user.super_admin.assign",
  "access_request.review",
  "role.read",
  "role.manage",
  "role.permissions.assign",
  "security_audit.read",
  "security_audit.export",

  "sarin.import.read",
  "sarin.import.upload",
  "sarin.import.validate",
  "sarin.issue.review",
  "sarin.issue.override",
  "sarin.output.generate",
  "sarin.output.export",
  "sarin.mapping.read",
  "sarin.mapping.manage",
] as const;

export const EXPORT_PERMISSIONS = [
  "analysis.export",
  "sales.export",
  "customers.export",
  "demand.export",
  "fantasy.export",
  "overall.export",
  "data_quality.export",
  "config.export",
  "audit.export",
  "security_audit.export",
  "sarin.output.export",
] as const satisfies readonly (typeof PERMISSIONS)[number][];

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ["SUPER_ADMIN"] as const;

export type Role = (typeof ROLES)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
};

export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

export function permissionsFor(role: string): Permission[] {
  return isRole(role) ? ROLE_PERMISSIONS[role] : [];
}

export function hasPermission(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
