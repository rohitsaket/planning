// Fantasy Live Data integration — database-backed checks on the throwaway sectest database.
// Fantasy itself is never called: the sync service receives an injected client.
import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { utils, write } from "xlsx";
import path from "node:path";
import { call, db, makeUser, resetDb } from "./helpers";
import { GET as liveDataRoute } from "@/app/api/fantasy/live-data/route";
import { POST as syncRoute } from "@/app/api/fantasy/live-data/sync/route";
import { GET as statusRoute } from "@/app/api/fantasy/sync/status/route";
import { GET as sourceRoute } from "@/app/api/fantasy/source/route";
import { runLiveDataSync, LIVE_SYNC_SOURCE, getLiveSyncStatus } from "@/lib/fantasy/live-sync";
import type { FantasyClient } from "@/lib/fantasy/live-api";
import { FantasyApiError } from "@/lib/fantasy/live-api";

const ROOT = process.cwd();
const stub = (rows: () => Promise<Record<string, unknown>[]>): FantasyClient =>
  ({ fetchLots: async () => ({ rows: await rows(), pages: 1, requests: 1, durationMs: 1, complete: true }) } as unknown as FantasyClient);
const lot = (id: string, weight: string, extra: Record<string, unknown> = {}) => ({ "Lot ID": id, "Lot Status DB": "Stock", Shape: "ROUND", Weight: weight, "Company ID": "FDH", "Doc ID": `D-${id}`, "Doc Date": "15-08-2026", ...extra });
const manyLots = (n: number) => Array.from({ length: n }, (_, i) => lot(`L-${i + 1}`, "1.10"));

let admin: Awaited<ReturnType<typeof makeUser>>, viewer: typeof admin, analyst: typeof admin;

beforeAll(async () => {
  await resetDb();
  process.env.FANTASY_SOURCE_MODE = "FANTASY_API";
  process.env.FANTASY_API_BASE_URL = "https://skylab.fantasy.mn:7600";
  process.env.FANTASY_API_USERNAME = "test-user";
  process.env.FANTASY_API_PASSWORD = "test-password-never-shown";
  process.env.FANTASY_SYNC_STALE_GUARD_PERCENT = "25";
  process.env.FANTASY_SYNC_CHAIN_PLANNING = "false"; // the planning sync has its own suite
  admin = await makeUser("fl.admin", "SUPER_ADMIN");
  viewer = await makeUser("fl.viewer", "VIEWER");
  analyst = await makeUser("fl.analyst", "DATA_ANALYST"); // fantasy.read, no fantasy.sync
});
beforeEach(async () => {
  await db.$executeRawUnsafe(`TRUNCATE "FantasyLiveLot", "IntegrationSyncRun" CASCADE`);
  await db.syncCheckpoint.deleteMany({ where: { source: LIVE_SYNC_SOURCE } });
});

describe("permissions", () => {
  test("live data: anonymous → 401, viewer (no fantasy.read) → 403, analyst → 200", async () => {
    expect((await call(liveDataRoute, { path: "/api/fantasy/live-data" })).status).toBe(401);
    expect((await call(liveDataRoute, { path: "/api/fantasy/live-data", cookie: viewer.cookie })).status).toBe(403);
    expect((await call(liveDataRoute, { path: "/api/fantasy/live-data", cookie: analyst.cookie })).status).toBe(200);
  });
  test("manual sync: anonymous → 401, analyst (no fantasy.sync) → 403; status needs fantasy.read", async () => {
    expect((await call(syncRoute, { method: "POST", path: "/api/fantasy/live-data/sync", body: {} })).status).toBe(401);
    expect((await call(syncRoute, { method: "POST", path: "/api/fantasy/live-data/sync", body: {}, cookie: analyst.cookie })).status).toBe(403);
    expect((await call(statusRoute, { path: "/api/fantasy/sync/status", cookie: viewer.cookie })).status).toBe(403);
    expect((await call(statusRoute, { path: "/api/fantasy/sync/status", cookie: analyst.cookie })).status).toBe(200);
  });
});

describe("no credential ever leaves the server", () => {
  test("status, source and live-data responses carry no password, username or token", async () => {
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => [lot("L-1", "1.10")]), chainCanonical: false });
    for (const [route, p] of [[statusRoute, "/api/fantasy/sync/status"], [sourceRoute, "/api/fantasy/source"], [liveDataRoute, "/api/fantasy/live-data"]] as const) {
      const r = await call(route, { path: p, cookie: admin.cookie });
      expect(r.status).toBe(200);
      const text = JSON.stringify(r.json);
      expect(text).not.toContain("test-password-never-shown");
      expect(text).not.toContain("test-user");
      expect(text).not.toMatch(/access_token|tokenEnc|Bearer/);
    }
  });
  test("sync run rows hold no credential; a failed auth is a fixed safe message", async () => {
    const failing = { fetchLots: async () => { throw new FantasyApiError("Fantasy authentication failed.", "AUTH_FAILED", 401); } } as unknown as FantasyClient;
    const r = await runLiveDataSync({ trigger: "manual", actor: "t", client: failing, chainCanonical: false });
    expect(r.status).toBe("FAILED");
    expect(r.errorCode).toBe("AUTH_FAILED");
    expect(r.errorSummary).toBe("Fantasy authentication failed.");
    const runs = await db.integrationSyncRun.findMany();
    expect(JSON.stringify(runs)).not.toContain("test-password-never-shown");
  });
  test("git: .env is untracked; tracked files contain no real credential", () => {
    const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n");
    expect(tracked).not.toContain(".env");
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
    expect(example).toMatch(/^FANTASY_API_PASSWORD=$/m);
    expect(example).toMatch(/^FANTASY_API_USERNAME=$/m);
    expect(example).not.toMatch(/enc:v1:[A-Za-z0-9+/=]{16,}/); // a real envelope, not the documentation mention
    let hits = "";
    try {
      hits = execSync(`git grep -l -E "FANTASY_API_PASSWORD=.+|SECRETS_KEY=.+" -- . ':!*.md'`, { cwd: ROOT }).toString().trim();
    } catch {
      hits = ""; // git grep exits 1 when nothing matches
    }
    expect(hits).toBe("");
  });
});

describe("synchronization semantics", () => {
  test("idempotent: the same snapshot twice keeps one row per identity; changed weight updates in place", async () => {
    const r1 = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(300)), chainCanonical: false });
    expect(r1.status).toBe("SUCCESS");
    expect(r1.recordsInserted).toBe(300);
    const r2 = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(300)), chainCanonical: false });
    expect(r2.recordsInserted).toBe(0);
    expect(r2.recordsUnchanged).toBe(300);
    expect(await db.fantasyLiveLot.count()).toBe(300);
    const changed = manyLots(300); changed[4] = lot("L-5", "1.20");
    const r3 = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => changed), chainCanonical: false });
    expect(r3.recordsUpdated).toBe(1);
    expect(r3.recordsUnchanged).toBe(299);
    expect(await db.fantasyLiveLot.count()).toBe(300);
    const l5 = await db.fantasyLiveLot.findFirst({ where: { lotId: "L-5" } });
    expect(String(l5?.weight)).toBe("1.2");
    expect(l5?.sourceActive).toBe(true);
  });
  test("failure safety: an upstream 500 leaves every row intact and records a FAILED run", async () => {
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(50)), chainCanonical: false });
    const failing = { fetchLots: async () => { throw new FantasyApiError("Fantasy API GET /api/lots → HTTP 500: boom", "UPSTREAM_ERROR", 500); } } as unknown as FantasyClient;
    const r = await runLiveDataSync({ trigger: "scheduled", client: failing, chainCanonical: false });
    expect(r.status).toBe("FAILED");
    expect(r.errorCode).toBe("UPSTREAM_ERROR");
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: true } })).toBe(50);
    const st = await getLiveSyncStatus();
    expect(st.status).toBe("idle");
    expect(st.lastRun?.status).toBe("FAILED");
    expect(st.lastSuccessfulSyncAt).not.toBeNull();
  });
  test("empty snapshot never stales data: PARTIAL with POSSIBLE_SOURCE_SNAPSHOT_ANOMALY", async () => {
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(20)), chainCanonical: false });
    const r = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => []), chainCanonical: false });
    expect(r.status).toBe("PARTIAL");
    expect(r.errorCode).toBe("POSSIBLE_SOURCE_SNAPSHOT_ANOMALY");
    expect(r.recordsStaled).toBe(0);
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: true } })).toBe(20);
  });
  test("mass-disappearance guard: >25% missing → nothing staled; small drift → stale, never deleted", async () => {
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(100)), chainCanonical: false });
    const r = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(50)), chainCanonical: false });
    expect(r.status).toBe("PARTIAL");
    expect(r.errorCode).toBe("POSSIBLE_SOURCE_SNAPSHOT_ANOMALY");
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: true } })).toBe(100);
    const r2 = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(90)), chainCanonical: false });
    expect(r2.status).toBe("SUCCESS");
    expect(r2.recordsStaled).toBe(10);
    expect(await db.fantasyLiveLot.count()).toBe(100);
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: false } })).toBe(10);
    const r3 = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(100)), chainCanonical: false });
    expect(r3.recordsUpdated + r3.recordsUnchanged).toBe(100);
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: true } })).toBe(100);
  });
  test("schema mismatch: rows that map to nothing fail the run without writes", async () => {
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(5)), chainCanonical: false });
    const r = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => [{ foo: 1 }, { bar: 2 }]), chainCanonical: false });
    expect(r.status).toBe("FAILED");
    expect(r.errorCode).toBe("SCHEMA_MISMATCH");
    expect(await db.fantasyLiveLot.count({ where: { sourceActive: true } })).toBe(5);
  });
  test("concurrency: a second sync while one runs is LOCKED, and the route answers 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = stub(async () => { await gate; return manyLots(3); });
    const first = runLiveDataSync({ trigger: "scheduled", client: slow, chainCanonical: false });
    await new Promise((r) => setTimeout(r, 150));
    const second = await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => manyLots(3)), chainCanonical: false });
    expect(second.status).toBe("LOCKED");
    const viaRoute = await call(syncRoute, { method: "POST", path: "/api/fantasy/live-data/sync", body: {}, cookie: admin.cookie });
    expect(viaRoute.status).toBe(409);
    release();
    expect((await first).status).toBe("SUCCESS");
    expect((await getLiveSyncStatus()).status).toBe("idle");
  });
});

describe("live data API", () => {
  beforeEach(async () => {
    const rows = manyLots(120).map((r, i) => ({ ...r, Shape: i % 2 ? "OVAL" : "ROUND", "Lab Name": i % 3 ? "GIA" : "IGI", "Certificate No": `CERT-${i + 1}`, "On Hold": i % 10 === 0 ? "Y" : "N", Weight: (1 + i / 100).toFixed(2) }));
    await runLiveDataSync({ trigger: "manual", actor: "t", client: stub(async () => rows), chainCanonical: false });
  });
  test("server-side pagination with totals", async () => {
    const r = await call(liveDataRoute, { path: "/api/fantasy/live-data?page=2&pageSize=50", cookie: admin.cookie });
    expect(r.status).toBe(200);
    expect(r.json.totalRecords).toBe(120);
    expect(r.json.totalPages).toBe(3);
    expect(r.json.data.length).toBe(50);
    expect(Object.keys(r.json.data[0])).toContain("metalId");
    expect(typeof r.json.data[0].weight).toBe("string");
  });
  test("search by identifiers and column filters", async () => {
    const byCert = await call(liveDataRoute, { path: "/api/fantasy/live-data?q=CERT-7", cookie: admin.cookie });
    expect(byCert.json.data.map((d: { certificateNo: string }) => d.certificateNo).every((c: string) => c.includes("CERT-7"))).toBe(true);
    const oval = await call(liveDataRoute, { path: "/api/fantasy/live-data?shape=OVAL&pageSize=500", cookie: admin.cookie });
    expect(oval.json.totalRecords).toBe(60);
    const hold = await call(liveDataRoute, { path: "/api/fantasy/live-data?onHold=true&pageSize=500", cookie: admin.cookie });
    expect(hold.json.totalRecords).toBe(12);
  });
  test("sort whitelist: weight ascending works, unknown column → 400", async () => {
    const asc = await call(liveDataRoute, { path: "/api/fantasy/live-data?sortBy=weight&sortOrder=asc&pageSize=3", cookie: admin.cookie });
    expect(asc.json.data.map((d: { weight: string }) => d.weight)).toEqual(["1", "1.01", "1.02"]);
    expect((await call(liveDataRoute, { path: "/api/fantasy/live-data?sortBy=sourcePayload", cookie: admin.cookie })).status).toBe(400);
  });
  test("manual sync route returns the documented shape and audits the user", async () => {
    const r = await call(syncRoute, { method: "POST", path: "/api/fantasy/live-data/sync", body: {}, cookie: admin.cookie });
    expect(r.status).toBe(200);
    for (const key of ["success", "syncRunId", "status", "recordsFetched", "recordsInserted", "recordsUpdated", "recordsUnchanged", "durationMs"]) expect(Object.keys(r.json)).toContain(key);
    const audit = await db.auditLog.findFirst({ where: { action: "FANTASY_LIVE_SYNC" }, orderBy: { timestamp: "desc" } });
    expect(audit?.actorUserId).toBe(admin.user.id);
  });
});

describe("export import", () => {
  const headers = ["Metal ID", "Lot ID", "Lot Name", "Lot Status DB", "Shape", "Weight", "Company ID", "Doc ID", "Doc Date", "ItemName"];
  const xlsx = (rows: unknown[][]) => {
    const wb = utils.book_new();
    utils.book_append_sheet(wb, utils.aoa_to_sheet([headers, ...rows]), "Lots");
    return write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  };
  const upload = async (name: string, buf: Buffer, cookie?: string) => {
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array(buf)], name, { type: "application/octet-stream" }));
    const mod = await import("@/app/api/fantasy/live-data/import/route");
    const res = await mod.POST(new Request("http://localhost:3000/api/fantasy/live-data/import", { method: "POST", headers: cookie ? { cookie } : {}, body: fd }), { params: Promise.resolve({}) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  test("anonymous → 401; analyst (no fantasy.sync) → 403", async () => {
    expect((await upload("a.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"]]))).status).toBe(401);
    expect((await upload("a.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"]]), analyst.cookie)).status).toBe(403);
  });
  test("an xlsx export lands in Live Data through the same sync, recorded as an import", async () => {
    const r = await upload("fantasy-lots.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"], ["M2", "L-2", "n", "Memo", "OVAL", "2,000.5", "FDH", "D2", "", "Polished"]]), admin.cookie);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(r.json.recordsInserted).toBe(2);
    expect(r.json.headers.length).toBe(10);
    const rows = await db.fantasyLiveLot.findMany({ orderBy: { lotId: "asc" } });
    expect(rows.length).toBe(2);
    expect(String(rows[1].weight)).toBe("2000.5");
    const run = await db.integrationSyncRun.findFirst({ where: { entity: "LiveData" }, orderBy: { startedAt: "desc" } });
    expect(run?.triggeredBy).toBe("fl.admin");
    expect(run?.sourceMode).toBe("FILE_IMPORT");
    const list = await call(liveDataRoute, { path: "/api/fantasy/live-data?q=L-2", cookie: admin.cookie });
    expect(list.json.totalRecords).toBe(1);
    expect(list.json.data[0].metalId).toBe("M2");
  });
  test("re-importing the same export is idempotent; a csv works too", async () => {
    await upload("a.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"]]), admin.cookie);
    const again = await upload("a.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"]]), admin.cookie);
    expect(again.json.recordsInserted).toBe(0);
    expect(again.json.recordsUnchanged).toBe(1);
    const csv = Buffer.from(`${headers.join(",")}\nM9,L-9,n,Stock,PEAR,0.9,FDH,D9,15-08-2026,Polished\n`);
    const c = await upload("export.csv", csv, admin.cookie);
    expect(c.status).toBe(200);
    expect(c.json.format).toBe("csv");
    expect(await db.fantasyLiveLot.count()).toBe(2);
  });
  test("a wrong file type is rejected and nothing changes", async () => {
    await upload("a.xlsx", xlsx([["M1", "L-1", "n", "Stock", "ROUND", 1.1, "FDH", "D1", "15-08-2026", "Polished"]]), admin.cookie);
    const r = await upload("notes.pdf", Buffer.from("%PDF-1.4"), admin.cookie);
    expect(r.status).toBe(400);
    expect(await db.fantasyLiveLot.count()).toBe(1);
  });
});
