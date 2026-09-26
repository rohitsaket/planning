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
  // Consolidated Workflow Views
  "dashboard": "analysis.read",
  "fantasy-live": "fantasy.read",
  "fantasy-sync": "fantasy.read",
  "overall-data": "overall.read",
  "data-quality-issues": "data_quality.read",
  "demand-overview": "analysis.read",
  "inventory-position": "analysis.read",
  // Customers tab needs customers.read, Orders tab needs orders.read; either admits
  // the page, and each tab still enforces its own.
  "customers-orders": ["customers.read", "orders.read"],
  // Legacy alias for "analysis-demand-trace"; kept in step with it so a stale link is
  // authorized identically to the canonical id it resolves to.
  "demand-trace": "analysis.read",
  "stock-strategy": "analysis.read",
  "requirements-matrix": "requirement.read",
  "requirements-priority-queue": "requirement.read",
  "orders-exceptions": "orders.read",
  "replenishment-allocation": "requirement.read",
  "planning-rough-availability": "rough.read",
  // Executing an import is a create: the route enforces plan.create.
  "planning-workbook-import": "plan.create",
  "planning-workbench": "plan.read",
  "planning-comparison": "plan.read",
  // Reading the queue needs plan.read; approving/rejecting needs plan.approve and is
  // enforced on POST /api/planning/approvals and gated per button.
  "planning-approval-queue": "plan.read",
  "manufacturing-overview": "fantasy.read",
  // /api/traceability/[query] resolves rough, cases, plans and pieces: plan.read.
  "manufacturing-traceability": "plan.read",
  "plan-vs-actual": "plan.read",
  "data-science-forecasting": "analysis.read",
  "data-science-predictive-models": "analysis.read",
  "data-science-prediction-monitoring": "analysis.read",
  "reports": "analysis.read",
  "admin-users-access": "user.read",
  "admin-rules-mappings": "business_rule.read",
  "admin-system-settings": "feature_flag.read",
  "admin-audit-log": "audit.read",

  // Analysis Section & Direct Subpages
  "analysis-executive": "analysis.read",
  "analysis-sales": "sales.read", // "Sales Analysis & Trends" module (tabs: analysis | trends)
  "analysis-sales-trends": "sales.read", // legacy id, redirected to analysis-sales?tab=trends
  // Alias of "customers-orders"; kept in step with it so a stale link is authorized
  // identically to the canonical id it resolves to.
  "analysis-customers-orders": ["customers.read", "orders.read"],
  "analysis-inventory-position": "analysis.read",
  "analysis-customers": "customers.read",
  "analysis-orders": "orders.read",
  "analysis-country": "analysis.read",
  "analysis-polished": "analysis.read",
  "analysis-memo": "sales.read",
  "analysis-wip": "analysis.read",
  "analysis-forecast": "analysis.read",
  "analysis-stockout": "analysis.read",
  "analysis-excess": "analysis.read",
  "analysis-aging": "analysis.read",
  "analysis-reorder-signals": "analysis.read",
  "demand-history": "analysis.read",
  "analysis-demand-trace": "analysis.read",
  "transfer-analyzer": "analysis.read",
  "aging-dashboard": "analysis.read",

  // Legacy Views & Direct Subpages
  "requirements-orders": "orders.read",
  "planning-reservations": "rough.read",
  "fantasy-status-mapping": "business_rule.read",
  "data-quality-unmapped-labs": "config.read",
  "data-quality-unmapped-shapes": "config.read",
  "admin-business-rules": "business_rule.read",
  "admin-feature-flags": "feature_flag.read",
  "admin-users": "user.read",
  "admin-access-requests": "access_request.review",
  "admin-weight-bands": "config.read",
  "admin-lab-mappings": "config.read",
  "admin-shape-mappings": "config.read",

  // Fantasy subpages. Rough stock is served by /api/fantasy/rough, which enforces
  // rough.read — not fantasy.read.
  "fantasy-rough": "rough.read",
  "fantasy-polished": "fantasy.read",
  "fantasy-departments": "fantasy.read",
  "fantasy-locations": "fantasy.read",
  "fantasy-reconciliation": "fantasy.read",

  // Manufacturing subpages.
  "manufacturing-departments": "fantasy.read",
  "manufacturing-locations": "fantasy.read",
  "manufacturing-tracking": "fantasy.read",
  "manufacturing-wip": "analysis.read",
  "manufacturing-plan-vs-actual": "plan.read",

  // Planning subpages.
  "planning-cases": "plan.read",
  "planning-planned-pieces": "plan.read",

  // Requirements subpages (all render the requirements matrix).
  "requirements-allocation": "requirement.read",
  "requirements-backorders": "requirement.read",
  "requirements-forecast-signals": "requirement.read",
  "requirements-replenishment": "requirement.read",
  "requirements-special": "requirement.read",

  // Data-science subpages.
  "data-science-forecast": "analysis.read",
  "data-science-forecast-accuracy": "analysis.read",
  "data-science-models": "analysis.read",
  "data-science-anomaly-detection": "analysis.read",
  "data-science-yield-prediction": "analysis.read",
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
  "forecast.methodology.read": "Forecast Model Methodology & Validation Metrics",
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
  "plan.create": "Plan Creation & Workbook Import",
  "plan.select": "Plan Option Selection",
  "plan.approve": "Planning Approval Authority",
  "plan.replan": "Replanning Authority",
  "rough.read": "Rough Diamond Inventory Access",
  "rough.reserve": "Rough Reservation Authority",
  "demand.run": "Demand Calculation Execution",
  "forecast.run": "Forecast Model Execution",
  "forecast.publish": "Forecast Publishing",
  "fantasy.read": "Fantasy ERP & Manufacturing Data Access",
  "overall.read": "Overall Historical Data Access",
  "overall.export": "Overall Historical Data Export",
  "data_quality.read": "Data Quality Issues & Diagnostics Access",
  "data_quality.manage": "Data Quality Resolution Management",
  "data_quality.export": "Data Quality Issues Export",
  "config.read": "Master Configuration Access",
  "business_rule.read": "Business Rules & Mappings Access",
  "business_rule.manage": "Business Rules Administration",
  "feature_flag.read": "System Settings & Flags Access",
  "feature_flag.manage": "Feature Flags Management",
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
  "role.read": "Role & Permission Matrix Access",
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
  "sarin.mapping.manage": "Sarin Shape Mapping Administration",
};
