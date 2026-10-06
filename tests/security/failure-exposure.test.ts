import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as demandHistory } from "@/app/api/demand/history/route";
import { GET as fantasySync } from "@/app/api/fantasy/sync/route";
import { GET as excess } from "@/app/api/analysis/excess/route";
import {
  readPublicFailure,
  recordOperationalFailure,
  serializePublicFailure,
} from "@/lib/api/operational-failure";
import { runSynchronization } from "@/lib/fantasy/sync-service";

const MARKERS = [
  "PrismaClientKnownRequestError",
  "DemandRun",
  "errorSummary",
  "IntegrationSyncRun_batchId_key",
  "/var/task/.next/server/chunks/8471.js",
  "Invalid `db.demandRun.update()` invocation",
];

const LEGACY_RAW_ERROR_SUMMARY = [
  "Invalid `db.demandRun.update()` invocation:",
  "Unique constraint failed on the constraint: `IntegrationSyncRun_batchId_key`",
  "  at PrismaClientKnownRequestError (/var/task/.next/server/chunks/8471.js:12:3)",
  "  at async runDemandCalculation (/var/task/.next/server/chunks/8471.js:88:5)",
  "  column: errorSummary, model: DemandRun",
].join("\n");

function assertNoMarkers(serialized: string, where: string) {
  for (const marker of MARKERS) {
    expect(serialized.includes(marker)).toBe(false);
  }
  expect(/\bat\s+async\s+\w+\s+\(/.test(serialized)).toBe(false);
  expect(serialized.includes(where)).toBe(false);
}

describe("operational failure sanitization", () => {
  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
  });

  test("converts a marker-laden exception into a public envelope carrying none of it", () => {
    const err = new Error(LEGACY_RAW_ERROR_SUMMARY);
    err.stack = `${LEGACY_RAW_ERROR_SUMMARY}\n  at Object.<anonymous> (/var/task/.next/server/chunks/8471.js:1:1)`;

    const failure = recordOperationalFailure(err, {
      operation: "demand.run",
      entity: "DemandRun",
      entityId: "test-entity",
      actorUserId: null,
    });

    const serialized = serializePublicFailure(failure);
    assertNoMarkers(serialized, LEGACY_RAW_ERROR_SUMMARY);

    expect(failure.code).toBe("OPERATION_FAILED");
    expect(failure.message.length > 0).toBe(true);
    expect(/^[0-9A-F]{12}$/.test(failure.referenceId)).toBe(true);
    expect(typeof failure.retryable).toBe("boolean");
  });

  test("re-sanitizes a stored raw value instead of echoing it", () => {
    const recovered = readPublicFailure(LEGACY_RAW_ERROR_SUMMARY);
    expect(recovered !== null).toBe(true);
    assertNoMarkers(JSON.stringify(recovered), LEGACY_RAW_ERROR_SUMMARY);
    expect(recovered?.code).toBe("OPERATION_FAILED");
    expect(recovered?.referenceId).toBe("");
  });

  test("does not invent a failure for a run that did not fail", () => {
    expect(readPublicFailure(null)).toBe(null);
    expect(readPublicFailure("")).toBe(null);
  });

  test("a value smuggled into the envelope cannot ride out through an unexpected key", () => {
    const forged = JSON.stringify({
      v: "PUBLIC_FAILURE_V1",
      code: "OPERATION_FAILED",
      message: LEGACY_RAW_ERROR_SUMMARY,
      referenceId: LEGACY_RAW_ERROR_SUMMARY,
      occurredAt: "2026-01-01T00:00:00.000Z",
      extra: LEGACY_RAW_ERROR_SUMMARY,
    });
    const recovered = readPublicFailure(forged);
    assertNoMarkers(JSON.stringify(recovered), LEGACY_RAW_ERROR_SUMMARY);
  });
});

describe("failed synchronization leaves no exception text and no partial write", () => {
  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
  });

  test("a real failure inside the transaction rolls back and persists only the envelope", async () => {
    const lotsBefore = await db.lotMasterRecord.count();
    const historyBefore = await db.lotHistoryRecord.count();

    const result = await runSynchronization({ actor: "failure-exposure-test", simulateFailure: true });

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");

    expect(await db.lotMasterRecord.count()).toBe(lotsBefore);
    expect(await db.lotHistoryRecord.count()).toBe(historyBefore);

    const run = await db.integrationSyncRun.findUnique({ where: { id: result.runId } });
    expect(run?.status).toBe("FAILED");

    expect(run?.errorSummary?.includes("Controlled simulation failure")).toBe(false);
    const stored = readPublicFailure(run?.errorSummary ?? null);
    expect(stored?.code).toBe("OPERATION_FAILED");
    expect(/^[0-9A-F]{12}$/.test(stored?.referenceId ?? "")).toBe(true);

    expect(result.failure?.referenceId).toBe(stored?.referenceId);
    expect(JSON.stringify(result.failure).includes("Controlled simulation failure")).toBe(false);
  });
});

describe("route boundaries sanitize legacy stored failures", () => {
  let analystCookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    analystCookie = (await makeUser("failure-exposure-viewer", "VIEWER")).cookie;
  });

  test("demand run history never returns a raw stored error summary", async () => {
    await db.demandRun.create({
      data: {
        status: "FAILED",
        errorSummary: LEGACY_RAW_ERROR_SUMMARY,
        windowDays: 90,
        ruleVersion: "DEMAND-V1",
        sourcePolicy: "CANONICAL_FANTASY",
        startedAt: new Date(),
        finishedAt: new Date(),
        durationMs: 42,
        actor: "failure-exposure-test",
      },
    });

    const res = await call(demandHistory, { path: "/api/demand/history", cookie: analystCookie });
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(res.json);
    assertNoMarkers(serialized, LEGACY_RAW_ERROR_SUMMARY);

    const row = res.json.rows.find((r: any) => r.status === "FAILED");
    expect(row !== undefined).toBe(true);
    expect(row.failure.code).toBe("OPERATION_FAILED");
    expect(row.errorSummary).toBe(undefined);
  });

  test("fantasy sync status never returns a raw stored error summary", async () => {
    const syncCookie = (await makeUser("failure-exposure-mfg", "MFG_VIEWER")).cookie;
    await db.integrationSyncRun.create({
      data: {
        source: "FANTASY",
        entity: "BATCH",
        status: "FAILED",
        batchId: `FX-${Date.now()}`,
        startingCheckpoint: 0,
        endingCheckpoint: 0,
        errorSummary: LEGACY_RAW_ERROR_SUMMARY,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    const res = await call(fantasySync, { path: "/api/fantasy/sync", cookie: syncCookie });
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(res.json);
    assertNoMarkers(serialized, LEGACY_RAW_ERROR_SUMMARY);

    const failedRun = res.json.recentRuns.find((r: any) => r.status === "FAILED");
    expect(failedRun !== undefined).toBe(true);
    expect(failedRun.failure.code).toBe("OPERATION_FAILED");
    expect(failedRun.errorSummary).toBe(undefined);
    expect(serialized.includes('"sample"')).toBe(false);
  });
});

describe("analysis responses carry results, not mechanics", () => {
  let viewerCookie = "";

  const MECHANICS = [
    "zScore",
    "z-score",
    "MAX(0",
    "std-dev",
    "standard deviation",
    "σ",
    "α = ",
    "|z|",
  ];

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    viewerCookie = (await makeUser("mechanics-viewer", "VIEWER")).cookie;
  });

  test("excess analysis explains what the number means without stating how it is derived", async () => {
    const res = await call(excess, { path: "/api/analysis/excess?section=status", cookie: viewerCookie });
    expect(res.status).toBe(200);

    const serialized = JSON.stringify(res.json);
    for (const m of MECHANICS) expect(serialized.includes(m)).toBe(false);
    expect(serialized.includes("formula")).toBe(false);
    expect(res.json.warning).toBe(undefined);

    expect(typeof res.json.sourceLabel).toBe("string");
    expect(typeof res.json.periodLabel).toBe("string");
  });

  test("both endpoints still refuse an unauthenticated caller", async () => {
    expect((await call(excess, { path: "/api/analysis/excess" })).status).toBe(401);
    expect((await call(demandHistory, { path: "/api/demand/history" })).status).toBe(401);
    expect((await call(fantasySync, { path: "/api/fantasy/sync" })).status).toBe(401);
  });

  test("fantasy sync stays refused for a role without fantasy.read", async () => {
    const res = await call(fantasySync, { path: "/api/fantasy/sync", cookie: viewerCookie });
    expect(res.status).toBe(403);
    assertNoMarkers(JSON.stringify(res.json), LEGACY_RAW_ERROR_SUMMARY);
  });
});
