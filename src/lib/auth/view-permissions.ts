// Single mapping for view permission requirements.
// Frontend UX lock states use this to display lock icons and access restricted gates.
// The backend API enforces authorization on every endpoint independently.

const EXACT: Record<string, string> = {
  // Consolidated Workflow Views
  "dashboard": "analysis.read",
  "fantasy-live": "fantasy.read",
  "fantasy-sync": "fantasy.read",
  "overall-data": "overall.read",
  "data-quality-issues": "data_quality.read",
  "demand-overview": "analysis.read",
  "inventory-position": "analysis.read",
  "customers-orders": "customers.read",
  "demand-trace": "analysis.read",
  "stock-strategy": "analysis.read",
  "requirements-matrix": "requirement.read",
  "requirements-priority-queue": "requirement.read",
  "orders-exceptions": "orders.read",
  "replenishment-allocation": "requirement.read",
  "planning-rough-availability": "rough.read",
  "planning-workbook-import": "plan.read",
  "planning-workbench": "plan.read",
  "planning-comparison": "plan.read",
  "planning-approval-queue": "plan.approve",
  "manufacturing-overview": "fantasy.read",
  "manufacturing-traceability": "fantasy.read",
  "plan-vs-actual": "plan.read",
  "data-science-forecasting": "analysis.read",
  "data-science-predictive-models": "analysis.read",
  "data-science-prediction-monitoring": "analysis.read",
  "reports": "analysis.read",
  "admin-users-access": "user.manage",
  "admin-rules-mappings": "business_rule.read",
  "admin-system-settings": "feature_flag.read",
  "admin-audit-log": "audit.read",

  // Legacy Views & Direct Subpages
  "analysis-sales": "sales.read",
  "analysis-sales-trends": "sales.read",
  "analysis-memo": "sales.read",
  "analysis-customers": "customers.read",
  "analysis-orders": "orders.read",
  "requirements-orders": "orders.read",
  "planning-reservations": "rough.read",
  "fantasy-status-mapping": "business_rule.read",
  "data-quality-unmapped-labs": "config.read",
  "data-quality-unmapped-shapes": "config.read",
  "admin-business-rules": "business_rule.read",
  "admin-feature-flags": "feature_flag.read",
  "admin-users": "user.manage",
  "admin-access-requests": "user.manage",
  "admin-weight-bands": "config.read",
  "admin-lab-mappings": "config.read",
  "admin-shape-mappings": "config.read",
};

export function viewPermission(viewId: string): string {
  if (EXACT[viewId]) return EXACT[viewId];
  if (viewId.startsWith("requirements-")) return "requirement.read";
  if (viewId.startsWith("planning-")) return "plan.read";
  if (viewId.startsWith("fantasy-") || viewId.startsWith("manufacturing-")) return "fantasy.read";
  if (viewId.startsWith("admin-")) return "business_rule.read";
  return "analysis.read";
}

export function isViewAuthorized(userPerms: string[] | undefined | null, viewId: string): boolean {
  if (!userPerms || userPerms.length === 0) return false;
  const reqPerm = viewPermission(viewId);
  return userPerms.includes(reqPerm);
}

export const PERMISSION_LABELS: Record<string, string> = {
  "analysis.read": "Executive Analytics & Dashboard Access",
  "sales.read": "Commercial & Sales Analysis Access",
  "customers.read": "Customer Information Access",
  "orders.read": "Customer Orders Access",
  "requirement.read": "Manufacturing Requirements Access",
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
  "fantasy.sync": "Fantasy Sync & Integration Management",
  "overall.read": "Overall Historical Data Access",
  "overall.export": "Overall Historical Data Export",
  "data_quality.read": "Data Quality Issues & Diagnostics Access",
  "data_quality.manage": "Data Quality Resolution Management",
  "config.read": "Master Configuration Access",
  "business_rule.read": "Business Rules & Mappings Access",
  "business_rule.manage": "Business Rules Administration",
  "feature_flag.read": "System Settings & Flags Access",
  "feature_flag.manage": "Feature Flags Management",
  "audit.read": "Audit Trail & System Logs Access",
  "user.manage": "User & Access Management",
};
