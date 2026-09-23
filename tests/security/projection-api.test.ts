import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as listRuns, POST as startRun } from "@/app/api/fantasy/projection/route";
import { GET as getReconciliation } from "@/app/api/fantasy/projection/[runId]/reconciliation/route";
import { POST as abortRun } from "@/app/api/fantasy/projection/[runId]/abort/route";
import { ingestFantasyRawBatch } from "@/lib/fantasy/raw-ingestion";
import { FANTASY_ROW_CONTRACT_V1, FANTASY_V1_HEADERS } from "@/lib/fantasy/row-contract";

/**
 * The projection diagnostics API, exercised across the HTTP boundary.
 *
 * The route sweep already proves every role that LACKS the permission is denied. What it
 * cannot prove is the other half: that the roles which are supposed to hold these
 * permissions actually reach the handler, and that what comes back carries no source
 * values. Both are checked here against real handler calls.
 */

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const header of FANTASY_V1_HEADERS) base[header] = null;
  base["Lot ID"] = "API-LOT-1";
  base["Company ID"] = "API-CO";
  base["Lot Status DB"] = "STOCK";
  base["Shape"] = "MARQUISE";
  base["Weight"] = "2.75";
  base["Qty"] = "1";
  base["Remark"] = "OPERATOR NOTE DO NOT LEAK";
  return { ...base, ...overrides };
}

describe("projection API — permitted roles reach the handler", () => {
  let batchId = "";
  let integrationCookie = "";
  let auditorCookie = "";
  let viewerCookie = "";
  let adminCookie = "";
  let adminUserId = "";

  beforeAll(async () => {
    await resetDb();
    const [integration, auditor, viewer, admin] = await Promise.all([
      makeUser("proj.integration", "FANTASY_INTEGRATION"),
      makeUser("proj.auditor", "AUDITOR"),
      makeUser("proj.viewer", "VIEWER"),
      makeUser("proj.admin", "ADMIN"),
    ]);
    integrationCookie = integration.cookie;
    auditorCookie = auditor.cookie;
    viewerCookie = viewer.cookie;
    adminCookie = admin.cookie;
    adminUserId = admin.user.id;

    const ingestion = await ingestFantasyRawBatch(
      {
        contractVersion: FANTASY_ROW_CONTRACT_V1,
        sourceMode: "FIXTURE",
        batchId: `API-TEST-${Date.now()}`,
        headers: [...FANTASY_V1_HEADERS],
        rows: [row(), row({ "Lot ID": "API-LOT-2", "Lot Status DB": "MEMO" })],
        cursor: { kind: "FULL_SNAPSHOT", token: null },
      },
      {
        mode: "PERSIST",
        db,
        provenance: { effectiveSourceState: "FIXTURE_SIMULATION", providerId: "fixture-raw-test" },
      },
    );
    batchId = ingestion.batchId ?? "";
  });

  test("FANTASY_INTEGRATION may start a run; VIEWER may not", async () => {
    resetRateLimits();
    const denied = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: viewerCookie,
      body: { batchId, mode: "SHADOW" },
    });
    expect(denied.status).toBe(403);

    resetRateLimits();
    const allowed = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: integrationCookie,
      body: { batchId, mode: "SHADOW" },
    });
    expect({ status: allowed.status }).toEqual({ status: 200 });
    expect(allowed.json.status).toBe("COMPLETED");
  });

  test("AUDITOR may read runs but may NOT start one", async () => {
    resetRateLimits();
    const read = await call(listRuns, { path: "/api/fantasy/projection", cookie: auditorCookie });
    expect({ status: read.status }).toEqual({ status: 200 });

    resetRateLimits();
    const write = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: auditorCookie,
      body: { batchId, mode: "SHADOW" },
    });
    // Reading how data would be interpreted is an audit activity. Consuming
    // batch-sized work is not, and the two permissions are separable.
    expect(write.status).toBe(403);
  });

  test("ACTIVE is refused by request validation, never downgraded", async () => {
    resetRateLimits();
    const res = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: integrationCookie,
      body: { batchId, mode: "ACTIVE" },
    });
    expect({ status: res.status, code: res.json?.error?.code }).toEqual({
      status: 400,
      code: "VALIDATION_FAILED",
    });
    const active = await db.fantasyProjectionRun.count({ where: { mode: "ACTIVE" } });
    expect(active).toBe(0);
  });

  test("diagnostic responses carry no source values", async () => {
    resetRateLimits();
    const runs = await call(listRuns, { path: "/api/fantasy/projection", cookie: integrationCookie });
    expect(runs.status).toBe(200);

    const runId: string = runs.json.rows[0].id;
    resetRateLimits();
    const recon = await call(getReconciliation, {
      path: `/api/fantasy/projection/x/reconciliation`,
      cookie: integrationCookie,
      params: { runId },
    });
    expect({ status: recon.status }).toEqual({ status: 200 });

    // Every one of these appears in the raw rows behind the run. None may appear in a
    // response — least of all the operator remark, which is why it is never projected.
    const payload = JSON.stringify(runs.json) + JSON.stringify(recon.json);
    const leaks = [
      "OPERATOR NOTE DO NOT LEAK",
      "API-LOT-1",
      "API-LOT-2",
      "API-CO",
      "MARQUISE",
      "2.75",
    ].filter((needle) => payload.includes(needle));
    expect({ leaks }).toEqual({ leaks: [] });
  });

  test("reconciliation refuses an unknown run with a safe fixed code", async () => {
    resetRateLimits();
    const res = await call(getReconciliation, {
      path: "/api/fantasy/projection/x/reconciliation",
      cookie: auditorCookie,
      params: { runId: "nonexistent" },
    });
    expect({ status: res.status, code: res.json?.error?.code }).toEqual({
      status: 404,
      code: "RUN_NOT_FOUND",
    });
    // The message must not name a table, a column or an internal path.
    const message: string = res.json?.error?.message ?? "";
    expect(/Fantasy(Projection|Raw)|prisma|SELECT|src\//i.test(message)).toBe(false);
  });

  test("an ineligible batch is refused with a fixed code, not a 500", async () => {
    await db.fantasyRawBatch.update({ where: { id: batchId }, data: { status: "CONFLICT" } });
    resetRateLimits();
    const res = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: integrationCookie,
      body: { batchId, mode: "DRY_RUN" },
    });
    expect({ status: res.status, code: res.json?.error?.code }).toEqual({
      status: 422,
      code: "BATCH_STATUS_CONFLICT",
    });
    await db.fantasyRawBatch.update({ where: { id: batchId }, data: { status: "ACCEPTED" } });
  });

  test("abort requires fantasy.projection.recover, not run or read", async () => {
    // A RUNNING attempt to act on. Created directly so the test owns its lifecycle.
    const attempt = await db.fantasyProjectionRun.create({
      data: {
        mode: "SHADOW",
        status: "RUNNING",
        fingerprint: `abort-rbac-${Date.now()}`,
        attemptNumber: 1,
        contractVersion: FANTASY_ROW_CONTRACT_V1,
        effectiveSourceState: "FIXTURE_SIMULATION",
        identityPolicyVersion: 1,
        quantitySemantics: "PIECE_COUNT",
        weightUnit: "CARAT",
        ownerTokenHash: "a".repeat(64),
      },
      select: { id: true, version: true },
    });

    // FANTASY_INTEGRATION may START a projection but has no recovery authority.
    resetRateLimits();
    const byIntegration = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: integrationCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version, reasonCode: "OPERATOR_REQUESTED" },
    });
    expect(byIntegration.status).toBe(403);

    // AUDITOR may READ projections but likewise cannot terminate one.
    resetRateLimits();
    const byAuditor = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: auditorCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version, reasonCode: "OPERATOR_REQUESTED" },
    });
    expect(byAuditor.status).toBe(403);

    const untouched = await db.fantasyProjectionRun.findUniqueOrThrow({
      where: { id: attempt.id },
      select: { status: true },
    });
    expect(untouched.status).toBe("RUNNING");

    // An unlisted abort reason is refused by validation.
    resetRateLimits();
    const badReason = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: adminCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version, reasonCode: "BECAUSE_I_SAID_SO" },
    });
    expect(badReason.status).toBe(400);

    // A stale expected version is refused.
    resetRateLimits();
    const staleVersion = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: adminCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version + 7, reasonCode: "OPERATOR_REQUESTED" },
    });
    expect({ status: staleVersion.status, code: staleVersion.json?.error?.code }).toEqual({
      status: 409,
      code: "VERSION_CONFLICT",
    });

    // ADMIN holds the recovery permission and succeeds.
    resetRateLimits();
    const allowed = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: adminCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version, reasonCode: "SUSPECTED_STALLED_WORKER", note: "no heartbeat" },
    });
    expect({ status: allowed.status, status2: allowed.json?.status }).toEqual({ status: 200, status2: "ABORTED" });

    // The response must carry no ownership secret.
    const body = JSON.stringify(allowed.json);
    expect(/ownerToken|tokenHash|[0-9a-f]{64}/.test(body)).toBe(false);

    const aborted = await db.fantasyProjectionRun.findUniqueOrThrow({
      where: { id: attempt.id },
      select: { status: true, ownerTokenHash: true, abortedByUserId: true, abortReasonCode: true },
    });
    expect({ status: aborted.status, owner: aborted.ownerTokenHash, reason: aborted.abortReasonCode }).toEqual({
      status: "ABORTED",
      owner: null,
      reason: "SUSPECTED_STALLED_WORKER",
    });
    // The actor comes from the session, never from the request body.
    expect(aborted.abortedByUserId).toBe(adminUserId);

    // Re-aborting a terminal attempt is refused.
    resetRateLimits();
    const again = await call(abortRun, {
      method: "POST",
      path: "/api/fantasy/projection/x/abort",
      cookie: adminCookie,
      params: { runId: attempt.id },
      body: { expectedVersion: attempt.version + 1, reasonCode: "OPERATOR_REQUESTED" },
    });
    expect({ status: again.status, code: again.json?.error?.code }).toEqual({
      status: 409,
      code: "RUN_NOT_RUNNING",
    });
  });

  test("the abort is audited, and the audit carries no secret", async () => {
    const entry = await db.auditLog.findFirst({
      where: { action: "FANTASY_PROJECTION_ABORT" },
      orderBy: { timestamp: "desc" },
      select: { actorUserId: true, outcome: true, entity: true, after: true },
    });
    expect(entry !== null).toBe(true);
    expect({ outcome: entry!.outcome, entity: entry!.entity }).toEqual({
      outcome: "SUCCESS",
      entity: "FantasyProjectionRun",
    });
    expect(entry!.actorUserId).toBe(adminUserId);
    const after = JSON.stringify(entry!.after);
    expect(/ownerToken|tokenHash|[0-9a-f]{64}/.test(after)).toBe(false);
    // No raw Fantasy value reaches the audit trail either.
    expect(/OPERATOR NOTE DO NOT LEAK|API-LOT-|MARQUISE/.test(after)).toBe(false);
  });

  test("a refused projection start is audited as DENIED", async () => {
    await db.fantasyRawBatch.update({ where: { id: batchId }, data: { status: "REJECTED" } });
    resetRateLimits();
    const res = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: integrationCookie,
      body: { batchId, mode: "DRY_RUN" },
    });
    expect(res.status).toBe(422);

    const denied = await db.auditLog.findFirst({
      where: { action: "FANTASY_PROJECTION_RUN", outcome: "DENIED" },
      orderBy: { timestamp: "desc" },
      select: { outcome: true, after: true },
    });
    // An audit trail containing only successes cannot answer "who kept trying and why
    // did it not work".
    expect(denied !== null).toBe(true);
    expect(JSON.stringify(denied!.after)).toContain("BATCH_STATUS_REJECTED");
    await db.fantasyRawBatch.update({ where: { id: batchId }, data: { status: "ACCEPTED" } });
  });

  test("projection mutates no operational record", async () => {
    // A delta, not an absolute: `resetDb` does not truncate the canonical tables, so
    // rows from earlier suites legitimately remain. What must hold is that running a
    // projection moves none of them.
    const snapshot = async () =>
      Promise.all([db.lotMasterRecord.count(), db.lotHistoryRecord.count(), db.syncCheckpoint.count()]);

    const before = await snapshot();
    resetRateLimits();
    const res = await call(startRun, {
      method: "POST",
      path: "/api/fantasy/projection",
      cookie: integrationCookie,
      body: { batchId, mode: "DRY_RUN" },
    });
    expect(res.status).toBe(200);
    const after = await snapshot();

    expect({ master: after[0], history: after[1], checkpoints: after[2] }).toEqual({
      master: before[0],
      history: before[1],
      checkpoints: before[2],
    });
  });
});
