import { click, consoleProblems, evaluate, eventCount, eventsSince, key, send, setViewport, sleep, startBrowser, touchScroll, signInAs, waitFor, wheel } from "./browser-harness";
import { db } from "../tests/security/helpers";
import { assertScrollingTestDatabase, BOUNDARY_COUNTS, boundaryToken, seedScrollingFixture } from "./scrolling-fixture";

const ALL_VIEWPORTS = ["1440x900", "1366x768", "1024x768", "768x1024", "390x844", "360x800"];
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const VIEWPORTS = (arg("viewports")?.split(",") ?? ALL_VIEWPORTS).map((v) => v.split("x").map(Number) as [number, number]);
const PAGES = [
  "dashboard", "analysis-sales", "analysis-customers-orders", "analysis-inventory-position", "fantasy-data", "data-quality-issues",
  "planning-workbook-import", "admin-users-access", "admin-mappings", "admin-audit-log",
];
const FINAL_SIDEBAR: Array<[string, string[]]> = [
  ["Dashboard", ["Overview"]],
  ["Analysis", ["Sales & Trends", "Customers & Orders", "Inventory"]],
  ["Data", ["Fantasy Data", "Import Issues"]],
  ["Planning", ["Workbook Import"]],
  ["Administration", ["Users & Access", "Mappings", "Audit Log"]],
];
const RETIRED_LINKS: Array<[string, RegExp]> = [
  ["#planning-workbench", /outside the current planning utility/],
  ["#planning-workbench?tab=comparison", /outside the current planning utility/],
  ["#planning-cases", /outside the current planning utility/],
  ["#planning-comparison", /outside the current planning utility/],
  ["#planning-planned-pieces", /outside the current planning utility/],
  ["#planning-reservations", /outside the current planning utility/],
  ["#planning-approval-queue", /outside the current planning utility/],
  ["#planning-rough-availability", /No authoritative rough-stock source is configured\./],
  ["#fantasy-rough", /No authoritative rough-stock source is configured\./],
  ["#fantasy-live", /No authoritative rough-stock source is configured\./],
  ["#requirements-matrix", /Requirements and order workflows are not configured for this planning utility\./],
  ["#requirements-priority-queue", /Requirements and order workflows are not configured for this planning utility\./],
  ["#orders-exceptions", /Requirements and order workflows are not configured for this planning utility\./],
  ["#replenishment-allocation", /Requirements and order workflows are not configured for this planning utility\./],
  ["#requirements-backorders", /Requirements and order workflows are not configured for this planning utility\./],
  ["#analysis-orders", /Requirements and order workflows are not configured for this planning utility\./],
];
const IMPORT_PAGE_SIZE = 50;

const results: { check: string; ok: boolean; detail: string }[] = [];
const notes: string[] = [];
const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, ok, detail });
  if (!ok) console.log(`  FAIL ${check}${detail ? ` — ${detail}` : ""}`);
};

const PAGE_HELPERS = `
window.__sc = {
  main() { return document.querySelector('main[data-scroll-owner="page"]'); },
  box(el) { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; },
  visiblePoint(el) {
    const m = this.main().getBoundingClientRect(), r = el.getBoundingClientRect();
    const top = Math.max(r.top, m.top + 70), bottom = Math.min(r.bottom, m.bottom - 10);
    const left = Math.max(r.left, m.left), right = Math.min(r.right, m.right);
    if (bottom - top < 20 || right - left < 20) return null;
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
  },
  tables() {
    return [...this.main().querySelectorAll('[data-table-root]')].filter((t) => t.offsetParent).map((t, i) => {
      const vp = t.querySelector('[data-table-viewport]');
      return { i, mode: t.getAttribute('data-table-scroll'), top: vp.scrollTop, left: vp.scrollLeft, sh: vp.scrollHeight, ch: vp.clientHeight, sw: vp.scrollWidth, cw: vp.clientWidth,
        overflowY: getComputedStyle(vp).overflowY, maxHeight: getComputedStyle(vp).maxHeight, rows: vp.querySelectorAll('tbody tr').length };
    });
  },
  regions() { return [...this.main().querySelectorAll('[data-section] > [role="region"], [data-table-scroll="bounded"] [data-table-viewport]')].filter((r) => r.offsetParent); },
  clipped() {
    const out = [];
    for (const el of this.main().querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (!/(hidden|clip)/.test(cs.overflowY) || el.clientHeight <= 4) continue;
      if (el.closest('[data-radix-popper-content-wrapper], svg, .recharts-wrapper, [data-table-viewport]')) continue;
      if (el.scrollHeight > el.clientHeight + 8) out.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 4).join('.') + ' ' + el.clientHeight + '/' + el.scrollHeight);
    }
    return out;
  },
  state() {
    const m = this.main(), d = document.scrollingElement;
    return { top: m.scrollTop, sh: m.scrollHeight, ch: m.clientHeight, left: m.scrollLeft, docH: d.scrollHeight, docW: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth };
  },
  gutter() {
    const r = this.main().getBoundingClientRect();
    const x = Math.round(r.left + 3), y = Math.round(r.top + r.height * 0.6);
    const hit = document.elementFromPoint(x, y);
    return { x, y, inTable: !!(hit && hit.closest('[data-table-root], [role="region"]')) };
  },
  settled() {
    const m = this.main();
    return !!m && document.readyState === 'complete' && !m.querySelector('.animate-pulse, [aria-busy="true"]') && !/Loading/.test(m.innerText);
  },
};
true`;

async function navigate(hash: string) {
  await evaluate(`location.hash = ${JSON.stringify(hash)}; true`);
  await sleep(250);
  if (!(await evaluate<boolean>("!!window.__sc"))) await evaluate(PAGE_HELPERS);
  await waitFor("window.__sc.settled()", 12000);
  await sleep(400);
}

const mainState = () => evaluate<{ top: number; sh: number; ch: number; left: number; docH: number; docW: number; ih: number; iw: number }>("window.__sc.state()");
const setMainTop = (top: number) => evaluate(`window.__sc.main().scrollTop = ${top}; true`);

async function checkPage(label: string, touch: boolean) {
  const from = eventCount();
  await setMainTop(0);
  await sleep(150);
  const s = await mainState();
  const tall = s.sh > s.ch + 4;
  record(`${label}: no body scrollbar and no page-wide horizontal overflow`, s.docH <= s.ih + 1 && s.docW <= s.iw + 1, `doc ${s.docW}x${s.docH} viewport ${s.iw}x${s.ih}`);
  const clipped = await evaluate<string[]>("window.__sc.clipped()");
  record(`${label}: nothing is clipped without a scrollbar`, clipped.length === 0, clipped.slice(0, 3).join(" | "));
  const tables = await evaluate<Array<{ i: number; mode: string; sh: number; ch: number; sw: number; cw: number }>>("window.__sc.tables()");
  const trapped = tables.filter((t) => t.mode === "flow" && t.sh > t.ch + 1);
  record(`${label}: flowing tables never scroll vertically themselves`, trapped.length === 0, JSON.stringify(trapped));
  if (!tall) notes.push(`${label}: content fits the viewport (no page scrolling needed)`);

  if (tall) {
    const g = await evaluate<{ x: number; y: number; inTable: boolean }>("window.__sc.gutter()");
    await wheel(g.x, g.y, 0, 300);
    const afterGutter = await mainState();
    record(`${label}: wheel outside tables scrolls the page`, afterGutter.top > 0, `top ${afterGutter.top}`);
    await setMainTop(0);

    const flowIndex = tables.find((t) => t.mode === "flow")?.i;
    if (flowIndex !== undefined) {
      await evaluate(`(() => { const t = [...window.__sc.main().querySelectorAll('[data-table-root]')].filter((t) => t.offsetParent)[${flowIndex}]; const m = window.__sc.main(); m.scrollTop = Math.max(0, t.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - 120); return true; })()`);
      await sleep(200);
      const p = await evaluate<{ x: number; y: number } | null>(`window.__sc.visiblePoint([...window.__sc.main().querySelectorAll('[data-table-root] [data-table-viewport]')].filter((t) => t.offsetParent)[${flowIndex}])`);
      if (p) {
        const before = await mainState();
        const down = before.top + before.ch < before.sh - 2;
        if (touch) await touchScroll(p.x, p.y, down ? 250 : -250);
        else await wheel(p.x, p.y, 0, down ? 300 : -300);
        const after = await mainState();
        const tableAfter = (await evaluate<Array<{ top: number }>>("window.__sc.tables()"))[flowIndex];
        record(`${label}: ${touch ? "touch" : "wheel"} over a flowing table scrolls the page`, (down ? after.top > before.top : after.top < before.top) && tableAfter.top === 0, `page ${before.top}→${after.top}, table ${tableAfter.top}`);
      }
      await setMainTop(0);
    }

    await setMainTop(1e7);
    await sleep(200);
    const reach = await evaluate<{ bottom: boolean; pagers: number; hidden: number }>(`(() => {
      const m = window.__sc.main();
      const bottom = m.scrollTop + m.clientHeight >= m.scrollHeight - 2;
      const pagers = [...m.querySelectorAll('button')].filter((b) => (/^(Next|Prev|Previous)$/.test(b.textContent.trim()) || /^(Next|Previous) page$/.test(b.getAttribute('aria-label') || '')) && b.offsetParent);
      let hidden = 0;
      for (const p of pagers) {
        p.scrollIntoView({ block: 'nearest' });
        const r = m.getBoundingClientRect(), b = p.getBoundingClientRect();
        const hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
        // A disabled button takes no pointer events, so the hit lands on its own pager bar.
        if (!(b.bottom <= r.bottom + 1 && b.top >= r.top - 1 && hit && p.parentElement.contains(hit))) hidden++;
      }
      return { bottom, pagers: pagers.length, hidden };
    })()`);
    record(`${label}: the page scrolls to its end and every pager (${reach.pagers}) can be reached`, reach.bottom && reach.hidden === 0, JSON.stringify(reach));
    await setMainTop(0);
  }

  const wide = tables.find((t) => t.sw > t.cw + 2);
  if (wide) {
    await evaluate(`(() => { const vp = [...window.__sc.main().querySelectorAll('[data-table-root] [data-table-viewport]')].filter((t) => t.offsetParent)[${wide.i}]; vp.scrollIntoView({ block: 'center' }); vp.scrollLeft = 0; return true; })()`);
    await sleep(250);
    const p = await evaluate<{ x: number; y: number } | null>(`window.__sc.visiblePoint([...window.__sc.main().querySelectorAll('[data-table-root] [data-table-viewport]')].filter((t) => t.offsetParent)[${wide.i}])`);
    if (p) {
      await wheel(p.x, p.y, 240, 0);
      const trackpad = (await evaluate<Array<{ left: number }>>("window.__sc.tables()"))[wide.i].left;
      await evaluate(`[...window.__sc.main().querySelectorAll('[data-table-root] [data-table-viewport]')].filter((t) => t.offsetParent)[${wide.i}].scrollLeft = 0; true`);
      await wheel(p.x, p.y, 0, 240, 8);
      const shift = (await evaluate<Array<{ left: number }>>("window.__sc.tables()"))[wide.i].left;
      const st = await mainState();
      record(`${label}: a wide table scrolls sideways (trackpad and Shift+wheel) without widening the page`, trackpad > 0 && shift > 0 && st.left === 0 && st.docW <= st.iw + 1, `trackpad ${trackpad}, shift ${shift}, page left ${st.left}`);
    }
    await setMainTop(0);
  }

  const regionCount = await evaluate<number>("window.__sc.regions().length");
  for (let r = 0; r < regionCount; r++) {
    const info = await evaluate<{ sh: number; ch: number } | null>(`(() => { const el = window.__sc.regions()[${r}]; el.scrollIntoView({ block: 'center' }); el.scrollTop = 0; return { sh: el.scrollHeight, ch: el.clientHeight }; })()`);
    if (!info || info.sh <= info.ch + 2) continue;
    await sleep(200);
    const p = await evaluate<{ x: number; y: number } | null>(`window.__sc.visiblePoint(window.__sc.regions()[${r}])`);
    if (!p) continue;
    const before = await mainState();
    if (touch) await touchScroll(p.x, p.y, 150);
    else await wheel(p.x, p.y, 0, 150);
    const inner = await evaluate<number>(`window.__sc.regions()[${r}].scrollTop`);
    const mid = await mainState();
    record(`${label}: bounded region ${r + 1} scrolls internally under ${touch ? "touch" : "the wheel"}`, inner > 0 && mid.top === before.top, `region ${inner}, page ${before.top}→${mid.top}`);
    await evaluate(`(() => { const el = window.__sc.regions()[${r}]; el.scrollTop = el.scrollHeight; return true; })()`);
    await sleep(300);
    const atEnd = await mainState();
    if (atEnd.top + atEnd.ch < atEnd.sh - 2) {
      let moved = atEnd.top;
      for (let i = 0; i < 3 && moved === atEnd.top; i++) {
        if (touch) await touchScroll(p.x, p.y, 200);
        else await wheel(p.x, p.y, 0, 250);
        moved = (await mainState()).top;
      }
      record(`${label}: at the end of bounded region ${r + 1}, continued ${touch ? "swiping" : "scrolling"} moves the page`, moved > atEnd.top, `page ${atEnd.top}→${moved}`);
    }
    if (!touch) {
      await evaluate(`(() => { const el = window.__sc.regions()[${r}]; el.scrollTop = 0; el.focus(); return true; })()`);
      await key("ArrowDown", 40);
      await key("ArrowDown", 40);
      await key("PageDown", 34);
      const keyed = await evaluate<{ top: number; focused: boolean }>(`(() => { const el = window.__sc.regions()[${r}]; return { top: el.scrollTop, focused: document.activeElement === el }; })()`);
      record(`${label}: bounded region ${r + 1} scrolls with arrow keys and Page Down and keeps focus`, keyed.top > 0 && keyed.focused, JSON.stringify(keyed));
    }
    await setMainTop(0);
  }

  const problems = consoleProblems(from);
  record(`${label}: no console errors or hydration warnings`, problems.length === 0, problems.slice(0, 2).join(" | "));
}

async function tabsOnPage(): Promise<string[]> {
  return evaluate<string[]>(`[...document.querySelectorAll('main [role="tab"]')].map((t) => t.textContent.trim())`);
}
async function clickTab(label: string) {
  await evaluate(`[...document.querySelectorAll('main [role="tab"]')].find((t) => t.textContent.trim() === ${JSON.stringify(label)}).click(); true`);
  await sleep(300);
  await waitFor("window.__sc.settled()", 12000);
  await sleep(400);
}

async function openStoredOutput(): Promise<boolean> {
  const opened = await evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Open'); if (!b) return false; b.click(); return true; })()`);
  if (!opened) return false;
  return waitFor(`/Output Ready/.test(window.__sc.main().innerText) && !!window.__sc.main().querySelector('[aria-label^="Plans of stone"]')`, 15000);
}

async function interactionChecks(tag: string, width: number) {
  const mobile = width < 768;
  await navigate("#analysis-inventory-position");
  await setMainTop(600);
  const tabs = await tabsOnPage();
  if (tabs.length > 1) {
    await clickTab(tabs[1]);
    record(`${tag}: switching tabs starts the new tab at the top`, (await mainState()).top === 0);
  }

  await navigate("#data-quality-issues");
  const g = await evaluate<{ x: number; y: number }>("window.__sc.gutter()");
  await click(g.x, g.y);
  await key("PageDown", 34);
  const pd = (await mainState()).top;
  await key("End", 35);
  const end = await mainState();
  await key("Home", 36);
  const home = (await mainState()).top;
  record(`${tag}: Page Down, End and Home scroll the page`, pd > 0 && end.top + end.ch >= end.sh - 2 && home === 0, `pageDown ${pd}, end ${end.top}/${end.sh - end.ch}, home ${home}`);

  await setMainTop(0);
  let visible = true;
  let deep = false;
  for (let i = 0; i < 60 && !deep; i++) {
    await key("Tab", 9);
    const f = await evaluate<{ inMain: boolean; ok: boolean; below: boolean } | null>(`(() => {
      const a = document.activeElement, m = window.__sc.main();
      if (!a || !m.contains(a)) return { inMain: false, ok: true, below: false };
      const r = a.getBoundingClientRect(), mr = m.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(Math.max((r.left + r.right) / 2, mr.left + 1), mr.right - 1), (r.top + r.bottom) / 2);
      return { inMain: true, ok: r.bottom <= mr.bottom + 1 && r.top >= mr.top - 1 && !!hit && (a.contains(hit) || hit.contains(a)), below: m.scrollTop > 0 };
    })()`);
    if (f?.inMain && !f.ok) visible = false;
    if (f?.below) deep = true;
  }
  record(`${tag}: Tab moves focus through the page and each focused control is visible, not under a sticky header`, visible && deep);

  await navigate("#admin-users-access");
  const opened = await evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('main button')].find((x) => /Add user/.test(x.textContent)); if (!b) return false; b.click(); return true; })()`);
  if (opened) {
    await waitFor(`!!document.querySelector('[role="dialog"]')`);
    await key("Escape", 27);
    await waitFor(`!document.querySelector('[role="dialog"]')`);
  }
  const cols = await evaluate<boolean>(`(() => { const b = [...document.querySelectorAll('main button')].find((x) => /^Columns/.test(x.textContent.trim())); if (!b) return false; b.click(); return true; })()`);
  if (cols) {
    await sleep(300);
    await key("Escape", 27);
  }
  await setMainTop(0);
  const gg = await evaluate<{ x: number; y: number }>("window.__sc.gutter()");
  await wheel(gg.x, gg.y, 0, 300);
  const lock = await evaluate<{ body: string; pointer: string }>(`({ body: getComputedStyle(document.body).overflow, pointer: getComputedStyle(document.body).pointerEvents })`);
  record(`${tag}: after a dialog and a popover close, the page still scrolls and nothing stays locked`, (await mainState()).top > 0 && lock.pointer !== "none" && lock.body !== "hidden", JSON.stringify(lock));

  if (!mobile) {
    await evaluate(`document.querySelector('button[aria-label="Collapse sidebar"]')?.click(); true`);
    await sleep(400);
    await setMainTop(0);
    const g2 = await evaluate<{ x: number; y: number }>("window.__sc.gutter()");
    await wheel(g2.x, g2.y, 0, 300);
    const collapsed = (await mainState()).top;
    await evaluate(`[...document.querySelectorAll('aside button')].find((b) => b.getAttribute('aria-label') === 'Expand sidebar' || b.title === 'Expand sidebar')?.click(); true`);
    await sleep(400);
    record(`${tag}: the page scrolls with the sidebar collapsed`, collapsed > 0);
  } else {
    await navigate("#data-quality-issues");
    await setMainTop(0);
    await evaluate(`document.querySelector('button[aria-label="Open navigation menu"]').click(); true`);
    await waitFor(`!!document.querySelector('aside nav[aria-label="Main navigation"]')`);
    await sleep(300);
    const nav = await evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector('aside nav[aria-label="Main navigation"]').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await touchScroll(nav.x, nav.y, 300);
    await touchScroll(nav.x, nav.y, 300);
    const behind = (await mainState()).top;
    record(`${tag}: swiping the navigation drawer never scrolls the page behind it`, behind === 0, `page top ${behind}`);
    await evaluate(`[...document.querySelectorAll('aside nav button')].find((b) => b.textContent.trim() === 'Audit Log').click(); true`);
    await sleep(600);
    await waitFor("window.__sc.settled()");
    const closed = await evaluate<boolean>(`!document.querySelector('aside nav[aria-label="Main navigation"]')`);
    const g3 = await evaluate<{ x: number; y: number }>("window.__sc.gutter()");
    await touchScroll(g3.x, g3.y, 300);
    record(`${tag}: choosing a page closes the drawer and the page scrolls again`, closed && (await mainState()).top > 0);
  }
}

async function setInput(placeholderStart: string, value: string) {
  return evaluate<boolean>(`(() => {
    const el = [...document.querySelectorAll('main input')].find((i) => (i.placeholder || '').startsWith(${JSON.stringify(placeholderStart)}));
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  })()`);
}

async function boundaryChecks(tag: string, touch: boolean) {
  const flowShapes: string[] = [];
  for (const n of BOUNDARY_COUNTS) {
    await navigate("#data-quality-issues");
    await setInput("Record or message", boundaryToken(n));
    await key("Enter", 13);
    await waitFor("window.__sc.settled()");
    await sleep(500);
    const t = (await evaluate<Array<{ mode: string; sh: number; ch: number; overflowY: string; rows: number }>>("window.__sc.tables()"))[0];
    const expected = n === 0 ? 1 : Math.min(n, IMPORT_PAGE_SIZE);
    record(`${tag}: Import Issues with ${n} rows shows ${Math.min(n, IMPORT_PAGE_SIZE)} on the page and flows with the page`, !!t && t.rows === expected && t.mode === "flow" && t.sh <= t.ch + 1, JSON.stringify(t));
    if (t) flowShapes.push(`${t.mode}/${t.overflowY}`);
    if (n === 300) {
      const pager = await evaluate<boolean>(`[...window.__sc.main().querySelectorAll('button')].some((b) => (b.textContent.trim() === 'Next' || b.getAttribute('aria-label') === 'Next page') && !b.disabled)`);
      record(`${tag}: 300 matching issues are served a page at a time with a reachable Next`, pager);
    }
    if (n === 51 || n === 300) await checkPage(`${tag} Import Issues (${n} rows)`, touch);
  }
  record(`${tag}: Import Issues scrolling is the same at every row count`, new Set(flowShapes).size === 1, [...new Set(flowShapes)].join(", "));
}

async function sidebarChecks(tag: string) {
  const open = await evaluate<boolean>(`!!document.querySelector('aside')`);
  if (!open) {
    await evaluate(`document.querySelector('button[aria-label="Open navigation menu"]')?.click(); true`);
    await waitFor(`!!document.querySelector('aside')`);
  }
  await evaluate(`[...document.querySelectorAll('aside button[aria-label^="Expand "]')].forEach((b) => b.click()); true`);
  await sleep(300);
  const groups = await evaluate<Array<[string, string[]]>>(`[...document.querySelectorAll('aside button[aria-controls^="nav-group-"]')].map((g) => [
    g.getAttribute('aria-label').replace(/^(Collapse|Expand) /, ''),
    [...(document.getElementById(g.getAttribute('aria-controls'))?.querySelectorAll('li button') ?? [])].map((b) => b.title),
  ])`);
  record(`${tag}: the sidebar is exactly the final route set`, JSON.stringify(groups) === JSON.stringify(FINAL_SIDEBAR), JSON.stringify(groups));
  const text = await evaluate<string>(`document.querySelector('aside')?.innerText ?? ''`);
  record(`${tag}: no retired planning page is offered in the sidebar`, !/Planning Workbench|Approval Queue|Rough Availability|Reservations|Planned Pieces|Planning Cases|Requirement Matrix|Priority Queue|Order Exceptions|Replenishment/.test(text));
}

async function retiredLinkChecks(tag: string, touch: boolean) {
  for (const [hash, reason] of RETIRED_LINKS) {
    await navigate("#dashboard");
    const from = eventCount();
    await navigate(hash);
    await sleep(300);
    const text = await evaluate<string>(`window.__sc.main().innerText`);
    const apiCalls = eventsSince(from)
      .filter((e) => e.method === "Network.requestWillBeSent")
      .map((e) => new URL((e.params as { request: { url: string } }).request.url).pathname)
      .filter((p) => p.startsWith("/api/") && p !== "/api/auth/me" && p !== "/api/notifications");
    record(`${tag}: ${hash} shows Not available with its reason`, /Not available/.test(text) && reason.test(text), text.slice(0, 160));
    record(`${tag}: ${hash} requests no page data`, apiCalls.length === 0, apiCalls.join(", "));
  }
  await checkPage(`${tag} retired link (Not available)`, touch);
}

async function main() {
  await assertScrollingTestDatabase();
  const sessionToken = process.argv.includes("--skip-seed")
    ? await (async () => {
        const { createSession } = await import("@/lib/auth/session");
        const root = await db.user.findUniqueOrThrow({ where: { username: "scroll.root" } });
        return (await createSession(root.id, { ip: null, userAgent: "scrolling-suite" })).token;
      })()
    : (await seedScrollingFixture()).sessionToken;

  const browser = await startBrowser();
  const base = browser.base;
  try {
    await signInAs(sessionToken);

    for (const [width, height] of VIEWPORTS) {
      const tag = `@${width}x${height}`;
      const touch = width <= 768;
      console.log(`\n=== ${tag}${touch ? " (touch)" : ""}`);
      await setViewport(width, height, touch);
      await send("Page.navigate", { url: `${base}/#dashboard` });
      await waitFor(`!!document.querySelector('main[data-scroll-owner="page"]')`, 20000);
      await evaluate(PAGE_HELPERS);

      for (const page of PAGES) {
        await navigate(`#${page}`);
        const tabs = await tabsOnPage();
        if (tabs.length === 0) await checkPage(`${tag} ${page}`, touch);
        for (const t of tabs) {
          await navigate(`#${page}`);
          await clickTab(t);
          await checkPage(`${tag} ${page} › ${t}`, touch);
        }
        if (page === "planning-workbook-import") {
          const ok = await openStoredOutput();
          record(`${tag}: Workbook Import reopens the stored output`, ok);
          if (ok) await checkPage(`${tag} planning-workbook-import › stored output`, touch);
        }
      }
      await interactionChecks(tag, width);
      await retiredLinkChecks(tag, touch);
      if (width === 1440 || width === 390) await boundaryChecks(tag, touch);
      await sidebarChecks(tag);
    }
  } finally {
    await browser.stop();
    await db.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPages that fit the viewport without scrolling: ${notes.length}`);
  for (const n of notes) console.log(`  - ${n}`);
  console.log(`\nSCROLLING: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
