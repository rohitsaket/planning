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
  // Legacy alias for "analysis-demand-trace"; kept in step with it so a stale link is
  // authorized identically to the canonical id it resolves to.
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

  // Analysis Section & Direct Subpages
  "analysis-executive": "analysis.read",
  "analysis-sales": "sales.read", // "Sales Analysis & Trends" module (tabs: analysis | trends)
  "analysis-sales-trends": "sales.read", // legacy id, redirected to analysis-sales?tab=trends
  "analysis-customers-orders": "customers.read",
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
  "data_quality.export": "Data Quality Issues Export",
  "config.read": "Master Configuration Access",
  "business_rule.read": "Business Rules & Mappings Access",
  "business_rule.manage": "Business Rules Administration",
  "feature_flag.read": "System Settings & Flags Access",
  "feature_flag.manage": "Feature Flags Management",
  "audit.read": "Audit Trail & System Logs Access",
  "user.manage": "User & Access Management",
};
