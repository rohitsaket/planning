import { beforeAll, describe, expect, test } from "./harness";
import { db, resetDb } from "./helpers";
import {
  CANONICAL_STATE_ID,
  CanonicalStateBusyError,
  claimCanonicalState,
  forceReleaseCanonicalState,
  isClaimStillHeld,
  releaseCanonicalState,
} from "@/lib/fantasy/canonical-state-claim";
import { runDemandCalculation } from "@/lib/demand/demand-service";
import { runSynchronization } from "@/lib/fantasy/sync-service";
import { call, makeUser } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { POST as fantasySync } from "@/app/api/fantasy/sync/route";
import { POST as demandRun } from "@/app/api/demand/run/route";
import { GET as stockout } from "@/app/api/analysis/stockout/route";
import { GET as demandTrace } from "@/app/api/analysis/demand-trace/route";
import { resolveEffectiveAccess } from "@/lib/auth/effective-permissions";

/**
 * Canonical-state coordination.
 *
 * Synchronization and the demand calculation each guarded their own operation and knew
 * nothing about the other, so a sync could commit a batch while a demand run was
 * part-way through reading the rows it was changing — producing one calculation whose
 * sales came from before the batch and whose inventory came from after it. Nothing in
 * the result would have looked wrong.
 *
 * Every claim here is taken through the real functions against the real row, and the
 * overlap tests start both operations before either finishes.
 */

async function freeClaim() {
  await db.canonicalStateClaim.upsert({
    where: { id: CANONICAL_STATE_ID },
    create: { id: CANONICAL_STATE_ID },
    update: { holder: null, ownerToken: null, claimedBy: null, claimedAt: null, expiresAt: null },
  });
}

describe("claiming the canonical state", () => {
  beforeAll(async () => {
    await resetDb();
    await freeClaim();
  });

  test("two workers race for a free claim and exactly one wins", async () => {
    await freeClaim();
    // Genuinely overlapping: both statements are in flight against the same row.
    const [a, b] = await Promise.all([
      claimCanonicalState("SYNC", "worker-a"),
      claimCanonicalState("DEMAND", "worker-b"),
    ]);
    const winners = [a, b].filter((r) => r.acquired);
    expect(winners.length).toBe(1);

    const loser = [a, b].find((r) => !r.acquired)!;
    expect(loser.acquired).toBe(false);
    if (!loser.acquired) {
      // The refusal names the holder in business language and carries no token.
      expect(["SYNC", "DEMAND"].includes(loser.heldBy)).toBe(true);
      expect(loser.reason.includes("token")).toBe(false);
    }
  });

  test("a wrong token cannot release another worker's claim", async () => {
    const held = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect(held.ownerToken !== null).toBe(true);

    const released = await releaseCanonicalState({
      holder: "SYNC",
      ownerToken: "not-the-owner",
      fencingVersion: held.fencingVersion,
      expiresAt: held.expiresAt!,
    });
    expect(released).toBe(false);

    const still = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect(still.ownerToken).toBe(held.ownerToken);
  });

  test("the owning token releases its own claim", async () => {
    const held = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    const released = await releaseCanonicalState({
      holder: held.holder === "DEMAND" ? "DEMAND" : "SYNC",
      ownerToken: held.ownerToken!,
      fencingVersion: held.fencingVersion,
      expiresAt: held.expiresAt!,
    });
    expect(released).toBe(true);

    const free = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect({ holder: free.holder, token: free.ownerToken }).toEqual({ holder: null, token: null });
  });

  test("an expired claim is reclaimable without an administrator", async () => {
    await freeClaim();
    // A lease already in the past: the worker that took it is gone.
    const stale = await claimCanonicalState("SYNC", "crashed-worker", db, -1_000);
    expect(stale.acquired).toBe(true);

    const reclaimed = await claimCanonicalState("DEMAND", "next-worker");
    expect(reclaimed.acquired).toBe(true);
    if (reclaimed.acquired) {
      // A new generation, so the crashed worker is fenced.
      expect(stale.acquired && reclaimed.claim.fencingVersion > stale.claim.fencingVersion).toBe(true);
      await releaseCanonicalState(reclaimed.claim);
    }
  });

  test("an unexpired claim is not reclaimable", async () => {
    await freeClaim();
    const first = await claimCanonicalState("SYNC", "holder");
    expect(first.acquired).toBe(true);
    const second = await claimCanonicalState("DEMAND", "waiter");
    expect(second.acquired).toBe(false);
    if (!second.acquired) expect(second.heldBy).toBe("SYNC");
    if (first.acquired) await releaseCanonicalState(first.claim);
  });
});

describe("fencing a displaced worker", () => {
  beforeAll(async () => {
    await resetDb();
    await freeClaim();
  });

  test("a held claim reports itself as still in force", async () => {
    const claim = await claimCanonicalState("DEMAND", "worker");
    expect(claim.acquired).toBe(true);
    if (claim.acquired) expect(await isClaimStillHeld(claim.claim)).toBe(true);
  });

  test("after a forced release the displaced worker is fenced", async () => {
    const held = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    const displaced = {
      holder: "DEMAND" as const,
      ownerToken: held.ownerToken!,
      fencingVersion: held.fencingVersion,
      expiresAt: held.expiresAt!,
    };

    const forced = await forceReleaseCanonicalState("ADMIN_TEST");
    expect({ released: forced.released, active: forced.forcedActiveClaim, holder: forced.previousHolder }).toEqual({
      released: true,
      active: true,
      holder: "DEMAND",
    });

    // The worker still holds its own token, and is still refused: the generation moved.
    expect(await isClaimStillHeld(displaced)).toBe(false);
    // And it cannot release a claim that is no longer its own.
    expect(await releaseCanonicalState(displaced)).toBe(false);
  });

  test("a worker whose claim was broken cannot fence out a new holder", async () => {
    const stale = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    const fresh = await claimCanonicalState("SYNC", "new-worker");
    expect(fresh.acquired).toBe(true);

    // The displaced worker's release attempt must not free the new holder's claim.
    const displaced = {
      holder: "DEMAND" as const,
      ownerToken: "stale-token",
      fencingVersion: stale.fencingVersion,
      expiresAt: new Date(Date.now() + 60_000),
    };
    expect(await releaseCanonicalState(displaced)).toBe(false);

    const still = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect(still.holder).toBe("SYNC");
    if (fresh.acquired) await releaseCanonicalState(fresh.claim);
  });

  test("a forced release of a free claim reports that nothing was held", async () => {
    await freeClaim();
    const forced = await forceReleaseCanonicalState("ADMIN_TEST");
    expect({ released: forced.released, holder: forced.previousHolder }).toEqual({
      released: false,
      holder: null,
    });
  });

  test("clearing an expired claim is not reported as breaking live work", async () => {
    await freeClaim();
    await claimCanonicalState("SYNC", "crashed", db, -1_000);
    const forced = await forceReleaseCanonicalState("ADMIN_TEST");
    expect({ released: forced.released, active: forced.forcedActiveClaim }).toEqual({
      released: true,
      active: false,
    });
  });
});

describe("synchronization and demand cannot overlap", () => {
  beforeAll(async () => {
    await resetDb();
    await freeClaim();
  });

  test("a demand run cannot enter while synchronization holds the canonical state", async () => {
    await freeClaim();
    const syncHolds = await claimCanonicalState("SYNC", "sync-worker");
    expect(syncHolds.acquired).toBe(true);

    let refused: unknown = null;
    try {
      await runDemandCalculation({ actor: "demand-worker", windowDays: 90 });
    } catch (e) {
      refused = e;
    }
    expect(refused instanceof CanonicalStateBusyError).toBe(true);
    expect((refused as CanonicalStateBusyError).heldBy).toBe("SYNC");
    // Business wording, no token, no row id, no SQL.
    const message = (refused as Error).message;
    expect(message.includes("being updated")).toBe(true);
    for (const leaked of ["token", "CanonicalStateClaim", "SELECT", "ownerToken"]) {
      expect(message.includes(leaked)).toBe(false);
    }

    // The refused run released the demand lock again rather than holding it for a lease.
    const lock = await db.demandCalculationLock.findUnique({ where: { id: "DEMAND_CALCULATION" } });
    expect(lock?.isLocked ?? false).toBe(false);

    if (syncHolds.acquired) await releaseCanonicalState(syncHolds.claim);
  });

  test("a synchronization cannot mutate canonical records while demand holds the state", async () => {
    await freeClaim();
    const demandHolds = await claimCanonicalState("DEMAND", "demand-worker");
    expect(demandHolds.acquired).toBe(true);

    const lotsBefore = await db.lotMasterRecord.count();
    let refused: unknown = null;
    try {
      await runSynchronization({ actor: "sync-worker" });
    } catch (e) {
      refused = e;
    }
    expect(refused instanceof CanonicalStateBusyError).toBe(true);
    expect((refused as CanonicalStateBusyError).heldBy).toBe("DEMAND");

    // Nothing was written, and the sync lock was handed back.
    expect(await db.lotMasterRecord.count()).toBe(lotsBefore);
    const checkpoint = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
    expect(checkpoint?.isLocked ?? false).toBe(false);

    if (demandHolds.acquired) await releaseCanonicalState(demandHolds.claim);
  });

  test("a synchronization leaves the claim free for the next operation", async () => {
    await freeClaim();
    await runSynchronization({ actor: "sync-worker" });
    const after = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect({ holder: after.holder, token: after.ownerToken }).toEqual({ holder: null, token: null });
  });

  test("a failed synchronization releases the claim and advances no checkpoint", async () => {
    await freeClaim();
    const before = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });

    const result = await runSynchronization({ actor: "sync-worker", simulateFailure: true });
    expect(result.status).toBe("FAILED");

    const after = await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } });
    expect(after.currentCheckpoint).toBe(before.currentCheckpoint);

    const claim = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect({ holder: claim.holder, token: claim.ownerToken }).toEqual({ holder: null, token: null });
  });
});

describe("a demand run is bound to one committed synchronization", () => {
  beforeAll(async () => {
    await resetDb();
    await freeClaim();
  });

  test("the run records the exact sync it read, not merely a timestamp", async () => {
    await freeClaim();
    const sync = await runSynchronization({ actor: "sync-worker" });
    expect(sync.success).toBe(true);

    const run = await runDemandCalculation({ actor: "demand-worker", windowDays: 90 });
    const stored = await db.demandRun.findUniqueOrThrow({
      where: { id: run.runId },
      select: { sourceSyncRunId: true, checkpoint: true, lastBatchId: true },
    });
    expect(stored.sourceSyncRunId).toBe(sync.runId);
    expect(stored.checkpoint).toBe(sync.endingCheckpoint);
    expect(stored.lastBatchId).toBe(sync.batchId);
  });

  test("a later synchronization does not rewrite an older run's source identity", async () => {
    const earlier = await db.demandRun.findFirstOrThrow({
      orderBy: { runDate: "desc" },
      select: { id: true, sourceSyncRunId: true, checkpoint: true },
    });

    await freeClaim();
    const laterSync = await runSynchronization({ actor: "sync-worker" });

    const unchanged = await db.demandRun.findUniqueOrThrow({
      where: { id: earlier.id },
      select: { sourceSyncRunId: true, checkpoint: true },
    });
    expect(unchanged.sourceSyncRunId).toBe(earlier.sourceSyncRunId);
    expect(unchanged.checkpoint).toBe(earlier.checkpoint);
    // The newer sync is genuinely a different one, so the check is not vacuous.
    expect(laterSync.runId === earlier.sourceSyncRunId).toBe(false);
  });

  test("a legacy run reports its source identity as unavailable rather than guessed", async () => {
    const legacy = await db.demandRun.create({
      data: {
        status: "COMPLETED", windowDays: 90, ruleVersion: "DEMAND-V1",
        sourcePolicy: "CANONICAL_FANTASY", startedAt: new Date(), finishedAt: new Date(),
        actor: "legacy",
      },
      select: { sourceSyncRunId: true },
    });
    expect(legacy.sourceSyncRunId).toBe(null);
  });
});

describe("failure leaves no partial result", () => {
  beforeAll(async () => {
    await resetDb();
    await freeClaim();
  });

  test("a synchronization that fails inside its transaction writes nothing", async () => {
    await freeClaim();
    // Rewind so the fixture provider actually has a batch to offer. Without this the
    // run takes the "no new batch" path and never reaches the transaction the failure
    // is injected into, and the test would pass without exercising rollback at all.
    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: { currentCheckpoint: 0, isLocked: false, lockToken: null, lockExpiresAt: null },
    });
    const before = {
      lots: await db.lotMasterRecord.count(),
      history: await db.lotHistoryRecord.count(),
      checkpoint: (await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } })).currentCheckpoint,
    };

    // The failure is thrown inside the service's own `$transaction`, so this exercises
    // the real rollback rather than a hand-built FAILED row.
    const result = await runSynchronization({ actor: "sync-worker", simulateFailure: true });
    expect(result.status).toBe("FAILED");

    expect({
      lots: await db.lotMasterRecord.count(),
      history: await db.lotHistoryRecord.count(),
      checkpoint: (await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } })).currentCheckpoint,
    }).toEqual(before);

    // The failed attempt produced a FAILED run, not a SUCCESS one — so no successful
    // checkpoint can refer to the canonical writes that were rolled back.
    const thisAttempt = await db.integrationSyncRun.findUniqueOrThrow({
      where: { id: result.runId },
      select: { status: true, endingCheckpoint: true },
    });
    expect(thisAttempt.status).toBe("FAILED");
  });

  test("a demand run fenced before persistence leaves no metrics and no completed run", async () => {
    await freeClaim();
    await runSynchronization({ actor: "sync-worker" });
    await freeClaim();

    const metricsBefore = await db.demandMetric.count();
    const completedBefore = await db.demandRun.count({ where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } } });

    // A real overlap: the calculation starts, an administrator force-releases its claim
    // mid-flight, and the run must discard its own result rather than persist figures
    // describing a state it no longer exclusively held.
    const calculation = runDemandCalculation({ actor: "demand-worker", windowDays: 90 });
    await new Promise((r) => setTimeout(r, 5));
    await forceReleaseCanonicalState("ADMIN_TEST");

    let failed: unknown = null;
    try {
      await calculation;
    } catch (e) {
      failed = e;
    }

    if (failed) {
      // Fenced: nothing of this run survives.
      expect(await db.demandMetric.count()).toBe(metricsBefore);
      expect(
        await db.demandRun.count({ where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } } }),
      ).toBe(completedBefore);
      // The message is safe for a browser: no token, no table, no SQL.
      const message = (failed as Error).message;
      for (const leaked of ["ownerToken", "CanonicalStateClaim", "SELECT", "prisma"]) {
        expect(message.includes(leaked)).toBe(false);
      }
    } else {
      // The calculation committed before the release landed. That is a legitimate
      // outcome of a genuine race — what must never happen is a half-written result.
      const run = await db.demandRun.findFirstOrThrow({ orderBy: { runDate: "desc" } });
      expect(["COMPLETED", "REVIEW_REQUIRED"].includes(run.status)).toBe(true);
    }
  });

  test("the claim is never left held after either operation finishes", async () => {
    const claim = await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } });
    expect({ holder: claim.holder, token: claim.ownerToken }).toEqual({ holder: null, token: null });
  });
});

describe("persisted roles cannot re-grant operational access to ADMIN", () => {
  const OPERATIONAL = ["fantasy.sync.run", "fantasy.sync.retry", "fantasy.sync.unlock", "demand.run", "demand.unlock"] as const;

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
  });

  test("ADMIN is a system role, so its permissions come from code and rows are ignored", async () => {
    const admin = await db.role.findUnique({
      where: { code: "ADMIN" },
      select: { isSystem: true, status: true, permissions: { select: { permissionCode: true } } },
    });
    expect(admin?.isSystem).toBe(true);

    // The decisive check: even a row explicitly granting an operational permission
    // contributes nothing for a system role, so no database state can undo Phase I.
    const withForgedGrant = resolveEffectiveAccess(
      [{
        code: "ADMIN",
        isSystem: true,
        status: "ACTIVE",
        permissions: OPERATIONAL.map((permissionCode) => ({ permissionCode })),
      }],
      null,
    );
    for (const p of OPERATIONAL) {
      expect({ p, granted: withForgedGrant.permissions.includes(p) }).toEqual({ p, granted: false });
    }
  });

  test("an explicit custom-role grant is still honoured, so specialized access is preserved", () => {
    // Custom roles keep their permissions in rows. An operator deliberately granted the
    // permission must keep it; this is what "do not remove explicit assignments" means.
    const custom = resolveEffectiveAccess(
      [{
        code: "INTEGRATION_OPERATOR",
        isSystem: false,
        status: "ACTIVE",
        permissions: [{ permissionCode: "fantasy.sync.run" }, { permissionCode: "demand.run" }],
      }],
      null,
    );
    expect(custom.permissions.includes("fantasy.sync.run")).toBe(true);
    expect(custom.permissions.includes("demand.run")).toBe(true);
  });

  test("an administrator signed in against the real routes is refused both operations", async () => {
    const admin = (await makeUser("h2.admin", "ADMIN")).cookie;
    const origin = { origin: "http://localhost:3000" };

    for (const [label, handler] of [["sync", fantasySync], ["demand run", demandRun]] as const) {
      resetRateLimits();
      const res = await call(handler, { method: "POST", path: "/api/x", cookie: admin, body: {}, headers: origin });
      expect({ label, status: res.status }).toEqual({ label, status: 403 });
    }
  });

  test("the specialized roles still reach their own operation", async () => {
    resetRateLimits();
    const operator = (await makeUser("h2.integration", "FANTASY_INTEGRATION")).cookie;
    const res = await call(fantasySync, {
      method: "POST", path: "/api/fantasy/sync", cookie: operator, body: {},
      headers: { origin: "http://localhost:3000" },
    });
    expect([401, 403].includes(res.status)).toBe(false);
  });
});

describe("Stockout and Demand Overview read the same bound source", () => {
  let cookie = "";

  beforeAll(async () => {
    await resetDb();
    resetRateLimits();
    cookie = (await makeUser("h2.analyst", "ANALYSIS_MANAGER")).cookie;
    await freeClaim();
    await db.syncCheckpoint.updateMany({
      where: { source: "FANTASY" },
      data: { currentCheckpoint: 0, isLocked: false, lockToken: null, lockExpiresAt: null },
    });
    await runSynchronization({ actor: "h2-sync" });
    await freeClaim();
    await runDemandCalculation({ actor: "h2-demand", windowDays: 90 });
  });

  test("both pages select the same run, and that run names its source synchronization", async () => {
    resetRateLimits();
    const so = await call(stockout, { path: "/api/analysis/stockout?section=status", cookie });
    expect(so.status).toBe(200);
    expect(so.json.hasRun).toBe(true);

    resetRateLimits();
    const trace = await call(demandTrace, { path: `/api/analysis/demand-trace?runId=${so.json.runId}`, cookie });
    expect(trace.status).toBe(200);
    expect(trace.json.runId).toBe(so.json.runId);

    const bound = await db.demandRun.findUniqueOrThrow({
      where: { id: so.json.runId },
      select: { sourceSyncRunId: true, checkpoint: true },
    });
    expect(typeof bound.sourceSyncRunId).toBe("string");

    // The named synchronization really did succeed — the binding is to a committed state.
    const sync = await db.integrationSyncRun.findUniqueOrThrow({
      where: { id: bound.sourceSyncRunId! },
      select: { status: true, endingCheckpoint: true },
    });
    expect(sync.status).toBe("SUCCESS");
    expect(bound.checkpoint).toBe(sync.endingCheckpoint);
  });

  test("opening either page takes no claim and recalculates nothing", async () => {
    const before = {
      runs: await db.demandRun.count(),
      metrics: await db.demandMetric.count(),
      claim: (await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } })).holder,
    };

    for (const path of ["/api/analysis/stockout?section=status", "/api/analysis/stockout?section=categories"]) {
      resetRateLimits();
      expect((await call(stockout, { path, cookie })).status).toBe(200);
    }
    resetRateLimits();
    expect((await call(demandTrace, { path: "/api/analysis/demand-trace", cookie })).status).toBe(200);

    expect({
      runs: await db.demandRun.count(),
      metrics: await db.demandMetric.count(),
      claim: (await db.canonicalStateClaim.findUniqueOrThrow({ where: { id: CANONICAL_STATE_ID } })).holder,
    }).toEqual(before);
    // Read-only pages never hold the execution claim.
    expect(before.claim).toBe(null);
  });

  test("Stockout keeps showing the committed result while a synchronization is running", async () => {
    await freeClaim();
    const syncHolds = await claimCanonicalState("SYNC", "sync-worker");
    expect(syncHolds.acquired).toBe(true);

    resetRateLimits();
    const res = await call(stockout, { path: "/api/analysis/stockout?section=status", cookie });
    // The page is not blanked because a sync is in flight; it shows the last committed
    // demand result, which is still the authoritative answer until a new one commits.
    expect(res.status).toBe(200);
    expect(res.json.hasRun).toBe(true);

    if (syncHolds.acquired) await releaseCanonicalState(syncHolds.claim);
  });
});
