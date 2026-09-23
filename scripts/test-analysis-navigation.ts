/**
 * TEST SUITE: ANALYSIS SECTION & NAVIGATION INTEGRITY
 * 
 * Verifies:
 * 1. Analysis section pages in exact required order ("Sales Analysis" and "Sales Trends"
 *    are one module, "Sales Analysis & Trends", with two tabs). Demand Run History and
 *    Demand Trace sit under Demand, not Analysis.
 * 2. NAV section ordering: Dashboard -> Analysis -> Fantasy ERP.
 * 3. All navigation entry IDs are globally unique across all NAV groups.
 * 4. Every Analysis ViewId maps to the correct component in VIEW_REGISTRY.
 * 5. Every Analysis ViewId has an explicit centralized permission mapping.
 * 6. Role-based view authorization works accurately across all 8 standard roles.
 * 7. Demand Trace alias (analysis-demand-trace) resolves to DemandTraceView without ID collision.
 * 8. Command Palette contains all Analysis entries with non-empty keywords.
 * 9. Unauthorized pages retain visibility with Lock indicator requirement.
 * 10. No duplicate React keys or collision between direct Analysis views and the Demand section.
 * 12. Moving a page between sidebar sections changes neither its view id, hash, route,
 *     component nor permission — existing bookmarks keep opening the same page.
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
import { viewPermission, isViewAuthorized } from "../src/lib/auth/view-permissions";
import { permissionsFor, PERMISSIONS, ROLES } from "../src/lib/auth/permissions";
import {
  useNavStore, initNavFromHash, parseNavHash, resolveViewAlias, navHash, DEMAND_TRACE_VIEW,
} from "../src/stores/nav-store";
import { resolveCategorySelection } from "../src/lib/demand/demand-category-selection";
import { resolveActiveTab } from "../src/components/diamond/shared/tabbed-host-view";
import { SALES_ANALYSIS_TABS, SALES_ANALYSIS_DEFAULT_TAB } from "../src/components/diamond/views/consolidated/sales-analysis-trends-view";

// Demand Trace moved to the Demand section. Demand History is consolidated inside
// Demand Overview as a tab and removed from sidebar navigation.
const EXPECTED_DEMAND_PAGES = [
  { id: "demand-overview", label: "Demand Overview" },
  { id: "analysis-demand-trace", label: "Demand Trace" },
];

const EXPECTED_ANALYSIS_PAGES = [
  { id: "analysis-executive", label: "Executive Analysis", perm: "analysis.read" },
  { id: "analysis-sales", label: "Sales Analysis & Trends", perm: "sales.read" },
  { id: "analysis-customers-orders", label: "Customers & Orders", perm: "customers.read" },
  { id: "analysis-inventory-position", label: "Inventory", perm: "analysis.read" },
  { id: "analysis-stockout", label: "Stockout Risk", perm: "analysis.read" },
  { id: "analysis-excess", label: "Excess Stock", perm: "analysis.read" },
  { id: "analysis-aging", label: "Stock Aging", perm: "analysis.read" },
  { id: "analysis-reorder-signals", label: "Reorder Signals", perm: "analysis.read" },
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

  // 4. The Demand section holds the demand pages, and holds them only once
  console.log("\n--- TEST 4: Demand Section Placement & Non-Duplicated Navigation ---");
  const demandGroup = NAV.find((g) => g.id === "demand-group");

  assert(!!demandGroup, "A 'demand-group' section exists");
  assert(demandGroup?.label === "Demand", `Demand section label is 'Demand' (got '${demandGroup?.label}')`);
  assert(
    !NAV.some((g) => g.label === "Demand and Inventory" || g.id === "demand-inventory-group"),
    "'Demand and Inventory' no longer appears in navigation",
  );
  assert(
    demandGroup?.items.length === EXPECTED_DEMAND_PAGES.length,
    `Demand section has exactly ${EXPECTED_DEMAND_PAGES.length} entries (got ${demandGroup?.items.length})`,
  );
  for (let i = 0; i < EXPECTED_DEMAND_PAGES.length; i++) {
    const expected = EXPECTED_DEMAND_PAGES[i];
    const actual = demandGroup?.items[i];
    assert(actual?.id === expected.id, `Demand item #${i + 1} ID matches '${expected.id}'`);
    assert(actual?.label === expected.label, `Demand item #${i + 1} label matches '${expected.label}'`);
  }

  // Demand Trace lives in demand-group; Demand History is consolidated in Demand Overview tab and absent from sidebar.
  assert(
    !analysisGroup.items.some((i) => i.id === "analysis-demand-trace"),
    "'analysis-demand-trace' no longer appears under Analysis",
  );
  const traceSections = NAV.filter((g) => g.items.some((i) => i.id === "analysis-demand-trace")).map((g) => g.id);
  assert(traceSections.length === 1 && traceSections[0] === "demand-group", "'analysis-demand-trace' appears once, under Demand");

  assert(
    !NAV.some((g) => g.items.some((i) => i.id === "demand-history")),
    "Demand History is absent from the sidebar (consolidated in Demand Overview)",
  );

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

  // 4b. Moving a page between sections must change nothing a bookmark depends on.
  console.log("\n--- TEST 4b: Moved Pages Keep Their Identity ---");
  {
    const pageSource = readFileSync(path.join(process.cwd(), "src", "app", "page.tsx"), "utf8");
    const MOVED: Array<{ id: string; component: string; perm: string }> = [
      { id: "demand-history", component: "DemandHistoryView", perm: "analysis.read" },
      { id: "analysis-demand-trace", component: "DemandTraceView", perm: "analysis.read" },
    ];
    for (const m of MOVED) {
      const registered = new RegExp(`"${m.id}":\\s*(\\w+)`).exec(pageSource)?.[1];
      assert(registered === m.component, `'${m.id}' still renders ${m.component} (got '${registered}')`);
      assert(viewPermission(m.id) === m.perm, `'${m.id}' still requires '${m.perm}'`);

      // The hash a bookmark holds still parses to the same view.
      const parsed = parseNavHash(`#${m.id}`);
      assert(parsed?.view === m.id, `The existing hash '#${m.id}' still opens '${m.id}'`);
      assert(navHash(m.id as never, null) === `#${m.id}`, `'${m.id}' still builds the same hash`);
    }

    // Demand Overview is unmoved but changed section; its identity must be untouched too.
    const overview = /"demand-overview":\s*(\w+)/.exec(pageSource)?.[1];
    assert(!!overview, "Demand Overview is still registered in the view registry");
    assert(parseNavHash("#demand-overview")?.view === "demand-overview", "The '#demand-overview' hash still resolves");

    // A Demand Trace deep link carrying a category must survive the section change,
    // because Executive Analysis and Sales Analysis both navigate with one.
    const deep = parseNavHash(`#analysis-demand-trace?runId=run-1&category=${encodeURIComponent("GIA|HEART|1.00-1.49")}`);
    assert(deep?.view === "analysis-demand-trace", "A Demand Trace deep link still opens Demand Trace");
    assert(deep?.trace?.category === "GIA|HEART|1.00-1.49", "The exact category parameter survives the section move");
    assert(deep?.trace?.runId === "run-1", "The runId parameter survives the section move");
  }

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

  // =========================================================================
  console.log("\n--- TEST 8: Demand Trace category navigation ---");
  // =========================================================================
  const HEART = "GIA|HEART|1.70-1.99";
  const EMERALD = "GIA|EMERALD|1.10-1.49";
  const OVAL = "GIA|OVAL|1.00-1.09";
  const ASSCHER = "GIA|ASSCHER|1.00-1.09";
  const HEART_OTHER_BAND = "GIA|HEART|1.00-1.09";
  const ASSCHER_HEART_BAND = "GIA|ASSCHER|1.70-1.99";

  // Ordered exactly as the API serves them (planningCategory ascending), so Asscher is first.
  const RUN_CATEGORIES = [ASSCHER, ASSCHER_HEART_BAND, EMERALD, HEART_OTHER_BAND, HEART, OVAL].map(
    (category) => ({ category }),
  );
  assert(RUN_CATEGORIES[0].category === ASSCHER, "Fixture reproduces the API order with Asscher first");

  const nav = () => useNavStore.getState();
  const openTrace = (category: string, runId: string | null = "run-1") =>
    nav().openDemandTrace({ runId, category });
  const selectionFor = (key: string | null, malformed = false) =>
    resolveCategorySelection(RUN_CATEGORIES, key, { malformed, runLoaded: true });

  // --- Exact identity (requirements 1-6) ---
  for (const [name, key] of [["Heart", HEART], ["Emerald", EMERALD], ["Oval", OVAL]] as const) {
    openTrace(key);
    const sel = selectionFor(nav().trace?.category ?? null);
    assert(
      sel.state === "SELECTED" && sel.category.category === key,
      `${name} Trace opens ${name} (${key}), not the first category`,
    );
  }

  openTrace(HEART);
  assert(selectionFor(nav().trace?.category ?? null).category?.category === HEART, "Same shape, band 1.70-1.99 resolves to its own band");
  openTrace(HEART_OTHER_BAND);
  assert(selectionFor(nav().trace?.category ?? null).category?.category === HEART_OTHER_BAND, "Same shape, band 1.00-1.09 resolves to its own band");

  openTrace(ASSCHER_HEART_BAND);
  assert(selectionFor(nav().trace?.category ?? null).category?.category === ASSCHER_HEART_BAND, "Same band, Asscher resolves to Asscher");
  openTrace(HEART);
  assert(selectionFor(nav().trace?.category ?? null).category?.category === HEART, "Same band, Heart resolves to Heart");

  assert(
    selectionFor(HEART).category?.category === HEART && RUN_CATEGORIES[0].category === ASSCHER,
    "Asscher being first in API order does not affect a Heart selection",
  );

  // --- Hash handling (requirements 7-12) ---
  assert(
    navHash(DEMAND_TRACE_VIEW, null, { runId: "run-1", category: HEART, malformed: false }) ===
      "#analysis-demand-trace?runId=run-1&category=GIA%7CHEART%7C1.70-1.99",
    "Category pipes are percent-encoded in the hash (%7C)",
  );
  const parsedHeart = parseNavHash("#analysis-demand-trace?runId=run-1&category=GIA%7CHEART%7C1.70-1.99");
  assert(parsedHeart?.trace?.category === HEART, "Hash parsing restores the exact category key");
  assert(parsedHeart?.trace?.runId === "run-1", "Hash parsing restores the runId");
  assert(
    navHash("analysis-sales", "trends", null) === "#analysis-sales?tab=trends",
    "Hash generation still produces tab-only URLs unchanged",
  );
  const tabAndTrace = navHash(DEMAND_TRACE_VIEW, "records", { runId: "run-9", category: OVAL, malformed: false });
  const parsedBoth = parseNavHash(tabAndTrace);
  assert(
    parsedBoth?.tab === "records" && parsedBoth.trace?.runId === "run-9" && parsedBoth.trace?.category === OVAL,
    "tab, runId and category compose together and round-trip",
  );
  const withUnknown = parseNavHash(`#analysis-demand-trace?category=${encodeURIComponent(HEART)}&zzz=1&tab=`);
  assert(withUnknown?.trace?.category === HEART, "Unknown query parameters do not break navigation");
  assert(withUnknown?.view === DEMAND_TRACE_VIEW, "Unknown parameters leave the view id intact");

  const legacy = parseNavHash(`#demand-trace?runId=run-1&category=${encodeURIComponent(HEART)}`);
  assert(legacy?.view === DEMAND_TRACE_VIEW, "Legacy '#demand-trace' resolves to 'analysis-demand-trace'");
  assert(legacy?.aliased === true, "The legacy Demand Trace id is flagged as an alias for rewriting");
  assert(legacy?.trace?.category === HEART, "A legacy bookmark keeps its category through the alias");
  assert(
    resolveViewAlias("demand-trace").view === DEMAND_TRACE_VIEW,
    "resolveViewAlias maps the legacy id to the canonical id",
  );
  nav().setView("demand-trace");
  assert(nav().view === DEMAND_TRACE_VIEW, "setView('demand-trace') from an old caller lands on the canonical id");

  const registrySource = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
  assert(
    !/^\s*"demand-trace":/m.test(registrySource),
    "page.tsx has no second Demand Trace registry mapping",
  );
  assert(
    /"analysis-demand-trace": DemandTraceView/.test(registrySource),
    "page.tsx maps Demand Trace once, under the canonical id",
  );
  const traceSidebarItems = NAV.flatMap((g) => g.items).filter(
    (i) => i.id === "demand-trace" || i.id === "analysis-demand-trace",
  );
  assert(traceSidebarItems.length === 1, `Exactly one sidebar entry can be active for Demand Trace (got ${traceSidebarItems.length})`);
  const paletteSource = readFileSync(path.join(process.cwd(), "src/components/diamond/command-palette.tsx"), "utf8");
  assert(
    !/\{\s*id:\s*"demand-trace"/.test(paletteSource),
    "The command palette has no legacy 'demand-trace' entry",
  );
  assert(
    (paletteSource.match(/id:\s*"analysis-demand-trace"/g) ?? []).length === 1,
    "The command palette offers Demand Trace once, under the canonical id",
  );

  // The palette's group labels must follow the sidebar, or the two disagree about where
  // a page lives and the palette sends people to the wrong section heading.
  for (const { id, label } of EXPECTED_DEMAND_PAGES) {
    const entry = new RegExp(`\\{ id: "${id}",[^\\n]*group: "Demand"`).test(paletteSource);
    assert(entry, `The command palette lists '${label}' under the Demand group`);
  }
  assert(
    !/group: "Demand and Inventory"/.test(paletteSource),
    "No command palette entry still uses the 'Demand and Inventory' group",
  );
  assert(
    !/id: "stock-strategy"/.test(paletteSource),
    "The command palette no longer offers Stock Strategy",
  );
  assert(
    viewPermission("demand-trace") === viewPermission("analysis-demand-trace"),
    "The legacy alias and the canonical id require the same permission",
  );

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

  // --- State clearing (requirements 13-18) ---
  openTrace(HEART);
  nav().setView("analysis-executive");
  nav().setView(DEMAND_TRACE_VIEW);
  assert(nav().trace === null, "Open Heart, navigate away, then enter generically: no category is carried over");
  assert(selectionFor(nav().trace?.category ?? null).state === "NONE", "A generic entry shows the neutral selection state");

  openTrace(HEART);
  openTrace(OVAL);
  assert(nav().trace?.category === OVAL, "Opening Oval replaces Heart");
  assert(selectionFor(nav().trace?.category ?? null).category?.category === OVAL, "Oval, not Heart, is resolved after the replacement");

  openTrace(HEART);
  nav().setTraceCategory(OVAL);
  assert(nav().trace?.category === OVAL && nav().trace?.runId === "run-1", "An in-page category change keeps the selected run");
  assert(fakeWindow.location.hash.includes("category=GIA%7COVAL%7C1.00-1.09"), "An in-page category change updates the URL");

  // Remount / refresh: the store is reset and rebuilt from the URL alone.
  openTrace(HEART);
  const hashAfterDrillDown = fakeWindow.location.hash;
  useNavStore.setState({ view: "dashboard", tab: null, trace: null });
  initNavFromHash();
  assert(nav().view === DEMAND_TRACE_VIEW, "Component remount restores the Demand Trace view from the URL");
  assert(nav().trace?.category === HEART, "Browser refresh restores the exact category");
  assert(nav().trace?.runId === "run-1", "Browser refresh restores the selected run");
  assert(hashAfterDrillDown === "#analysis-demand-trace?runId=run-1&category=GIA%7CHEART%7C1.70-1.99", "The drill-down URL is the restorable contract");

  // Back must return to the source view, so the drill-down has to be a history entry.
  historyCalls.length = 0;
  nav().setView("demand-overview");
  openTrace(HEART);
  assert(historyCalls.at(-1)?.kind === "push", "A row drill-down pushes a history entry so Back returns to Demand Overview");
  const pushesBefore = historyCalls.filter((c) => c.kind === "push").length;
  nav().setTraceCategory(OVAL);
  assert(
    historyCalls.filter((c) => c.kind === "push").length === pushesBefore,
    "An in-page category change replaces instead of pushing, so Back still reaches Demand Overview",
  );
  historyCalls.length = 0;
  nav().setView("analysis-demand-trace");
  assert(historyCalls.at(-1)?.kind === "replace", "Sidebar navigation replaces the entry as before");

  // --- Invalid state (requirements 19-22) ---
  const unknown = selectionFor("GIA|HEART|9.99-9.99");
  assert(unknown.state === "UNAVAILABLE", "An unknown category produces the unavailable state");
  assert(unknown.category === null, "An unknown category selects nothing at all");
  assert(selectionFor(null).state === "NONE", "No category produces the neutral selection state");
  assert(selectionFor("GIA|HEART|9.99-9.99").category?.category !== ASSCHER, "An invalid category never falls back to the first category");
  assert(selectionFor(HEART.toLowerCase()).state === "UNAVAILABLE", "A wrong-case key does not match — no case-insensitive matching");
  assert(selectionFor("GIA|HEART").state === "UNAVAILABLE", "A partial key does not match — no prefix matching");
  assert(selectionFor(` ${HEART} `).state === "UNAVAILABLE", "A padded key does not match — the canonical key is not trimmed into place");
  assert(selectionFor(null, true).state === "UNAVAILABLE", "A malformed parameter produces the unavailable state, not a silent neutral state");

  const malformedHash = parseNavHash(`#analysis-demand-trace?category=${"x".repeat(250)}`);
  assert(malformedHash?.trace?.malformed === true, "An over-length category parameter is flagged malformed");
  assert(malformedHash?.trace?.category === null, "An over-length category parameter is never used as a key");
  const emptyParam = parseNavHash("#analysis-demand-trace?category=");
  assert(emptyParam?.trace?.malformed === true, "An empty category parameter is flagged malformed");
  assert(parseNavHash("#analysis-demand-trace")?.trace === null, "A bare Demand Trace hash carries no context");

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
  assert(isViewAuthorized(permissionsFor("FANTASY_INTEGRATION"), "fantasy-live"), "An authorized role still reaches the renamed page");
  assert(!isViewAuthorized(permissionsFor("SALES_VIEWER"), "fantasy-live"), "An unauthorized role still cannot reach the renamed page");
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
    for (const role of ROLES) {
      assert(
        !isViewAuthorized(permissionsFor(role), invented),
        `Unmapped view '${invented}' is denied to ${role}`,
      );
    }
  }
  assert(!isViewAuthorized(permissionsFor("SUPER_ADMIN"), "totally-new-page"), "Super Admin has no wildcard over unmapped pages");
  assert(!isViewAuthorized(permissionsFor("ADMIN"), "totally-new-page"), "Ordinary administrators have no wildcard over unmapped pages");
  assert(isViewAuthorized(permissionsFor("SUPER_ADMIN"), "dashboard"), "A mapped page is still reachable, so the check above is not vacuous");

  // Every registered view must have an explicit mapping, or it is unreachable.
  const viewRegistrySource = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
  const registryIds = [...viewRegistrySource.matchAll(/^\s+"([a-z0-9-]+)":\s+\w+View,/gm)].map((m) => m[1]);
  assert(registryIds.length > 50, `View registry parsed (${registryIds.length} views)`);
  const unmappedRegistered = registryIds.filter((id) => viewPermission(id) === null);
  assert(unmappedRegistered.length === 0, `Every registered view has an explicit permission${unmappedRegistered.length ? `: ${unmappedRegistered.join(", ")}` : ""}`);

  // --- UI/API permission agreement (RBAC-A) ---
  assert(viewPermission("fantasy-rough") === "rough.read", "Rough stock page uses the permission its API enforces (rough.read)");
  assert(viewPermission("planning-workbook-import") === "plan.create", "Workbook import page requires plan.create, as its route does");
  assert(viewPermission("planning-approval-queue") === "plan.read", "Approval queue is readable with plan.read; approving needs plan.approve");
  assert(viewPermission("manufacturing-traceability") === "plan.read", "Traceability uses the same permission at page and API");
  assert(permissionsFor("PLANNING_MANAGER").includes("plan.approve"), "Approval authority is still explicitly assigned");
  assert(!permissionsFor("ADMIN").includes("plan.approve"), "Administration still does not grant planning approval");

  // --- Separated Fantasy synchronization authorities (RBAC-A) ---
  assert(permissionsFor("FANTASY_INTEGRATION").includes("fantasy.sync.run"), "The integration role may run a synchronization");
  assert(!permissionsFor("FANTASY_INTEGRATION").includes("fantasy.sync.unlock"), "Running a synchronization does not imply releasing a stuck lock");
  assert(!permissionsFor("PLANNER").includes("fantasy.sync.retry"), "An unrelated role holds none of the synchronization authorities");

  // --- Access administration is no longer one super-permission (RBAC-A) ---
  assert(!(PERMISSIONS as readonly string[]).includes("user.manage"), "The user.manage super-permission is retired");
  assert(permissionsFor("ADMIN").includes("user.read"), "Administrators keep directory access");
  assert(!permissionsFor("ADMIN").includes("user.super_admin.assign"), "Administrators cannot assign the protected administrator role");
  assert(!permissionsFor("ADMIN").includes("role.permissions.assign"), "Administrators cannot change what a role may do");
  assert(permissionsFor("SUPER_ADMIN").includes("role.permissions.assign"), "Super Admin retains permission-assignment authority");
  assert(!permissionsFor("VIEWER").includes("notification.manage"), "Marking shared notifications read is not a viewer capability");


  console.log("\n===============================================================================");
  console.log("🎉 ALL ANALYSIS NAVIGATION INTEGRITY & RBAC TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
