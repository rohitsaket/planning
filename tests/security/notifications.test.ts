import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { call, makeUser, resetDb, db } from "./helpers";
import { POST as broadcast } from "@/app/api/notifications/broadcast/route";

const ROOT = process.cwd();
// Random per run: a fixed port lets a service left over from an earlier run answer the
// health check with a stale token, which shows up as a confusing 401.
const PORT = 3900 + Math.floor(Math.random() * 90);
const TOKEN = "t".repeat(16) + Math.random().toString(36).slice(2).padEnd(24, "x");
const URL_ = `http://127.0.0.1:${PORT}`;
let svc: ChildProcess;
let svcStartError: string | null = null;

beforeAll(async () => {
  await resetDb();
  // The service declares `tsx index.ts` as its start command; spawning `bun` here was a
  // leftover from the Bun test runner and simply fails on a Node install.
  svc = spawn("npx", ["tsx", "index.ts"], {
    cwd: path.join(ROOT, "mini-services/notifications-service"),
    env: { ...process.env, NOTIFY_PORT: String(PORT), NOTIFY_SERVICE_TOKEN: TOKEN, ALLOWED_ORIGINS: "https://planning.example.com" },
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  // Without this listener a spawn failure raises an unhandled 'error' event and kills the
  // whole run instead of failing this suite.
  svc.on("error", (e) => {
    svcStartError = e.message;
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${URL_}/health`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  process.env.NOTIFY_SERVICE_TOKEN = TOKEN;
  process.env.NOTIFY_INTERNAL_URL = URL_;
  const up = await fetch(`${URL_}/health`).then((r) => r.ok).catch(() => false);
  if (!up) throw new Error(`notifications service did not start${svcStartError ? `: ${svcStartError}` : " (no /health response)"}`);
});
afterAll(() => {
  if (!svc?.pid) return;
  // On Windows the shell wrapper is the direct child; killing only it orphans the
  // service and leaves the port held.
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(svc.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      svc.kill();
    }
  } else {
    svc.kill();
  }
});

const post = (body: string, headers: Record<string, string> = {}) => fetch(`${URL_}/broadcast`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
const good = JSON.stringify({ type: "TEST_EVENT", title: "hello", message: "m", severity: "info" });

describe("notifications service at runtime (SEC-004)", () => {
  test("anonymous broadcast → 401; wrong token → 401", async () => {
    expect((await post(good)).status).toBe(401);
    expect((await post(good, { authorization: "Bearer wrong-token-wrong-token-wrong-token-1234" })).status).toBe(401);
  });
  test("valid service token → 200; invalid payload → 400; oversized body → 413", async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await post(good, auth)).status).toBe(200);
    expect((await post(JSON.stringify({ type: "bad type!", title: "" }), auth)).status).toBe(400);
    expect((await post("{broken", auth)).status).toBe(400);
    expect((await post(JSON.stringify({ type: "T", title: "t", message: "x".repeat(20_000) }), auth)).status).toBe(413);
  });
  test("no wildcard CORS; a foreign origin is not granted access; socket without a session is refused", async () => {
    const r = await fetch(`${URL_}/health`, { headers: { origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
    const poll = await fetch(`${URL_}/socket.io/?EIO=4&transport=polling`, { headers: { origin: "https://evil.example" } });
    expect(poll.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(poll.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
    // Engine.IO handshake succeeds at transport level, but the namespace connect must be rejected.
    const sid = JSON.parse((await poll.text()).slice(1)).sid;
    await fetch(`${URL_}/socket.io/?EIO=4&transport=polling&sid=${sid}`, { method: "POST", body: "40" });
    const reply = await (await fetch(`${URL_}/socket.io/?EIO=4&transport=polling&sid=${sid}`)).text();
    expect(reply.startsWith("44")).toBe(true); // 44 = CONNECT_ERROR
    expect(reply).toContain("unauthorized");
  });
});

describe("user-facing broadcast route", () => {
  test("anonymous → 401; viewer → 403; admin → 200 and audited with the session user", async () => {
    const viewer = await makeUser("nviewer", "VIEWER");
    const admin = await makeUser("nadmin", "ADMIN");
    const body = { type: "TEST_EVENT", title: "hello", actor: "someone.else" };
    expect((await call(broadcast, { method: "POST", body })).status).toBe(401);
    expect((await call(broadcast, { method: "POST", cookie: viewer.cookie, body })).status).toBe(403);
    expect((await call(broadcast, { method: "POST", cookie: admin.cookie, body })).status).toBe(200);
    expect((await db.auditLog.findFirst({ where: { action: "NOTIFICATION_BROADCAST" } }))?.actor).toBe("nadmin");
    expect((await call(broadcast, { method: "POST", cookie: admin.cookie, body: { type: "lower case", title: "" } })).status).toBe(400);
  });
});
