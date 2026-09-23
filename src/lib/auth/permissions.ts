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
  "business_rule.read",
  "business_rule.manage",
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
  // Authority to assign a protected system-administrator role. Deliberately separate,
  // and deliberately withheld from ordinary administrators.
  "user.super_admin.assign",
  "access_request.review",
  "role.read",
  "role.manage",
  "role.permissions.assign",
  "security_audit.read",
  "security_audit.export",
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

/** Triaging shared system notifications. Not in BASE: the rows are global, so marking
 *  one read changes what every other user sees. */
const NOTIFICATION_TRIAGE: Permission[] = ["notification.manage"];
const PLANNING_READ: Permission[] = ["analysis.read", "requirement.read", "plan.read", "rough.read", "fantasy.read", "overall.read", "data_quality.read", "config.read"];
const COMMERCIAL_READ: Permission[] = ["sales.read", "customers.read", "orders.read"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ALL,
  // ADMIN keeps administrative and operational powers but is deliberately denied four
  // authorities: planning approval, rule management, feature-flag management, and —
  // added with the access-administration split — defining what a role may do and
  // assigning the protected Super Admin role.
  ADMIN: ALL.filter(
    (p) =>
      p !== "business_rule.manage" &&
      p !== "feature_flag.manage" &&
      p !== "plan.approve" &&
      p !== "role.manage" &&
      p !== "role.permissions.assign" &&
      p !== "user.super_admin.assign" &&
      // Administering the system does not make someone a model reviewer. Assignable,
      // but never automatic.
      p !== "forecast.methodology.read" &&
      // Nor an integration or demand operator. Running a synchronization pulls real
      // source data and advances the checkpoint; running a demand calculation replaces
      // the snapshot every Analysis page reads; force-releasing a sync lock can abandon
      // another worker's in-flight run. Each is an operational act with a consequence
      // for the data, not an administrative one — and each already has a role whose job
      // it is: FANTASY_INTEGRATION for synchronization, ANALYSIS_MANAGER for demand.
      // All three stay assignable to an administrator who genuinely holds that duty.
      p !== "fantasy.sync.run" &&
      p !== "fantasy.sync.retry" &&
      p !== "fantasy.sync.unlock" &&
      p !== "demand.run" &&
      p !== "demand.unlock",
  ),
  ANALYSIS_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, ...COMMERCIAL_READ, "requirement.create", "requirement.override", "demand.run", "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "requirement.export", "fantasy.export", "data_quality.manage", "data_quality.export", "business_rule.read", "audit.read"],
  DATA_ANALYST: [...BASE, ...PLANNING_READ, ...COMMERCIAL_READ, "demand.trace", "demand.export", "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "data_quality.read", "data_quality.export", "audit.read"],
  DATA_SCIENTIST: [...BASE, ...PLANNING_READ, "sales.read", "demand.trace", "demand.export", "forecast.run", "forecast.publish", "forecast.methodology.read", "overall.export", "analysis.export", "sales.export", "data_quality.read", "audit.read"],
  // Explicitly authorized planning approval authority
  PLANNING_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, "orders.read", "demand.trace", "plan.create", "plan.select", "plan.approve", "plan.replan", "rough.reserve", "overall.export", "analysis.export", "plan.export", "requirement.export", "business_rule.read", "audit.read"],
  PLANNER: [...BASE, ...PLANNING_READ, "orders.read", "plan.create", "plan.select", "plan.replan", "rough.reserve", "plan.export"],
  PLANNING_VIEWER: [...BASE, ...PLANNING_READ],
  MFG_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, ...PLANNING_READ, "analysis.export", "audit.read"],
  MFG_VIEWER: [...BASE, "analysis.read", "plan.read", "rough.read", "fantasy.read", "overall.read"],
  SALES_MANAGER: [...BASE, ...NOTIFICATION_TRIAGE, "analysis.read", "requirement.read", ...COMMERCIAL_READ, "overall.export", "analysis.export", "sales.export", "customers.export", "orders.export", "audit.read"],
  SALES_VIEWER: [...BASE, "analysis.read", ...COMMERCIAL_READ],
  // Fantasy Integration role: sync & data access only; no exports, notification
  // broadcast or planning approval. Runs and retries synchronization. Force-releasing a stuck lock is a separate
  // authority and is deliberately NOT granted here: running a sync must not imply it.
  FANTASY_INTEGRATION: ["fantasy.read", "fantasy.sync.run", "fantasy.sync.retry", "fantasy.projection.run", "fantasy.projection.read", "overall.read", "data_quality.read"],
  // Reads projection diagnostics but cannot start a run: inspecting how data would be
  // interpreted is an audit activity; consuming batch-sized work is not.
  AUDITOR: [...BASE, "audit.read", "audit.export", "overall.read", "data_quality.read", "fantasy.projection.read", "business_rule.read", "feature_flag.read", "config.read", "config.export"],
  VIEWER: [...BASE, "analysis.read", "requirement.read", "plan.read", "rough.read", "overall.read"],
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
