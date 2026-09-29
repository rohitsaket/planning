// Single mapping for view permission requirements.
//
// Fails closed: a view id with no explicit entry has no permission and is denied to
// everyone, Super Admin included. There is deliberately no prefix rule and no default —
// an unmapped page used to resolve to `analysis.read`, the most widely held permission
// in the system, so a newly added page was visible to almost every role before anyone
// chose a permission for it.
//
// Each entry is the permission the page's own data API enforces, so a page is never
// shown to someone whose first request would be a 403.
//
// A consolidated page whose tabs carry different permissions lists them as an array,
// meaning "any of these". Holding one tab's permission admits the page; it does not
// admit the other tab, which enforces its own permission in the UI and again at its own
// API. Without this, a page had to be mapped to a single permission, and a user holding
// only the other tab's permission was denied the whole page.
//
// Frontend lock states use this. The backend API enforces authorization on every
// endpoint independently; this is UX, not the security boundary.

const EXACT: Record<string, string | readonly string[]> = {
  // Sidebar pages. A host whose tabs carry different permissions lists them all: holding
  // any one admits the page, which then shows only the tabs that permission opens.
  "dashboard": "analysis.read", // Overview: Overview and Analysis tabs
  "analysis-sales": "sales.read",
  // Customers tab needs customers.read, Orders tab needs orders.read; either admits the
  // page, and each tab still enforces its own.
  "analysis-customers-orders": ["customers.read", "orders.read"],
  "analysis-inventory-position": "analysis.read", // Inventory, including Stockout, Excess and Aging
  "fantasy-data": ["rough.read", "fantasy.read", "overall.read"],
  "data-quality-issues": "data_quality.read",
  "requirements-matrix": "requirement.read",
  "requirements-priority-queue": "requirement.read",
  "orders-exceptions": "orders.read",
  "replenishment-allocation": "requirement.read",
  "planning-rough-availability": "rough.read",
  // Sarin file processing. Every action (upload, validate, generate, export) keeps its own
  // permission, enforced per control and per route.
  "planning-workbook-import": "sarin.import.read",
  "planning-workbench": ["plan.read", "rough.read"],
  // Reading the queue needs plan.read; approving/rejecting needs plan.approve and is
  // enforced on POST /api/planning/approvals and gated per button.
  "planning-approval-queue": "plan.read",
  // Users tab: account readers and access-request reviewers; Permissions tab: role readers
  // and approval-policy readers.
  "admin-users-access": ["user.read", "access_request.review", "role.read", "approval_policy.read"],
  // Mappings: master-data tabs need config.read, the Sarin Shape Mapping tab needs
  // sarin.mapping.read. Changes need each tab's manage permission.
  "admin-mappings": ["config.read", "sarin.mapping.read"],
  "admin-audit-log": "audit.read",

  // Direct views opened from dashboard tiles and page links.
  "analysis-customers": "customers.read",
  "analysis-orders": "orders.read",
  "analysis-country": "analysis.read",
  "analysis-polished": "analysis.read",
  "analysis-memo": "sales.read",
  "requirements-orders": "orders.read",
  "requirements-allocation": "requirement.read",
  "requirements-backorders": "requirement.read",
  "requirements-forecast-signals": "requirement.read",
  "requirements-replenishment": "requirement.read",
  "requirements-special": "requirement.read",
};

/**
 * The permission a view requires, or null when the view has no mapping.
 *
 * Null means denied. It is never substituted with a default: an unmapped page must be
 * unreachable until someone decides, explicitly, who may see it.
 */
/**
 * Every permission that admits a view. Empty means the view is mapped to nothing and is
 * therefore denied to everyone.
 */
export function viewPermissions(viewId: string): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(EXACT, viewId)) return [];
  const entry = EXACT[viewId];
  return typeof entry === "string" ? [entry] : entry;
}

/**
 * The single permission a view requires, or null when it requires none or several.
 *
 * Callers that need to handle a composite requirement use `viewPermissions`; this
 * remains for the common case of naming one required permission to the user.
 */
export function viewPermission(viewId: string): string | null {
  const perms = viewPermissions(viewId);
  return perms.length === 1 ? perms[0] : null;
}

/** Every view id that has an explicit mapping. Used by tests and the admin matrix. */
export function mappedViewIds(): string[] {
  return Object.keys(EXACT).sort();
}

export function isViewAuthorized(userPerms: string[] | undefined | null, viewId: string): boolean {
  if (!userPerms || userPerms.length === 0) return false;
  const required = viewPermissions(viewId);
  // No mapping → denied, for every role. There is no wildcard.
  if (required.length === 0) return false;
  // Any one of the listed permissions admits the page. This is page entry only; each
  // tab and each API enforces its own permission independently.
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
  "orders.export": "Customer Orders Export",
  "requirement.read": "Manufacturing Requirements Access",
  "requirement.export": "Requirements Export",
  "plan.export": "Planning Data Export",
  "fantasy.export": "Fantasy ERP Data Export",
  "config.export": "Master Configuration Export",
  "audit.export": "Audit Trail Export",
  "requirement.create": "Requirement Creation",
  "requirement.override": "Priority Override Authority",
  "plan.read": "Rough & Production Planning Access",
  "plan.create": "Plan Creation",
  "plan.select": "Plan Option Selection",
  "plan.approve": "Planning Approval Authority",
  "plan.replan": "Replanning Authority",
  "rough.read": "Rough Diamond Inventory Access",
  "rough.reserve": "Rough Reservation Authority",
  "demand.run": "Demand Calculation Execution",
  "fantasy.read": "Fantasy ERP & Manufacturing Data Access",
  "overall.read": "Overall Historical Data Access",
  "overall.export": "Overall Historical Data Export",
  "data_quality.read": "Import Issues Access",
  "data_quality.export": "Import Issues Export",
  "config.read": "Master Configuration Access",
  "approval_policy.read": "Approval Policy Access",
  "approval_policy.manage": "Approval Policy Change",
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
  "sarin.output.approve": "Sarin Output Planning Approval Authority",
  "sarin.output.export": "Sarin Output Export",
  "sarin.mapping.read": "View Shape Mappings",
  "sarin.mapping.manage": "Edit Shape Mappings",
};
