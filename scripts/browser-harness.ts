import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

type CdpEvent = { method: string; params: any };
let socket: WebSocket | null = null;
let nextId = 0;
const pending = new Map<number, (v: any) => void>();
const events: CdpEvent[] = [];

async function connect(port: number) {
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
  ws.onmessage = (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? msg);
      pending.delete(msg.id);
    } else if (msg.method) events.push(msg);
  };
  socket = ws;
}

export const send = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const n = ++nextId;
    pending.set(n, resolve);
    socket!.send(JSON.stringify({ id: n, method, params }));
  });

export const evaluate = async <T = any>(expression: string): Promise<T> =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value as T;

export const waitFor = async (expression: string, ms = 12000) => {
  for (let t = 0; t < ms; t += 200) {
    if (await evaluate(expression)) return true;
    await sleep(200);
  }
  return false;
};

export async function wheel(x: number, y: number, deltaX: number, deltaY: number, modifiers = 0) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers });
  await sleep(450);
}
const KEY_TEXT: Record<string, string> = { Enter: "\r", " ": " " };
export async function key(keyName: string, code: number, modifiers = 0) {
  const text = KEY_TEXT[keyName];
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: keyName, code: keyName === " " ? "Space" : keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code: keyName, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
  await sleep(350);
}
export async function click(x: number, y: number) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(300);
}
export async function touchScroll(x: number, y: number, distance: number) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i++) {
    await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y - (distance * i) / 12) }] });
    await sleep(16);
  }
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(600);
}

export const eventCount = () => events.length;
export const eventsSince = (from: number): ReadonlyArray<CdpEvent> => events.slice(from);

export function consoleProblems(from: number): string[] {
  return events.slice(from).flatMap((e) => {
    if (e.method === "Runtime.exceptionThrown") return [String(e.params.exceptionDetails?.exception?.description ?? "exception").slice(0, 160)];
    if (e.method === "Runtime.consoleAPICalled" && (e.params.type === "error" || /hydrat/i.test(JSON.stringify(e.params.args ?? [])))) {
      return [(e.params.args ?? []).map((a: any) => a.value ?? a.description).join(" ").slice(0, 160)];
    }
    if (e.method === "Log.entryAdded" && e.params.entry.level === "error") return [String(e.params.entry.text).slice(0, 160)];
    return [];
  });
}

export const signInAs = (token: string) =>
  send("Network.setCookie", { name: "dp_session", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" });

export async function setViewport(width: number, height: number, touch: boolean) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: touch ? 5 : 0 });
}

export async function startBrowser(): Promise<{ base: string; stop: () => Promise<void> }> {
  if (!existsSync(".next/BUILD_ID")) throw new Error("No production build: run `npm run build` first.");
  const port = 3400 + Math.floor(Math.random() * 400);
  const base = `http://localhost:${port}`;
  const server = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { env: process.env, stdio: "ignore" });
  const profile = mkdtempSync(path.join(tmpdir(), "ui-chrome-"));
  const debugPort = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(findChrome(), ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars=false", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const stop = async () => {
    socket?.close();
    chrome.kill();
    server.kill();
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) {
      await sleep(500);
      up = await fetch(`${base}/api/public/login-context`).then((r) => r.ok, () => false);
    }
    if (!up) throw new Error("The production server did not start.");
    await connect(debugPort);
    for (const domain of ["Page", "Runtime", "Log", "Network"]) await send(`${domain}.enable`);
  } catch (e) {
    await stop();
    throw e;
  }
  return { base, stop };
}
