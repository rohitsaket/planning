// Scrolling regression suite, in a real browser under real input.
//
// One vertical page scroller (<main>), tables that scroll only horizontally unless they are
// explicitly bounded, bounded regions that hand the gesture back to the page at their ends,
// and no clipped content or second body scrollbar — checked on every retained page and tab at
// six viewport sizes with mouse-wheel, trackpad, Shift+wheel, touch and keyboard input, plus
// row-count boundary sets around the old 50-row switch. Scroll positions are read back after
// each input; nothing is inferred from class names.
//
// Runs only against the isolated planning_sectest database and a production build:
//   npm run build && npm run test:scrolling
// Chrome is taken from CHROME_BIN or the usual install locations. `--viewports=1440x900,390x844`
// limits the sizes; `--skip-seed` reuses data already seeded.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../tests/security/helpers";
import { assertScrollingTestDatabase, BOUNDARY_COUNTS, BOUNDED_BOUNDARY_COUNTS, boundaryToken, seedScrollingFixture } from "./scrolling-fixture";

const ALL_VIEWPORTS = ["1440x900", "1366x768", "1024x768", "768x1024", "390x844", "360x800"];
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const VIEWPORTS = (arg("viewports")?.split(",") ?? ALL_VIEWPORTS).map((v) => v.split("x").map(Number) as [number, number]);
const PAGES = [
  "dashboard", "analysis-sales", "analysis-customers-orders", "analysis-inventory-position", "fantasy-data", "data-quality-issues",
  "requirements-matrix", "requirements-priority-queue", "orders-exceptions", "replenishment-allocation", "planning-rough-availability",
  "planning-workbook-import", "planning-workbench", "planning-approval-queue", "admin-users-access", "admin-mappings", "admin-audit-log",
];
const IMPORT_PAGE_SIZE = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { check: string; ok: boolean; detail: string }[] = [];
const notes: string[] = [];
const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, ok, detail });
  if (!ok) console.log(`  FAIL ${check}${detail ? ` — ${detail}` : ""}`);
};

function findChrome(): string {
  const candidates = [
    process.env.CHROME_BIN,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("Chrome not found: set CHROME_BIN.");
  return found;
}

// ---- Chrome DevTools Protocol --------------------------------------------------------------
type Cdp = { send: (method: string, params?: object) => Promise<any>; events: { method: string; params: any }[]; close: () => void };

async function connect(port: number): Promise<Cdp> {
  let wsUrl = "";
  for (let i = 0; i < 75 && !wsUrl; i++) {
    await sleep(200);
    try {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
    } catch {}
  }
  if (!wsUrl) throw new Error("Chrome DevTools endpoint did not come up");
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const events: Cdp["events"] = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? msg);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return { send, events, close: () => ws.close() };
}

let cdp: Cdp;
const evaluate = async <T = any>(expression: string): Promise<T> =>
  (await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value as T;
const waitFor = async (expression: string, ms = 12000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await evaluate(expression)) return true;
    await sleep(200);
  }
  return false;
};

// In-page helpers, installed after every navigation. Plain JavaScript: this runs in the page.
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

async function wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers });
  await sleep(450);
}
async function key(keyName: string, code: number, modifiers = 0) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyName, code: keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
  await sleep(350);
}
async function click(x: number, y: number) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(300);
}
// A finger drag: touchstart, twelve moves, touchend. Positive distance swipes up (scrolls down).
// Real touch events, so the browser's own gesture handling decides what scrolls.
async function touchScroll(x: number, y: number, distance: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y - (distance * i) / 12) }] });
    await sleep(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
}
const mainState = () => evaluate<{ top: number; sh: number; ch: number; left: number; docH: number; docW: number; ih: number; iw: number }>("window.__sc.state()");
const setMainTop = (top: number) => evaluate(`window.__sc.main().scrollTop = ${top}; true`);

function consoleProblems(from: number): string[] {
  return cdp.events.slice(from).flatMap((e) => {
    if (e.method === "Runtime.exceptionThrown") return [String(e.params.exceptionDetails?.exception?.description ?? "exception").slice(0, 160)];
    if (e.method === "Runtime.consoleAPICalled" && (e.params.type === "error" || /hydrat/i.test(JSON.stringify(e.params.args ?? [])))) {
      return [(e.params.args ?? []).map((a: any) => a.value ?? a.description).join(" ").slice(0, 160)];
    }
    if (e.method === "Log.entryAdded" && e.params.entry.level === "error") return [String(e.params.entry.text).slice(0, 160)];
    return [];
  });
}

// ---- Checks for one rendered page ----------------------------------------------------------
async function checkPage(label: string, touch: boolean) {
  const from = cdp.events.length;
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
    // Wheel outside any table scrolls <main>.
    const g = await evaluate<{ x: number; y: number; inTable: boolean }>("window.__sc.gutter()");
    await wheel(g.x, g.y, 0, 300);
    const afterGutter = await mainState();
    record(`${label}: wheel outside tables scrolls the page`, afterGutter.top > 0, `top ${afterGutter.top}`);
    await setMainTop(0);

    // Wheel over a flowing table scrolls the page, not the table.
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

    // The page scrolls to its end, and every pager can be scrolled into view uncovered.
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

  // Horizontal: a wide flowing table scrolls sideways by trackpad and Shift+wheel, the page never does.
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

  // Bounded regions scroll themselves, respond to the keyboard, and hand the gesture back at their end.
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
    // At the region's end, continued gestures reach the page. A gesture that starts while the
    // region can still move (even by a sub-pixel remainder) stays with the region, as browsers
    // do, so the page must move within a few gestures, not necessarily the first.
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

// ---- Interaction checks that are not per page ----------------------------------------------
async function interactionChecks(tag: string, width: number) {
  const mobile = width < 768;
  // Switching tabs from deep in a page starts the new tab at the top.
  await navigate("#analysis-inventory-position");
  await setMainTop(600);
  const tabs = await tabsOnPage();
  if (tabs.length > 1) {
    await clickTab(tabs[1]);
    record(`${tag}: switching tabs starts the new tab at the top`, (await mainState()).top === 0);
  }

  // Keyboard: Page Down, End and Home scroll <main> after a click in the page.
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

  // Tab navigation brings focus into view below the sticky header.
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

  // A dialog and a popover leave no scroll lock behind.
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
    // Collapsing and expanding the sidebar keeps the page scroller working.
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
    // The mobile drawer scrolls on its own; choosing a page closes it and the page scrolls again.
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

// ---- Row-count boundaries -----------------------------------------------------------------
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
    const expected = n === 0 ? 1 : Math.min(n, IMPORT_PAGE_SIZE); // 0 rows shows one empty-state row
    record(`${tag}: Import Issues with ${n} rows shows ${Math.min(n, IMPORT_PAGE_SIZE)} on the page and flows with the page`, !!t && t.rows === expected && t.mode === "flow" && t.sh <= t.ch + 1, JSON.stringify(t));
    if (t) flowShapes.push(`${t.mode}/${t.overflowY}`);
    if (n === 300) {
      const pager = await evaluate<boolean>(`[...window.__sc.main().querySelectorAll('button')].some((b) => (b.textContent.trim() === 'Next' || b.getAttribute('aria-label') === 'Next page') && !b.disabled)`);
      record(`${tag}: 300 matching issues are served a page at a time with a reachable Next`, pager);
    }
    if (n === 51 || n === 300) await checkPage(`${tag} Import Issues (${n} rows)`, touch);
  }
  record(`${tag}: Import Issues scrolling is the same at every row count`, new Set(flowShapes).size === 1, [...new Set(flowShapes)].join(", "));

  const boundedShapes: string[] = [];
  for (const n of BOUNDED_BOUNDARY_COUNTS) {
    await navigate("#planning-rough-availability");
    await setInput("Search by stone name", boundaryToken(n));
    await sleep(500);
    const t = (await evaluate<Array<{ mode: string; sh: number; ch: number; overflowY: string; maxHeight: string; rows: number }>>("window.__sc.tables()"))[0];
    const expected = n === 0 ? 1 : n;
    record(`${tag}: Rough Availability with ${n} rows shows them all in its bounded table`, !!t && t.mode === "bounded" && t.rows === expected, JSON.stringify(t));
    if (t) boundedShapes.push(`${t.mode}/${t.overflowY}/${t.maxHeight}`);
    if (n === 51) await checkPage(`${tag} Rough Availability (${n} rows)`, touch);
  }
  record(`${tag}: Rough Availability scrolling is the same at every row count`, new Set(boundedShapes).size === 1, [...new Set(boundedShapes)].join(", "));
}

// ---- Run ------------------------------------------------------------------------------------
async function main() {
  await assertScrollingTestDatabase();
  if (!existsSync(".next/BUILD_ID")) throw new Error("No production build: run `npm run build` first.");
  const sessionToken = process.argv.includes("--skip-seed")
    ? await (async () => {
        const { createSession } = await import("@/lib/auth/session");
        const root = await db.user.findUniqueOrThrow({ where: { username: "scroll.root" } });
        return (await createSession(root.id, { ip: null, userAgent: "scrolling-suite" })).token;
      })()
    : (await seedScrollingFixture()).sessionToken;

  const port = 3400 + Math.floor(Math.random() * 400);
  const base = `http://localhost:${port}`;
  const server: ChildProcess = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { env: process.env, stdio: "ignore" });
  const profile = mkdtempSync(path.join(tmpdir(), "scroll-chrome-"));
  const debugPort = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars=false", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) {
      await sleep(500);
      up = await fetch(`${base}/api/public/login-context`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error("The production server did not start.");
    cdp = await connect(debugPort);
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await cdp.send(`${domain}.enable`);
    await cdp.send("Network.setCookie", { name: "dp_session", value: sessionToken, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" });

    for (const [width, height] of VIEWPORTS) {
      const tag = `@${width}x${height}`;
      const touch = width <= 768;
      console.log(`\n=== ${tag}${touch ? " (touch)" : ""}`);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
      await cdp.send("Page.navigate", { url: `${base}/#dashboard` });
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
      if (width === 1440 || width === 390) await boundaryChecks(tag, touch);
    }
  } finally {
    cdp?.close();
    chrome.kill();
    server.kill();
    await db.$disconnect();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
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
