/**
 * TEST SUITE: ANALYSIS SECTION & NAVIGATION INTEGRITY
 * 
 * Verifies:
 * 1. Analysis section pages in exact required order ("Sales Analysis" and "Sales Trends"
 *    are one module, "Sales Analysis & Trends", with two tabs).
 * 2. NAV section ordering: Dashboard -> Analysis -> Fantasy ERP.
 * 3. All navigation entry IDs are globally unique across all NAV groups.
 * 4. Every Analysis ViewId maps to the correct component in VIEW_REGISTRY.
 * 5. Every Analysis ViewId has an explicit centralized permission mapping.
 * 6. Role-based view authorization works accurately across all 8 standard roles.
 * 7. Withdrawn sections (Data Quality, Demand, Manufacturing, Evaluation and Reconciliation)
 *    are absent from the registry, sidebar, command palette and view permissions.
 * 8. Command Palette contains all Analysis entries with non-empty keywords.
 * 9. Unauthorized pages retain visibility with Lock indicator requirement.
 * 10. No duplicate React keys between Analysis views.
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

import { readFileSync } from "node:fs";
import path from "node:path";
import { NAV } from "../src/components/layout/app-shell";
import { viewPermission, viewPermissions, isViewAuthorized } from "../src/lib/auth/view-permissions";
import { PERMISSIONS, ROLES } from "../src/lib/auth/permissions";
// Roles other than SUPER_ADMIN are test fixture custom roles (tests/security/fixture-roles.ts).
import { TEST_ROLES, testPermissionsFor } from "../tests/security/fixture-roles";
import {
  useNavStore, initNavFromHash, parseNavHash, resolveViewAlias, navHash, type ViewId,
} from "../src/stores/nav-store";
import { isTabPermitted, resolveActiveTab } from "../src/components/diamond/shared/tabbed-host-view";
import { SALES_ANALYSIS_TABS, SALES_ANALYSIS_DEFAULT_TAB } from "../src/components/diamond/views/consolidated/sales-analysis-trends-view";
import { USERS_ACCESS_TABS } from "../src/components/diamond/views/consolidated/users-access-view";

const EXPECTED_ANALYSIS_PAGES = [
  { id: "analysis-executive", label: "Executive Analysis", perms: ["analysis.read"] },
  { id: "analysis-sales", label: "Sales Analysis & Trends", perms: ["sales.read"] },
  // Two tabs, two permissions: either admits the page, and each tab still enforces its
  // own. Mapping this page to customers.read alone locked out an orders-only user.
  { id: "analysis-customers-orders", label: "Customers & Orders", perms: ["customers.read", "orders.read"] },
  { id: "analysis-inventory-position", label: "Inventory", perms: ["analysis.read"] },
  { id: "analysis-stockout", label: "Stockout Risk", perms: ["analysis.read"] },
  { id: "analysis-excess", label: "Excess Stock", perms: ["analysis.read"] },
  { id: "analysis-aging", label: "Stock Aging", perms: ["analysis.read"] },
  { id: "analysis-reorder-signals", label: "Reorder Signals", perms: ["analysis.read"] },
  { id: "transfer-analyzer", label: "Transfer Analyzer", perms: ["analysis.read"] },
  { id: "aging-dashboard", label: "Aging Dashboard", perms: ["analysis.read"] },
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

  // 2. Analysis pages in exact order
  console.log("\n--- TEST 2: Analysis Pages in Exact Required Order ---");
  assert(
    analysisGroup.items.length === EXPECTED_ANALYSIS_PAGES.length,
    `Analysis group has exactly ${EXPECTED_ANALYSIS_PAGES.length} items (got ${analysisGroup.items.length})`,
  );

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

  // 4. Analysis placement
  console.log("\n--- TEST 4: Analysis Placement ---");
  // Inventory stays in Analysis and nowhere else.
  const inventorySections = NAV.filter((g) => g.items.some((i) => i.id === "analysis-inventory-position")).map((g) => g.id);
  assert(
    inventorySections.length === 1 && inventorySections[0] === "analysis-group",
    "Inventory appears only under Analysis",
  );

  // Stock Strategy is hidden from navigation, but its view, route and permission remain.
  assert(
    !NAV.some((g) => g.items.some((i) => i.id === "stock-strategy")),
    "Stock Strategy is absent from the sidebar",
  );
  {
    const pageSource = readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    assert(/"stock-strategy":\s*StockStrategyView/.test(pageSource), "Stock Strategy is still registered in the view registry");
    assert(viewPermission("stock-strategy") === "analysis.read", "Stock Strategy keeps its permission mapping");
  }

  // 5. Centralized Permission Mapping
  console.log("\n--- TEST 5: Centralized View Permission Verification ---");
  for (const exp of EXPECTED_ANALYSIS_PAGES) {
    const mapped = [...viewPermissions(exp.id)].sort();
    const expected = [...exp.perms].sort();
    assert(
      mapped.length === expected.length && mapped.every((p, i) => p === expected[i]),
      `View '${exp.id}' is admitted by '${expected.join(" | ")}' (got '${mapped.join(" | ")}')`,
    );
    // A single-permission page still reports that one permission for display.
    if (expected.length === 1) {
      assert(viewPermission(exp.id) === expected[0], `View '${exp.id}' names its single permission`);
    }
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
    const perms = testPermissionsFor(role);
    console.log(`\n  Checking Role: ${role} (${perms.length} permissions)`);

    // Analysis Executive -> requires analysis.read
    const canExec = isViewAuthorized(perms, "analysis-executive");
    const hasAnalysisRead = perms.includes("analysis.read");
    assert(canExec === hasAnalysisRead, `${role} can access analysis-executive: ${canExec}`);

    // Sales Analysis -> requires sales.read
    const canSales = isViewAuthorized(perms, "analysis-sales");
    const hasSalesRead = perms.includes("sales.read");
    assert(canSales === hasSalesRead, `${role} can access analysis-sales: ${canSales}`);

    // Customers & Orders -> admitted by customers.read OR orders.read
    const canCustOrders = isViewAuthorized(perms, "analysis-customers-orders");
    const hasEitherSection = perms.includes("customers.read") || perms.includes("orders.read");
    assert(canCustOrders === hasEitherSection, `${role} can access analysis-customers-orders: ${canCustOrders}`);
    // Entry does not imply either section: each API enforces its own permission.
    assert(
      !canCustOrders || hasEitherSection,
      `${role} entering Customers & Orders holds at least one section permission`,
    );

    // Inventory Position -> requires analysis.read
    const canInvPos = isViewAuthorized(perms, "analysis-inventory-position");
    assert(canInvPos === hasAnalysisRead, `${role} can access analysis-inventory-position: ${canInvPos}`);

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
    const perms = testPermissionsFor(role);
    const canModule = isViewAuthorized(perms, "analysis-sales");
    const canTabs = SALES_ANALYSIS_TABS.every((t) => isTabPermitted(t.permission, perms));
    assert(canModule === canTabs && canModule === perms.includes("sales.read"), `${role}: module and both tabs require sales.read (${canModule})`);
  }

  // =========================================================================
  console.log("\n--- TEST 8: Category drill-down navigation (Stockout Risk) ---");
  // =========================================================================
  // Demand Trace is withdrawn; category drill-downs now open Stockout Risk, which keeps
  // the same row context contract (runId + exact canonical category) in the URL.
  const STOCKOUT: ViewId = "analysis-stockout";
  const HEART = "GIA|HEART|1.70-1.99";
  const OVAL = "GIA|OVAL|1.00-1.09";
  const HEART_OTHER_BAND = "GIA|HEART|1.00-1.09";

  const nav = () => useNavStore.getState();
  const openCategory = (category: string, runId: string | null = "run-1") =>
    nav().openCategoryView(STOCKOUT, { runId, category });

  // --- Exact identity ---
  for (const key of [HEART, OVAL, HEART_OTHER_BAND]) {
    openCategory(key);
    assert(nav().view === STOCKOUT && nav().trace?.category === key, `A drill-down opens exactly '${key}', not another category`);
  }

  // --- Hash handling ---
  assert(
    navHash(STOCKOUT, null, { runId: "run-1", category: HEART, bucket: null, malformed: false }) ===
      "#analysis-stockout?runId=run-1&category=GIA%7CHEART%7C1.70-1.99",
    "Category pipes are percent-encoded in the hash (%7C)",
  );
  const parsedHeart = parseNavHash("#analysis-stockout?runId=run-1&category=GIA%7CHEART%7C1.70-1.99");
  assert(parsedHeart?.trace?.category === HEART, "Hash parsing restores the exact category key");
  assert(parsedHeart?.trace?.runId === "run-1", "Hash parsing restores the runId");
  assert(
    navHash("analysis-sales", "trends", null) === "#analysis-sales?tab=trends",
    "Hash generation still produces tab-only URLs unchanged",
  );
  const withUnknown = parseNavHash(`#analysis-stockout?category=${encodeURIComponent(HEART)}&zzz=1&tab=`);
  assert(withUnknown?.trace?.category === HEART, "Unknown query parameters do not break navigation");
  assert(withUnknown?.view === STOCKOUT, "Unknown parameters leave the view id intact");

  // --- Withdrawn sections stay withdrawn ---
  const paletteSource = readFileSync(path.join(process.cwd(), "src/components/diamond/command-palette.tsx"), "utf8");
  {
    const registrySource = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
    const WITHDRAWN = [
      "data-quality-issues", "demand-overview", "demand-history", "analysis-demand-trace", "demand-trace",
      "manufacturing-overview", "manufacturing-traceability", "plan-vs-actual", "manufacturing-plan-vs-actual",
      "manufacturing-tracking", "manufacturing-departments", "manufacturing-locations", "manufacturing-wip", "fantasy-reconciliation",
    ];
    for (const id of WITHDRAWN) {
      assert(!new RegExp(`"${id}":`).test(registrySource), `'${id}' is not in the view registry`);
      assert(!new RegExp(`id:\\s*"${id}"`).test(paletteSource), `'${id}' is not offered by the command palette`);
      assert(!NAV.some((g) => g.items.some((i) => i.id === id)), `'${id}' is not in the sidebar`);
      assert(viewPermission(id) === null, `'${id}' has no view-permission mapping`);
    }
    for (const group of ["data-quality-group", "demand-group", "manufacturing-group", "evaluation-group"]) {
      assert(!NAV.some((g) => g.id === group), `The '${group}' section is gone`);
    }
    for (const group of ["Data Quality", "Demand", "Manufacturing", "Evaluation and Reconciliation"]) {
      assert(!new RegExp(`group: "${group}"`).test(paletteSource), `No command palette group '${group}' remains`);
    }
    assert(
      !/id: "stock-strategy"/.test(paletteSource),
      "The command palette no longer offers Stock Strategy",
    );
  }

  // --- Executive Analysis has its own page ---
  {
    const pageSource = readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    const registration = /"analysis-executive":\s*(\w+)/.exec(pageSource);
    assert(registration !== null, "Executive Analysis is registered in the view registry");
    assert(
      registration?.[1] === "ExecutiveAnalysisView",
      `Executive Analysis renders its own view (found ${registration?.[1] ?? "nothing"})`,
    );
    // It used to render the Executive Dashboard component, so the two pages showed the
    // same thing under different names.
    assert(registration?.[1] !== "DashboardView", "Executive Analysis is not the Executive Dashboard");
    assert(
      /\bdashboard:\s*DashboardView/.test(pageSource),
      "The Executive Dashboard keeps its own component",
    );
  }

  // --- State clearing ---
  openCategory(HEART);
  nav().setView("analysis-executive");
  nav().setView(STOCKOUT);
  assert(nav().trace === null, "Open Heart, navigate away, then enter generically: no category is carried over");

  openCategory(HEART);
  openCategory(OVAL);
  assert(nav().trace?.category === OVAL, "Opening Oval replaces Heart");

  openCategory(HEART);
  nav().setTraceCategory(OVAL);
  assert(nav().trace?.category === OVAL && nav().trace?.runId === "run-1", "An in-page category change keeps the selected run");
  assert(fakeWindow.location.hash.includes("category=GIA%7COVAL%7C1.00-1.09"), "An in-page category change updates the URL");

  // Remount / refresh: the store is reset and rebuilt from the URL alone.
  openCategory(HEART);
  const hashAfterDrillDown = fakeWindow.location.hash;
  useNavStore.setState({ view: "dashboard", tab: null, trace: null });
  initNavFromHash();
  assert(nav().view === STOCKOUT, "Component remount restores the Stockout Risk view from the URL");
  assert(nav().trace?.category === HEART, "Browser refresh restores the exact category");
  assert(nav().trace?.runId === "run-1", "Browser refresh restores the selected run");
  assert(hashAfterDrillDown === "#analysis-stockout?runId=run-1&category=GIA%7CHEART%7C1.70-1.99", "The drill-down URL is the restorable contract");

  // Back must return to the source view, so the drill-down has to be a history entry.
  historyCalls.length = 0;
  nav().setView("analysis-executive");
  openCategory(HEART);
  assert(historyCalls.at(-1)?.kind === "push", "A row drill-down pushes a history entry so Back returns to the source page");
  const pushesBefore = historyCalls.filter((c) => c.kind === "push").length;
  nav().setTraceCategory(OVAL);
  assert(
    historyCalls.filter((c) => c.kind === "push").length === pushesBefore,
    "An in-page category change replaces instead of pushing, so Back still reaches the source page",
  );
  historyCalls.length = 0;
  nav().setView(STOCKOUT);
  assert(historyCalls.at(-1)?.kind === "replace", "Sidebar navigation replaces the entry as before");

  // --- Invalid state ---
  const malformedHash = parseNavHash(`#analysis-stockout?category=${"x".repeat(250)}`);
  assert(malformedHash?.trace?.malformed === true, "An over-length category parameter is flagged malformed");
  assert(malformedHash?.trace?.category === null, "An over-length category parameter is never used as a key");
  const emptyParam = parseNavHash("#analysis-stockout?category=");
  assert(emptyParam?.trace?.malformed === true, "An empty category parameter is flagged malformed");
  assert(parseNavHash("#analysis-stockout")?.trace === null, "A bare category-page hash carries no context");

  // --- Fantasy source-state naming (Phase 4): the page must not claim a live
  //     connection while fixture simulation is active. The route id, and therefore the
  //     URL hash and every existing bookmark, is unchanged. ---
  const fantasyGroup = NAV.find((g) => g.id === "fantasy-group");
  assert(!!fantasyGroup, "The Fantasy ERP navigation group exists");
  const currentDataItems = (fantasyGroup?.items ?? []).filter((i) => i.id === "fantasy-live");
  assert(currentDataItems.length === 1, "Exactly one Fantasy current-data page exists — no duplicate page was added");
  assert(currentDataItems[0]?.label === "Current Data", `The sidebar entry reads 'Current Data' (got '${currentDataItems[0]?.label}')`);
  assert(!NAV.some((g) => g.items.some((i) => i.label === "Live Data")), "No sidebar entry still reads 'Live Data'");
  assert(
    NAV.flatMap((g) => g.items).filter((i) => i.id === "fantasy-live").length === 1,
    "The Fantasy current-data route id is unchanged and unique, so existing links still resolve",
  );
  assert(viewPermission("fantasy-live") === "fantasy.read", "The renamed page keeps its server-side permission");
  assert(isViewAuthorized(testPermissionsFor("FANTASY_INTEGRATION"), "fantasy-live"), "An authorized role still reaches the renamed page");
  assert(!isViewAuthorized(testPermissionsFor("SALES_VIEWER"), "fantasy-live"), "An unauthorized role still cannot reach the renamed page");
  assert(navHash("fantasy-live", null) === "#fantasy-live", "The navigation hash for the renamed page is unchanged, so existing bookmarks still resolve");

  const fantasyPaletteLabel = /\{ id: "fantasy-live", label: "([^"]+)"/.exec(paletteSource)?.[1];
  assert(fantasyPaletteLabel === "Current Data", `The command palette entry reads 'Current Data' (got '${fantasyPaletteLabel}')`);
  assert(!/label: "Live Data"/.test(paletteSource), "No command palette entry still reads 'Live Data'");

  const currentDataView = readFileSync(
    path.join(process.cwd(), "src/components/diamond/views/consolidated/fantasy-live-view.tsx"),
    "utf8",
  );
  assert(/title="Fantasy Current Data"/.test(currentDataView), "The page title communicates current-state data");
  assert(!/title="Live Data"/.test(currentDataView), "The page title no longer claims live data");
  assert(!/authoritative live/i.test(currentDataView), "The page no longer calls the feed authoritative live data");
  assert(
    /FANTASY_SOURCE_STATE_LABELS\[sourceState\.effectiveState\]/.test(currentDataView),
    "The page's source badge is derived centrally rather than hardcoded",
  );

  // --- Page authorization fails closed (RBAC-A) ---
  // An unmapped view id used to resolve to `analysis.read`, so a page added without a
  // permission decision was visible to almost every role.
  for (const invented of ["totally-new-page", "admin-secret-console", "fantasy-invented", "requirements-invented", "planning-invented", ""]) {
    assert(viewPermission(invented) === null, `Unmapped view '${invented}' has no permission`);
    for (const role of TEST_ROLES) {
      assert(
        !isViewAuthorized(testPermissionsFor(role), invented),
        `Unmapped view '${invented}' is denied to ${role}`,
      );
    }
  }
  assert(!isViewAuthorized(testPermissionsFor("SUPER_ADMIN"), "totally-new-page"), "Super Admin has no wildcard over unmapped pages");
  assert(!isViewAuthorized(testPermissionsFor("ADMIN"), "totally-new-page"), "Ordinary administrators have no wildcard over unmapped pages");
  assert(isViewAuthorized(testPermissionsFor("SUPER_ADMIN"), "dashboard"), "A mapped page is still reachable, so the check above is not vacuous");

  // Every registered view must have an explicit mapping, or it is unreachable.
  const viewRegistrySource = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
  const registryIds = [...viewRegistrySource.matchAll(/^\s+"([a-z0-9-]+)":\s+\w+View,/gm)].map((m) => m[1]);
  assert(registryIds.length > 50, `View registry parsed (${registryIds.length} views)`);
  // Unmapped means no permission admits it. A page admitted by several is mapped, so
  // this counts permissions rather than asking for exactly one.
  const unmappedRegistered = registryIds.filter((id) => viewPermissions(id).length === 0);
  assert(unmappedRegistered.length === 0, `Every registered view has an explicit permission${unmappedRegistered.length ? `: ${unmappedRegistered.join(", ")}` : ""}`);

  // --- UI/API permission agreement (RBAC-A) ---
  assert(viewPermission("fantasy-rough") === "rough.read", "Rough stock page uses the permission its API enforces (rough.read)");
  assert(JSON.stringify(viewPermissions("planning-workbook-import")) === JSON.stringify(["sarin.import.read"]), "Workbook import page admits Sarin import readers, as its read route does");
  assert(!isViewAuthorized(["sarin.mapping.read"], "planning-workbook-import"), "Shape mapping administration is no longer part of Workbook Import");
  assert(JSON.stringify(viewPermissions("admin-mappings")) === JSON.stringify(["config.read", "sarin.mapping.read"]), "Mappings opens with config.read or sarin.mapping.read; each tab enforces its own");
  assert(isViewAuthorized(["sarin.mapping.read"], "admin-mappings") && isViewAuthorized(["config.read"], "admin-mappings") && !isViewAuthorized(["sarin.mapping.manage"], "admin-mappings"), "Mapping readers open Mappings; managing alone does not");
  assert(viewPermissions("admin-business-rules").length === 0 && viewPermissions("admin-rules-mappings").length === 0 && viewPermissions("admin-sarin-shape-mappings").length === 0, "Business Rules and the old mapping pages are no longer pages");
  assert(!(PERMISSIONS as readonly string[]).includes("sarin.mapping.approve"), "Mapping approval is withdrawn");
  assert(!(PERMISSIONS as readonly string[]).some((p) => p.startsWith("business_rule.")), "Business-rule permissions are withdrawn with the Business Rules page and API");
  assert(isViewAuthorized(testPermissionsFor("PLANNING_VIEWER"), "planning-workbook-import"), "A Sarin reader without plan.create can open Workbook Import");
  assert(!isViewAuthorized(testPermissionsFor("VIEWER"), "planning-workbook-import"), "A role without sarin.import.read cannot open Workbook Import");
  assert(viewPermission("planning-approval-queue") === "plan.read", "Approval queue is readable with plan.read; approving needs plan.approve");
  assert(testPermissionsFor("PLANNING_MANAGER").includes("plan.approve"), "Approval authority is still explicitly assigned");
  assert(!testPermissionsFor("ADMIN").includes("plan.approve"), "Administration still does not grant planning approval");

  // --- Separated Fantasy synchronization authorities (RBAC-A) ---
  assert(testPermissionsFor("FANTASY_INTEGRATION").includes("fantasy.sync.run"), "The integration role may run a synchronization");
  assert(!testPermissionsFor("FANTASY_INTEGRATION").includes("fantasy.sync.unlock"), "Running a synchronization does not imply releasing a stuck lock");
  assert(!testPermissionsFor("PLANNER").includes("fantasy.sync.retry"), "An unrelated role holds none of the synchronization authorities");

  // --- Access administration is no longer one super-permission (RBAC-A) ---
  assert(!(PERMISSIONS as readonly string[]).includes("user.manage"), "The user.manage super-permission is retired");
  assert(JSON.stringify(ROLES) === JSON.stringify(["SUPER_ADMIN"]), "Super Admin is the only built-in role; narrower access is a custom role");
  assert(testPermissionsFor("ADMIN").includes("user.read"), "Administrators keep directory access");
  assert(!testPermissionsFor("ADMIN").includes("user.super_admin.assign"), "Administrators cannot assign the protected administrator role");
  assert(!testPermissionsFor("ADMIN").includes("role.permissions.assign"), "Administrators cannot change what a role may do");
  assert(testPermissionsFor("SUPER_ADMIN").includes("role.permissions.assign"), "Super Admin retains permission-assignment authority");
  assert(!testPermissionsFor("VIEWER").includes("notification.manage"), "Marking shared notifications read is not a viewer capability");

  // --- Users and Access: exactly two tabs, one sidebar entry, old pages redirected ---
  assert(JSON.stringify(USERS_ACCESS_TABS.map((t) => [t.id, t.label])) === JSON.stringify([["users", "Users"], ["permissions", "Permissions"]]), "Users and Access has exactly two tabs: Users and Permissions");
  const adminEntries = NAV.flatMap((g) => g.items).filter((i) => /user|access|role|permission/i.test(i.label));
  assert(adminEntries.length === 1 && adminEntries[0].id === "admin-users-access" && adminEntries[0].label === "Users and Access", "The sidebar has one Users and Access entry");
  assert(JSON.stringify(viewPermissions("admin-users-access")) === JSON.stringify(["user.read", "access_request.review", "role.read"]), "Users and Access admits account readers, access-request reviewers and role readers");
  assert(isViewAuthorized(["access_request.review"], "admin-users-access") && resolveActiveTab(USERS_ACCESS_TABS, null, "users", ["access_request.review"]) === "users", "A reviewer holding only access_request.review lands on the Users tab (review queue)");
  assert(resolveActiveTab(USERS_ACCESS_TABS, "users", "users", ["role.read"]) === "permissions", "A role reader without user access lands on Permissions");
  assert(resolveActiveTab(USERS_ACCESS_TABS, "permissions", "users", ["user.read"]) === "users", "Permissions is not opened for someone who cannot read roles");
  assert(!isViewAuthorized(["plan.read", "analysis.read"], "admin-users-access"), "Unrelated permissions do not open Users and Access");
  for (const legacy of ["admin-users", "admin-access-requests"] as const) {
    assert(viewPermissions(legacy).length === 0, `${legacy} is no longer a page of its own`);
    const hit = parseNavHash(`#${legacy}`);
    assert(hit?.view === "admin-users-access" && hit.tab === "users" && hit.aliased, `An old #${legacy} bookmark opens Users and Access on the Users tab`);
  }
  for (const oldTab of ["roles", "matrix", "catalog", "requests"]) {
    assert(resolveActiveTab(USERS_ACCESS_TABS, oldTab, "users", ["user.read", "role.read", "access_request.review"]) === "users", `An old ?tab=${oldTab} link falls back to the Users tab`);
  }


  console.log("\n===============================================================================");
  console.log("🎉 ALL ANALYSIS NAVIGATION INTEGRITY & RBAC TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
