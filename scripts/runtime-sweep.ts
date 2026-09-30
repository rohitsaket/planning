// Live HTTP security sweep against a RUNNING instance (never in-process).
// Usage: SWEEP_BASE=http://127.0.0.1:3100 SWEEP_CREDS=/path/creds.txt bun scripts/runtime-sweep.ts
// creds file: one "<username> <password>" per line for roles VIEWER, DATA_ANALYST, PLANNER, PLANNING_MANAGER, ADMIN, SUPER_ADMIN.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
// Roles other than SUPER_ADMIN are test fixture custom roles (tests/security/fixture-roles.ts).
import { testHasPermission } from "../tests/security/fixture-roles";

const BASE = process.env.SWEEP_BASE || "http://127.0.0.1:3100";
const scriptDir = import.meta.dirname || (import.meta as any).dir || path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(scriptDir, "..");
// Generated evidence, not source: it goes to the system temp directory, never the repository.
const OUT = path.join(tmpdir(), "planning-runtime-sweep");
const PUBLIC = new Set(["GET /api", "POST /api/auth/login", "POST /api/auth/logout"]);
let failures = 0;
const notes: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  notes.push(`| ${ok ? "PASS" : "FAIL"} | ${name} | ${detail} |`);
  if (!ok) failures++;
};

// ---- sessions ----
const creds = readFileSync(process.env.SWEEP_CREDS!, "utf8").trim().split("\n").map((l) => l.split(" "));
const sessions: { username: string; role: string; cookie: string }[] = [];
for (const [username, password] of creds) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const role = ((await r.json()) as { user?: { role: string } }).user?.role ?? "?";
  sessions.push({ username, role, cookie: setCookie.split(";")[0] });
  if (sessions.length === 1) {
    check("login sets HttpOnly cookie", /HttpOnly/i.test(setCookie), setCookie.replace(/=[^;]+/, "=<redacted>"));
    check("login cookie SameSite=Lax, Path=/", /SameSite=Lax/i.test(setCookie) && /Path=\//.test(setCookie));
  }
  check(`login ${username}`, r.status === 200, `status ${r.status}`);
}

// ---- route inventory from source ----
function findRouteFiles(dir: string, base = ""): string[] {
  const res: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        res.push(...findRouteFiles(path.join(dir, entry.name), rel));
      } else if (entry.name === "route.ts") {
        res.push(rel);
      }
    }
  } catch {}
  return res;
}

interface Entry { route: string; method: string; guard: string }
const entries: Entry[] = [];
const routeFiles = findRouteFiles(path.join(ROOT, "src/app/api"), "src/app/api").sort();
for (const f of routeFiles) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  const route = "/" + f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
  for (const m of src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = withApi(?:<[^(]*>)?\(\{\s*([^}]*)\}/g)) {
    const perm = /permission: "([^"]+)"/.exec(m[2])?.[1];
    entries.push({ route, method: m[1], guard: perm ?? (/public: true/.test(m[2]) ? "PUBLIC" : "AUTHENTICATED") });
  }
}

const hit = async (e: Entry, cookie?: string) => {
  const url = BASE + e.route.replace(/\[(\w+)\]/g, "zzz-nonexistent");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (e.method !== "GET") headers["content-type"] = "application/json";
  const r = await fetch(url, { method: e.method, headers, body: e.method === "GET" ? undefined : "{}", redirect: "manual" });
  return r.status;
};

const rows: string[] = [];
for (const e of entries) {
  const key = `${e.method} ${e.route}`;
  const anon = await hit(e);
  if (PUBLIC.has(key)) check(`${key} public`, anon !== 401 && anon !== 403, `anon ${anon}`);
  else if (anon !== 401) check(`${key} anonymous must be 401`, false, `got ${anon}`);
  const cells: string[] = [];
  for (const s of sessions) {
    if (e.route === "/api/auth/logout") { cells.push("n/a"); continue; }
    const status = await hit(e, s.cookie);
    const allowed = e.guard === "PUBLIC" || e.guard === "AUTHENTICATED" || testHasPermission(s.role, e.guard as never);
    const ok = allowed ? status !== 401 && status !== 403 && status < 500 : status === 403;
    if (!ok) check(`${key} as ${s.role}`, false, `got ${status}, expected ${allowed ? "allowed (not 401/403/5xx)" : "403"}`);
    cells.push(String(status));
  }
  rows.push(`| ${key} | ${e.guard} | ${anon} | ${cells.join(" | ")} |`);
}
check(`route sweep: ${entries.length} handlers × (anonymous + ${sessions.length} roles)`, failures === 0);

// ---- targeted runtime checks ----
const admin = sessions.find((s) => s.role === "ADMIN")!;
// Any signed-in role that may override a requirement's priority: the live mutation used below.
const overrider = sessions.find((s) => testHasPermission(s.role, "requirement.override"))!;
const j = (cookie: string, url: string, init: RequestInit = {}) => fetch(BASE + url, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });

let r = await fetch(`${BASE}/api/analysis/customers`, { headers: { cookie: "dp_session=forged", "x-user": "admin", "x-role": "SUPER_ADMIN" } });
check("forged cookie + X-User/X-Role headers → 401", r.status === 401, `status ${r.status}`);
const requirement = ((await (await j(overrider.cookie, "/api/requirements?pageSize=1")).json()) as { rows: { id: string }[] }).rows[0];
const priorityUrl = `/api/requirements/${requirement?.id ?? "zzz-nonexistent"}/priority`;
r = await j(overrider.cookie, priorityUrl, { method: "POST", body: "{not json" });
check("malformed JSON → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/analysis/sales?windowDays=abc");
check("windowDays=abc → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/data-quality?pageSize=999999");
check("over-limit pageSize → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/data-quality?pageSize=1");
const paged = (await r.json()) as { rows: unknown[]; paging: { total: number; hasMore: boolean } };
check("pageSize=1 → at most 1 row, hasMore matches the total", paged.rows.length <= 1 && paged.paging.hasMore === paged.paging.total > 1);

// forged actor over real HTTP
if (requirement) {
  r = await j(overrider.cookie, priorityUrl, { method: "POST", body: JSON.stringify({ priority: "HIGH", reason: "runtime sweep identity check", actor: "ceo", updatedBy: "ceo" }) });
  const audit = (await (await j(admin.cookie, "/api/admin/audit?action=REQUIREMENT_PRIORITY_OVERRIDE&pageSize=5")).json()) as { rows: { actor: string; action: string; entityId: string }[] };
  const row = audit.rows.find((a) => a.entityId === requirement.id);
  check("forged actor 'ceo' over HTTP → audit actor is the session user", r.status === 200 && row?.actor === overrider.username, `status ${r.status}, actor ${row?.actor}`);
}
r = await fetch(BASE + priorityUrl, { method: "POST", headers: { cookie: overrider.cookie, "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check("cross-origin POST with a valid cookie → 403", r.status === 403, `status ${r.status}`);

// The retired legacy planning APIs are not served, whoever asks.
for (const url of ["/api/planning/cases", "/api/planning/compare/x", "/api/planning/pieces", "/api/planning/workbench", "/api/planning/reservations", "/api/planning/approvals", "/api/planning/rough", "/api/admin/approval-policy", "/api/fantasy/rough"]) {
  const [get, post] = [await j(admin.cookie, url), await j(admin.cookie, url, { method: "POST", body: "{}" })];
  check(`retired ${url} → 404`, get.status === 404 && post.status === 404, `GET ${get.status}, POST ${post.status}`);
}

// headers
const page = await fetch(`${BASE}/`);
const html = await page.text();
const csp = page.headers.get("content-security-policy") ?? "";
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
check("page: CSP present, no unsafe-eval, no wildcard, frame-ancestors none", !!csp && !csp.includes("unsafe-eval") && !/\s\*(\s|;|$)/.test(csp) && csp.includes("frame-ancestors 'none'"), csp);
check("page: script-src uses a per-request nonce and no unsafe-inline", !!nonce && !/script-src[^;]*unsafe-inline/.test(csp));
const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
check(`page: all ${scripts.length} <script> tags carry the nonce`, scripts.length > 0 && scripts.every((s) => s.includes(`nonce="${nonce}"`)));
const second = /'nonce-([^']+)'/.exec((await fetch(`${BASE}/`)).headers.get("content-security-policy") ?? "")?.[1];
check("page: nonce differs per request", !!second && second !== nonce);
for (const [h, want] of [["x-content-type-options", "nosniff"], ["x-frame-options", "DENY"], ["referrer-policy", "strict-origin-when-cross-origin"]] as const) {
  check(`page header ${h}`, page.headers.get(h) === want, String(page.headers.get(h)));
}
check("page: Permissions-Policy present", !!page.headers.get("permissions-policy"));
check("page: no X-Powered-By", !page.headers.get("x-powered-by"));
check("page: HSTS absent on plain HTTP (opt-in only)", !page.headers.get("strict-transport-security"));
const api = await fetch(`${BASE}/api/analysis/customers`);
check("API 401: nosniff + no-store + x-request-id", api.headers.get("x-content-type-options") === "nosniff" && (api.headers.get("cache-control") ?? "").includes("no-store") && !!api.headers.get("x-request-id"));

// logout
const viewer = sessions[0];
await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie: viewer.cookie } });
r = await fetch(`${BASE}/api/auth/me`, { headers: { cookie: viewer.cookie } });
check("after logout the old cookie → 401", r.status === 401, `status ${r.status}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(
  path.join(OUT, "runtime-sweep.md"),
  `# Runtime security sweep — live HTTP against ${BASE}\n\nRun: ${new Date().toISOString()} · production build · throwaway database planning_sectest · ${entries.length} handlers\n\n` +
    `## Checks\n| Result | Check | Detail |\n|---|---|---|\n${notes.join("\n")}\n\n## Status matrix\nPermitted roles show the status the handler returns for an empty/dummy request (200, 400, 404, 409, 503) — never 401/403.\n\n` +
    `| Handler | Guard | Anonymous | ${sessions.map((s) => s.role).join(" | ")} |\n|---|---|---|${sessions.map(() => "---").join("|")}|\n${rows.join("\n")}\n`,
);
console.log(`${failures === 0 ? "PASS" : "FAIL"}: ${notes.filter((n) => n.startsWith("| PASS")).length} checks passed, ${failures} failed`);
for (const n of notes.filter((n) => n.startsWith("| FAIL"))) console.log(n);
process.exit(failures === 0 ? 0 : 1);
