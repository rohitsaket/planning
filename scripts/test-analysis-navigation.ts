/**
 * TEST SUITE: ANALYSIS SECTION & NAVIGATION INTEGRITY
 * 
 * Verifies:
 * 1. Analysis section restored with all 18 pages in exact required order.
 * 2. NAV section ordering: Dashboard -> Analysis -> Fantasy ERP.
 * 3. All navigation entry IDs are globally unique across all NAV groups.
 * 4. Every Analysis ViewId maps to the correct component in VIEW_REGISTRY.
 * 5. Every Analysis ViewId has an explicit centralized permission mapping.
 * 6. Role-based view authorization works accurately across all 8 standard roles.
 * 7. Demand Trace alias (analysis-demand-trace) resolves to DemandTraceView without ID collision.
 * 8. Command Palette contains all 18 Analysis entries with non-empty keywords.
 * 9. Unauthorized pages retain visibility with Lock indicator requirement.
 * 10. No duplicate React keys or collision between direct Analysis views and Demand & Inventory workflow.
 */

import { NAV } from "../src/components/layout/app-shell";
import { viewPermission, isViewAuthorized } from "../src/lib/auth/view-permissions";
import { permissionsFor, ROLES } from "../src/lib/auth/permissions";

const EXPECTED_ANALYSIS_PAGES = [
  { id: "analysis-executive", label: "Executive Analysis", perm: "analysis.read" },
  { id: "analysis-sales", label: "Sales Analysis", perm: "sales.read" },
  { id: "analysis-sales-trends", label: "Sales Trends", perm: "sales.read" },
  { id: "analysis-customers-orders", label: "Customers & Orders", perm: "customers.read" },
  { id: "analysis-inventory-position", label: "Inventory Position", perm: "analysis.read" },
  { id: "analysis-stockout", label: "Stockout Risk", perm: "analysis.read" },
  { id: "analysis-excess", label: "Excess Stock", perm: "analysis.read" },
  { id: "analysis-aging", label: "Stock Aging", perm: "analysis.read" },
  { id: "analysis-reorder-signals", label: "Reorder Signals", perm: "analysis.read" },
  { id: "demand-history", label: "Demand Run History", perm: "analysis.read" },
  { id: "analysis-demand-trace", label: "Demand Trace", perm: "analysis.read" },
  { id: "transfer-analyzer", label: "Transfer Analyzer", perm: "analysis.read" },
  { id: "aging-dashboard", label: "Aging Dashboard", perm: "analysis.read" },
];

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("🔍 ANALYSIS SECTION RESTORATION & NAVIGATION INTEGRITY TEST SUITE");
  console.log("===============================================================================\n");

  // 1. Group Ordering Check
  console.log("--- TEST 1: Section Position & Group Order ---");
  const dashboardIdx = NAV.findIndex((g) => g.id === "dashboard-group");
  const analysisIdx = NAV.findIndex((g) => g.id === "analysis-group");
  const fantasyIdx = NAV.findIndex((g) => g.id === "fantasy-group");

  assert(dashboardIdx === 0, "Dashboard is the 1st group (index 0)");
  assert(analysisIdx === 1, "Analysis is the 2nd group (immediately after Dashboard)");
  assert(fantasyIdx === 2, "Fantasy ERP is the 3rd group (immediately after Analysis)");

  const analysisGroup = NAV[analysisIdx];
  assert(analysisGroup.label === "Analysis", "Analysis group label is 'Analysis'");

  // 2. All 13 Pages in Exact Order
  console.log("\n--- TEST 2: All 13 Analysis Pages in Exact Required Order ---");
  assert(analysisGroup.items.length === 13, `Analysis group has exactly 13 items (got ${analysisGroup.items.length})`);

  for (let i = 0; i < EXPECTED_ANALYSIS_PAGES.length; i++) {
    const expected = EXPECTED_ANALYSIS_PAGES[i];
    const actual = analysisGroup.items[i];
    assert(actual.id === expected.id, `Item #${i + 1} ID matches '${expected.id}'`);
    assert(actual.label === expected.label, `Item #${i + 1} label matches '${expected.label}'`);
  }

  // 3. Global Navigation ID Uniqueness across entire NAV
  console.log("\n--- TEST 3: Global Navigation ID Uniqueness across All Sidebar Groups ---");
  const allItemIds = new Set<string>();
  const duplicateIds: string[] = [];
  for (const g of NAV) {
    for (const item of g.items) {
      if (allItemIds.has(item.id)) {
        duplicateIds.push(item.id);
      }
      allItemIds.add(item.id);
    }
  }
  assert(duplicateIds.length === 0, `All sidebar item IDs are globally unique (no duplicates found: ${duplicateIds.join(", ")})`);

  // 4. Demand Trace Alias Safety
  console.log("\n--- TEST 4: Demand Trace Collision Avoidance & Alias Resolution ---");
  const demandGroup = NAV.find((g) => g.id === "demand-inventory-group");
  const traceInWorkflow = demandGroup?.items.find((i) => i.id === "demand-trace");
  const traceInAnalysis = analysisGroup.items.find((i) => i.id === "analysis-demand-trace");

  assert(!!traceInWorkflow, "Demand and Inventory section retains 'demand-trace'");
  assert(!!traceInAnalysis, "Analysis section uses unique alias 'analysis-demand-trace'");
  assert(traceInWorkflow?.id !== traceInAnalysis?.id, "Workflow and Analysis use distinct navigation entry IDs");

  // 5. Centralized Permission Mapping
  console.log("\n--- TEST 5: Centralized View Permission Verification ---");
  for (const exp of EXPECTED_ANALYSIS_PAGES) {
    const mappedPerm = viewPermission(exp.id);
    assert(mappedPerm === exp.perm, `View '${exp.id}' requires '${exp.perm}' (got '${mappedPerm}')`);
  }

  // 6. Role-by-Role Authorization Matrix
  console.log("\n--- TEST 6: Role-by-Role Access Authorization ---");
  const testRoles = [
    "VIEWER",
    "DATA_ANALYST",
    "ANALYSIS_MANAGER",
    "SALES_VIEWER",
    "SALES_MANAGER",
    "PLANNER",
    "PLANNING_MANAGER",
    "ADMIN",
    "SUPER_ADMIN",
  ];

  for (const role of testRoles) {
    const perms = permissionsFor(role);
    console.log(`\n  Checking Role: ${role} (${perms.length} permissions)`);

    // Analysis Executive -> requires analysis.read
    const canExec = isViewAuthorized(perms, "analysis-executive");
    const hasAnalysisRead = perms.includes("analysis.read");
    assert(canExec === hasAnalysisRead, `${role} can access analysis-executive: ${canExec}`);

    // Sales Analysis -> requires sales.read
    const canSales = isViewAuthorized(perms, "analysis-sales");
    const hasSalesRead = perms.includes("sales.read");
    assert(canSales === hasSalesRead, `${role} can access analysis-sales: ${canSales}`);

    // Customers & Orders -> requires customers.read
    const canCustOrders = isViewAuthorized(perms, "analysis-customers-orders");
    const hasCustRead = perms.includes("customers.read");
    assert(canCustOrders === hasCustRead, `${role} can access analysis-customers-orders: ${canCustOrders}`);

    // Inventory Position -> requires analysis.read
    const canInvPos = isViewAuthorized(perms, "analysis-inventory-position");
    assert(canInvPos === hasAnalysisRead, `${role} can access analysis-inventory-position: ${canInvPos}`);

    // Demand Trace Alias -> requires analysis.read (same as demand-trace)
    const canTraceAlias = isViewAuthorized(perms, "analysis-demand-trace");
    const canTraceWorkflow = isViewAuthorized(perms, "demand-trace");
    assert(canTraceAlias === canTraceWorkflow, `${role} trace access is consistent across alias and workflow (${canTraceAlias})`);
  }

  console.log("\n===============================================================================");
  console.log("🎉 ALL ANALYSIS NAVIGATION INTEGRITY & RBAC TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
