import { db } from "@/lib/db";
import { log } from "@/lib/api/with-api";
import { safeErrorMessage } from "@/lib/security/redact";
import { getFantasyConfig, getLiveFantasyConfig } from "./config";
import { createFantasyClient, FantasyApiError, type FantasyClient } from "./live-api";
import { mapLiveLotRows } from "./live-mapper";
import { countActiveLiveLots, markStaleNotSeenSince, upsertLiveLots } from "./live-repository";

export const LIVE_SYNC_SOURCE = "FANTASY_LIVE_DATA";
export const LIVE_SYNC_ENTITY = "LiveData";
const STALE_LOCK_MS = 60 * 60_000;

export type LiveSyncStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "LOCKED";
export type LiveSyncErrorCode = "NOT_CONFIGURED" | "AUTH_FAILED" | "TIMEOUT" | "NETWORK" | "UPSTREAM_ERROR" | "RATE_LIMITED" | "BAD_RESPONSE" | "SCHEMA_MISMATCH" | "POSSIBLE_SOURCE_SNAPSHOT_ANOMALY" | "LOCKED" | "INTERNAL";

export interface LiveSyncOptions {
  trigger: "manual" | "scheduled" | "import";
  actor?: string;
  actorUserId?: string;
  client?: FantasyClient;
  now?: () => Date;
  chainCanonical?: boolean | "background";
}

export interface LiveSyncResult {
  success: boolean;
  syncRunId: string | null;
  status: LiveSyncStatus;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  recordsFailed: number;
  recordsStaled: number;
  pagesFetched: number;
  durationMs: number;
  errorCode?: LiveSyncErrorCode;
  errorSummary?: string;
  errorDetail?: string;
  mappingWarnings?: number;
  unmappedSourceColumns?: string[];
}

async function ensureLockRow() {
  const existing = await db.syncCheckpoint.findUnique({ where: { source: LIVE_SYNC_SOURCE } });
  if (!existing) {
    try {
      await db.syncCheckpoint.create({ data: { source: LIVE_SYNC_SOURCE, mode: "FANTASY_API", currentCheckpoint: 0, isLocked: false } });
    } catch {
      // created concurrently
    }
  }
}

async function acquireLock(actor: string, now: Date): Promise<boolean> {
  await ensureLockRow();
  const claimed = await db.syncCheckpoint.updateMany({
    where: { source: LIVE_SYNC_SOURCE, OR: [{ isLocked: false }, { lockedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } }] },
    data: { isLocked: true, lockedAt: now, lockedBy: actor },
  });
  return claimed.count === 1;
}

async function releaseLock() {
  await db.syncCheckpoint.updateMany({ where: { source: LIVE_SYNC_SOURCE }, data: { isLocked: false, lockedAt: null, lockedBy: null } }).catch(() => undefined);
}

export function friendlyErrorSummary(code: LiveSyncErrorCode, e: unknown): string {
  const status = e instanceof FantasyApiError ? e.status : null;
  switch (code) {
    case "AUTH_FAILED": return "Fantasy authentication failed.";
    case "NOT_CONFIGURED": return "Fantasy ERP integration is not configured.";
    case "TIMEOUT": return "Fantasy ERP did not answer in time.";
    case "NETWORK": return "Fantasy ERP could not be reached.";
    case "RATE_LIMITED": return "Fantasy ERP is rate-limiting requests; the next scheduled run will retry.";
    case "BAD_RESPONSE": return "Fantasy ERP returned data in an unexpected format.";
    case "SCHEMA_MISMATCH": return "The Fantasy data did not match the Live Data column contract; nothing was changed.";
    case "UPSTREAM_ERROR": return status && status >= 500 ? `Fantasy ERP's lot listing service returned an internal error (HTTP ${status}). This has to be fixed on the Fantasy side.` : `Fantasy ERP rejected the request${status ? ` (HTTP ${status})` : ""}.`;
    default: return "Unable to synchronize Fantasy ERP.";
  }
}

export async function runLiveDataSync(opts: LiveSyncOptions): Promise<LiveSyncResult> {
  const now = opts.now ?? (() => new Date());
  const started = now();
  const startMs = Date.now();
  const cfg = getLiveFantasyConfig();
  const actor = opts.actor ?? (opts.trigger === "scheduled" ? "SCHEDULER" : opts.trigger === "import" ? "IMPORT" : "manual");
  const empty = (status: LiveSyncStatus, errorCode?: LiveSyncErrorCode, errorSummary?: string, syncRunId: string | null = null): LiveSyncResult => ({
    success: false, syncRunId, status, recordsFetched: 0, recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 0, recordsFailed: 0, recordsStaled: 0, pagesFetched: 0, durationMs: Date.now() - startMs, errorCode, errorSummary,
  });

  if (!cfg.configured) return empty("FAILED", "NOT_CONFIGURED", "Fantasy ERP integration is not configured.");
  if (!(await acquireLock(actor, started))) return empty("LOCKED", "LOCKED", "Synchronization is already running.");

  const run = await db.integrationSyncRun.create({
    data: { source: "Fantasy", entity: LIVE_SYNC_ENTITY, status: "RUNNING", sourceMode: opts.trigger === "import" ? "FILE_IMPORT" : "FANTASY_API", isSimulated: false, batchId: `${opts.trigger === "import" ? "IMPORT" : "LIVE"}-${started.toISOString().replace(/[:.]/g, "-")}`, triggeredBy: actor, triggeredByUserId: opts.actorUserId ?? null, startedAt: started },
  });
  log("info", "fantasy_sync_started", { syncRunId: run.id, trigger: opts.trigger });

  const client = opts.client ?? createFantasyClient();
  let result: LiveSyncResult = empty("FAILED", "INTERNAL", undefined, run.id);
  try {
    const fetched = await client.fetchLots();
    result.recordsFetched = fetched.rows.length;
    result.pagesFetched = fetched.pages;

    const outcome = mapLiveLotRows(fetched.rows);
    result.recordsFailed = outcome.invalid.length;
    result.mappingWarnings = outcome.mapped.reduce((n, m) => n + m.warnings.length, 0);
    result.unmappedSourceColumns = outcome.unmappedSourceColumns;
    if (fetched.rows.length > 0 && outcome.mapped.length === 0) {
      throw Object.assign(new Error(`Fantasy payload did not match the Live Data contract: ${outcome.invalid[0]?.reason ?? "no mappable rows"}.`), { liveCode: "SCHEMA_MISMATCH" as LiveSyncErrorCode });
    }

    const seenAt = now();
    const activeBefore = await countActiveLiveLots();
    const stats = await upsertLiveLots(outcome.mapped, run.id, seenAt, cfg.upsertBatchSize);
    result.recordsInserted = stats.inserted;
    result.recordsUpdated = stats.updated;
    result.recordsUnchanged = stats.unchanged;
    log("info", "fantasy_batch_upsert_completed", { syncRunId: run.id, ...stats });

    const seenKnown = stats.updated + stats.unchanged;
    const missing = Math.max(0, activeBefore - seenKnown);
    const missingPct = activeBefore > 0 ? (missing / activeBefore) * 100 : 0;
    let status: LiveSyncStatus = "SUCCESS";
    if (fetched.rows.length === 0 && activeBefore > 0) {
      status = "PARTIAL";
      result.errorCode = "POSSIBLE_SOURCE_SNAPSHOT_ANOMALY";
      result.errorSummary = `Empty snapshot while ${activeBefore} rows are active: nothing marked stale.`;
    } else if (activeBefore > 0 && missing > 0 && missingPct > cfg.staleGuardPercent) {
      status = "PARTIAL";
      result.errorCode = "POSSIBLE_SOURCE_SNAPSHOT_ANOMALY";
      result.errorSummary = `${missing} of ${activeBefore} active rows (${missingPct.toFixed(1)}%) are absent from the snapshot, above the ${cfg.staleGuardPercent}% guard: nothing marked stale.`;
    } else if (missing > 0) {
      result.recordsStaled = await markStaleNotSeenSince(seenAt);
    }
    if (status === "SUCCESS" && outcome.invalid.length > 0) {
      status = "PARTIAL";
      result.errorCode = undefined;
      result.errorSummary = `${outcome.invalid.length} row(s) rejected by validation (e.g. ${outcome.invalid[0].reason}).`;
    }

    result.status = status;
    result.success = true;
    result.durationMs = Date.now() - startMs;
    await db.$transaction([
      db.integrationSyncRun.update({
        where: { id: run.id },
        data: {
          status, recordsReceived: result.recordsFetched, recordsFetched: result.recordsFetched, recordsCreated: result.recordsInserted, recordsUpdated: result.recordsUpdated, recordsUnchanged: result.recordsUnchanged, recordsRejected: result.recordsFailed, recordsRemoved: result.recordsStaled,
          errorSummary: result.errorSummary ?? null,
          errorsJson: JSON.stringify({ code: result.errorCode ?? null, pages: fetched.pages, requests: fetched.requests, fetchMs: fetched.durationMs, mappingWarnings: result.mappingWarnings, unmappedSourceColumns: outcome.unmappedSourceColumns.slice(0, 50), invalidSample: outcome.invalid.slice(0, 20) }),
          durationMs: result.durationMs, finishedAt: now(),
        },
      }),
      db.syncCheckpoint.update({ where: { source: LIVE_SYNC_SOURCE }, data: { lastSyncAt: seenAt, lastBatchId: run.id, currentCheckpoint: { increment: 1 } } }),
    ]);
    log("info", "fantasy_sync_completed", { syncRunId: run.id, status, fetched: result.recordsFetched, inserted: result.recordsInserted, updated: result.recordsUpdated, unchanged: result.recordsUnchanged, failed: result.recordsFailed, staled: result.recordsStaled, durationMs: result.durationMs });
  } catch (e) {
    const code: LiveSyncErrorCode = e instanceof FantasyApiError ? e.code : (e as { liveCode?: LiveSyncErrorCode })?.liveCode ?? "INTERNAL";
    const detail = safeErrorMessage(e, 400);
    const summary = friendlyErrorSummary(code, e);
    result = { ...result, success: false, status: "FAILED", errorCode: code, errorSummary: summary, errorDetail: detail, durationMs: Date.now() - startMs };
    await db.integrationSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", recordsReceived: result.recordsFetched, recordsFetched: result.recordsFetched, recordsRejected: result.recordsFailed, errorSummary: summary, errorsJson: JSON.stringify({ code, detail }), durationMs: result.durationMs, finishedAt: now() } }).catch(() => undefined);
    log("warn", "fantasy_sync_failed", { syncRunId: run.id, errorCode: code, error: detail });
  } finally {
    await releaseLock();
  }

  const chain = opts.chainCanonical ?? true;
  if (result.success && chain !== false && cfg.chainPlanningSync && getFantasyConfig().sourceMode === "FANTASY_API") {
    const chained = async () => {
      try {
        const { runSynchronization } = await import("./sync-service");
        const canon = await runSynchronization({ actor: `${actor}:live-data`, actorUserId: opts.actorUserId });
        log(canon.success ? "info" : "warn", "fantasy_canonical_sync_chained", { syncRunId: result.syncRunId, canonicalRunId: canon.runId, status: canon.status });
      } catch (e) {
        log("warn", "fantasy_canonical_sync_skipped", { syncRunId: result.syncRunId, error: safeErrorMessage(e) });
      }
    };
    if (chain === "background") void chained();
    else await chained();
  }
  return result;
}

export interface LiveSyncStatusSummary {
  enabled: boolean;
  configured: boolean;
  status: "idle" | "running";
  lockedBy: string | null;
  lockedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  recordsInDatabase: number;
  staleRecords: number;
  lastRun: null | { id: string; status: string; trigger: string | null; sourceMode: string; recordsFetched: number; inserted: number; updated: number; unchanged: number; failed: number; staled: number; durationMs: number; errorCode: string | null; errorSummary: string | null; errorDetail: string | null; startedAt: string; finishedAt: string | null };
}

export async function getLiveSyncStatus(): Promise<LiveSyncStatusSummary> {
  const cfg = getLiveFantasyConfig();
  const [lock, lastRun, active, stale] = await Promise.all([
    db.syncCheckpoint.findUnique({ where: { source: LIVE_SYNC_SOURCE } }),
    db.integrationSyncRun.findFirst({ where: { entity: LIVE_SYNC_ENTITY }, orderBy: { startedAt: "desc" } }),
    db.fantasyLiveLot.count({ where: { sourceActive: true } }),
    db.fantasyLiveLot.count({ where: { sourceActive: false } }),
  ]);
  let errorCode: string | null = null;
  let errorDetail: string | null = null;
  if (lastRun?.errorsJson) {
    try {
      const j = JSON.parse(lastRun.errorsJson) as { code?: string | null; detail?: string | null };
      errorCode = j.code ?? null;
      errorDetail = j.detail ?? null;
    } catch {
      errorCode = null;
    }
  }
  return {
    enabled: cfg.syncEnabled && getFantasyConfig().sourceMode === "FANTASY_API",
    configured: cfg.configured,
    status: lock?.isLocked ? "running" : "idle",
    lockedBy: lock?.isLocked ? lock.lockedBy ?? null : null,
    lockedAt: lock?.isLocked ? lock.lockedAt?.toISOString() ?? null : null,
    lastSuccessfulSyncAt: lock?.lastSyncAt?.toISOString() ?? null,
    lastAttemptAt: lastRun?.startedAt.toISOString() ?? null,
    recordsInDatabase: active,
    staleRecords: stale,
    lastRun: lastRun
      ? { id: lastRun.id, status: lastRun.status, trigger: lastRun.triggeredBy, sourceMode: lastRun.sourceMode, recordsFetched: lastRun.recordsFetched, inserted: lastRun.recordsCreated, updated: lastRun.recordsUpdated, unchanged: lastRun.recordsUnchanged, failed: lastRun.recordsRejected, staled: lastRun.recordsRemoved, durationMs: lastRun.durationMs, errorCode, errorSummary: lastRun.errorSummary ? lastRun.errorSummary.split("\n")[0].slice(0, 250) : null, errorDetail, startedAt: lastRun.startedAt.toISOString(), finishedAt: lastRun.finishedAt?.toISOString() ?? null }
      : null,
  };
}
