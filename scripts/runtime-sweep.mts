import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { testHasPermission } from "../tests/security/fixture-roles";
import { deploymentMarker } from "../src/lib/fantasy/database-environment";

const REQUIRED_ROLES = ["VIEWER", "DATA_ANALYST", "PLANNER", "PLANNING_MANAGER", "ADMIN", "SUPER_ADMIN"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
function refuse(reason: string): never {
  console.error(`Runtime sweep refused: ${reason}`);
  process.exit(2);
}

const BASE = process.env.SWEEP_BASE || "http://127.0.0.1:3100";
{
  const marker = deploymentMarker(process.env);
  if (marker) refuse(`${marker} names a production or staging environment.`);
  let target: URL;
  try {
    target = new URL(BASE);
  } catch {
    refuse("SWEEP_BASE is not a URL.");
  }
  if (!/^https?:$/.test(target.protocol) || !LOOPBACK.has(target.hostname)) refuse("SWEEP_BASE must be an http(s) server on this machine (loopback).");
  const credsPath = process.env.SWEEP_CREDS;
  if (!credsPath || !existsSync(credsPath)) refuse("SWEEP_CREDS must name the test-role credentials file.");
}
const scriptDir = import.meta.dirname || (import.meta as any).dir || path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(scriptDir, "..");
const OUT = path.join(tmpdir(), "planning-runtime-sweep");
const PUBLIC = new Set(["GET /api", "POST /api/auth/login", "POST /api/auth/logout"]);
let failures = 0;
const notes: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  notes.push(`| ${ok ? "PASS" : "FAIL"} | ${name} | ${detail} |`);
  if (!ok) failures++;
};

const creds = readFileSync(process.env.SWEEP_CREDS!, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\s+/));
if (creds.length === 0 || creds.some((c) => c.length !== 2)) refuse("the credentials file must hold one \"<username> <password>\" line per test role.");
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
  check(`login as ${role}`, r.status === 200, `status ${r.status}`);
}
const missingRoles = REQUIRED_ROLES.filter((role) => !sessions.some((s) => s.role === role));
if (missingRoles.length) refuse(`no signed-in test account for ${missingRoles.join(", ")}.`);

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

const admin = sessions.find((s) => s.role === "ADMIN")!;
const mapper = sessions.find((s) => testHasPermission(s.role, "sarin.mapping.manage"))!;
const SWEEP_SHAPE = `RUNTIME SWEEP ${Date.now().toString(36).toUpperCase()}`;
const MAPPINGS = "/api/planning/sarin/shape-mappings";
const j = (cookie: string, url: string, init: RequestInit = {}) => fetch(BASE + url, { ...init, headers: { cookie, "content-type": "application/json", ...(init.headers ?? {}) } });

let r = await fetch(`${BASE}/api/analysis/customers`, { headers: { cookie: "dp_session=forged", "x-user": "admin", "x-role": "SUPER_ADMIN" } });
check("forged cookie + X-User/X-Role headers → 401", r.status === 401, `status ${r.status}`);
r = await j(mapper.cookie, MAPPINGS, { method: "POST", body: "{not json" });
check("malformed JSON → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/analysis/sales?windowDays=abc");
check("windowDays=abc → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/data-quality?pageSize=999999");
check("over-limit pageSize → 400", r.status === 400, `status ${r.status}`);
r = await j(admin.cookie, "/api/data-quality?pageSize=1");
const paged = (await r.json()) as { rows: unknown[]; paging: { total: number; hasMore: boolean } };
check("pageSize=1 → at most 1 row, hasMore matches the total", paged.rows.length <= 1 && paged.paging.hasMore === paged.paging.total > 1);

r = await j(mapper.cookie, MAPPINGS, { method: "POST", body: JSON.stringify({ sarinShape: SWEEP_SHAPE, fantasyShape: "Round", applyTo: "ALL_RATIOS", actor: "ceo", changedByUserId: "ceo" }) });
check("forged identity fields in a write body → 400", r.status === 400, `status ${r.status}`);
r = await j(mapper.cookie, MAPPINGS, { method: "POST", body: JSON.stringify({ sarinShape: SWEEP_SHAPE, fantasyShape: "Round", applyTo: "ALL_RATIOS" }) });
const audit = (await (await j(mapper.cookie, "/api/admin/audit?action=SARIN_MAPPING_SAVED&pageSize=5")).json()) as { rows: { actor: string; action: string }[] };
check("a real write over HTTP → audit actor is the session user", r.status === 200 && audit.rows[0]?.actor === mapper.username, `status ${r.status}, actor ${audit.rows[0]?.actor}`);
const added = ((await (await j(mapper.cookie, MAPPINGS)).json()) as { mappings: { id: string; sarinShape: string }[] }).mappings.filter((m) => m.sarinShape === SWEEP_SHAPE);
for (const m of added) await j(mapper.cookie, `${MAPPINGS}/${m.id}`, { method: "DELETE" });
r = await fetch(BASE + MAPPINGS, { method: "POST", headers: { cookie: mapper.cookie, "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
check("cross-origin POST with a valid cookie → 403", r.status === 403, `status ${r.status}`);

for (const url of ["/api/planning/cases", "/api/planning/compare/x", "/api/planning/pieces", "/api/planning/workbench", "/api/planning/reservations", "/api/planning/approvals", "/api/planning/rough", "/api/admin/approval-policy", "/api/fantasy/rough", "/api/requirements", "/api/requirements/x", "/api/requirements/x/priority", "/api/analysis/orders"]) {
  const [get, post] = [await j(admin.cookie, url), await j(admin.cookie, url, { method: "POST", body: "{}" })];
  check(`retired ${url} → 404`, get.status === 404 && post.status === 404, `GET ${get.status}, POST ${post.status}`);
}

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
