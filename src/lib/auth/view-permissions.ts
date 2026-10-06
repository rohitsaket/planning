const EXACT: Record<string, string | readonly string[]> = {
  "dashboard": "analysis.read",
  "analysis-sales": "sales.read",
  "analysis-customers-orders": ["customers.read", "orders.read"],
  "analysis-inventory-position": "analysis.read",
  "fantasy-data": ["fantasy.read", "overall.read"],
  "data-quality-issues": "data_quality.read",
  "planning-workbook-import": "sarin.import.read",
  "admin-users-access": ["user.read", "access_request.review", "role.read"],
  "admin-mappings": ["config.read", "sarin.mapping.read"],
  "admin-audit-log": "audit.read",

  "analysis-customers": "customers.read",
  "analysis-country": "analysis.read",
  "analysis-polished": "analysis.read",
  "analysis-memo": "sales.read",
};

export function viewPermissions(viewId: string): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(EXACT, viewId)) return [];
  const entry = EXACT[viewId];
  return typeof entry === "string" ? [entry] : entry;
}

export function viewPermission(viewId: string): string | null {
  const perms = viewPermissions(viewId);
  return perms.length === 1 ? perms[0] : null;
}

export function mappedViewIds(): string[] {
  return Object.keys(EXACT).sort();
}

export function isViewAuthorized(userPerms: string[] | undefined | null, viewId: string): boolean {
  if (!userPerms || userPerms.length === 0) return false;
  const required = viewPermissions(viewId);
  if (required.length === 0) return false;
  return required.some((p) => userPerms.includes(p));
}

export const PERMISSION_LABELS: Record<string, string> = {
  "analysis.read": "Executive Analytics & Dashboard Access",
  "analysis.export": "Inventory & Analysis Export",
  "sales.read": "Commercial & Sales Analysis Access",
  "sales.export": "Sales & Memo Export",
  "customers.read": "Customer Information Access",
  "customers.export": "Customer Data Export",
  "orders.read": "Customer Orders Access",
  "fantasy.export": "Fantasy ERP Data Export",
  "config.export": "Master Configuration Export",
  "audit.export": "Audit Trail Export",
  "demand.run": "Demand Calculation Execution",
  "fantasy.read": "Fantasy ERP & Manufacturing Data Access",
  "overall.read": "Overall Historical Data Access",
  "overall.export": "Overall Historical Data Export",
  "data_quality.read": "Import Issues Access",
  "data_quality.export": "Import Issues Export",
  "config.read": "Master Configuration Access",
  "audit.read": "Audit Trail & System Logs Access",
  "user.read": "User Directory Access",
  "user.create": "Account Creation",
  "user.update": "Account Profile Update",
  "user.status.manage": "Account Activation & Suspension",
  "user.roles.assign": "Role Assignment",
  "user.password.reset": "Password Reset Authority",
  "user.sessions.read": "Session Visibility",
  "user.sessions.revoke": "Session Revocation",
  "user.super_admin.assign": "Protected Administrator Assignment",
  "access_request.review": "Access Request Review",
  "role.read": "Role & Permission Access",
  "role.manage": "Role Administration",
  "role.permissions.assign": "Role Permission Assignment",
  "security_audit.read": "Access Security History",
  "security_audit.export": "Access Security History Export",
  "fantasy.sync.run": "Fantasy Synchronization Execution",
  "fantasy.sync.retry": "Fantasy Synchronization Retry",
  "fantasy.sync.unlock": "Fantasy Synchronization Lock Release",
  "notification.manage": "Notification Triage",
  "sarin.import.read": "Sarin Import History & Issues Access",
  "sarin.import.upload": "Sarin File Upload",
  "sarin.import.validate": "Sarin Import Validation",
  "sarin.issue.review": "Sarin Issue Review",
  "sarin.issue.override": "Sarin Issue Override Authority",
  "sarin.output.generate": "Sarin Output Generation",
  "sarin.output.export": "Sarin Output Export",
  "sarin.mapping.read": "View Shape Mappings",
  "sarin.mapping.manage": "Edit Shape Mappings",
};
