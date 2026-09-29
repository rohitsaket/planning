/**
 * Plain-language metadata for every permission in the central catalogue
 * (`permissions.ts`), served to the administration page so it can group and label them.
 *
 * The permission codes stay the only authorization vocabulary: this file describes them
 * and grants nothing. Every code must appear here exactly once; the security tests
 * enforce it. No permission implies another — nothing here is a dependency or an
 * inheritance rule, because the authorization model defines none.
 */

import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";

export const PERMISSION_AREAS = [
  "Analysis",
  "Demand",
  "Fantasy Data",
  "Overall Data",
  "Requirements",
  "Workbook Import",
  "Planning",
  "Mappings",
  "Users and Access",
  "System Administration",
  "Audit",
] as const;
export type PermissionArea = (typeof PERMISSION_AREAS)[number];

export const PERMISSION_CAPABILITIES = ["View", "Create", "Update", "Process/Run", "Retry", "Export", "Approve", "Manage", "Override", "Unlock"] as const;
export type PermissionCapability = (typeof PERMISSION_CAPABILITIES)[number];

export interface PermissionMeta {
  readonly id: Permission;
  readonly label: string;
  readonly area: PermissionArea;
  readonly capability: PermissionCapability;
  /**
   * Sensitive permissions are never implied by any other choice and are confirmed
   * explicitly before a role gains or loses them.
   */
  readonly sensitive: boolean;
}

const m = (id: Permission, area: PermissionArea, capability: PermissionCapability, label: string, sensitive = false): PermissionMeta => ({ id, area, capability, label, sensitive });

export const PERMISSION_CATALOG: readonly PermissionMeta[] = [
  // Analysis
  m("analysis.read", "Analysis", "View", "View analysis pages"),
  m("analysis.export", "Analysis", "Export", "Export analysis data", true),
  m("sales.read", "Analysis", "View", "View sales"),
  m("sales.export", "Analysis", "Export", "Export sales", true),
  m("customers.read", "Analysis", "View", "View customer information"),
  m("customers.export", "Analysis", "Export", "Export customer data", true),
  m("orders.read", "Analysis", "View", "View customer orders"),
  m("orders.export", "Analysis", "Export", "Export customer orders", true),
  m("forecast.run", "Analysis", "Process/Run", "Run forecast models"),
  m("forecast.publish", "Analysis", "Manage", "Publish forecasts"),
  m("forecast.methodology.read", "Analysis", "View", "View forecast methodology"),
  // Demand
  m("demand.run", "Demand", "Process/Run", "Run the demand calculation"),
  m("demand.trace", "Demand", "View", "View record-level demand detail"),
  m("demand.export", "Demand", "Export", "Export demand records", true),
  // Fantasy Data
  m("fantasy.read", "Fantasy Data", "View", "View Fantasy ERP data"),
  m("fantasy.export", "Fantasy Data", "Export", "Export Fantasy ERP data", true),
  m("fantasy.sync.run", "Fantasy Data", "Process/Run", "Run synchronization", true),
  m("fantasy.sync.retry", "Fantasy Data", "Retry", "Retry synchronization", true),
  m("fantasy.sync.unlock", "Fantasy Data", "Unlock", "Release a stuck synchronization", true),
  m("fantasy.projection.read", "Fantasy Data", "View", "View projection diagnostics"),
  m("fantasy.projection.run", "Fantasy Data", "Process/Run", "Run projections"),
  m("fantasy.projection.recover", "Fantasy Data", "Unlock", "Recover a stalled projection", true),
  // Overall Data
  m("overall.read", "Overall Data", "View", "View overall historical data"),
  m("overall.export", "Overall Data", "Export", "Export overall historical data", true),
  // Requirements
  m("requirement.read", "Requirements", "View", "View requirements"),
  m("requirement.create", "Requirements", "Create", "Create requirements"),
  m("requirement.override", "Requirements", "Override", "Override requirement priority", true),
  m("requirement.export", "Requirements", "Export", "Export requirements", true),
  // Workbook Import
  m("sarin.import.read", "Workbook Import", "View", "View Sarin files and outputs"),
  m("sarin.import.upload", "Workbook Import", "Create", "Upload Sarin files"),
  m("sarin.import.validate", "Workbook Import", "Process/Run", "Check Sarin files"),
  m("sarin.issue.review", "Workbook Import", "Update", "Review file findings"),
  m("sarin.issue.override", "Workbook Import", "Override", "Override file findings", true),
  m("sarin.output.generate", "Workbook Import", "Process/Run", "Prepare structured output"),
  m("sarin.output.approve", "Workbook Import", "Approve", "Approve Sarin output for planning", true),
  m("sarin.output.export", "Workbook Import", "Export", "Export Sarin output", true),
  // Planning
  m("plan.read", "Planning", "View", "View plans"),
  m("plan.create", "Planning", "Create", "Create plans"),
  m("plan.select", "Planning", "Update", "Select plan options"),
  m("plan.replan", "Planning", "Update", "Replan"),
  m("plan.approve", "Planning", "Approve", "Approve plans", true),
  m("plan.export", "Planning", "Export", "Export planning data", true),
  m("rough.read", "Planning", "View", "View rough inventory"),
  m("rough.reserve", "Planning", "Update", "Reserve rough stones"),
  // Mappings
  m("config.read", "Mappings", "View", "View mappings and configuration"),
  m("config.export", "Mappings", "Export", "Export configuration", true),
  m("sarin.mapping.read", "Mappings", "View", "View Sarin shape mappings"),
  m("sarin.mapping.manage", "Mappings", "Manage", "Manage Sarin shape mappings", true),
  // Users and Access
  m("user.read", "Users and Access", "View", "View users"),
  m("user.create", "Users and Access", "Create", "Add users", true),
  m("user.update", "Users and Access", "Update", "Edit user details", true),
  m("user.status.manage", "Users and Access", "Manage", "Suspend or reactivate users", true),
  m("user.roles.assign", "Users and Access", "Manage", "Assign roles to users", true),
  m("user.password.reset", "Users and Access", "Manage", "Reset user passwords", true),
  m("user.sessions.read", "Users and Access", "View", "View user sessions"),
  m("user.sessions.revoke", "Users and Access", "Manage", "Sign users out", true),
  m("user.scope.read", "Users and Access", "View", "View country and lab scope"),
  m("user.scope.assign", "Users and Access", "Manage", "Assign country and lab scope", true),
  m("user.super_admin.assign", "Users and Access", "Manage", "Assign the Super Admin role", true),
  m("access_request.review", "Users and Access", "Approve", "Review access requests", true),
  m("role.read", "Users and Access", "View", "View roles"),
  m("role.manage", "Users and Access", "Manage", "Manage roles", true),
  m("role.permissions.assign", "Users and Access", "Manage", "Choose role permissions", true),
  // System Administration
  m("feature_flag.read", "System Administration", "View", "View system settings"),
  m("feature_flag.manage", "System Administration", "Manage", "Change system settings", true),
  m("notification.read", "System Administration", "View", "View notifications"),
  m("notification.manage", "System Administration", "Update", "Mark shared notifications read"),
  m("notification.broadcast", "System Administration", "Manage", "Broadcast notifications", true),
  // Audit
  m("audit.read", "Audit", "View", "View the audit log", true),
  m("audit.export", "Audit", "Export", "Export the audit log", true),
  m("security_audit.read", "Audit", "View", "View security audit", true),
  m("security_audit.export", "Audit", "Export", "Export security audit", true),
];

const BY_ID = new Map(PERMISSION_CATALOG.map((p) => [p.id, p]));
export const permissionMeta = (id: Permission): PermissionMeta | undefined => BY_ID.get(id);

/** Every catalogue permission described once, and nothing that is not a permission. */
export function catalogCoverage(): { missing: Permission[]; unknown: string[]; duplicated: string[] } {
  const ids = PERMISSION_CATALOG.map((p) => p.id as string);
  return {
    missing: PERMISSIONS.filter((p) => !ids.includes(p)),
    unknown: ids.filter((id) => !(PERMISSIONS as readonly string[]).includes(id)),
    duplicated: ids.filter((id, i) => ids.indexOf(id) !== i),
  };
}
