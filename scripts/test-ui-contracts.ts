// UI contracts that only a real browser can show: things placed after mount (the table tools
// that join a panel header), computed sizes from the density tokens, keyboard behaviour, and
// the retired legacy planning and Fantasy Rough slices as the production build serves them: old links show Not
// available, retired APIs answer 404, and no client chunk carries a retired page.
//
// Runs only against the isolated planning_sectest database and a production build:
//   npm run build && npm run test:ui-contracts
import { call, db, makeUser } from "../tests/security/helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { createSession, SESSION_COOKIE } from "@/lib/auth/session";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { assertScrollingTestDatabase, seedScrollingFixture } from "./scrolling-fixture";
import { consoleProblems, evaluate, eventCount, eventsSince, key, send, setViewport, signInAs, sleep, startBrowser, waitFor } from "./browser-harness";

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail = "") => {
  results.push({ check, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} ${check}${!ok && detail ? ` — ${detail}` : ""}`);
};

/** A user whose only role holds exactly these permissions; returns a session token. */
async function tokenWith(rootCookie: string, name: string, permissions: string[]): Promise<string> {
  const u = await makeUser(`contract.${name}.${Date.now().toString(36)}`, "VIEWER");
  const code = `CONTRACT_${name.toUpperCase()}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: rootCookie, body: { op: "createRole", code, name: code, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: rootCookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return (await createSession(u.user.id, { ip: null, userAgent: "ui-contracts" })).token;
}

let base = "";
async function open(hash: string) {
  // A fresh document each time, so a new session cookie takes effect (a hash-only change would not reload).
  await send("Page.navigate", { url: "about:blank" });
  await sleep(200);
  await send("Page.navigate", { url: `${base}/${hash}` });
  await waitFor(`!!document.querySelector('main[data-scroll-owner="page"]') && document.readyState === 'complete'`, 20000);
  await waitFor(`!document.querySelector('main .animate-spin, main .animate-pulse') && !/Loading/.test(document.querySelector('main').innerText)`, 15000);
  await sleep(400);
}
const mainText = () => evaluate<string>(`document.querySelector('main').innerText.replace(/\\s+/g, ' ')`);

async function tabStrip(tag: string, expectedPx: number) {
  await open("#analysis-inventory-position");
  const tabs = await evaluate<Array<{ h: number; token: boolean; selected: boolean }>>(`[...document.querySelectorAll('main [role="tab"]')].map((t) => ({ h: t.getBoundingClientRect().height, token: t.classList.contains('h-tab'), selected: t.getAttribute('aria-selected') === 'true' }))`);
  record(`${tag}: every tab uses the shared tab-height token (${expectedPx}px here)`, tabs.length > 1 && tabs.every((t) => t.token && Math.round(t.h) === expectedPx), JSON.stringify(tabs.map((t) => t.h)));
  await evaluate(`document.querySelector('main [role="tab"][aria-selected="true"]').focus(); true`);
  const before = await evaluate<string>(`document.activeElement.textContent.trim()`);
  await key("ArrowRight", 39);
  await sleep(400);
  const after = await evaluate<{ label: string; selected: boolean }>(`({ label: document.activeElement.textContent.trim(), selected: document.activeElement.getAttribute('aria-selected') === 'true' })`);
  record(`${tag}: arrow keys still move between tabs and select them`, after.label !== before && after.selected, `${before} → ${after.label}`);
}

async function importIssuesExport(tag: string, rootToken: string, readerToken: string) {
  await signInAs(rootToken);
  await open("#data-quality-issues");
  const found = await evaluate<{ inHeader: boolean; visible: boolean; uncut: boolean } | null>(`(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Export');
    if (!b) return null;
    const section = b.closest('[data-section]'), header = b.closest('header');
    const r = b.getBoundingClientRect(), s = section.getBoundingClientRect();
    const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { inHeader: !!header && !!section && section.contains(header), visible: r.width > 0 && r.height > 0, uncut: r.left >= s.left - 1 && r.right <= s.right + 1 && !!hit && b.contains(hit) };
  })()`);
  record(`${tag}: Import Issues shows Export in the Issues panel header, visible and uncut`, !!found && found.inHeader && found.visible && found.uncut, JSON.stringify(found));
  await evaluate(`[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Export').focus(); true`);
  await key("Enter", 13);
  await sleep(400);
  const menu = await evaluate<string>(`[...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map((m) => m.innerText).join(' ')`);
  record(`${tag}: from the keyboard, Export opens a menu that says it exports the rows on this page`, /Rows on this page/.test(menu) && /Export visible rows \(CSV\)/.test(menu) && !/loaded rows/.test(menu), menu.replace(/\s+/g, " ").slice(0, 160));
  await key("Escape", 27);
  await signInAs(readerToken);
  await open("#data-quality-issues");
  const text = await mainText();
  record(`${tag}: a reader without the export permission sees the issues but no Export`, /Recorded problem/.test(text) && !(await evaluate<boolean>(`[...document.querySelectorAll('main button')].some((x) => x.textContent.trim() === 'Export')`)));
  await signInAs(rootToken);
}

async function recentFiles(tag: string) {
  await open("#planning-workbook-import");
  const header = await evaluate<{ name: string; sort: string | null } | null>(`(() => {
    const th = [...document.querySelectorAll('main th[scope="col"]')].find((t) => /Packet/.test(t.textContent));
    if (!th) return null;
    const copy = th.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return { name: copy.textContent.trim(), sort: th.getAttribute('aria-sort') };
  })()`);
  record(`${tag}: Recent Files names the column "Packet Type" and announces its sort state`, header?.name === "Packet Type" && header.sort === "none", JSON.stringify(header));
}

/** Old links to the retired planning pages, and the reason each must state. */
const RETIRED_LINKS: Array<[string, RegExp]> = [
  ["#planning-workbench?tab=comparison", /outside the current planning utility/],
  ["#planning-cases", /outside the current planning utility/],
  ["#planning-reservations", /outside the current planning utility/],
  ["#planning-approval-queue", /outside the current planning utility/],
  ["#planning-rough-availability", /No authoritative rough-stock source is configured\./],
  ["#fantasy-rough", /No authoritative rough-stock source is configured\./],
  ["#fantasy-live", /No authoritative rough-stock source is configured\./],
  ["#requirements-matrix", /Requirements and order workflows are not configured for this planning utility\./],
  ["#requirements-priority-queue", /Requirements and order workflows are not configured for this planning utility\./],
  ["#orders-exceptions", /Requirements and order workflows are not configured for this planning utility\./],
  ["#replenishment-allocation", /Requirements and order workflows are not configured for this planning utility\./],
  ["#requirements-orders", /Requirements and order workflows are not configured for this planning utility\./],
  ["#requirements-special", /Requirements and order workflows are not configured for this planning utility\./],
  ["#analysis-orders", /Requirements and order workflows are not configured for this planning utility\./],
];
/** The retired legacy planning APIs; the production build must not serve any of them. */
const RETIRED_APIS = [
  "/api/planning/cases", "/api/planning/cases/x", "/api/planning/cases/x/replan", "/api/planning/compare/x", "/api/planning/pieces",
  "/api/planning/workbench", "/api/planning/reservations", "/api/planning/approvals", "/api/planning/rough", "/api/admin/approval-policy",
  "/api/fantasy/rough",
  "/api/requirements", "/api/requirements/x", "/api/requirements/x/priority", "/api/analysis/orders",
];

/** Requests to the application's API since `from`, by path. */
const apiRequestsSince = (from: number) =>
  eventsSince(from)
    .filter((e) => e.method === "Network.requestWillBeSent")
    .map((e) => new URL(e.params.request.url).pathname)
    .filter((p) => p.startsWith("/api/"));

async function retiredPlanning(tag: string, rootToken: string, desktop: boolean) {
  await signInAs(rootToken);
  // Old links open Not available with the reason, and ask the server for no page data.
  for (const [hash, reason] of RETIRED_LINKS) {
    const from = eventCount();
    await open(hash);
    const text = await mainText();
    const data = apiRequestsSince(from).filter((p) => p !== "/api/auth/me" && p !== "/api/notifications");
    record(`${tag}: ${hash} shows Not available with its reason and requests no page data`, /Not available/.test(text) && reason.test(text) && data.length === 0, `${text.slice(0, 140)} | ${data.join(", ")}`);
  }
  // Every retired API is gone from the production build, for reads and writes alike, even for
  // the Super Admin. Asked from this process with the same session, so the page's console stays
  // a clean signal.
  const statuses: Array<[string, number, number]> = [];
  for (const p of RETIRED_APIS) {
    const headers = { cookie: `${SESSION_COOKIE}=${rootToken}`, origin: base, "content-type": "application/json" };
    statuses.push([p, (await fetch(base + p, { headers })).status, (await fetch(base + p, { method: "POST", headers, body: "{}" })).status]);
  }
  record(`${tag}: every retired planning API answers 404 to GET and POST`, statuses.every(([, g, p]) => g === 404 && p === 404), JSON.stringify(statuses.filter(([, g, p]) => g !== 404 || p !== 404)));

  // Fantasy Data shows polished stock only and asks for no rough stock.
  let from = eventCount();
  await open("#fantasy-data");
  let requested = apiRequestsSince(from);
  record(`${tag}: Fantasy Data requests polished stock and no rough stock`, requested.includes("/api/fantasy/polished") && !requested.some((p) => p.startsWith("/api/fantasy/rough")) && !/Rough stock/i.test(await mainText()), requested.join(", "));
  // Synchronization presents no rough mirror as live stock.
  await open("#fantasy-data?tab=integration");
  const sync = await mainText();
  record(`${tag}: Integration Status shows no "Current Rough" figure and no rough stock row`, /Integration Status/.test(sync) && !/Current Rough|Rough Stock/i.test(sync), sync.slice(0, 160));

  if (desktop) {
    // Global search asks for polished lots and requirements, never rough stock.
    await open("#dashboard");
    from = eventCount();
    await evaluate(`(() => {
      const el = document.querySelector('input[placeholder^="Search polished lot"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'GIA');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
      return true;
    })()`);
    await waitFor(`!!document.querySelector('input[placeholder^="Search polished lot"]')`);
    await sleep(1500);
    requested = apiRequestsSince(from);
    record(`${tag}: global search queries polished lots only, never a retired requirement or rough route`, requested.includes("/api/fantasy/polished") && !requested.some((p) => p.startsWith("/api/fantasy/rough") || p.startsWith("/api/requirements")), requested.join(", "));
  }
}

/** No client chunk of the production build carries a retired page or API. */
function bundleChecks() {
  const dir = path.join(process.cwd(), ".next", "static", "chunks");
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".js"));
  const MARKERS = [
    "/api/planning/cases", "/api/planning/compare", "/api/planning/pieces", "/api/planning/workbench", "/api/planning/reservations",
    "/api/planning/approvals", "/api/planning/rough", "/api/admin/approval-policy", "Approve this plan", "Request replanning", "Rough Reservations",
    "/api/fantasy/rough", "fantasyRoughCount", "Current Rough",
    "/api/requirements", "/api/analysis/orders", "Requirement Matrix", "Priority Queue", "Order Exceptions", "Replenishment & Allocation", "Critical Reqs", "Overdue Reqs",
    // Customer 360's seeded order count and the sign-in page's retired module.
    "Open Orders", "Open and partly filled orders", "Traceability",
  ];
  const found = files.flatMap((f) => {
    const js = readFileSync(path.join(dir, f), "utf8");
    return MARKERS.filter((m) => js.includes(m)).map((m) => `${f}: ${m}`);
  });
  record(`production bundle: none of ${files.length} client chunks carries a retired page, API, order figure or module`, files.length > 0 && found.length === 0, found.slice(0, 5).join(" | "));
}

async function main() {
  await assertScrollingTestDatabase();
  const rootToken = process.argv.includes("--skip-seed")
    ? (await createSession((await db.user.findUniqueOrThrow({ where: { username: "scroll.root" } })).id, { ip: null, userAgent: "ui-contracts" })).token
    : (await seedScrollingFixture()).sessionToken;
  const rootCookie = `${SESSION_COOKIE}=${rootToken}`;
  const dqReader = await tokenWith(rootCookie, "dqreader", ["data_quality.read"]);

  const browser = await startBrowser();
  base = browser.base;
  try {
    await signInAs(rootToken);
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      const tag = `@${width}x${height}`;
      console.log(`\n=== ${tag}`);
      await setViewport(width, height, width < 768);
      const from = eventCount();
      await tabStrip(tag, width < 768 ? 40 : 32);
      await importIssuesExport(tag, rootToken, dqReader);
      await recentFiles(tag);
      await retiredPlanning(tag, rootToken, width >= 1024);
      const problems = consoleProblems(from);
      const refused = eventsSince(from).filter((e) => e.method === "Network.responseReceived" && e.params.response.status === 403).map((e) => new URL(e.params.response.url).pathname);
      if (refused.length) console.log(`  refused requests: ${[...new Set(refused)].join(", ")}`);
      record(`${tag}: no console errors or hydration warnings`, problems.length === 0, problems.slice(0, 2).join(" | "));
    }
    bundleChecks();
  } finally {
    await browser.stop();
    await db.$disconnect();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nUI CONTRACTS: ${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
