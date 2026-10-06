import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as memo } from "@/app/api/analysis/memo/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { GET as customers } from "@/app/api/analysis/customers/route";
import { GET as inventory } from "@/app/api/analysis/inventory/route";
import { memoPredicates, memoWhere } from "@/lib/analysis/memo";

type User = Awaited<ReturnType<typeof makeUser>>;
const STAMP = Date.now().toString(36).toUpperCase();
const [HOME, AWAY] = ["QM", "QN"];
const [LAB_A, LAB_B] = ["QLAB-A", "QLAB-B"];

const MEMOS: Array<[string, string, string, string, number, number]> = [
  [HOME, "QM-1", LAB_A, "OPEN", 100, 10],
  [HOME, "QM-1", LAB_A, "OPEN", 100, 20],
  [HOME, "QM-2", LAB_B, "OPEN", 200, 45],
  [HOME, "QM-1", LAB_A, "RETURNED", 50, 100],
  [AWAY, "QN-1", LAB_A, "OPEN", 1000, 200],
  [AWAY, "QN-1", LAB_A, "OPEN", 1000, 190],
  [AWAY, "QN-1", LAB_B, "INVOICED", 500, 5],
];

let unrestricted: User, homeOnly: User, labAOnly: User, noSales: User, noAnalysis: User;
const customerIds: string[] = [];

async function grant(u: User, countries: string[], labs: string[]) {
  await db.userAccessScope.deleteMany({ where: { userId: u.user.id } });
  await db.userAccessScope.createMany({
    data: [
      ...countries.map((value) => ({ userId: u.user.id, dimension: "COUNTRY", value, reason: "test fixture" })),
      ...labs.map((value) => ({ userId: u.user.id, dimension: "LAB", value, reason: "test fixture" })),
    ],
  });
}

const get = async (handler: Parameters<typeof call>[0], u: User | null, path: string) => {
  resetRateLimits();
  return call(handler, { path, ...(u ? { cookie: u.cookie } : {}) });
};

const expected = (keep: (m: (typeof MEMOS)[number]) => boolean) => {
  const rows = MEMOS.filter(keep);
  return { qty: rows.length, value: rows.reduce((s, m) => s + m[4], 0) };
};

beforeAll(async () => {
  unrestricted = await makeUser(`memo.all.${STAMP}`, "DATA_ANALYST");
  homeOnly = await makeUser(`memo.home.${STAMP}`, "DATA_ANALYST");
  labAOnly = await makeUser(`memo.laba.${STAMP}`, "DATA_ANALYST");
  noSales = await makeUser(`memo.nosales.${STAMP}`, "PLANNER");
  noAnalysis = await makeUser(`memo.noanalysis.${STAMP}`, "FANTASY_INTEGRATION");
  await grant(homeOnly, [HOME], []);
  await grant(labAOnly, [], [LAB_A]);

  for (const country of [HOME, AWAY]) {
    const c = await db.customer.create({ data: { customerCode: `MEMO-${country}-${STAMP}`, name: `Memo Customer ${country}`, country, branch: `${country}-1` } });
    customerIds.push(c.id);
  }
  await db.memoRecord.createMany({
    data: MEMOS.map(([country, branch, lab, status, value, age], i) => ({
      lotId: `MEMO-${STAMP}-${i}`,
      memoDate: new Date(Date.now() - age * 86_400_000),
      customerId: customerIds[country === HOME ? 0 : 1],
      country, branch, shape: "ROUND", weight: new Prisma.Decimal(1), labNormalized: lab,
      memoValueUsd: new Prisma.Decimal(value), status, memoAgeDays: age,
    })),
  });
});

describe("Memo scope: who may call", () => {
  test("anonymous callers get 401 and callers without the permission get 403, with no memo data", async () => {
    for (const [handler, path] of [[memo, "/api/analysis/memo"], [dashboard, "/api/dashboard"], [customers, "/api/analysis/customers"]] as const) {
      const anon = await get(handler, null, path);
      expect([path, anon.status, "totalQty" in (anon.json ?? {}), "memoExposure" in (anon.json ?? {})]).toEqual([path, 401, false, false]);
    }
    expect((await get(memo, noSales, "/api/analysis/memo")).status).toBe(403);
    expect((await get(customers, noSales, "/api/analysis/customers")).status).toBe(403);
    expect((await get(dashboard, noAnalysis, "/api/dashboard")).status).toBe(403);
  });
});

describe("Memo scope: the session decides what is visible", () => {
  test("an unrestricted reader may use any valid filter", async () => {
    const away = await get(memo, unrestricted, `/api/analysis/memo?country=${AWAY}`);
    const e = expected((m) => m[0] === AWAY);
    expect([away.status, away.json.totalQty, away.json.totalValue]).toEqual([200, e.qty, e.value]);
    const narrowed = await get(memo, unrestricted, `/api/analysis/memo?country=${HOME}&branch=QM-1&lab=${LAB_A}&status=OPEN`);
    const n = expected((m) => m[0] === HOME && m[1] === "QM-1" && m[2] === LAB_A && m[3] === "OPEN");
    expect([narrowed.json.totalQty, narrowed.json.totalValue]).toEqual([n.qty, n.value]);
  });

  test("a country-restricted reader with no filter sees exactly their country, in every figure", async () => {
    const res = await get(memo, homeOnly, "/api/analysis/memo?pageSize=500");
    const e = expected((m) => m[0] === HOME);
    expect([res.status, res.json.totalQty, res.json.totalValue, res.json.total]).toEqual([200, e.qty, e.value, e.qty]);
    expect((res.json.byCountry as Array<{ dimension: string }>).map((g) => g.dimension)).toEqual([HOME]);
    expect([...new Set((res.json.rows as Array<{ country: string }>).map((r) => r.country))]).toEqual([HOME]);
    expect((res.json.byCustomer as Array<{ dimension: string }>).map((g) => g.dimension)).toEqual([`Memo Customer ${HOME}`]);
    expect(Object.values(res.json.ageBuckets as Record<string, number>).reduce((s, n) => s + n, 0)).toBe(e.qty);
    expect(res.json.accessScope.countries).toEqual([HOME]);
  });

  test("a permitted filter narrows within the scope", async () => {
    const res = await get(memo, homeOnly, `/api/analysis/memo?country=${HOME}&lab=${LAB_A}`);
    const e = expected((m) => m[0] === HOME && m[2] === LAB_A);
    expect([res.status, res.json.totalQty, res.json.totalValue]).toEqual([200, e.qty, e.value]);
  });

  test("a lab-restricted reader's country filter narrows their lab scope rather than replacing it", async () => {
    const all = await get(memo, labAOnly, "/api/analysis/memo");
    const e = expected((m) => m[2] === LAB_A);
    expect([all.status, all.json.totalQty, all.json.totalValue]).toEqual([200, e.qty, e.value]);
    const away = await get(memo, labAOnly, `/api/analysis/memo?country=${AWAY}`);
    const a = expected((m) => m[2] === LAB_A && m[0] === AWAY);
    expect([away.status, away.json.totalQty, away.json.totalValue]).toEqual([200, a.qty, a.value]);
  });

  test("an out-of-scope country or lab is refused, and the refusal does not reveal whether it exists", async () => {
    const existing = await get(memo, homeOnly, `/api/analysis/memo?country=${AWAY}`);
    const missing = await get(memo, homeOnly, "/api/analysis/memo?country=QX");
    for (const r of [existing, missing]) {
      expect([r.status, "totalQty" in r.json, "rows" in r.json]).toEqual([403, false, false]);
      expect(JSON.stringify(r.json).includes(AWAY) || JSON.stringify(r.json).includes(HOME)).toBe(false);
    }
    expect([existing.json.error.code, existing.json.error.message]).toEqual([missing.json.error.code, missing.json.error.message]);
    const otherLab = await get(memo, labAOnly, `/api/analysis/memo?lab=${LAB_B}`);
    const noLab = await get(memo, labAOnly, "/api/analysis/memo?lab=QLAB-NONE");
    expect([otherLab.status, otherLab.json.error.message]).toEqual([403, noLab.json.error.message]);
  });

  test("forged, repeated, unknown and malformed filter parameters are rejected without data", async () => {
    const forged = [
      `country=${HOME}&country=${AWAY}`,
      `country=${AWAY}&country=${HOME}`,
      `lab=${LAB_A}&lab=${LAB_B}`,
      `status=OPEN&status=INVOICED`,
      `Country=${AWAY}`,
      `countries=${AWAY}`,
      `accessScope=unrestricted`,
      `userId=${unrestricted.user.id}`,
      `branch=QN-1&scope=all`,
      "country=",
      `country=${"Q".repeat(61)}`,
      "country=Q%00N",
      "branch=%20QN-1",
      "status=BOGUS",
    ];
    for (const qs of forged) {
      const r = await get(memo, homeOnly, `/api/analysis/memo?${qs}`);
      expect([qs, r.status === 400 || r.status === 403, "totalQty" in (r.json ?? {})]).toEqual([qs, true, false]);
    }
    for (const qs of [`country=${HOME}&country=${AWAY}`, `countries=${AWAY}`, "status=BOGUS", "branch=%20QN-1"]) {
      expect([qs, (await get(memo, homeOnly, `/api/analysis/memo?${qs}`)).status]).toEqual([qs, 400]);
    }
    const branch = await get(memo, homeOnly, "/api/analysis/memo?branch=QN-1");
    expect([branch.status, branch.json.totalQty]).toEqual([200, 0]);
  });
});

describe("Memo scope: every memo figure describes the same records", () => {
  test("the paged list, the summary and the exported rows agree, and hold only in-scope lots", async () => {
    const summary = await get(memo, homeOnly, "/api/analysis/memo");
    const ids: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const res = await get(memo, homeOnly, `/api/analysis/memo?page=${page}&pageSize=2`);
      ids.push(...(res.json.rows as Array<{ id: string }>).map((r) => r.id));
      if (!res.json.hasMore) break;
    }
    const inDb = await db.memoRecord.findMany({ where: { country: HOME }, select: { id: true } });
    expect([ids.length, new Set(ids).size, summary.json.total]).toEqual([inDb.length, inDb.length, inDb.length]);
    expect(ids.sort()).toEqual(inDb.map((r) => r.id).sort());
    const byCountryQty = (summary.json.byCountry as Array<{ qty: number }>).reduce((s, g) => s + g.qty, 0);
    const byCustomerQty = (summary.json.byCustomer as Array<{ qty: number }>).reduce((s, g) => s + g.qty, 0);
    expect([byCountryQty, byCustomerQty]).toEqual([summary.json.totalQty, summary.json.totalQty]);
  });

  test("open memo exposure is identical on Memo Analysis, the dashboard and Customers, with and without a lab filter", async () => {
    for (const lab of [null, LAB_A]) {
      const qs = lab ? `&lab=${lab}` : "";
      const memoOpen = (await get(memo, homeOnly, `/api/analysis/memo?status=OPEN${qs}`)).json.totalValue;
      const dash = (await get(dashboard, homeOnly, `/api/dashboard${lab ? `?lab=${lab}` : ""}`)).json.memoExposure;
      const cust = (await get(customers, homeOnly, `/api/analysis/customers${lab ? `?lab=${lab}` : ""}`)).json.summary.memoExposure;
      const e = expected((m) => m[0] === HOME && m[3] === "OPEN" && (!lab || m[2] === lab));
      expect([lab, memoOpen, dash, cust]).toEqual([lab, e.value, e.value, e.value]);
    }
  });

  test("the dashboard and Customers refuse an out-of-scope country, and the dashboard refuses parameters it does not read", async () => {
    for (const [handler, path] of [[dashboard, "/api/dashboard"], [customers, "/api/analysis/customers"]] as const) {
      const r = await get(handler, homeOnly, `${path}?country=${AWAY}`);
      expect([path, r.status, "memoExposure" in (r.json ?? {}), "summary" in (r.json ?? {})]).toEqual([path, 403, false, false]);
      expect([path, (await get(handler, homeOnly, `${path}?country=${HOME}&country=${AWAY}`)).status]).toEqual([path, 400]);
    }
    expect((await get(dashboard, unrestricted, "/api/dashboard?windowDays=30")).status).toBe(400);
  });

  test("the inventory reconciliation counts only memo records inside the caller's scope", async () => {
    const scoped = await get(inventory, homeOnly, "/api/analysis/inventory?section=reconciliation");
    const all = await get(inventory, unrestricted, "/api/analysis/inventory?section=reconciliation");
    expect([scoped.status, scoped.json.memoMirrorRows]).toEqual([200, await db.memoRecord.count({ where: { country: HOME } })]);
    expect(all.json.memoMirrorRows).toBe(await db.memoRecord.count());
  });
});

describe("Memo scope: the query itself carries the scope", () => {
  const scope = { countries: [HOME], labs: null };

  test("a requested filter is ANDed with the scope, never assigned over it", async () => {
    const where = memoWhere({ scope, country: AWAY, branch: null, lab: null, status: null });
    expect(where).toEqual({ AND: [{ country: { in: [HOME] } }, { country: AWAY }] });
    expect(await db.memoRecord.count({ where })).toBe(0);
    expect(await db.memoRecord.count({ where: memoWhere({ scope, country: HOME, branch: null, lab: null, status: null }) })).toBe(expected((m) => m[0] === HOME).qty);
    const sql = Prisma.join(memoPredicates({ scope, country: AWAY, branch: null, lab: null, status: null }, "m"), " AND ");
    expect(sql.sql).toBe('(m."country" IS NOT NULL AND m."country" IN (?)) AND m."country" = ?');
    expect(sql.values).toEqual([HOME, AWAY]);
  });

  test("every API route that reads memo records builds its filter through the shared memo module", () => {
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") routes.push(full);
      }
    };
    walk("src/app/api");
    const readers = routes.filter((f) => /memoRecord\.|"MemoRecord"/.test(readFileSync(f, "utf8")));
    expect(readers.length >= 3).toBe(true);
    for (const f of readers) {
      const text = readFileSync(f, "utf8");
      expect([f, text.includes("@/lib/analysis/memo"), /where\.(country|labNormalized|branch|status)\s*=/.test(text)]).toEqual([f, true, false]);
    }
  });
});

describe("Memo scope: fixture teardown", () => {
  afterAll(async () => {
    await db.memoRecord.deleteMany({ where: { lotId: { startsWith: `MEMO-${STAMP}-` } } });
    await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  });

  test("the fixture is still intact when the last check runs", async () => {
    expect(await db.memoRecord.count({ where: { lotId: { startsWith: `MEMO-${STAMP}-` } } })).toBe(MEMOS.length);
  });
});
