import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Glob } from "bun";
import path from "node:path";
import { call, makeUser, resetDb } from "./helpers";
import { hasPermission, PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { resetRateLimits } from "@/lib/api/rate-limit";

const ROOT = path.resolve(import.meta.dir, "../..");
const files = [...new Glob("src/app/api/**/route.ts").scanSync(ROOT)].sort();
const PUBLIC = new Set(["GET /api", "POST /api/auth/login", "POST /api/auth/logout", "GET /api/public/login-context", "GET /api/public/daily-motivation", "POST /api/public/access-request"]);
const SWEEP_ROLES: { label: string; role: Role }[] = [
  { label: "Viewer", role: "VIEWER" },
  { label: "Analyst", role: "DATA_ANALYST" },
  { label: "Planner", role: "PLANNER" },
  { label: "Approver", role: "PLANNING_MANAGER" },
  { label: "Admin", role: "ADMIN" },
  { label: "SuperAdmin", role: "SUPER_ADMIN" },
];

interface Entry { file: string; route: string; method: string; guard: string; }
const entries: Entry[] = [];
for (const f of files) {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  const route = "/" + f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
  const re = /export const (GET|POST|PUT|PATCH|DELETE) = withApi(?:<[^(]*>)?\(\{\s*([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const opts = m[2];
    const perm = /permission: "([^"]+)"/.exec(opts)?.[1];
    entries.push({ file: f, route, method: m[1], guard: perm ?? (/public: true/.test(opts) ? "PUBLIC" : /authenticated: true/.test(opts) ? "AUTHENTICATED" : "UNCLASSIFIED") });
  }
}

describe("route inventory — no handler may be unclassified", () => {
  test("every route file exports only withApi-wrapped handlers", () => {
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      expect({ f, bare: /export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/.test(src) }).toEqual({ f, bare: false });
      const exported = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].length;
      const wrapped = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = withApi/g)].length;
      expect({ f, exported }).toEqual({ f, exported: wrapped });
      expect(wrapped).toBeGreaterThan(0);
    }
  });
  test("every handler declares a known permission, AUTHENTICATED, or is on the explicit public allowlist", () => {
    for (const e of entries) {
      expect(e.guard).not.toBe("UNCLASSIFIED");
      if (e.guard === "PUBLIC") expect(PUBLIC.has(`${e.method} ${e.route}`)).toBe(true);
      else if (e.guard !== "AUTHENTICATED") expect((PERMISSIONS as readonly string[]).includes(e.guard)).toBe(true);
    }
    expect(entries.filter((e) => e.guard === "PUBLIC").length).toBe(PUBLIC.size);
  });
});

describe("runtime 401/403 sweep over every handler", () => {
  const rows: string[] = [];
  beforeAll(resetDb);

  test("anonymous → 401 everywhere; each role → 403 exactly where it lacks the permission", async () => {
    const users = await Promise.all(SWEEP_ROLES.map((r) => makeUser(`sweep.${r.label.toLowerCase()}`, r.role)));
    for (const e of entries) {
      const mod = await import(path.join(ROOT, e.file));
      const handler = mod[e.method];
      const params = { id: "nonexistent", caseId: "nonexistent", query: "zzzz-no-match" };
      const opts = { method: e.method, path: e.route.replace(/\[(\w+)\]/g, "x"), params, ...(e.method === "GET" ? {} : { body: {} }) };
      resetRateLimits();
      const anon = (await call(handler, opts)).status;
      const cells: string[] = [];
      if (e.guard === "PUBLIC") {
        expect({ r: e.route, anon: anon === 401 || anon === 403 }).toEqual({ r: e.route, anon: false });
      } else {
        expect({ r: `${e.method} ${e.route}`, anon }).toEqual({ r: `${e.method} ${e.route}`, anon: 401 });
      }
      for (let i = 0; i < SWEEP_ROLES.length; i++) {
        if (e.route === "/api/auth/logout") { cells.push("n/a"); continue; } // would end the sweep user's session
        resetRateLimits();
        const status = (await call(handler, { ...opts, cookie: users[i].cookie })).status;
        const allowed = e.guard === "PUBLIC" || e.guard === "AUTHENTICATED" || hasPermission(SWEEP_ROLES[i].role, e.guard as never);
        if (allowed) expect({ r: `${e.method} ${e.route}`, role: SWEEP_ROLES[i].label, denied: status === 401 || status === 403 }).toEqual({ r: `${e.method} ${e.route}`, role: SWEEP_ROLES[i].label, denied: false });
        else expect({ r: `${e.method} ${e.route}`, role: SWEEP_ROLES[i].label, status }).toEqual({ r: `${e.method} ${e.route}`, role: SWEEP_ROLES[i].label, status: 403 });
        cells.push(`${status}${allowed ? "" : " (denied)"}`);
      }
      rows.push(`| ${e.method} ${e.route} | ${e.guard} | ${anon} | ${cells.join(" | ")} |`);
    }
    const out = path.join(ROOT, "security-audit/remediation");
    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, "route-sweep-matrix.md"),
      `# Route security sweep (in-process handler calls, generated by tests/security/route-sweep.test.ts)\n\n` +
        `Statuses for permitted roles are whatever the handler returns for an empty/dummy request (200, 400 validation, 404 unknown id, 503 unconfigured) — the assertion is only that they are not 401/403.\n\n` +
        `| Handler | Guard | Anonymous | ${SWEEP_ROLES.map((r) => `${r.label} (${r.role})`).join(" | ")} |\n|---|---|---|${SWEEP_ROLES.map(() => "---").join("|")}|\n${rows.join("\n")}\n\nHandlers: ${entries.length}\n`,
    );
    expect(entries.length).toBeGreaterThanOrEqual(58);
  }, 120_000);
});
