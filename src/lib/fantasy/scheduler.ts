/**
 * Automatic Fantasy synchronisation (server process only).
 *
 * Started once per Node server from src/instrumentation.ts when FANTASY_SOURCE_MODE=FANTASY_API and
 * FANTASY_SYNC_INTERVAL_MINUTES > 0. Each tick calls the same runSynchronization() the "Sync Now"
 * button uses, so the atomic sync lock, checkpoint rules, audit trail and Sync Monitor all apply.
 * A tick that finds the lock held simply logs and waits for the next one. Consecutive failures
 * (for example the vendor's listing endpoint erroring) double the wait, up to 32× the interval,
 * so a broken upstream does not fill the Sync Monitor with a failed run every few minutes; the
 * first success restores the normal cadence.
 */

import { log } from "@/lib/api/with-api";
import { getFantasyConfig, getLiveFantasyConfig, validateFantasyConfigForLog } from "./config";

export interface SchedulerStatus {
  enabled: boolean;
  intervalMinutes: number;
  consecutiveFailures: number;
  running: boolean;
  startedAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  nextRunAt: string | null;
}

interface SchedulerState extends SchedulerStatus {
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
}

const g = globalThis as unknown as { __fantasySyncScheduler?: SchedulerState };

export function getSchedulerConfig(): { enabled: boolean; intervalMinutes: number; initialDelayMs: number } {
  const live = getLiveFantasyConfig();
  const enabled = getFantasyConfig().sourceMode === "FANTASY_API" && live.syncEnabled && live.configured;
  return { enabled, intervalMinutes: live.syncIntervalMinutes, initialDelayMs: live.syncInitialDelaySeconds * 1000 };
}

export function getSchedulerStatus(): SchedulerStatus {
  const cfg = getSchedulerConfig();
  const s = g.__fantasySyncScheduler;
  if (!s) return { enabled: cfg.enabled, intervalMinutes: cfg.intervalMinutes, consecutiveFailures: 0, running: false, startedAt: null, lastRunAt: null, lastStatus: null, lastError: null, nextRunAt: null };
  const { timer: _t, inFlight: _f, ...status } = s;
  return status;
}

export function nextDelayMs(intervalMinutes: number, consecutiveFailures: number): number {
  return intervalMinutes * 60_000 * Math.pow(2, Math.min(5, consecutiveFailures));
}

async function tick(state: SchedulerState) {
  if (state.inFlight || !state.running) return;
  state.inFlight = true;
  try {
    const { runLiveDataSync } = await import("./live-sync");
    const result = await runLiveDataSync({ trigger: "scheduled" });
    state.lastRunAt = new Date().toISOString();
    state.lastStatus = result.status;
    state.lastError = result.errorSummary ?? null;
    // LOCKED (a manual run is in progress) is coalesced, not counted as an upstream failure.
    state.consecutiveFailures = result.success || result.status === "LOCKED" ? (result.success ? 0 : state.consecutiveFailures) : state.consecutiveFailures + 1;
    log(result.success ? "info" : "warn", "fantasy_scheduled_sync", { syncRunId: result.syncRunId, status: result.status, fetched: result.recordsFetched, inserted: result.recordsInserted, updated: result.recordsUpdated, errorCode: result.errorCode ?? null, consecutiveFailures: state.consecutiveFailures });
  } catch (e) {
    // Lock held by a manual run, or configuration error: not counted as an upstream failure.
    state.lastRunAt = new Date().toISOString();
    state.lastStatus = "SKIPPED";
    state.lastError = (e instanceof Error ? e.message : String(e)).slice(0, 250);
    log("warn", "fantasy.scheduled_sync_skipped", { error: state.lastError });
  } finally {
    state.inFlight = false;
    schedule(state, nextDelayMs(state.intervalMinutes, state.consecutiveFailures));
  }
}

function schedule(state: SchedulerState, delayMs: number) {
  if (!state.running) return;
  if (state.timer) clearTimeout(state.timer);
  state.nextRunAt = new Date(Date.now() + delayMs).toISOString();
  state.timer = setTimeout(() => void tick(state), delayMs);
  state.timer.unref?.();
}

export function startFantasySyncScheduler(): SchedulerStatus {
  // Startup validation: names what is configured, never a value.
  log("info", "fantasy_integration_config", validateFantasyConfigForLog());
  const cfg = getSchedulerConfig();
  if (!cfg.enabled) {
    if (getFantasyConfig().sourceMode === "FANTASY_API" && !getLiveFantasyConfig().configured) log("warn", "fantasy_integration_not_configured", { message: "Fantasy ERP integration is not configured.", missing: getLiveFantasyConfig().missing });
    return getSchedulerStatus();
  }
  if (g.__fantasySyncScheduler?.running) return getSchedulerStatus();
  const state: SchedulerState = {
    enabled: true,
    intervalMinutes: cfg.intervalMinutes,
    consecutiveFailures: 0,
    running: true,
    startedAt: new Date().toISOString(),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    nextRunAt: new Date(Date.now() + cfg.initialDelayMs).toISOString(),
    timer: null,
    inFlight: false,
  };
  g.__fantasySyncScheduler = state;
  schedule(state, cfg.initialDelayMs);
  log("info", "fantasy.scheduler_started", { intervalMinutes: cfg.intervalMinutes, firstRunAt: state.nextRunAt });
  return getSchedulerStatus();
}

export function stopFantasySyncScheduler(): void {
  const s = g.__fantasySyncScheduler;
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.running = false;
  s.nextRunAt = null;
}
