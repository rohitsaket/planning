/**
 * Server configuration for the Fantasy data source — server-only.
 *
 * This module is the only place that reads the source-mode environment variable. It
 * turns that raw value into the vocabulary defined in the client-safe `source-state.ts`
 * and never decides what a state means — that decision lives in
 * `deriveEffectiveSourceState`. Provider registration, required configuration key names
 * and configuration completeness live behind `provider-registry.server.ts`.
 *
 * Nothing here returns a key name, a key value or an environment string to a caller.
 * Configuration completeness leaves this module as a boolean.
 */

import {
  deriveEffectiveSourceState,
  parseConfiguredSourceMode,
  toSourceStateSummary,
  type FantasyConfiguredMode,
  type FantasyRuntimeHealth,
  type FantasySourceReasonCode,
  type FantasySourceStateSummary,
  type LegacyCanonicalSyncMode,
} from "./source-state";
import {
  findInstalledLiveProvider,
  isLiveConfigurationComplete,
  isProviderHistoryTrusted,
  type SourceEnvironment,
} from "./provider-registry.server";
import { describeSecretEnv } from "@/lib/security/secrets";

if (typeof window !== "undefined") {
  throw new Error("fantasy/config is server-only and must not be imported by client code.");
}

export type { SourceEnvironment };

/** Number of deterministic fixture batches the legacy canonical pipeline can replay. */
const FIXTURE_BATCH_COUNT = 5;

export interface FantasySourceConfiguration {
  readonly configuredMode: FantasyConfiguredMode;
  readonly configuredReasonCode: FantasySourceReasonCode;
  /**
   * Mode for the legacy canonical fixture synchronization, or null when the configured
   * source cannot drive it. `sync-service.ts` is the only supported consumer.
   */
  readonly canonicalSourceMode: LegacyCanonicalSyncMode | null;
  readonly providerInstalled: boolean;
  readonly configurationComplete: boolean;
  /** Whether synchronization history can be attributed to the installed provider. */
  readonly providerHistoryTrusted: boolean;
  readonly fixtureBatchCount: number;
}

/**
 * Reads the configured source mode. An absent, unsupported or unsupportable value
 * fails closed to NOT_CONFIGURED; it never throws, so a status page renders a
 * controlled business state instead of a 500.
 */
export function getFantasySourceConfiguration(env: SourceEnvironment = process.env): FantasySourceConfiguration {
  const parsed = parseConfiguredSourceMode(env.FANTASY_SOURCE_MODE);
  const registration = parsed.configuredMode === "LIVE_FANTASY" ? findInstalledLiveProvider() : null;

  return {
    configuredMode: parsed.configuredMode,
    configuredReasonCode: parsed.reasonCode,
    canonicalSourceMode: parsed.canonicalSourceMode,
    providerInstalled: registration !== null,
    // Checked against the keys the provider itself declares, so no configuration key is
    // invented here for an API contract that is not confirmed.
    configurationComplete: isLiveConfigurationComplete(registration, env),
    providerHistoryTrusted: isProviderHistoryTrusted(registration),
    fixtureBatchCount: FIXTURE_BATCH_COUNT,
  };
}

export interface FantasyServerConfig {
  sourceMode: LegacyCanonicalSyncMode | null;
  isSimulation: boolean;
}

export function getFantasyConfig(env: SourceEnvironment = process.env): FantasyServerConfig {
  const { canonicalSourceMode } = parseConfiguredSourceMode(env.FANTASY_SOURCE_MODE);
  return {
    sourceMode: canonicalSourceMode,
    isSimulation: canonicalSourceMode === "FIXTURE",
  };
}

export interface SourceStateDeps {
  /** Health the installed live provider reports. Fixtures have no live health. */
  readonly providerHealth?: FantasyRuntimeHealth;
  readonly lastSuccessAt?: Date | null;
  readonly lastFailureAt?: Date | null;
  readonly now?: Date;
  readonly env?: SourceEnvironment;
  /** Server-side operational override. Never sourced from a request or a browser. */
  readonly freshnessWindowMs?: number;
}

/**
 * Resolves the sanitized source state. Every page and API that shows where the data
 * came from calls this, so the label is decided once.
 */
export function resolveFantasySourceState(deps: SourceStateDeps = {}): FantasySourceStateSummary {
  const config = getFantasySourceConfiguration(deps.env);
  const lastSuccessAt = deps.lastSuccessAt ?? null;
  const lastFailureAt = deps.lastFailureAt ?? null;

  const derived = deriveEffectiveSourceState({
    configuredMode: config.configuredMode,
    configuredReasonCode: config.configuredReasonCode,
    providerInstalled: config.providerInstalled,
    configurationComplete: config.configurationComplete,
    // With no installed live provider there is nothing to report health for.
    providerHealth: deps.providerHealth ?? "NOT_APPLICABLE",
    providerHistoryTrusted: config.providerHistoryTrusted,
    lastSuccessAt,
    lastFailureAt,
    now: deps.now ?? new Date(),
    freshnessWindowMs: deps.freshnessWindowMs,
  });

  return toSourceStateSummary({
    configuredMode: config.configuredMode,
    derived,
    providerInstalled: config.providerInstalled,
    configurationComplete: config.configurationComplete,
    lastSuccessAt,
    lastFailureAt,
  });
}

// ---------------------------------------------------------------------------
// Synchronization history, scoped to the configured source
// ---------------------------------------------------------------------------

/**
 * Legacy and current values that identify a *simulated* run. Both spellings are read,
 * because runs recorded before Phase 4 carry `FIXTURE`.
 */
const FIXTURE_RUN_SOURCE_MODES = ["FIXTURE", "FIXTURE_SIMULATION"] as const;
/** Legacy and current values that identify a *live* run. */
const LIVE_RUN_SOURCE_MODES = ["FANTASY_API", "LIVE_FANTASY"] as const;

/** `IntegrationSyncRun.source` for the Fantasy integration, as the service writes it. */
const FANTASY_RUN_SOURCE = "Fantasy";

export interface SyncRunScope {
  readonly source: string;
  readonly status: string;
  readonly isSimulated: boolean;
  readonly sourceMode: { in: string[] };
}

/**
 * Restricts freshness evidence to runs that actually belong to the configured source.
 *
 * Without this, a fixture success would count as proof that a live connection is
 * current, and a fixture failure would degrade a live connection that never ran. Both
 * kinds of run are recorded on the same table, so the scope carries the two pieces of
 * evidence those rows already hold: `isSimulated`, and the source-mode spelling. A run
 * whose mode is neither vocabulary matches nothing and therefore proves nothing.
 *
 * Returns null when the configured mode has no history worth reading — an unconfigured
 * source has nothing to be fresh about.
 */
function syncRunScope(configuredMode: FantasyConfiguredMode, status: string): SyncRunScope | null {
  if (configuredMode === "FIXTURE_SIMULATION") {
    return { source: FANTASY_RUN_SOURCE, status, isSimulated: true, sourceMode: { in: [...FIXTURE_RUN_SOURCE_MODES] } };
  }
  if (configuredMode === "LIVE_FANTASY") {
    return { source: FANTASY_RUN_SOURCE, status, isSimulated: false, sourceMode: { in: [...LIVE_RUN_SOURCE_MODES] } };
  }
  return null;
}

/** Exposed so tests can assert the scope rather than re-deriving it. */
export function fantasySyncRunScope(configuredMode: FantasyConfiguredMode, status: string) {
  return syncRunScope(configuredMode, status);
}

/** The two timestamps the state derivation and the status page need. */
export interface SyncRunTimestampReader {
  integrationSyncRun: {
    findFirst(args?: {
      where?: unknown;
      orderBy?: unknown;
      select?: unknown;
    }): Promise<{ startedAt: Date; finishedAt: Date | null } | null>;
  };
}

/**
 * Resolves the source state together with the most recent successful and failed
 * synchronization times *for the configured source only*. Two indexed single-row reads,
 * skipped entirely when the configured source has no history to read.
 */
export async function resolveFantasySourceStateWithHistory(
  reader: SyncRunTimestampReader,
  deps: SourceStateDeps = {},
): Promise<FantasySourceStateSummary> {
  const config = getFantasySourceConfiguration(deps.env);
  const successScope = syncRunScope(config.configuredMode, "SUCCESS");
  const failureScope = syncRunScope(config.configuredMode, "FAILED");

  const select = { startedAt: true, finishedAt: true } as const;
  const orderBy = { startedAt: "desc" } as const;
  const [success, failure] = await Promise.all([
    successScope ? reader.integrationSyncRun.findFirst({ where: successScope, orderBy, select }) : null,
    failureScope ? reader.integrationSyncRun.findFirst({ where: failureScope, orderBy, select }) : null,
  ]);

  return resolveFantasySourceState({
    ...deps,
    lastSuccessAt: deps.lastSuccessAt ?? success?.finishedAt ?? success?.startedAt ?? null,
    lastFailureAt: deps.lastFailureAt ?? failure?.finishedAt ?? failure?.startedAt ?? null,
  });
}

const int = (name: string, def: number, min: number, max: number) => {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};
const flag = (name: string, def: boolean) => {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  if (v === "") return def;
  return v === "true" || v === "1" || v === "yes" || v === "on";
};

export interface LiveFantasyConfig {
  configured: boolean;
  /** Names of missing/invalid variables. Values are never included. */
  missing: string[];
  baseUrl: string;
  username: string;
  usernameConfigured: boolean;
  passwordConfigured: boolean;
  passwordStorage: "missing" | "plaintext" | "encrypted";
  lotsPath: string;
  timeoutMs: number;
  maxRetries: number;
  pageSize: number;
  /** Query-string names for page number / page size; both unset = the listing is one response. */
  pageParam: string | null;
  pageSizeParam: string | null;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  syncInitialDelaySeconds: number;
  /** Above this share of previously-active rows missing from a snapshot, the sync refuses to mark them stale. */
  staleGuardPercent: number;
  upsertBatchSize: number;
  /** After a successful live sync, also refresh the planning engine's canonical lot store. */
  chainPlanningSync: boolean;
  defaultCountry: string;
  defaultBranch: string;
}

export function getLiveFantasyConfig(): LiveFantasyConfig {
  const baseUrl = (process.env.FANTASY_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const username = (process.env.FANTASY_API_USERNAME || "").trim();
  const passwordStorage = describeSecretEnv("FANTASY_API_PASSWORD");
  const missing: string[] = [];
  if (!baseUrl) missing.push("FANTASY_API_BASE_URL");
  else {
    try {
      const u = new URL(baseUrl);
      if (u.protocol !== "https:") missing.push("FANTASY_API_BASE_URL (must be https)");
    } catch {
      missing.push("FANTASY_API_BASE_URL (invalid URL)");
    }
  }
  if (!username) missing.push("FANTASY_API_USERNAME");
  if (passwordStorage === "missing") missing.push("FANTASY_API_PASSWORD");
  if (passwordStorage === "encrypted" && !process.env.SECRETS_KEY) missing.push("SECRETS_KEY");
  const lotsPathRaw = (process.env.FANTASY_API_LOTS_PATH || "/api/lots").trim();
  const pageParam = (process.env.FANTASY_API_PAGE_PARAM || "").trim() || null;
  const pageSizeParam = (process.env.FANTASY_API_PAGE_SIZE_PARAM || "").trim() || null;
  return {
    configured: missing.length === 0,
    missing,
    baseUrl,
    username,
    usernameConfigured: !!username,
    passwordConfigured: passwordStorage !== "missing",
    passwordStorage,
    lotsPath: lotsPathRaw.startsWith("/") ? lotsPathRaw : `/${lotsPathRaw}`,
    timeoutMs: int("FANTASY_API_TIMEOUT_MS", 30_000, 5_000, 300_000),
    maxRetries: int("FANTASY_SYNC_MAX_RETRIES", 3, 0, 10),
    pageSize: int("FANTASY_SYNC_PAGE_SIZE", 500, 1, 10_000),
    pageParam,
    pageSizeParam,
    syncEnabled: flag("FANTASY_SYNC_ENABLED", true),
    syncIntervalMinutes: int("FANTASY_SYNC_INTERVAL_MINUTES", 5, 1, 24 * 60),
    syncInitialDelaySeconds: int("FANTASY_SYNC_INITIAL_DELAY_SECONDS", 20, 0, 3600),
    staleGuardPercent: int("FANTASY_SYNC_STALE_GUARD_PERCENT", 25, 0, 100),
    upsertBatchSize: int("FANTASY_SYNC_UPSERT_BATCH", 500, 50, 5_000),
    chainPlanningSync: flag("FANTASY_SYNC_CHAIN_PLANNING", true),
    defaultCountry: (process.env.FANTASY_API_DEFAULT_COUNTRY || "IN").trim(),
    defaultBranch: (process.env.FANTASY_API_DEFAULT_BRANCH || "SURAT").trim(),
  };
}

/** Host only, safe to show in the UI. */
export function describeBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl ? "invalid URL" : "not set";
  }
}

/** Startup validation: logs configured=true/false per variable, never a value. */
export function validateFantasyConfigForLog(): { integration: "live" | "fixture" | "not_configured"; configured: boolean; missing: string[]; usernameConfigured: boolean; passwordConfigured: boolean; passwordStorage: string } {
  const mode = getFantasyConfig();
  const live = getLiveFantasyConfig();
  return {
    integration: mode.sourceMode === "FANTASY_API" ? "live" : mode.sourceMode === "FIXTURE" ? "fixture" : "not_configured",
    configured: live.configured,
    missing: live.missing,
    usernameConfigured: live.usernameConfigured,
    passwordConfigured: live.passwordConfigured,
    passwordStorage: live.passwordStorage,
  };
}
