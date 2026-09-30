// Scroll architecture, as rendered: <main> is the only vertical page scroller inside a
// viewport-high frame, the tab host flows inside it, a Section never clips or scrolls unless
// it is bounded, and a table's scrolling is chosen by its `scroll` mode — never by how many
// rows are loaded. Real components; the browser behaviour itself is exercised by
// scripts/test-scrolling.ts under wheel, touch and keyboard input.

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, test } from "./harness";
import { makeUser } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { useNavStore } from "@/stores/nav-store";
import { AppShell } from "@/components/layout/app-shell";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Section } from "@/components/diamond/shared/page-header";
import { BOUNDED_REGION_MAX_HEIGHT } from "@/components/diamond/shared/density";
import { MappingsView } from "@/components/diamond/views/consolidated/mappings-view";

type Row = { id: number; name: string };
const COLUMNS: Column<Row>[] = [{ key: "id", header: "ID", cell: (r) => r.id }, { key: "name", header: "Name", cell: (r) => r.name }];
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: i, name: `Row ${i}` }));
const openTag = (html: string, marker: string) => new RegExp(`<[a-z]+[^>]*${marker}[^>]*>`).exec(html)?.[0] ?? "";
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";
const tableHtml = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(DataTable<Row>, { columns: COLUMNS, rows: [], ...props }));

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
beforeAll(async () => {
  root = await makeUser(`scroll.layout.${Date.now().toString(36)}`, "SUPER_ADMIN");
});

describe("one vertical page scroller", () => {
  test("the frame never scrolls; <main> scrolls vertically only; the top bar sits outside it", async () => {
    const nav = useNavStore.getInitialState();
    const saved = { sidebarOpen: nav.sidebarOpen, view: nav.view };
    Object.assign(nav, { sidebarOpen: true, view: "dashboard" });
    try {
      const page = await renderPage(AppShell as ComponentType<object>, { children: createElement("p", null, "page body") }, await sessionUser(root.cookie), root.cookie);
      const frame = classOf(openTag(page.html, "data-app-shell"));
      const main = classOf(openTag(page.html, 'data-scroll-owner="page"'));
      expect([frame.includes("overflow-hidden"), /min-h-screen/.test(frame)]).toEqual([true, false]);
      expect(["overflow-y-auto", "overflow-x-hidden", "min-h-0", "min-w-0", "flex-1"].every((c) => main.split(" ").includes(c))).toBe(true);
      // The top bar precedes <main> and is not inside it; the sidebar has its own scroller.
      expect(page.html.indexOf("<header") < page.html.indexOf('data-scroll-owner="page"')).toBe(true);
      expect(classOf(openTag(page.html, 'aria-label="Main navigation"')).includes("overflow-y-auto")).toBe(true);
    } finally {
      Object.assign(nav, saved);
    }
  });

  test("a tabbed page flows inside <main>: sticky title strip, no second vertical scroller", async () => {
    const page = await renderPage(MappingsView as ComponentType<object>, {}, await sessionUser(root.cookie), root.cookie);
    const panel = classOf(openTag(page.html, 'role="tabpanel"'));
    expect([/overflow-(y-)?auto/.test(panel), /flex-1|min-h-0/.test(panel)]).toEqual([false, false]);
    expect(page.html).toMatch(/class="sticky top-0 z-30[^"]*"/);
  });
});

describe("Section", () => {
  test("a normal Section grows with its content: no clipping scroller, no stretching", () => {
    const html = renderToStaticMarkup(createElement(Section as ComponentType<{ title: string }>, { title: "Plain" }, createElement("p", null, "content")));
    const cls = classOf(openTag(html, "data-section"));
    expect([cls.includes("overflow-hidden"), cls.includes("flex-1"), cls.includes("min-h-0"), cls.includes("overflow-clip")]).toEqual([false, false, false, true]);
    expect(html.includes('role="region"')).toBe(false);
  });

  test("a bounded Section scrolls its body in a viewport-aware height, as a named, focusable region", () => {
    const html = renderToStaticMarkup(createElement(Section as ComponentType<{ title: string; layout: "bounded" }>, { title: "Plan Options", layout: "bounded" }, createElement("p", null, "cards")));
    const body = openTag(html, 'role="region"');
    expect([body.includes('aria-label="Plan Options"'), body.includes('tabindex="0"'), classOf(body).includes("overflow-y-auto")]).toEqual([true, true, true]);
    expect(body).toContain(`max-height:${BOUNDED_REGION_MAX_HEIGHT}`);
  });
});

describe("DataTable scroll modes", () => {
  test("a flowing table scrolls only sideways, is not a focus stop, and is identical at every row count", () => {
    const shapes = [0, 1, 25, 49, 50, 51, 200].map((n) => {
      const html = tableHtml({ rows: rows(n) });
      const viewport = openTag(html, "data-table-viewport");
      return JSON.stringify({ mode: /data-table-scroll="([a-z]+)"/.exec(html)?.[1], cls: classOf(viewport), style: /style="([^"]*)"/.exec(viewport)?.[1] ?? null, tab: viewport.includes("tabindex"), role: viewport.includes("role=") });
    });
    expect(new Set(shapes).size).toBe(1);
    const only = JSON.parse(shapes[0]);
    expect([only.mode, only.cls.includes("overflow-x-auto"), only.cls.includes("overflow-y-hidden"), only.style, only.tab, only.role]).toEqual(["flow", true, true, null, false, false]);
  });

  test("a bounded table owns its rows in a viewport-aware height under a sticky header, at every row count", () => {
    const shapes = [0, 1, 49, 50, 51, 200].map((n) => {
      const html = tableHtml({ rows: rows(n), scroll: "bounded", title: "Rough" });
      const viewport = openTag(html, "data-table-viewport");
      return JSON.stringify({ cls: classOf(viewport), label: /aria-label="([^"]*)"/.exec(viewport)?.[1], tab: viewport.includes('tabindex="0"'), style: /style="([^"]*)"/.exec(viewport)?.[1], sticky: /<thead class="sticky top-0/.test(html) });
    });
    expect(new Set(shapes).size).toBe(1);
    const only = JSON.parse(shapes[0]);
    expect([only.cls.includes("overflow-auto"), only.label, only.tab, only.style, only.sticky]).toEqual([true, "Rough rows", true, `max-height:${BOUNDED_REGION_MAX_HEIGHT}`, true]);
  });

  test("a table's own z-index stays inside it, so it cannot paint over the page's sticky headers", () => {
    const cls = classOf(openTag(tableHtml({ rows: rows(3) }), "data-table-root"));
    expect(cls.split(" ").includes("isolate")).toBe(true);
    expect(/overflow-hidden|flex-1|min-h-0/.test(cls)).toBe(false);
  });
});
