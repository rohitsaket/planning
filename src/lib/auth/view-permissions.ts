// Which permission a screen needs. Used ONLY to hide navigation the user could not use;
// the API enforces every permission independently.
const EXACT: Record<string, string> = {
  "analysis-sales": "sales.read",
  "analysis-sales-trends": "sales.read",
  "analysis-memo": "sales.read",
  "analysis-customers": "customers.read",
  "analysis-orders": "orders.read",
  "requirements-orders": "orders.read",
  "planning-rough-availability": "rough.read",
  "planning-reservations": "rough.read",
  "fantasy-status-mapping": "business_rule.read",
  "data-quality-unmapped-labs": "config.read",
  "data-quality-unmapped-shapes": "config.read",
  "admin-business-rules": "business_rule.read",
  "admin-feature-flags": "feature_flag.read",
  "admin-audit-log": "audit.read",
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
  return "analysis.read";
}
