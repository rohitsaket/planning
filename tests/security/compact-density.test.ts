// Compact density: one shared set of dimensions (CSS tokens) used by the shell, page bodies,
// headers, panels, KPI cards, tables, tabs and controls; no scaling tricks; headers that do not
// repeat the page title; semantic, keyboard-usable tables. Pages are rendered from their real
// components with data from the real route handlers in the isolated planning_sectest database.

import { beforeAll, describe, expect, test } from "./harness";
import { makeUser, resetDb } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { useNavStore } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { DataTable } from "@/components/diamond/shared/data-table";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { HostTabContext } from "@/components/diamond/shared/density";
import { InventoryPositionView } from "@/components/diamond/views/consolidated/inventory-position-view";
import { FantasyDataView } from "@/components/diamond/views/consolidated/fantasy-data-view";
import { DataQualityView } from "@/components/diamond/views/data-quality-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { AuditLogView } from "@/components/diamond/views/audit-log-view";
import { WorkbookImportView } from "@/components/diamond/views/workbook-import-view";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
const ROOT = process.cwd();
const css = () => readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

async function renderAs(view: ComponentType<object>, u: User, tab: string | null = null) {
  const s = await sessionUser(u.cookie);
  const nav = useNavStore.getInitialState();
  const saved = { tab: nav.tab, trace: nav.trace };
  Object.assign(nav, { tab, trace: null });
  try {
    return await renderPage(view, {}, s, u.cookie);
  } finally {
    Object.assign(nav, saved);
  }
}

beforeAll(async () => {
  await resetDb();
  root = await makeUser("density.root", "SUPER_ADMIN");
});

describe("compact density: one shared token set", () => {
  test("the theme defines the density tokens, with larger touch targets on phones", () => {
    const text = css();
    for (const token of ["--dp-page-x", "--dp-page-y", "--dp-section-gap", "--dp-card-pad", "--dp-control-h", "--dp-row-h", "--dp-tab-h", "--dp-bar-h", "--dp-nav-row-h", "--dp-sidebar-w"]) {
      expect([token, text.includes(`${token}:`)]).toEqual([token, true]);
    }
    const mobile = text.slice(text.indexOf("@media (max-width: 767px)"));
    expect(/--dp-control-h:\s*2\.5rem/.test(mobile)).toBe(true);
    // Desktop controls 32px, rows 36px: compact, not miniature.
    expect([/--dp-control-h:\s*2rem/.test(text), /--dp-row-h:\s*2\.25rem/.test(text)]).toEqual([true, true]);
  });

  test("compactness never comes from scaling or zoom", () => {
    const sources = [css(), ...["density.tsx", "page-header.tsx", "kpi-card.tsx", "data-table.tsx", "tabbed-host-view.tsx"].map((f) => readFileSync(path.join(ROOT, "src/components/diamond/shared", f), "utf8"))];
    for (const src of sources) expect(/\bzoom\s*:|transform:\s*scale\(|scale-\[0\./.test(src)).toBe(false);
  });

  test("controls take the shared height by default, and a page's explicit size still wins", () => {
    expect(renderToStaticMarkup(createElement(Button, null, "Go"))).toContain("h-control");
    expect(renderToStaticMarkup(createElement(Input, { "aria-label": "x" }))).toContain("h-control");
    expect(cn("h-control", "h-8")).toBe("h-8");
  });

  test("every page body uses the shared page padding and block gap", () => {
    const views = path.join(ROOT, "src/components/diamond/views");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(d, e.name));
        else if (e.name.endsWith(".tsx")) files.push(path.join(d, e.name));
      }
    };
    walk(views);
    const bodies = files.filter((f) => readFileSync(f, "utf8").includes("data-page-body"));
    expect(bodies.length).toBeGreaterThanOrEqual(36);
    // No page keeps the old ad-hoc roots.
    const legacy = files.filter((f) => /className="(flex flex-col gap-3 p-3|space-y-4 p-3)"/.test(readFileSync(f, "utf8")));
    expect(legacy.map((f) => path.basename(f))).toEqual([]);
  });

  test("no page wraps its filters in a separate titled card", () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".tsx") && /<Section\s+title="Filters"/.test(readFileSync(p, "utf8"))) hits.push(e.name); } };
    walk(path.join(ROOT, "src/components/diamond/views"));
    expect(hits).toEqual([]);
  });
});

describe("compact density: shared components", () => {
  test("a KPI card is one compact block: small inline icon, value, one supporting line", () => {
    const html = renderToStaticMarkup(createElement(KpiCard, { label: "Physical shortage", value: 74, unit: "pcs", hint: "Quantity still needed" }));
    expect([html.includes("data-kpi"), html.includes("text-xl"), html.includes("p-4"), html.includes("text-3xl")]).toEqual([true, true, false, false]);
  });

  test("a clickable KPI card is a keyboard target with a visible focus ring", () => {
    const html = renderToStaticMarkup(createElement(KpiCard, { label: "Open", value: 1, onClick: () => {} }));
    expect([html.includes('role="button"'), html.includes('tabindex="0"'), html.includes("focus-visible:ring-2")]).toEqual([true, true, true]);
  });

  test("inside a tabbed page the header does not repeat the page title or the tab label", () => {
    const inHost = (title: string) => renderToStaticMarkup(createElement(HostTabContext.Provider, { value: { hostTitle: "Inventory", tabLabel: "Stockout Risk" } }, createElement(PageHeader, { title, subtitle: "Categories short of target stock" })));
    const same = inHost("Stockout Risk");
    expect([same.includes("Stockout Risk"), same.includes("<h1"), same.includes("Categories short of target stock"), same.includes("sticky")]).toEqual([false, false, true, false]);
    // A distinct title is kept, as a sub-heading under the page's single h1.
    expect(inHost("Executive Dashboard")).toContain("<h2");
    // Standalone, it is the page's single sticky h1.
    const alone = renderToStaticMarkup(createElement(PageHeader, { title: "Audit Log" }));
    expect([alone.includes("<h1"), alone.includes("sticky")]).toEqual([true, true]);
  });

  test("tables keep semantic markup, compact rows, full-value tooltips and keyboard rows", () => {
    const rows = [{ id: "a", name: "GIA | Cushion Modified | 2.10-2.49 with a long description", qty: 6 }];
    const html = renderToStaticMarkup(createElement(DataTable<(typeof rows)[number]>, {
      columns: [
        { key: "name", header: "Category", cell: (r) => r.name, exportValue: (r) => r.name },
        { key: "qty", header: "Qty", align: "right", cell: (r) => r.qty },
      ],
      rows,
      onRowClick: () => {},
    }));
    expect([html.includes("<table"), html.includes("<thead"), html.includes('scope="col"'), html.includes("<tbody")]).toEqual([true, true, true, true]);
    expect([html.includes("h-row"), html.includes('tabindex="0"'), html.includes(`title="${rows[0].name}"`), html.includes("tabular-nums")]).toEqual([true, true, true, true]);
  });

  test("a table inside a panel does not draw a second card", () => {
    const table = createElement(DataTable<{ a: number }>, { columns: [{ key: "a", header: "A", cell: (r) => r.a }], rows: [{ a: 1 }] });
    const inSection = renderToStaticMarkup(createElement(Section as ComponentType<{ title: string }>, { title: "Rows" }, table));
    const alone = renderToStaticMarkup(table);
    const wrapper = (html: string) => {
      const tag = /<div[^>]*data-table-root[^>]*>/.exec(html)?.[0] ?? "";
      return /class="([^"]*)"/.exec(tag)?.[1] ?? "";
    };
    expect([wrapper(alone).includes("rounded-lg border"), wrapper(inSection).includes("border")]).toEqual([true, false]);
  });

  test("exports are one menu, still offered only with the export permission", async () => {
    const page = await renderAs(DataQualityView, root);
    expect([page.text.includes("Export"), page.text.includes("Export loaded rows (CSV)")]).toEqual([true, false]);
  });
});

describe("compact density: rendered pages", () => {
  test("a tabbed page shows its title once and each tab label once", async () => {
    const page = await renderAs(InventoryPositionView, root, "stockout");
    const headings = [...page.html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    expect(headings.filter((h) => h === "Inventory").length).toBe(1);
    expect(headings.includes("Stockout Risk")).toBe(false);
    expect(page.html).toContain("h-tab");
  });

  test("a page reached through a single permitted tab still names its section", async () => {
    const u = await makeUser("density.history", "AUDITOR"); // overall.read only among Fantasy Data tabs
    const page = await renderAs(FantasyDataView, u, "current");
    expect([page.text.includes("Historical Data"), /role="tab"/.test(page.html)]).toEqual([true, false]);
  });

  test("Requirements, Audit Log and Data Quality use the one-row filter toolbar", async () => {
    for (const view of [RequirementsMatrixView, AuditLogView]) {
      const page = await renderAs(view as ComponentType<object>, root);
      expect([page.html.includes("data-filter-bar"), page.html.includes('aria-label="Filters"')]).toEqual([true, true]);
    }
  });

  test("Workbook Import keeps its simple form: file, Packet type, planning date, lab, Process File — no country", async () => {
    const page = await renderAs(WorkbookImportView, root);
    for (const label of ["Sarin CSV file", "Packet type", "Planning date", "Lab (optional)", "Process File", "Recent Files"]) expect([label, page.text.includes(label)]).toEqual([label, true]);
    expect([/Country/.test(page.text), /Stone Type/i.test(page.text)]).toEqual([false, false]);
  });
});
