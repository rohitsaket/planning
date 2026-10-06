import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import type { ComponentType } from "react";
import { POST as rolesPost, GET as listRoles } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { GET as dataQuality } from "@/app/api/data-quality/route";
import { resolveViewAlias, useNavStore, type ViewId } from "@/stores/nav-store";
import { OverviewView } from "@/components/diamond/views/consolidated/overview-view";
import { InventoryPositionView } from "@/components/diamond/views/consolidated/inventory-position-view";
import { FantasyDataView } from "@/components/diamond/views/consolidated/fantasy-data-view";
import { OutOfScopeView } from "@/components/diamond/shared/out-of-scope";
import { AppShell } from "@/components/layout/app-shell";
import { createElement } from "react";
import { UsersAccessView } from "@/components/diamond/views/consolidated/users-access-view";
import { DataQualityView } from "@/components/diamond/views/data-quality-view";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;

async function userWith(name: string, permissions: string[]): Promise<User> {
  const u = await makeUser(name, "VIEWER");
  const code = `NAV_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  const role = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `Nav ${name}`, permissions } });
  if (role.status !== 200) throw new Error(`role create failed ${role.status}`);
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

async function renderAs(view: ComponentType<object>, u: User, tab: string | null, category: string | null = null) {
  const s = await sessionUser(u.cookie);
  const nav = useNavStore.getInitialState();
  const saved = { tab: nav.tab, trace: nav.trace };
  Object.assign(nav, { tab, trace: category ? { runId: "no-such-run", category, bucket: null, malformed: false } : null });
  try {
    return await renderPage(view, {}, s, u.cookie);
  } finally {
    Object.assign(nav, saved);
  }
}
const tabLabels = (html: string) => [...html.matchAll(/role="tab"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());

beforeAll(async () => {
  await resetDb();
  await db.dataQualityIssue.deleteMany({});
  root = await makeUser("nav.root", "SUPER_ADMIN");
});

describe("consolidated pages render their existing views as tabs", () => {
  test("Overview: the dashboard and Executive Analysis are the two tabs", async () => {
    const page = await renderAs(OverviewView, root, "analysis");
    expect(tabLabels(page.html)).toEqual(["Overview", "Analysis"]);
    expect(page.text).toContain("Executive Analysis");
    expect(page.requested.some((r) => r.startsWith("/api/analysis/executive"))).toBe(true);
  });

  test("Inventory: position, stockout, excess and aging are tabs; Aging carries the bucket and location summary", async () => {
    const aging = await renderAs(InventoryPositionView, root, "aging");
    expect(tabLabels(aging.html)).toEqual(["Position", "Categories", "Lots", "Reconciliation", "Stockout Risk", "Excess Stock", "Aging"]);
    for (const label of ["Stock Aging", "Stock by inventory bucket", "Stock by location", "Current stock"]) expect([label, aging.text.includes(label)]).toEqual([label, true]);
    expect((aging.text.match(/Current lots/g) ?? []).length).toBe(1);
    const stockout = await renderAs(InventoryPositionView, root, "stockout");
    expect(stockout.text).toContain("Stockout Risk");
    expect(stockout.requested.some((r) => r.startsWith("/api/analysis/stockout"))).toBe(true);
    const drill = await renderAs(InventoryPositionView, root, "stockout", "GIA|HEART|1.70-1.99");
    expect(drill.text).toContain("No demand calculation yet");
    const excess = await renderAs(InventoryPositionView, root, "excess");
    expect(excess.requested.some((r) => r.startsWith("/api/analysis/excess"))).toBe(true);
  });

  test("Fantasy Data: current data, integration status and historical data", async () => {
    const current = await renderAs(FantasyDataView, root, "current");
    expect(tabLabels(current.html)).toEqual(["Current Data", "Integration Status", "Historical Data"]);
    expect([current.requested.some((r) => r.startsWith("/api/fantasy/polished")), current.requested.some((r) => r.startsWith("/api/fantasy/rough")), current.html.includes('aria-label="Stock type"'), /Rough stock/i.test(current.text)]).toEqual([true, false, false, false]);
    expect((await renderAs(FantasyDataView, root, "integration")).text).toContain("Integration Status");
    expect((await renderAs(FantasyDataView, root, "history")).text).toContain("Historical Data");
    expect(/Sync Monitor|Overall Data\b/.test(current.text)).toBe(false);
  });

  test("old Workbench, Approval Queue and Reservations links resolve to Not available and request no data", async () => {
    const retired = ["planning-workbench", "planning-comparison", "planning-cases", "planning-planned-pieces", "planning-reservations", "planning-approval-queue"];
    for (const id of retired) expect([id, resolveViewAlias(id as ViewId, "comparison")]).toEqual([id, { view: "out-of-scope", tab: null }]);
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, null);
    expect([page.text.includes("Not available"), /legacy planning workbench/i.test(page.text), page.text.includes("Approval")]).toEqual([true, true, false]);
    expect(page.requested).toEqual([]);
  });

  test("old Rough Availability and Fantasy Rough links say no rough-stock source is configured, and request nothing", async () => {
    for (const id of ["fantasy-rough", "fantasy-live"]) expect([id, resolveViewAlias(id as ViewId, null)]).toEqual([id, { view: "out-of-scope", tab: "rough-stock" }]);
    const target = resolveViewAlias("planning-rough-availability" as ViewId, null);
    expect(target).toEqual({ view: "out-of-scope", tab: "rough-stock" });
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, target.tab);
    expect([page.text.includes("Not available"), page.text.includes("No authoritative rough-stock source is configured.")]).toEqual([true, true]);
    expect(page.requested).toEqual([]);
  });

  test("an old manufacturing link shows Not available and requests no data", async () => {
    const page = await renderAs(OutOfScopeView as ComponentType<object>, root, null);
    expect([page.text.includes("Not available"), page.text.includes("outside the current planning utility"), page.text.includes("Workbook Import")]).toEqual([true, true, true]);
    expect(page.requested).toEqual([]);
  });

  test("Users & Access keeps exactly Users and Permissions; Super Admin is not an assignable role", async () => {
    expect(tabLabels((await renderAs(UsersAccessView, root, null)).html)).toEqual(["Users", "Permissions"]);
    resetRateLimits();
    const roles = (await call(listRoles, { cookie: root.cookie, path: "/api/admin/roles" })).json.roles as Array<{ code: string }>;
    expect(roles.some((r) => r.code === "SUPER_ADMIN")).toBe(false);
  });
});

describe("only permitted tabs are shown, selected or requested", () => {
  test("a historical-data-only reader sees Fantasy Data as one page, even from a link to Current Data", async () => {
    const u = await userWith("history", ["overall.read"]);
    const page = await renderAs(FantasyDataView, u, "current");
    expect(tabLabels(page.html)).toEqual([]);
    expect(page.text).toContain("Historical Data");
    expect(page.requested.some((r) => /\/api\/fantasy\/(rough|polished|sync)/.test(r))).toBe(false);
    expect([page.text.includes("Rough stock"), page.text.includes("Integration Status")]).toEqual([false, false]);
  });

  test("rough.read is no longer grantable, and Fantasy Data needs fantasy.read or overall.read", async () => {
    resetRateLimits();
    const refused = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code: `NAV_ROUGH_${Date.now().toString(36).toUpperCase()}`, name: "Rough reader", permissions: ["rough.read"] } });
    expect(refused.status).toBe(400);
    const u = await userWith("polishedreader", ["fantasy.read"]);
    const page = await renderAs(FantasyDataView, u, "current");
    expect([page.requested.some((r) => r.startsWith("/api/fantasy/polished")), page.requested.some((r) => r.startsWith("/api/fantasy/rough") || r.startsWith("/api/planning/"))]).toEqual([true, false]);
  });

  test("a user without any tab's permission is told the page is restricted, and nothing is requested", async () => {
    const u = await userWith("nothing", ["notification.read"]);
    const page = await renderAs(InventoryPositionView, u, "stockout");
    expect(page.text).toContain("Access Restricted");
    expect(page.requested).toEqual([]);
  });
});

describe("Import Issues shows only persisted issues", () => {
  test("with nothing recorded it says so, and claims no healthy state", async () => {
    const page = await renderAs(DataQualityView, root, null);
    expect(page.text).toContain("No import issues are recorded");
    expect([page.text.includes("Import Issues"), /Data Quality Issues|quality assurance/i.test(page.text)]).toEqual([true, false]);
    expect(/healthy|all clear|no errors/i.test(page.text)).toBe(false);
  });

  test("recorded issues appear by plain-language type, with counts from the database and no internal codes", async () => {
    const base = { source: "FANTASY", entity: "LOT", status: "OPEN", batchId: "batch-internal-7", syncRunId: "run-internal-7" };
    await db.dataQualityIssue.createMany({
      data: [
        { ...base, issueCode: "DQ-NAV-1", recordId: "LOT-NAV-1", rule: "INVALID_CANONICAL_RECORD", message: "Validation failure for Lot LOT-NAV-1: weight missing", severity: "ERROR" },
        { ...base, issueCode: "DQ-NAV-2", recordId: "LOT-NAV-2", rule: "UNMAPPED_LAB_WARNING", message: "Lab value XYZ is not mapped", severity: "WARNING" },
        { ...base, issueCode: "DQ-NAV-3", recordId: null, rule: "SOME_FUTURE_RULE", message: "Something new", severity: "INFO", source: "DEMAND_CALCULATION" },
      ],
    });
    const page = await renderAs(DataQualityView, root, null);
    for (const label of ["Invalid records", "Unmapped source values", "Other issue", "LOT-NAV-1", "Demand calculation", "3 matching issues"]) expect([label, page.text.includes(label)]).toEqual([label, true]);
    expect(/INVALID_CANONICAL_RECORD|UNMAPPED_LAB_WARNING|SOME_FUTURE_RULE|DQ-NAV-|batch-internal|run-internal/.test(page.text)).toBe(false);
    resetRateLimits();
    const filtered = await call(dataQuality, { cookie: root.cookie, path: "/api/data-quality?type=INVALID_RECORD&pageSize=1" });
    expect([filtered.status, filtered.json.paging.total, filtered.json.rows.length, filtered.json.severityCounts.ERROR]).toEqual([200, 1, 1, 1]);
    const paged = await call(dataQuality, { cookie: root.cookie, path: "/api/data-quality?pageSize=2&page=2" });
    expect([paged.json.paging.total, paged.json.rows.length, paged.json.paging.hasMore]).toEqual([3, 1, false]);
  });

  test("reading issues needs data_quality.read", async () => {
    const u = await userWith("nodq", ["analysis.read"]);
    resetRateLimits();
    expect((await call(dataQuality, { cookie: u.cookie, path: "/api/data-quality" })).status).toBe(403);
  });
});

describe("planning-only sidebar: every group expands and collapses", () => {
  const renderShell = async (u: User, collapsedGroups: Record<string, boolean> = {}) => {
    const s = await sessionUser(u.cookie);
    const nav = useNavStore.getInitialState();
    const saved = { collapsedGroups: nav.collapsedGroups, sidebarOpen: nav.sidebarOpen, view: nav.view };
    Object.assign(nav, { collapsedGroups, sidebarOpen: true, view: "dashboard" });
    try {
      return await renderPage(AppShell, { children: createElement("p", null, "page body") }, s, u.cookie);
    } finally {
      Object.assign(nav, saved);
    }
  };
  const groupButtons = (html: string) => [...html.matchAll(/<button[^>]*aria-expanded="(true|false)"[^>]*aria-label="([^"]+)"[^>]*>/g)].map((m) => [m[2], m[1]]);

  test("each group has a toggle with aria-expanded and an Expand/Collapse label; no manufacturing or QA entry", async () => {
    const page = await renderShell(root);
    expect(groupButtons(page.html)).toEqual([
      ["Collapse Dashboard", "true"], ["Collapse Analysis", "true"], ["Collapse Data", "true"],
      ["Collapse Planning", "true"], ["Collapse Administration", "true"],
    ]);
    expect(page.text).toContain("Import Issues");
    expect(/Execution|Manufacturing|Traceability|Plan vs Actual|Quality Assurance|Data Quality Issues|Requirement Matrix|Priority Queue|Order Exceptions|Replenishment/.test(page.text)).toBe(false);
  });

  test("Dashboard, with only Overview, collapses and expands like any other group", async () => {
    const collapsed = await renderShell(root, { "dashboard-group": true });
    expect(groupButtons(collapsed.html)[0]).toEqual(["Expand Dashboard", "false"]);
    expect(/>Overview</.test(collapsed.html)).toBe(false);
    const open = await renderShell(root);
    expect([groupButtons(open.html)[0][0], />Overview</.test(open.html)]).toEqual(["Collapse Dashboard", true]);
  });

  test("a reader with one page in a group still sees an expandable group; groups with none are not shown", async () => {
    const auditor = await userWith("auditonly", ["audit.read"]);
    const page = await renderShell(auditor);
    expect(groupButtons(page.html)).toEqual([["Collapse Administration", "true"]]);
    expect([page.text.includes("Audit Log"), page.text.includes("Users & Access"), page.text.includes("Mappings"), page.text.includes("Overview")]).toEqual([true, false, false, false]);
  });

  test("pages a reader may not open are never rendered, not even locked", async () => {
    const importReader = await userWith("importonly", ["sarin.import.read"]);
    const page = await renderShell(importReader);
    expect([page.text.includes("Workbook Import"), page.text.includes("Import Issues"), page.text.includes("Planning Workbench"), page.text.includes("Approval Queue"), page.text.includes("Rough Availability")]).toEqual([true, false, false, false, false]);
    expect(/Restricted/.test(page.html)).toBe(false);
  });

  test("stored state naming the retired Execution group does not break the sidebar", async () => {
    const page = await renderShell(root, { "execution-group": true, "manufacturing-group": false });
    expect(groupButtons(page.html).length).toBe(5);
  });
});
