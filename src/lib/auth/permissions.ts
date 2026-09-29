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
  // How a prediction is produced — algorithm, training and validation windows, and the
  // error metrics a model is judged on. Separate from reading the prediction itself:
  // a planner acts on the forecast, while only model governance needs to see the method
  // behind it. Deliberately not implied by `analysis.read`, which every read-only role
  // holds, nor by `forecast.run`/`forecast.publish`, which are actions on a model.
  "forecast.methodology.read",
  "fantasy.read",
  // Running a routine synchronization, retrying a failed one and force-releasing a
  // stuck lock are three different risks and are authorized separately.
  "fantasy.sync.run",
  "fantasy.sync.retry",
  "fantasy.sync.unlock",
  // Shadow projection is a diagnostic capability, separate from synchronization.
  // Running one costs real work over a whole batch; reading a run's reconciliation
  // exposes how source data would be interpreted. Neither implies the other, and
  // neither implies any authority over live synchronization.
  "fantasy.projection.run",
  "fantasy.projection.read",
  // Aborting someone else's running projection is an administrative recovery action,
  // not a consequence of being allowed to start or read one. Kept separate so it can be
  // granted to whoever actually holds operational recovery authority.
  "fantasy.projection.recover",
  "fantasy.export",
  "overall.read",
  "overall.export",
  "data_quality.read",
  "data_quality.manage",
  "data_quality.export",
  "config.read",
  "config.export",
  "feature_flag.read",
  "feature_flag.manage",
  "notification.read",
  // Marking a notification read is a write: it must not travel on the read permission.
  "notification.manage",
  "notification.broadcast",
  "audit.read",
  "audit.export",

  // --- Access administration -------------------------------------------------
  // Replaces the single `user.manage` super-permission, which authorized account
  // creation, role assignment, password reset (an account-takeover primitive) and
  // access-request approval with one grant.
  "user.read",
  "user.create",
  "user.update",
  "user.status.manage",
  "user.roles.assign",
  "user.password.reset",
  "user.sessions.read",
  "user.sessions.revoke",
  // Which countries and labs an account may see. Reading a scope is part of reviewing an
  // account; changing one decides how much of the business somebody can read, which is a
  // separate decision from assigning a role and is granted separately.
  "user.scope.read",
  "user.scope.assign",
  // Authority to assign a protected system-administrator role. Deliberately separate,
  // and deliberately withheld from ordinary administrators.
  "user.super_admin.assign",
  "access_request.review",
  "role.read",
  "role.manage",
  "role.permissions.assign",
  "security_audit.read",
  "security_audit.export",

  // --- Sarin import --------------------------------------------------------------
  // Each step of the Sarin CSV workflow carries a different risk and is authorized on its
  // own: reading history, bringing a file in, running validation, triaging issues,
  // overriding a finding, generating output, approving output for planning, exporting it,
  // and changing the shape mappings every future import is judged against.
  "sarin.import.read",
  "sarin.import.upload",
  "sarin.import.validate",
  "sarin.issue.review",
  "sarin.issue.override",
  "sarin.output.generate",
  // Planning approval authority. Never granted through the `ALL` shortcut — see
  // EXPLICIT_GRANT_PERMISSIONS.
  "sarin.output.approve",
  "sarin.output.export",
  // Shape mappings: reading the catalog, and changing it (a saved change applies at once,
  // after the server's checks). Every change is audited and kept as a snapshot.
  "sarin.mapping.read",
  "sarin.mapping.manage",
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
  "security_audit.export",
  "sarin.output.export",
] as const satisfies readonly (typeof PERMISSIONS)[number][];

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Permissions Super Admin does not receive by holding "everything". A permission listed here
 * reaches a user only through a custom role that names it, built deliberately by whoever
 * holds that authority. Approving Sarin output for planning is a planning authority, not a
 * consequence of administering the system.
 */
export const EXPLICIT_GRANT_PERMISSIONS = ["sarin.output.approve"] as const satisfies readonly Permission[];

/**
 * The one built-in system role. Every narrower access profile is a custom role (Role rows
 * with isSystem = false and explicit RolePermission rows), created and assigned under
 * role.manage and user.roles.assign.
 */
export const ROLES = ["SUPER_ADMIN"] as const;

export type Role = (typeof ROLES)[number];

const ALL = PERMISSIONS.filter((p) => !(EXPLICIT_GRANT_PERMISSIONS as readonly Permission[]).includes(p)) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
};

/**
 * True only for a permission this build defines. Stored role-permission rows are checked
 * through this on write and on read, so a code that no longer has an enforcement point
 * grants nothing.
 */
export function isPermission(v: string): v is Permission {
  return (PERMISSIONS as readonly string[]).includes(v);
}

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
