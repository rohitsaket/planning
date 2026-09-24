import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { GET as inventory } from "@/app/api/analysis/inventory/route";
import { GET as aging } from "@/app/api/analysis/aging/route";
import { GET as agingDashboard } from "@/app/api/analysis/aging-dashboard/route";
import { GET as countries } from "@/app/api/analysis/countries/route";
import { GET as transferCandidates } from "@/app/api/analysis/transfer-candidates/route";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import { GET as memo } from "@/app/api/analysis/memo/route";
import { GET as adminUsers, POST as adminUsersPost } from "@/app/api/admin/users/route";
import { GET as me } from "@/app/api/auth/me/route";
import {
  SCOPE_DIMENSIONS,
  UNRESTRICTED_SCOPE,
  assertWithinScope,
  describeScope,
  describeScopeApplication,
  isUnrestricted,
  readEffectiveScope,
  scopeWhere,
} from "@/lib/auth/access-scope";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";

/**
 * Country and lab authorization scope.
 *
 * Before this existed, the country and lab controls on screen were a convenience filter:
 * any caller holding `analysis.read` received the whole business, and editing the query
 * string was enough to look at anything. A client-supplied filter is not authorization.
 *
 * These tests cross the real handler boundary in both directions — a request for another
 * country is refused, and an unfiltered request returns only the caller's own scope —
 * because either half alone leaves a hole. They also pin the backward-compatibility rule
 * that an account with no stored scope keeps unrestricted access.
 */

const BATCH = "SCOPE-TEST";

/** Two countries and two labs, each with a distinguishable number of lots. */
const LOTS: Array<{ country: string; lab: string; n: number }> = [
  { country: "ZS", lab: "LAB-ALPHA", n: 4 },
  { country: "ZS", lab: "LAB-BETA", n: 3 },
  { country: "ZT", lab: "LAB-ALPHA", n: 2 },
  { country: "ZT", lab: "LAB-BETA", n: 1 },
];

async function seedLots() {
  const data: Prisma.LotMasterRecordCreateManyInput[] = [];
  let i = 0;
  for (const spec of LOTS) {
    for (let n = 0; n < spec.n; n++) {
      data.push({
        lotId: `${BATCH}-${i++}`,
        currentStatus: "STOCK",
        statusEffectiveDate: new Date(),
        docDate: new Date(),
        shape: "ROUND",
        shapeNormalized: "ROUND",
        weight: new Prisma.Decimal(1),
        labNormalized: spec.lab,
        quantity: new Prisma.Decimal(1),
        country: spec.country,
        branch: `${spec.country}-BR`,
        lastSyncBatchId: BATCH,
        isCurrent: true,
        roughOrPolished: "POLISHED",
        sourceType: "FIXTURE",
        isSimulated: true,
        inventoryClass: "PHYSICAL_AVAILABLE",
        classificationState: "CLASSIFIED",
        holdState: "NOT_HELD",
        canonicalLifecycle: "AVAILABLE",
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      });
    }
  }
  await db.lotMasterRecord.createMany({ data });
}

async function clearFixtures() {
  await db.lotHistoryRecord.deleteMany({ where: { syncBatchId: BATCH } });
  await db.lotMasterRecord.deleteMany({ where: { lastSyncBatchId: BATCH } });
}

async function grantScope(userId: string, countries: string[], labs: string[]) {
  await db.userAccessScope.deleteMany({ where: { userId } });
  const rows = [
    ...countries.map((value) => ({ dimension: "COUNTRY", value })),
    ...labs.map((value) => ({ dimension: "LAB", value })),
  ];
  if (rows.length) {
    await db.userAccessScope.createMany({
      data: rows.map((r) => ({ userId, dimension: r.dimension, value: r.value, reason: "test fixture" })),
    });
  }
}

describe("Access scope — the model itself", () => {
  beforeAll(async () => { await resetDb(); await clearFixtures(); });

  test("an account with no stored scope is unrestricted", async () => {
    // The backward-compatibility rule. The table starts empty on deploy, so every account
    // that existed before scoping must keep exactly the access it had.
    const user = await makeUser("scope.legacy", "DATA_ANALYST");
    const scope = await readEffectiveScope(user.user.id);
    expect(scope).toEqual(UNRESTRICTED_SCOPE);
    expect(isUnrestricted(scope)).toBe(true);
  });

  test("a stored scope resolves to exactly the values granted", async () => {
    const user = await makeUser("scope.stored", "DATA_ANALYST");
    await grantScope(user.user.id, ["ZS"], ["LAB-ALPHA", "LAB-BETA"]);
    const scope = await readEffectiveScope(user.user.id);
    expect({ countries: scope.countries, labs: scope.labs })
      .toEqual({ countries: ["ZS"], labs: ["LAB-ALPHA", "LAB-BETA"] });
  });

  test("one dimension can be restricted while the other stays unrestricted", async () => {
    const user = await makeUser("scope.partial", "DATA_ANALYST");
    await grantScope(user.user.id, ["ZS"], []);
    const scope = await readEffectiveScope(user.user.id);
    expect({ countries: scope.countries, labs: scope.labs })
      .toEqual({ countries: ["ZS"], labs: null });
  });

  test("a scope is stored as rows, never as delimited text", async () => {
    const user = await makeUser("scope.rows", "DATA_ANALYST");
    await grantScope(user.user.id, ["ZS", "ZT"], []);
    const rows = await db.userAccessScope.findMany({
      where: { userId: user.user.id, dimension: "COUNTRY" },
      select: { value: true },
    });
    // Two rows, not one row holding "ZS,ZT". A delimited value cannot be indexed, cannot
    // be revoked individually, and widens access the moment a value contains the delimiter.
    expect(rows.map((r) => r.value).sort()).toEqual(["ZS", "ZT"]);
    expect(rows.some((r) => r.value.includes(","))).toBe(false);
  });

  test("the dimension vocabulary is closed", () => {
    expect([...SCOPE_DIMENSIONS].sort()).toEqual(["COUNTRY", "LAB"]);
  });

  test("a request for a value outside the scope is refused, not narrowed", () => {
    const scope = { countries: ["ZS"], labs: null };
    let refused = false;
    try {
      assertWithinScope(scope, { country: "ZT" });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    // And a request inside it passes untouched.
    assertWithinScope(scope, { country: "ZS" });
    assertWithinScope(scope, { country: null, lab: "ANYTHING" });
  });

  test("the refusal message does not disclose which values the caller may see", () => {
    let message = "";
    try {
      assertWithinScope({ countries: ["ZS", "SECRET-COUNTRY"], labs: null }, { country: "ZT" });
    } catch (e) {
      message = (e as { message?: string }).message ?? "";
    }
    expect(message.includes("SECRET-COUNTRY")).toBe(false);
    expect(message.includes("ZS")).toBe(false);
  });

  test("a null column is outside a restricted scope", () => {
    // A record that does not say where it is cannot be shown to someone authorized for
    // particular places.
    const where = scopeWhere({ countries: ["ZS"], labs: null }, { country: "country", lab: "labNormalized" });
    expect(where).toEqual({ country: { in: ["ZS"] } });
  });

  test("an unrestricted scope adds no restriction at all", () => {
    expect(scopeWhere(UNRESTRICTED_SCOPE, { country: "country", lab: "labNormalized" })).toEqual({});
  });

  test("a dimension the dataset cannot express is disclosed rather than implied", () => {
    const applied = describeScopeApplication({ countries: ["ZS"], labs: ["LAB-ALPHA"] }, ["LAB"]);
    expect(applied.applied).toEqual(["LAB"]);
    expect(applied.notEnforceable).toEqual(["COUNTRY"]);
    expect(applied.notice !== null).toBe(true);
    // Nothing is claimed when everything could be applied.
    expect(describeScopeApplication({ countries: ["ZS"], labs: null }, ["COUNTRY", "LAB"]).notice).toBe(null);
  });

  test("a caller's own scope is described without naming what they cannot see", () => {
    const described = describeScope({ countries: ["ZS"], labs: null });
    expect(described.unrestricted).toBe(false);
    expect(described.countries).toEqual(["ZS"]);
    expect(described.labs).toBe(null);
    expect(described.summary.includes("ZS")).toBe(true);
  });
});

describe("Access scope — enforcement across the real API boundary", () => {
  let scopedCookie = "";
  let unscopedCookie = "";

  beforeAll(async () => {
    await clearFixtures();
    await seedLots();
    const scoped = await makeUser("scope.enforced", "DATA_ANALYST");
    const unscoped = await makeUser("scope.unscoped", "DATA_ANALYST");
    await grantScope(scoped.user.id, ["ZS"], []);
    scopedCookie = scoped.cookie;
    unscopedCookie = unscoped.cookie;
  });

  test("an unfiltered request returns only the caller's scope", async () => {
    // The half a refusal alone would miss: the caller asked for nothing in particular, so
    // there was nothing to refuse, and the whole business used to come back.
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: scopedCookie,
    });
    expect(res.status).toBe(200);
    const rows = res.json.rows as Array<{ country: string }>;
    expect(rows.length > 0).toBe(true);
    expect([...new Set(rows.map((r) => r.country))]).toEqual(["ZS"]);
    // 4 + 3 lots in ZS, out of 10 overall.
    expect(res.json.totals.currentLots).toBe(7);
  });

  test("the same request without a scope returns everything", async () => {
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: unscopedCookie,
    });
    expect(res.status).toBe(200);
    expect(res.json.totals.currentLots).toBe(10);
  });

  test("asking for another country is refused with 403", async () => {
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&country=ZT`,
      cookie: scopedCookie,
    });
    expect(res.status).toBe(403);
  });

  test("asking for the caller's own country still works", async () => {
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&country=ZS&pageSize=200`,
      cookie: scopedCookie,
    });
    expect(res.status).toBe(200);
    expect(res.json.totals.currentLots).toBe(7);
  });

  test("a lab restriction narrows independently of the country", async () => {
    const user = await makeUser("scope.labonly", "DATA_ANALYST");
    await grantScope(user.user.id, [], ["LAB-ALPHA"]);
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: user.cookie,
    });
    expect(res.status).toBe(200);
    const rows = res.json.rows as Array<{ lab: string | null }>;
    expect([...new Set(rows.map((r) => r.lab))]).toEqual(["LAB-ALPHA"]);
    // 4 in ZS + 2 in ZT.
    expect(res.json.totals.currentLots).toBe(6);
  });

  test("both dimensions intersect rather than replacing one another", async () => {
    const user = await makeUser("scope.both", "DATA_ANALYST");
    await grantScope(user.user.id, ["ZS"], ["LAB-ALPHA"]);
    resetRateLimits();
    const res = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: user.cookie,
    });
    expect(res.json.totals.currentLots).toBe(4);
  });

  test("the summary, the dashboard and the transfer distribution are narrowed too", async () => {
    // Aggregation, not only row listing: a KPI computed over everything would leak the
    // same data the table withholds.
    const surfaces: Array<{ name: string; lots: number }> = [];
    for (const [name, handler, path] of [
      ["aging summary", aging, `/api/analysis/aging?section=summary&search=${BATCH}`],
      ["dashboard", agingDashboard, `/api/analysis/aging-dashboard?search=${BATCH}`],
    ] as const) {
      resetRateLimits();
      const res = await call(handler, { path, cookie: scopedCookie });
      expect({ name, status: res.status }).toEqual({ name, status: 200 });
      surfaces.push({ name, lots: res.json.currentLots });
    }
    resetRateLimits();
    const transfer = await call(transferCandidates, {
      path: `/api/analysis/transfer-candidates?search=${BATCH}`,
      cookie: scopedCookie,
    });
    surfaces.push({ name: "transfer", lots: transfer.json.distribution.currentLots });

    expect(surfaces.filter((s) => s.lots !== 7)).toEqual([]);
  });

  test("the location breakdown never names a country outside the scope", async () => {
    resetRateLimits();
    const res = await call(agingDashboard, {
      path: `/api/analysis/aging-dashboard?search=${BATCH}`,
      cookie: scopedCookie,
    });
    const labels = (res.json.byLocation as Array<{ label: string }>).map((r) => r.label);
    expect(labels.some((l) => l.startsWith("ZT"))).toBe(false);
  });

  test("Country & Branch is narrowed and refuses an out-of-scope country", async () => {
    resetRateLimits();
    const allowed = await call(countries, { path: "/api/analysis/countries", cookie: scopedCookie });
    expect(allowed.status).toBe(200);
    const labels = (allowed.json.inventory.byLocation as Array<{ label: string }>).map((r) => r.label);
    expect(labels.some((l) => l.startsWith("ZT"))).toBe(false);

    resetRateLimits();
    const denied = await call(countries, { path: "/api/analysis/countries?country=ZT", cookie: scopedCookie });
    expect(denied.status).toBe(403);
  });

  test("Inventory is narrowed and refuses an out-of-scope country", async () => {
    resetRateLimits();
    const allowed = await call(inventory, {
      path: `/api/analysis/inventory?section=lots&search=${BATCH}&pageSize=200`,
      cookie: scopedCookie,
    });
    expect(allowed.status).toBe(200);
    const rows = allowed.json.rows as Array<{ country: string }>;
    expect([...new Set(rows.map((r) => r.country))]).toEqual(["ZS"]);

    resetRateLimits();
    const denied = await call(inventory, {
      path: "/api/analysis/inventory?section=lots&country=ZT",
      cookie: scopedCookie,
    });
    expect(denied.status).toBe(403);
  });

  test("a demand-derived page says which half of the scope it could not apply", async () => {
    // `DemandMetric` has a lab but no country. Rather than imply a country-level figure,
    // the response states that the country restriction could not be applied.
    resetRateLimits();
    const res = await call(stockout, { path: "/api/analysis/stockout?section=categories", cookie: scopedCookie });
    expect(res.status).toBe(200);
    if (res.json.scopeApplication) {
      expect(res.json.scopeApplication.notEnforceable).toEqual(["COUNTRY"]);
      expect(typeof res.json.scopeApplication.notice).toBe("string");
    }
  });

  test("a route over a different table is narrowed by the same scope", async () => {
    resetRateLimits();
    const denied = await call(memo, { path: "/api/analysis/memo?country=ZT", cookie: scopedCookie });
    expect(denied.status).toBe(403);
  });

  test("the caller's own scope is disclosed to them", async () => {
    resetRateLimits();
    const res = await call(me, { path: "/api/auth/me", cookie: scopedCookie });
    expect(res.status).toBe(200);
    expect(res.json.user.accessScope.countries).toEqual(["ZS"]);
    expect(res.json.user.accessScope.unrestricted).toBe(false);
  });

  test("an unscoped account is told it is unrestricted rather than being told nothing", async () => {
    resetRateLimits();
    const res = await call(me, { path: "/api/auth/me", cookie: unscopedCookie });
    expect(res.json.user.accessScope).toEqual({
      unrestricted: true,
      countries: null,
      labs: null,
      summary: "You have access to all countries and labs.",
    });
  });
});

describe("Access scope — exports carry the same restriction", () => {
  test("every scoped read route also declares the scope in its filters", () => {
    // The wrapper refuses an out-of-scope request; the read service narrows the query.
    // A route that declared only the first half would return everything to a caller who
    // simply did not ask for a country, which is the easier mistake to make.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") {
          const text = readFileSync(full, "utf8");
          if (!text.includes("scoped: true")) continue;
          const rel = full.split(path.sep).join("/");
          // It must do something with the scope, not merely declare it.
          const uses =
            text.includes("scopeWhere") ||
            text.includes("scopePredicates") ||
            text.includes("scope,") ||
            text.includes("api.scope") ||
            text.includes("withSalesScope") ||
            text.includes("scope.labs") ||
            // Passed as an argument — the aging and sales services take the scope as a
            // required parameter, which is how the compiler stops a route forgetting it.
            // `describeScope(scope)` deliberately does not match: disclosing a scope is
            // not applying one.
            /,\s*scope\s*[,)]/.test(text);
          if (!uses) offenders.push(rel);
        }
      }
    };
    walk("src/app/api/analysis");
    expect(offenders).toEqual([]);
  });

  test("the export routes are scoped, not only the on-screen tables", () => {
    const exports = [
      "src/app/api/analysis/stockout/export/route.ts",
      "src/app/api/analysis/excess/export/route.ts",
      "src/app/api/analysis/sales/export/route.ts",
    ];
    const unscoped = exports.filter((f) => !readFileSync(f, "utf8").includes("scoped: true"));
    expect(unscoped).toEqual([]);
  });

  test("no route reads a scope, role or actor out of the request", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") {
          const code = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "");
          // An authorization input taken from the caller is not authorization.
          if (/qStr\(url,\s*"(role|actor|userId|permissions|accessScope|allowedCountries|allowedLabs)"/.test(code)) {
            offenders.push(full.split(path.sep).join("/"));
          }
          if (/headers\.get\("x-(role|user|scope|country)/i.test(code)) {
            offenders.push(full.split(path.sep).join("/"));
          }
        }
      }
    };
    walk("src/app/api/analysis");
    expect(offenders).toEqual([]);
  });
});

describe("Access scope — managing it is its own authority", () => {
  test("a general administrator does not get scope assignment by default", () => {
    // The centralized policy grants it explicitly or not at all. ADMIN is built by
    // excluding specific authorities from the full set, so a new permission would
    // otherwise arrive there silently.
    expect(ROLE_PERMISSIONS.ADMIN.includes("user.scope.assign")).toBe(false);
    // Reading an account's scope is part of reviewing the account, so that is allowed.
    expect(ROLE_PERMISSIONS.ADMIN.includes("user.scope.read")).toBe(true);
    // And it remains assignable to whoever genuinely holds the authority.
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.includes("user.scope.assign")).toBe(true);
  });

  test("an administrator without the permission is refused", async () => {
    const admin = await makeUser("scope.admin", "ADMIN");
    const target = await makeUser("scope.target", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: admin.cookie,
      body: { op: "setScope", id: target.user.id, countries: ["ZS"], labs: [], reason: "test" },
    });
    expect(res.status).toBe(403);
    // And nothing was written.
    expect(await db.userAccessScope.count({ where: { userId: target.user.id } })).toBe(0);
  });

  test("an authorized administrator can set and then clear a scope", async () => {
    const superAdmin = await makeUser("scope.super", "SUPER_ADMIN");
    const target = await makeUser("scope.super.target", "DATA_ANALYST");

    resetRateLimits();
    const set = await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: target.user.id, countries: ["ZS"], labs: ["LAB-ALPHA"], reason: "narrowing for test" },
    });
    expect(set.status).toBe(200);
    expect(await readEffectiveScope(target.user.id)).toEqual({ countries: ["ZS"], labs: ["LAB-ALPHA"] });

    // Clearing is an empty set, which restores unrestricted access.
    resetRateLimits();
    const cleared = await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: target.user.id, countries: [], labs: [], reason: "restoring for test" },
    });
    expect(cleared.status).toBe(200);
    expect(await readEffectiveScope(target.user.id)).toEqual(UNRESTRICTED_SCOPE);
  });

  test("replacing a scope revokes what was left out", async () => {
    const superAdmin = await makeUser("scope.replace", "SUPER_ADMIN");
    const target = await makeUser("scope.replace.target", "DATA_ANALYST");
    await grantScope(target.user.id, ["ZS", "ZT"], []);

    resetRateLimits();
    await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: target.user.id, countries: ["ZS"], labs: [], reason: "revoking ZT" },
    });
    const scope = await readEffectiveScope(target.user.id);
    expect(scope.countries).toEqual(["ZS"]);
  });

  test("a scope change is audited with the previous and new values", async () => {
    const superAdmin = await makeUser("scope.audit", "SUPER_ADMIN");
    const target = await makeUser("scope.audit.target", "DATA_ANALYST");
    resetRateLimits();
    await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: target.user.id, countries: ["ZS"], labs: [], reason: "audited change" },
    });
    const entry = await db.auditLog.findFirst({
      where: { action: "USER_ACCESS_SCOPE_CHANGE", entityId: target.user.id },
      orderBy: { timestamp: "desc" },
    });
    expect(entry !== null).toBe(true);
    expect(entry?.category).toBe("SECURITY");
    expect(entry?.reason).toBe("audited change");
    expect(entry?.actorUserId).toBe(superAdmin.user.id);
    expect(String(entry?.after)).toContain("ZS");
  });

  test("nobody may change their own scope", async () => {
    const superAdmin = await makeUser("scope.self", "SUPER_ADMIN");
    resetRateLimits();
    const res = await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: superAdmin.user.id, countries: [], labs: [], reason: "widening myself" },
    });
    expect(res.status).toBe(403);
  });

  test("a scope change takes effect on the next request without revoking the session", async () => {
    await clearFixtures();
    await seedLots();
    const superAdmin = await makeUser("scope.live", "SUPER_ADMIN");
    const target = await makeUser("scope.live.target", "DATA_ANALYST");

    resetRateLimits();
    const before = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: target.cookie,
    });
    expect(before.json.totals.currentLots).toBe(10);

    resetRateLimits();
    await call(adminUsersPost, {
      method: "POST",
      path: "/api/admin/users",
      cookie: superAdmin.cookie,
      body: { op: "setScope", id: target.user.id, countries: ["ZT"], labs: [], reason: "narrowing live" },
    });

    // Same cookie, same session.
    resetRateLimits();
    const after = await call(aging, {
      path: `/api/analysis/aging?section=lots&search=${BATCH}&pageSize=200`,
      cookie: target.cookie,
    });
    expect(after.json.totals.currentLots).toBe(3);
  });

  test("the scope of other accounts is withheld without the read permission", async () => {
    const analyst = await makeUser("scope.reader", "DATA_ANALYST");
    resetRateLimits();
    const res = await call(adminUsers, { path: "/api/admin/users", cookie: analyst.cookie });
    // A data analyst holds no user.read at all, so the list is refused outright.
    expect(res.status).toBe(403);
  });

  test("an administrator who may read accounts sees their scope", async () => {
    const admin = await makeUser("scope.admin.read", "ADMIN");
    resetRateLimits();
    const res = await call(adminUsers, { path: "/api/admin/users?pageSize=100", cookie: admin.cookie });
    expect(res.status).toBe(200);
    expect(res.json.canReadScope).toBe(true);
    // ADMIN does not hold the assign permission, and the list says so.
    expect(res.json.canManageScope).toBe(false);
    const rows = res.json.rows as Array<{ accessScope: unknown }>;
    expect(rows.every((r) => r.accessScope !== null)).toBe(true);
  });
});

describe("Access scope — the module stays server-side", () => {
  test("the scope module refuses to load in a browser", () => {
    const source = readFileSync("src/lib/auth/access-scope.ts", "utf8");
    expect(source.includes('typeof window !== "undefined"')).toBe(true);
  });

  test("no client component imports it", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = readFileSync(full, "utf8");
          if (text.includes("auth/access-scope")) offenders.push(full.split(path.sep).join("/"));
        }
      }
    };
    walk("src/components");
    walk("src/stores");
    expect(offenders).toEqual([]);
  });
});
