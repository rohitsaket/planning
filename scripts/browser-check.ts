// Real-browser check over the Chrome DevTools Protocol (no extra dependencies):
// loads the app, confirms the sign-in gate renders under the CSP, signs in through the form,
// opens views, and records console errors, CSP violations and failed requests.
// Usage: CHROME_BIN=... BROWSER_BASE=http://127.0.0.1:3187 BROWSER_USER=u BROWSER_PASS=p bun scripts/browser-check.ts
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.BROWSER_BASE || "http://127.0.0.1:3187";
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333 + Math.floor(Math.random() * 500);
const VIEWS = (process.env.BROWSER_VIEWS || "dashboard,analysis-sales,analysis-customers,requirements-matrix,planning-cases,planning-approval-queue,planning-reservations,admin-audit-log,admin-users,manufacturing-traceability").split(",");

const profile = mkdtempSync(path.join(tmpdir(), "sec-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch {}
}
if (!wsUrl) throw new Error("Chrome DevTools endpoint did not come up");

const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map<number, (v: any) => void>();
const events: { method: string; params: any }[] = [];
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
const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
const waitFor = async (expression: string, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");

const results: { check: string; ok: boolean; detail: string }[] = [];
const record = (check: string, ok: boolean, detail = "") => results.push({ check, ok, detail });

await send("Page.navigate", { url: `${BASE}/` });
const gate = await waitFor(`!!document.querySelector('input[autocomplete="current-password"]')`);
record("sign-in gate renders and hydrates under the production CSP", gate);

const setValue = (sel: string, v: string) =>
  evaluate(`(() => { const el = document.querySelector('${sel}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
await setValue("#username", process.env.BROWSER_USER!);
await setValue("#password", process.env.BROWSER_PASS!);
await evaluate(`document.querySelector('form button[type=submit]').click()`);
const signedIn = await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Sign out')`);
record("sign-in through the form reaches the application shell", signedIn);
const cookieVisibleToJs = await evaluate(`document.cookie.includes('dp_session')`);
record("session cookie is not readable from JavaScript (HttpOnly)", cookieVisibleToJs === false);

for (const view of VIEWS) {
  const before = events.length;
  await evaluate(`location.hash = '${view}'; location.reload(); true`);
  await sleep(300);
  await waitFor(`!!document.querySelector('header') && document.readyState === 'complete'`);
  await sleep(2500);
  const fresh = events.slice(before);
  const errs = fresh.filter((e) => (e.method === "Runtime.exceptionThrown") || (e.method === "Log.entryAdded" && e.params.entry.level === "error") || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"));
  const api4xx5xx = fresh.filter((e) => e.method === "Network.responseReceived" && e.params.response.url.includes("/api/") && e.params.response.status >= 400);
  const detail = [
    ...errs.map((e) => (e.params.entry?.text ?? e.params.exceptionDetails?.exception?.description ?? e.params.args?.map((a: any) => a.value ?? a.description).join(" ") ?? "").slice(0, 160)),
    ...api4xx5xx.map((e) => `${e.params.response.status} ${new URL(e.params.response.url).pathname}`),
  ].join(" ; ");
  record(`view ${view}: no console errors, no API 4xx/5xx`, errs.length === 0 && api4xx5xx.length === 0, detail);
}

const csp = events.filter((e) => JSON.stringify(e.params).includes("Content Security Policy"));
record("no Content-Security-Policy violations across all views", csp.length === 0, csp.slice(0, 3).map((e) => (e.params.entry?.text ?? "").slice(0, 200)).join(" ; "));

await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sign out').click()`);
record("sign out returns to the sign-in gate", await waitFor(`!!document.querySelector('input[autocomplete="current-password"]')`));

ws.close();
chrome.kill();
const scriptDir = import.meta.dirname || (import.meta as any).dir || path.dirname(new URL(import.meta.url).pathname);
const out = path.resolve(scriptDir, "../security-audit/remediation");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "browser-check.md"), `# Browser check — headless Chrome via DevTools protocol against ${BASE}\n\nRun: ${new Date().toISOString()}\n\n| Result | Check | Detail |\n|---|---|---|\n${results.map((r) => `| ${r.ok ? "PASS" : "FAIL"} | ${r.check} | ${r.detail.replace(/\|/g, "\\|")} |`).join("\n")}\n`);
const failed = results.filter((r) => !r.ok);
console.log(`${failed.length ? "FAIL" : "PASS"}: ${results.length - failed.length}/${results.length}`);
for (const f of failed) console.log(`FAIL ${f.check} :: ${f.detail}`);
process.exit(failed.length ? 1 : 0);
