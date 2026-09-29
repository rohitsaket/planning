/**
 * TEST SUITE: NAVIGATION STRUCTURE, ALIASES AND PAGE AUTHORIZATION
 *
 * Verifies:
 * 1. The sidebar is exactly the approved workflow structure, in order.
 * 2. No duplicate destinations in the sidebar or the command palette.
 * 3. Advisory and unconfirmed pages are absent from navigation (not shown locked), while
 *    their views, routes and APIs remain.
 * 4. Every visible page has a registered component and an explicit permission decision;
 *    every registered view is mapped; unmapped ids fail closed.
 * 5. The command palette mirrors the sidebar, and tab entries name their host.
 * 6. Every former page id resolves, in one hop, to a registered page and an existing tab,
 *    preserving row context; the URL is rewritten to the canonical form.
 * 7. Consolidated hosts: page entry needs at least one tab's permission, the first
 *    permitted tab opens, and an unpermitted tab in the URL is never selected.
 * 8. Tab switches are history entries, so Back/Forward move between tabs.
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

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { NAV } from "../src/components/layout/app-shell";
import { PALETTE_ITEMS, isPaletteItemAllowed } from "../src/components/diamond/command-palette";
import { viewPermission, viewPermissions, isViewAuthorized } from "../src/lib/auth/view-permissions";
import { PERMISSIONS, ROLES } from "../src/lib/auth/permissions";
// Roles other than SUPER_ADMIN are test fixture custom roles (tests/security/fixture-roles.ts).
import { TEST_ROLES, testPermissionsFor } from "../tests/security/fixture-roles";
import {
  LEGACY_VIEW_ALIASES, useNavStore, initNavFromHash, parseNavHash, resolveViewAlias, navHash, type ViewId,
} from "../src/stores/nav-store";
import { isTabPermitted, resolveActiveTab, type HostTabItem } from "../src/components/diamond/shared/tabbed-host-view";
import { SALES_ANALYSIS_TABS, SALES_ANALYSIS_DEFAULT_TAB } from "../src/components/diamond/views/consolidated/sales-analysis-trends-view";
import { USERS_ACCESS_TABS } from "../src/components/diamond/views/consolidated/users-access-view";
import { OVERVIEW_TABS } from "../src/components/diamond/views/consolidated/overview-view";
import { INVENTORY_TABS } from "../src/components/diamond/views/consolidated/inventory-position-view";
import { FANTASY_DATA_TABS } from "../src/components/diamond/views/consolidated/fantasy-data-view";
import { PLANNING_WORKBENCH_TABS } from "../src/components/diamond/views/consolidated/planning-workbench-host-view";
import { MAPPINGS_TABS } from "../src/components/diamond/views/consolidated/mappings-view";

/** The approved sidebar, exactly. */
const EXPECTED_SIDEBAR: Array<[string, Array<[string, string]>]> = [
  ["Dashboard", [["dashboard", "Overview"]]],
  ["Analysis", [["analysis-sales", "Sales & Trends"], ["analysis-customers-orders", "Customers & Orders"], ["analysis-inventory-position", "Inventory"]]],
  ["Data", [["fantasy-data", "Fantasy Data"], ["data-quality-issues", "Import Issues"]]],
  ["Requirements", [["requirements-matrix", "Requirement Matrix"], ["requirements-priority-queue", "Priority Queue"], ["orders-exceptions", "Order Exceptions"], ["replenishment-allocation", "Replenishment & Allocation"]]],
  ["Planning", [["planning-rough-availability", "Rough Availability"], ["planning-workbook-import", "Workbook Import"], ["planning-workbench", "Planning Workbench"], ["planning-approval-queue", "Approval Queue"]]],
  // Planning-only scope: no Execution, Manufacturing or Quality Assurance group.
  ["Administration", [["admin-users-access", "Users & Access"], ["admin-mappings", "Mappings"], ["admin-audit-log", "Audit Log"]]],
];

const HOSTS: Record<string, { tabs: readonly HostTabItem[]; defaultTab: string }> = {
  dashboard: { tabs: OVERVIEW_TABS, defaultTab: "overview" },
  "analysis-sales": { tabs: SALES_ANALYSIS_TABS, defaultTab: SALES_ANALYSIS_DEFAULT_TAB },
  "analysis-inventory-position": { tabs: INVENTORY_TABS, defaultTab: "position" },
  "fantasy-data": { tabs: FANTASY_DATA_TABS, defaultTab: "current" },
  "planning-workbench": { tabs: PLANNING_WORKBENCH_TABS, defaultTab: "cases" },
  "admin-mappings": { tabs: MAPPINGS_TABS, defaultTab: "weight-bands" },
  "admin-users-access": { tabs: USERS_ACCESS_TABS, defaultTab: "users" },
};

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

async function main() {
  console.log("===============================================================================");
  console.log("🔍 NAVIGATION STRUCTURE, ALIAS AND AUTHORIZATION TEST SUITE");
  console.log("===============================================================================\n");

  // =========================================================================
  console.log("--- TEST 1: Exact sidebar structure and order ---");
  const actual = NAV.map((g) => [g.label, g.items.map((i) => [i.id, i.label])]);
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED_SIDEBAR), `Sidebar is exactly the approved structure (got ${JSON.stringify(actual)})`);
  const printed = NAV.map((g) => `${g.label}\n${g.items.map((i) => `  ${i.label}`).join("\n")}`).join("\n\n");
  assert(printed.split("\n").length === 6 + 17 + 5, "Six groups and seventeen pages are listed");

  // =========================================================================
  console.log("\n--- TEST 2: No duplicate destinations ---");
  const sidebarIds = NAV.flatMap((g) => g.items.map((i) => i.id));
  assert(new Set(sidebarIds).size === sidebarIds.length, "Every sidebar entry opens a different page");
  const paletteKeys = PALETTE_ITEMS.map((i) => `${i.id}:${i.tab ?? ""}`);
  assert(new Set(paletteKeys).size === paletteKeys.length, "Every command palette entry opens a different page or tab");
  const sidebarLabels = NAV.flatMap((g) => g.items.map((i) => i.label));
  assert(new Set(sidebarLabels).size === sidebarLabels.length, "No two sidebar entries share a label");

  // =========================================================================
  console.log("\n--- TEST 3: Advisory and unconfirmed pages are absent from navigation ---");
  const ABSENT_ITEMS = [
    "Executive Analysis", "Stockout Risk", "Excess Stock", "Stock Aging", "Aging Dashboard", "Reorder Signals", "Transfer Analyzer",
    "Plan Comparison", "System Settings", "Reports Library", "Forecasting", "Predictive Models", "Model Monitoring", "Current Data", "Sync Monitor", "Overall Data",
    "Manufacturing & Traceability", "Manufacturing Overview", "Traceability", "Plan vs Actual", "Quality Assurance", "Data Quality Issues",
  ];
  for (const label of ABSENT_ITEMS) assert(!sidebarLabels.includes(label), `'${label}' is not a sidebar item`);
  for (const group of ["Fantasy ERP", "Overall Data", "Data Science", "Reports", "Requirements and Priority"]) {
    assert(!NAV.some((g) => g.label === group), `No '${group}' sidebar group`);
  }
  const RETIRED_IDS: ViewId[] = [
    "analysis-reorder-signals", "transfer-analyzer", "stock-strategy", "reports", "analysis-forecast",
    "data-science-forecasting", "data-science-predictive-models", "data-science-prediction-monitoring",
    "data-science-anomaly-detection", "data-science-yield-prediction", "data-science-forecast", "data-science-models", "data-science-forecast-accuracy",
  ];
  const registry = read("src/app/page.tsx");
  for (const id of RETIRED_IDS) {
    assert(!sidebarIds.includes(id) && !PALETTE_ITEMS.some((i) => i.id === id), `'${id}' is in neither the sidebar nor the command palette`);
    assert(!new RegExp(`"?${id}"?:\s*\w+View`).test(registry), `'${id}' is no longer a registered page`);
    assert(resolveViewAlias(id).view === "out-of-scope", `An old #${id} link opens the Not available state`);
  }
  // The generic settings page is retired; the only setting ever in force, the plan approval
  // policy, lives on the Permissions tab of Users & Access.
  assert(resolveViewAlias("admin-system-settings" as ViewId).view === "out-of-scope", "An old #admin-system-settings link opens the Not available state");
  const flagsTarget = resolveViewAlias("admin-feature-flags" as ViewId);
  assert(flagsTarget.view === "admin-users-access" && flagsTarget.tab === "permissions", "An old #admin-feature-flags link opens Users & Access → Permissions (Approval Policy)");
  // Retired APIs are gone; APIs shared with retained planning pages stay.
  for (const route of ["analysis/reorder-signals", "analysis/transfer-candidates", "forecast", "reports", "analysis/yield-prediction", "analysis/anomalies", "analysis/wip", "audit/recent", "notifications/broadcast", "traceability/[query]", "fantasy/departments", "fantasy/locations", "admin/feature-flags", "fantasy/projection", "fantasy/projection/[runId]/abort", "fantasy/projection/[runId]/reconciliation"]) {
    assert(!existsSync(path.join(process.cwd(), "src/app/api", route, "route.ts")), `Retired API /api/${route} is removed`);
  }
  for (const route of ["analysis/forecast", "analysis/memo", "analysis/demand-trace", "admin/approval-policy", "notifications", "auth/password", "fantasy/classification-refresh"]) {
    assert(existsSync(path.join(process.cwd(), "src/app/api", route, "route.ts")), `Shared API /api/${route} is kept`);
  }

  // =========================================================================
  console.log("\n--- TEST 4: Every page is registered and has a permission decision ---");
  const registryIds = [...registry.matchAll(/^\s+"?([a-z0-9-]+)"?:\s+\w+View,/gm)].map((m) => m[1]);
  assert(registryIds.length >= 20, `View registry parsed (${registryIds.length} views)`);
  for (const id of sidebarIds) {
    assert(registryIds.includes(id), `Sidebar page '${id}' has a registered component`);
    assert(viewPermissions(id).length > 0, `Sidebar page '${id}' has a permission decision`);
  }
  const unmapped = registryIds.filter((id) => viewPermissions(id).length === 0);
  assert(unmapped.length === 0, `Every registered view has an explicit permission${unmapped.length ? `: ${unmapped.join(", ")}` : ""}`);
  const aliasIds = Object.keys(LEGACY_VIEW_ALIASES);
  const shadowed = registryIds.filter((id) => aliasIds.includes(id));
  assert(shadowed.length === 0, `No former id is still registered as its own page${shadowed.length ? `: ${shadowed.join(", ")}` : ""}`);
  for (const invented of ["totally-new-page", "admin-secret-console", "plan-vs-actual", ""]) {
    assert(viewPermission(invented) === null, `Unmapped view '${invented}' has no permission`);
    for (const role of TEST_ROLES) assert(!isViewAuthorized(testPermissionsFor(role), invented), `Unmapped view '${invented}' is denied to ${role}`);
  }
  assert(isViewAuthorized(testPermissionsFor("SUPER_ADMIN"), "dashboard"), "A mapped page is still reachable, so the checks above are not vacuous");

  // =========================================================================
  console.log("\n--- TEST 5: Command palette mirrors the sidebar ---");
  const palettePages = PALETTE_ITEMS.filter((i) => !i.tab).map((i) => i.id);
  assert(JSON.stringify([...palettePages].sort()) === JSON.stringify([...sidebarIds].sort()), "The palette offers exactly the sidebar's pages");
  for (const item of PALETTE_ITEMS.filter((i) => !i.tab)) {
    const navLabel = NAV.flatMap((g) => g.items).find((i) => i.id === item.id)?.label;
    assert(item.label === navLabel, `Palette entry '${item.label}' uses the sidebar label`);
  }
  for (const item of PALETTE_ITEMS.filter((i) => i.tab)) {
    const host = HOSTS[item.id];
    const navLabel = NAV.flatMap((g) => g.items).find((i) => i.id === item.id)?.label;
    const tab = host?.tabs.find((t) => t.id === item.tab);
    assert(!!tab, `Palette tab entry '${item.label}' targets an existing tab`);
    assert(item.label === `${navLabel} → ${tab!.label}` || item.label.startsWith(`${navLabel} → `), `Palette tab entry '${item.label}' names its host '${navLabel}'`);
  }
  // Permission filtering matches the page and the tab.
  assert(!isPaletteItemAllowed({ id: "fantasy-data", tab: "history" }, ["fantasy.read"]), "A tab entry is withheld when only another tab of the host is open to the user");
  assert(isPaletteItemAllowed({ id: "fantasy-data", tab: "history" }, ["overall.read"]), "A tab entry is offered for the tab the user may open");
  assert(!isPaletteItemAllowed({ id: "admin-audit-log" }, ["analysis.read"]), "A page entry is withheld without its permission");
  const paletteSource = read("src/components/diamond/command-palette.tsx");
  assert(!/Locked|advisory/.test(paletteSource), "The palette no longer lists locked or advisory entries");

  // =========================================================================
  console.log("\n--- TEST 6: Former page ids resolve in one hop, keeping context ---");
  const EXPECTED_ALIASES: Array<[string, string | null, string, string | null]> = [
    ["analysis-executive", null, "dashboard", "analysis"],
    ["analysis-sales-trends", null, "analysis-sales", "trends"],
    ["inventory-position", "lots", "analysis-inventory-position", "lots"],
    ["customers-orders", "orders", "analysis-customers-orders", "orders"],
    ["analysis-stockout", null, "analysis-inventory-position", "stockout"],
    ["analysis-excess", null, "analysis-inventory-position", "excess"],
    ["analysis-aging", null, "analysis-inventory-position", "aging"],
    ["aging-dashboard", null, "analysis-inventory-position", "aging"],
    ["fantasy-live", null, "fantasy-data", "current"],
    ["fantasy-live", "polished", "fantasy-data", "current"],
    ["fantasy-live", "departments", "out-of-scope", null],
    ["fantasy-live", "locations", "out-of-scope", null],
    ["fantasy-sync", null, "fantasy-data", "integration"],
    ["overall-data", null, "fantasy-data", "history"],
    ["analysis-wip", null, "out-of-scope", null],
    ["manufacturing-overview", "tracking", "fantasy-data", "integration"],
    ["manufacturing-overview", "wip", "out-of-scope", null],
    ["manufacturing-traceability", null, "out-of-scope", null],
    ["manufacturing", null, "out-of-scope", null],
    ["plan-vs-actual", null, "out-of-scope", null],
    ["fantasy-departments", null, "out-of-scope", null],
    ["planning-comparison", null, "planning-workbench", "comparison"],
    ["planning-cases", null, "planning-workbench", "cases"],
    ["planning-reservations", null, "planning-workbench", "reservations"],
    ["data-quality-unmapped-labs", null, "admin-mappings", "lab-mappings"],
    ["admin-sarin-shape-mappings", null, "admin-mappings", "sarin-shape-mapping"],
    ["admin-users", null, "admin-users-access", "users"],
  ];
  for (const [from, tab, view, toTab] of EXPECTED_ALIASES) {
    const r = resolveViewAlias(from as ViewId, tab);
    assert(r.view === view && r.tab === toTab, `#${from}${tab ? `?tab=${tab}` : ""} → #${view}${toTab ? `?tab=${toTab}` : ""}`);
  }
  for (const [from, alias] of Object.entries(LEGACY_VIEW_ALIASES)) {
    const targets = [alias, ...Object.values(alias.tabs ?? {})];
    for (const t of targets) {
      assert(!aliasIds.includes(t.view), `Alias '${from}' points at a page, not another alias (no chains or loops)`);
      // "out-of-scope" is the Not available state for former manufacturing pages; it shows no data.
      assert(registryIds.includes(t.view) || t.view === "out-of-scope", `Alias '${from}' lands on a registered page ('${t.view}')`);
      if (t.tab && HOSTS[t.view]) assert(HOSTS[t.view].tabs.some((x) => x.id === t.tab), `Alias '${from}' opens an existing tab ('${t.view}?tab=${t.tab}')`);
    }
  }
  const HEART = "GIA|HEART|1.70-1.99";
  const legacyDrill = parseNavHash(`#analysis-stockout?runId=run-1&category=${encodeURIComponent(HEART)}`);
  assert(legacyDrill?.view === "analysis-inventory-position" && legacyDrill.tab === "stockout" && legacyDrill.aliased, "An old Stockout Risk drill-down opens Inventory → Stockout Risk");
  assert(legacyDrill?.trace?.category === HEART && legacyDrill.trace.runId === "run-1", "…and keeps the exact category key and run");
  const legacyBucket = parseNavHash("#aging-dashboard?bucket=POLISHED_AVAILABLE");
  assert(legacyBucket?.tab === "aging", "An old Aging Dashboard link opens Inventory → Aging");
  historyCalls.length = 0;
  fakeWindow.location.hash = `#analysis-stockout?runId=run-1&category=${encodeURIComponent(HEART)}`;
  initNavFromHash();
  assert(useNavStore.getState().view === "analysis-inventory-position" && useNavStore.getState().tab === "stockout" && useNavStore.getState().trace?.category === HEART, "Loading the old hash restores the host, tab and category");
  assert(historyCalls.at(-1)?.kind === "replace" && historyCalls.at(-1)?.url === `#analysis-inventory-position?tab=stockout&runId=run-1&category=${encodeURIComponent(HEART)}`, "The old hash is rewritten once to the canonical URL (replaceState, no loop)");
  historyCalls.length = 0;
  initNavFromHash();
  assert(historyCalls.length === 0, "A canonical URL is not rewritten again");
  // Copying the new URL reopens the same tab.
  fakeWindow.location.hash = "#planning-workbench?tab=comparison";
  useNavStore.setState({ view: "dashboard", tab: null, trace: null });
  initNavFromHash();
  assert(useNavStore.getState().view === "planning-workbench" && useNavStore.getState().tab === "comparison", "#planning-workbench?tab=comparison reopens Planning Workbench → Comparison");
  // Removed pages with no successor fail closed rather than landing on another page's content.
  const pva = parseNavHash("#plan-vs-actual");
  assert(pva?.view === "out-of-scope" && !isViewAuthorized(testPermissionsFor("SUPER_ADMIN"), pva.view), "#plan-vs-actual opens the Not available state, never demonstration data");
  assert(!registryIds.includes("out-of-scope") && /view === "out-of-scope" \? <OutOfScopeView/.test(registry), "The Not available state is rendered outside the data-page registry");

  // =========================================================================
  console.log("\n--- TEST 7: Consolidated hosts: entry, first permitted tab, no unpermitted tab ---");
  for (const [hostId, host] of Object.entries(HOSTS)) {
    for (const role of TEST_ROLES) {
      const perms = testPermissionsFor(role);
      const permittedTabs = host.tabs.filter((t) => isTabPermitted(t.permission, perms));
      assert(isViewAuthorized(perms, hostId) === (permittedTabs.length > 0), `${role}: '${hostId}' opens exactly when one of its tabs is permitted (${permittedTabs.length})`);
      const active = resolveActiveTab(host.tabs, null, host.defaultTab, perms);
      if (permittedTabs.length === 0) {
        assert(active === undefined, `${role}: no tab of '${hostId}' is selected`);
        continue;
      }
      const expected = permittedTabs.some((t) => t.id === host.defaultTab) ? host.defaultTab : permittedTabs[0].id;
      assert(active === expected, `${role}: '${hostId}' opens on '${expected}'`);
      for (const tab of host.tabs.filter((t) => !isTabPermitted(t.permission, perms))) {
        const chosen = resolveActiveTab(host.tabs, tab.id, host.defaultTab, perms);
        assert(chosen !== tab.id, `${role}: a URL naming unpermitted '${hostId}?tab=${tab.id}' does not open it`);
      }
    }
  }
  // Custom access profiles, not just the fixtures.
  const onlyHistory = ["overall.read"];
  assert(isViewAuthorized(onlyHistory, "fantasy-data") && resolveActiveTab(FANTASY_DATA_TABS, "current", "current", onlyHistory) === "history", "A historical-data-only user opens Fantasy Data on Historical Data");
  const onlyRough = ["rough.read"];
  assert(isViewAuthorized(onlyRough, "planning-workbench") && resolveActiveTab(PLANNING_WORKBENCH_TABS, null, "cases", onlyRough) === "reservations", "A rough reader opens Planning Workbench on Rough Reservations only");
  assert(viewPermissions("manufacturing").length === 0, "Manufacturing is no longer a page");
  assert(!isViewAuthorized(["analysis.read"], "data-quality-issues") && isViewAuthorized(["data_quality.read"], "data-quality-issues"), "Import Issues needs data_quality.read (internal code unchanged)");
  assert(viewPermission("planning-approval-queue") === "plan.read", "Approval queue is readable with plan.read; approving needs plan.approve");
  assert(testPermissionsFor("PLANNING_MANAGER").includes("plan.approve"), "Approval authority is still explicitly assigned");
  assert(!testPermissionsFor("ADMIN").includes("plan.approve"), "Administration does not grant planning approval");
  assert(!testPermissionsFor("SUPER_ADMIN").includes("sarin.output.approve"), "Super Admin does not receive Sarin output approval through administration");

  // =========================================================================
  console.log("\n--- TEST 8: Tabs are history entries ---");
  historyCalls.length = 0;
  useNavStore.getState().setView("analysis-inventory-position");
  assert(historyCalls.at(-1)?.kind === "replace" && historyCalls.at(-1)?.url === "#analysis-inventory-position", "Opening Inventory writes its hash (replaceState)");
  useNavStore.getState().setTab("excess");
  assert(historyCalls.at(-1)?.kind === "push" && historyCalls.at(-1)?.url === "#analysis-inventory-position?tab=excess", "Switching to Excess Stock pushes a history entry");
  fakeWindow.location.hash = "#analysis-inventory-position";
  initNavFromHash();
  assert(useNavStore.getState().tab === null, "Back to #analysis-inventory-position restores the default tab");
  fakeWindow.location.hash = "#analysis-inventory-position?tab=excess";
  initNavFromHash();
  assert(useNavStore.getState().tab === "excess", "Forward to ?tab=excess restores Excess Stock");
  const pushes = historyCalls.filter((c) => c.kind === "push").length;
  useNavStore.getState().setTab("excess");
  assert(historyCalls.filter((c) => c.kind === "push").length === pushes, "Re-selecting the active tab adds no history entry");

  // =========================================================================
  console.log("\n--- TEST 9: Sales & Trends ---");
  assert(SALES_ANALYSIS_TABS.map((t) => t.id).join(",") === "analysis,trends", "Sales & Trends keeps two tabs: analysis, trends");
  assert(SALES_ANALYSIS_TABS.every((t) => t.permission === "sales.read"), "Both tabs are gated on sales.read");
  assert(resolveActiveTab(SALES_ANALYSIS_TABS, "abc", SALES_ANALYSIS_DEFAULT_TAB) === "analysis", "Invalid ?tab=abc falls back to Sales Analysis");
  assert(navHash("analysis-sales", "trends") === "#analysis-sales?tab=trends", "navHash builds #analysis-sales?tab=trends");

  // =========================================================================
  console.log("\n--- TEST 10: Category drill-down into Inventory → Stockout Risk ---");
  const nav = () => useNavStore.getState();
  const OVAL = "GIA|OVAL|1.00-1.09";
  nav().openCategoryView("analysis-stockout", { runId: "run-1", category: HEART });
  assert(nav().view === "analysis-inventory-position" && nav().tab === "stockout" && nav().trace?.category === HEART, "A drill-down opens Inventory → Stockout Risk with exactly that category");
  assert(historyCalls.at(-1)?.kind === "push", "A drill-down is a history entry, so Back returns to the source page");
  nav().setTraceCategory(OVAL);
  assert(nav().trace?.category === OVAL && nav().trace?.runId === "run-1", "An in-page category change keeps the run");
  assert(fakeWindow.location.hash.includes("tab=stockout") && fakeWindow.location.hash.includes("category=GIA%7COVAL%7C1.00-1.09"), "…and updates the URL without leaving the tab");
  nav().setView("dashboard");
  nav().setView("analysis-stockout");
  assert(nav().trace === null && nav().tab === "stockout", "Generic navigation carries no category over");
  const malformed = parseNavHash(`#analysis-stockout?category=${"x".repeat(250)}`);
  assert(malformed?.trace?.malformed === true && malformed.trace.category === null, "An over-length category is flagged malformed, never used");

  // =========================================================================
  console.log("\n--- TEST 11: Users & Access, Mappings and permission vocabulary ---");
  assert(JSON.stringify(USERS_ACCESS_TABS.map((t) => [t.id, t.label])) === JSON.stringify([["users", "Users"], ["permissions", "Permissions"]]), "Users & Access has exactly two tabs: Users and Permissions");
  assert(JSON.stringify(viewPermissions("admin-users-access")) === JSON.stringify(["user.read", "access_request.review", "role.read", "approval_policy.read"]), "Users & Access admits account readers, access-request reviewers, role readers and approval-policy readers");
  assert(JSON.stringify(viewPermissions("admin-mappings")) === JSON.stringify(["config.read", "sarin.mapping.read"]), "Mappings opens with config.read or sarin.mapping.read");
  assert(MAPPINGS_TABS.map((t) => t.label).join("|") === "Weight Bands|Lab Mapping|Shape Mapping|Status Mapping|Sarin Shape Mapping", "Mappings keeps its sections as tabs, and no generic settings tab");
  assert(!(PERMISSIONS as readonly string[]).some((p) => p.startsWith("feature_flag.") || p.startsWith("fantasy.projection.")), "No feature-flag or shadow-projection permission remains");
  assert(JSON.stringify(ROLES) === JSON.stringify(["SUPER_ADMIN"]), "Super Admin is the only built-in role");
  assert((PERMISSIONS as readonly string[]).includes("data_quality.read") && (PERMISSIONS as readonly string[]).includes("data_quality.export"), "Data Quality Issues has its read and export permissions");
  assert(!(PERMISSIONS as readonly string[]).includes("data_quality.manage"), "No unenforced data-quality management permission exists");
  assert(JSON.stringify(viewPermissions("planning-workbook-import")) === JSON.stringify(["sarin.import.read"]), "Workbook Import keeps its own page and permission");

  console.log("\n===============================================================================");
  console.log("🎉 ALL NAVIGATION STRUCTURE, ALIAS AND AUTHORIZATION TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
