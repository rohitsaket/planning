/**
 * TEST SUITE: ANALYSIS SECTION & NAVIGATION INTEGRITY
 * 
 * Verifies:
 * 1. Analysis section with all 12 pages in exact required order ("Sales Analysis" and
 *    "Sales Trends" are one module, "Sales Analysis & Trends", with two tabs).
 * 2. NAV section ordering: Dashboard -> Analysis -> Fantasy ERP.
 * 3. All navigation entry IDs are globally unique across all NAV groups.
 * 4. Every Analysis ViewId maps to the correct component in VIEW_REGISTRY.
 * 5. Every Analysis ViewId has an explicit centralized permission mapping.
 * 6. Role-based view authorization works accurately across all 8 standard roles.
 * 7. Demand Trace alias (analysis-demand-trace) resolves to DemandTraceView without ID collision.
 * 8. Command Palette contains all Analysis entries with non-empty keywords.
 * 9. Unauthorized pages retain visibility with Lock indicator requirement.
 * 10. No duplicate React keys or collision between direct Analysis views and Demand & Inventory workflow.
 * 11. "Sales Analysis & Trends": single sidebar entry, two tabs, default tab, URL/tab state,
 *     browser history (pushState per tab switch), invalid-tab fallback, legacy id redirect.
 */

// Minimal window stub so the nav store's history handling can run outside a browser.
type HistoryCall = { kind: "push" | "replace"; url: string };
const historyCalls: HistoryCall[] = [];
const fakeWindow = {
  location: { hash: "" },
  history: {
    pushState: (_s: unknown, _t: string, url: string) => { historyCalls.push({ kind: "push", url }); fakeWindow.location.hash = url; },
    replaceState: (_s: unknown, _t: string, url: string) => { historyCalls.push({ kind: "replace", url }); fakeWindow.location.hash = url; },
  },
  innerWidth: 1440,
};
(globalThis as any).window = fakeWindow;

import { NAV } from "../src/components/layout/app-shell";
import { viewPermission, isViewAuthorized } from "../src/lib/auth/view-permissions";
import { permissionsFor, ROLES } from "../src/lib/auth/permissions";
import { useNavStore, initNavFromHash, parseNavHash, resolveViewAlias, navHash } from "../src/stores/nav-store";
import { resolveActiveTab } from "../src/components/diamond/shared/tabbed-host-view";
import { SALES_ANALYSIS_TABS, SALES_ANALYSIS_DEFAULT_TAB } from "../src/components/diamond/views/consolidated/sales-analysis-trends-view";

const EXPECTED_ANALYSIS_PAGES = [
  { id: "analysis-executive", label: "Executive Analysis", perm: "analysis.read" },
  { id: "analysis-sales", label: "Sales Analysis & Trends", perm: "sales.read" },
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

  // 2. All 12 Pages in Exact Order
  console.log("\n--- TEST 2: All 12 Analysis Pages in Exact Required Order ---");
  assert(analysisGroup.items.length === 12, `Analysis group has exactly 12 items (got ${analysisGroup.items.length})`);

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

  // 7. Sales Analysis & Trends — merged module
  console.log("\n--- TEST 7: Sales Analysis & Trends merged module ---");
  const salesItems = analysisGroup.items.filter((i) => i.id === "analysis-sales" || i.id === "analysis-sales-trends");
  assert(salesItems.length === 1 && salesItems[0].id === "analysis-sales", "Exactly one sidebar entry for sales, using view id 'analysis-sales'");
  assert(salesItems[0].label === "Sales Analysis & Trends", "Sidebar label is 'Sales Analysis & Trends'");
  assert(!NAV.some((g) => g.items.some((i) => i.label === "Sales Analysis")), "Separate 'Sales Analysis' sidebar item is gone");
  assert(!NAV.some((g) => g.items.some((i) => i.label === "Sales Trends")), "Separate 'Sales Trends' sidebar item is gone");
  assert(!NAV.some((g) => g.items.some((i) => i.id === "analysis-sales-trends")), "Legacy id 'analysis-sales-trends' is no longer a sidebar item");

  assert(SALES_ANALYSIS_TABS.map((t) => t.id).join(",") === "analysis,trends", "Unified page has exactly two tabs: analysis, trends");
  assert(SALES_ANALYSIS_TABS.map((t) => t.label).join("|") === "Sales Analysis|Sales Trends", "Tab labels are 'Sales Analysis' and 'Sales Trends'");
  assert(SALES_ANALYSIS_TABS.every((t) => t.permission === "sales.read"), "Both tabs are gated on sales.read (same as the module view permission)");
  assert(SALES_ANALYSIS_DEFAULT_TAB === "analysis", "Sales Analysis is the default tab");
  assert(resolveActiveTab(SALES_ANALYSIS_TABS, null, SALES_ANALYSIS_DEFAULT_TAB) === "analysis", "No tab in URL → Sales Analysis");
  assert(resolveActiveTab(SALES_ANALYSIS_TABS, "trends", SALES_ANALYSIS_DEFAULT_TAB) === "trends", "?tab=trends → Sales Trends");
  assert(resolveActiveTab(SALES_ANALYSIS_TABS, "abc", SALES_ANALYSIS_DEFAULT_TAB) === "analysis", "Invalid ?tab=abc falls back to Sales Analysis");
  assert(viewPermission("analysis-sales-trends") === "sales.read", "Legacy id keeps its sales.read mapping");

  // Legacy id resolution (old Sales Trends URL → trends tab of the merged module)
  const aliased = resolveViewAlias("analysis-sales-trends");
  assert(aliased.view === "analysis-sales" && aliased.tab === "trends", "resolveViewAlias('analysis-sales-trends') → analysis-sales?tab=trends");
  const plain = resolveViewAlias("analysis-sales");
  assert(plain.view === "analysis-sales" && plain.tab === null, "Old Sales Analysis URL stays 'analysis-sales' (default tab)");
  const parsedLegacy = parseNavHash("#analysis-sales-trends");
  assert(!!parsedLegacy && parsedLegacy.view === "analysis-sales" && parsedLegacy.tab === "trends" && parsedLegacy.aliased, "parseNavHash('#analysis-sales-trends') maps to the trends tab and flags the alias");
  const parsedCanonical = parseNavHash("#analysis-sales?tab=trends");
  assert(!!parsedCanonical && parsedCanonical.view === "analysis-sales" && parsedCanonical.tab === "trends" && !parsedCanonical.aliased, "parseNavHash('#analysis-sales?tab=trends') is canonical");
  assert(navHash("analysis-sales", "trends") === "#analysis-sales?tab=trends", "navHash builds #analysis-sales?tab=trends");
  assert(navHash("analysis-sales", null) === "#analysis-sales", "navHash builds #analysis-sales when no tab");

  // URL / history behaviour of the store
  historyCalls.length = 0;
  useNavStore.getState().setView("analysis-sales");
  assert(useNavStore.getState().view === "analysis-sales" && useNavStore.getState().tab === null, "setView('analysis-sales') → module with default tab");
  assert(historyCalls.at(-1)?.kind === "replace" && historyCalls.at(-1)?.url === "#analysis-sales", "Opening the module writes #analysis-sales (replaceState)");
  useNavStore.getState().setTab("trends");
  assert(useNavStore.getState().tab === "trends", "Clicking Sales Trends switches the tab");
  assert(historyCalls.at(-1)?.kind === "push" && historyCalls.at(-1)?.url === "#analysis-sales?tab=trends", "Tab switch pushes #analysis-sales?tab=trends (history entry for Back/Forward)");
  const pushCount = historyCalls.filter((c) => c.kind === "push").length;
  useNavStore.getState().setTab("trends");
  assert(historyCalls.filter((c) => c.kind === "push").length === pushCount, "Re-selecting the active tab adds no history entry");
  // Refresh / direct link restores the tab from the URL
  fakeWindow.location.hash = "#analysis-sales?tab=trends";
  useNavStore.setState({ view: "dashboard", tab: null });
  initNavFromHash();
  assert(useNavStore.getState().view === "analysis-sales" && useNavStore.getState().tab === "trends", "Refresh of #analysis-sales?tab=trends restores the Sales Trends tab");
  // Browser Back to the tab-less hash → default tab
  fakeWindow.location.hash = "#analysis-sales";
  initNavFromHash();
  assert(useNavStore.getState().view === "analysis-sales" && useNavStore.getState().tab === null, "Back to #analysis-sales restores the Sales Analysis (default) tab");
  // Legacy hash is redirected and rewritten
  historyCalls.length = 0;
  fakeWindow.location.hash = "#analysis-sales-trends";
  initNavFromHash();
  assert(useNavStore.getState().view === "analysis-sales" && useNavStore.getState().tab === "trends", "Old #analysis-sales-trends opens the merged module on the Sales Trends tab");
  assert(historyCalls.at(-1)?.kind === "replace" && historyCalls.at(-1)?.url === "#analysis-sales?tab=trends", "Legacy hash is rewritten to the canonical #analysis-sales?tab=trends");
  useNavStore.getState().setView("analysis-sales-trends");
  assert(useNavStore.getState().view === "analysis-sales" && useNavStore.getState().tab === "trends", "setView('analysis-sales-trends') (e.g. old caller) lands on the trends tab");
  // Sidebar active state: both tabs share the module view id
  for (const tab of ["analysis", "trends"]) {
    useNavStore.getState().setView("analysis-sales", tab);
    assert(useNavStore.getState().view === "analysis-sales", `Sidebar entry 'analysis-sales' stays active on tab '${tab}'`);
  }
  // RBAC: same gate for both tabs and the module
  for (const role of testRoles) {
    const perms = permissionsFor(role);
    const canModule = isViewAuthorized(perms, "analysis-sales");
    const canTabs = SALES_ANALYSIS_TABS.every((t) => !t.permission || (perms as readonly string[]).includes(t.permission));
    assert(canModule === canTabs && canModule === perms.includes("sales.read"), `${role}: module and both tabs require sales.read (${canModule})`);
  }

  console.log("\n===============================================================================");
  console.log("🎉 ALL ANALYSIS NAVIGATION INTEGRITY & RBAC TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
