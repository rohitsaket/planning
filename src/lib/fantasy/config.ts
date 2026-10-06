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

const FIXTURE_BATCH_COUNT = 5;

export interface FantasySourceConfiguration {
  readonly configuredMode: FantasyConfiguredMode;
  readonly configuredReasonCode: FantasySourceReasonCode;
  readonly canonicalSourceMode: LegacyCanonicalSyncMode | null;
  readonly providerInstalled: boolean;
  readonly configurationComplete: boolean;
  readonly providerHistoryTrusted: boolean;
  readonly fixtureBatchCount: number;
}

export function getFantasySourceConfiguration(env: SourceEnvironment = process.env): FantasySourceConfiguration {
  const parsed = parseConfiguredSourceMode(env.FANTASY_SOURCE_MODE);
  const registration = parsed.configuredMode === "LIVE_FANTASY" ? findInstalledLiveProvider() : null;

  return {
    configuredMode: parsed.configuredMode,
    configuredReasonCode: parsed.reasonCode,
    canonicalSourceMode: parsed.canonicalSourceMode,
    providerInstalled: registration !== null,
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
  readonly providerHealth?: FantasyRuntimeHealth;
  readonly lastSuccessAt?: Date | null;
  readonly lastFailureAt?: Date | null;
  readonly now?: Date;
  readonly env?: SourceEnvironment;
  readonly freshnessWindowMs?: number;
}

export function resolveFantasySourceState(deps: SourceStateDeps = {}): FantasySourceStateSummary {
  const config = getFantasySourceConfiguration(deps.env);
  const lastSuccessAt = deps.lastSuccessAt ?? null;
  const lastFailureAt = deps.lastFailureAt ?? null;

  const derived = deriveEffectiveSourceState({
    configuredMode: config.configuredMode,
    configuredReasonCode: config.configuredReasonCode,
    providerInstalled: config.providerInstalled,
    configurationComplete: config.configurationComplete,
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

const FIXTURE_RUN_SOURCE_MODES = ["FIXTURE", "FIXTURE_SIMULATION"] as const;
const LIVE_RUN_SOURCE_MODES = ["FANTASY_API", "LIVE_FANTASY"] as const;

const FANTASY_RUN_SOURCE = "Fantasy";

export interface SyncRunScope {
  readonly source: string;
  readonly status: string;
  readonly isSimulated: boolean;
  readonly sourceMode: { in: string[] };
}

function syncRunScope(configuredMode: FantasyConfiguredMode, status: string): SyncRunScope | null {
  if (configuredMode === "FIXTURE_SIMULATION") {
    return { source: FANTASY_RUN_SOURCE, status, isSimulated: true, sourceMode: { in: [...FIXTURE_RUN_SOURCE_MODES] } };
  }
  if (configuredMode === "LIVE_FANTASY") {
    return { source: FANTASY_RUN_SOURCE, status, isSimulated: false, sourceMode: { in: [...LIVE_RUN_SOURCE_MODES] } };
  }
  return null;
}

export function fantasySyncRunScope(configuredMode: FantasyConfiguredMode, status: string) {
  return syncRunScope(configuredMode, status);
}

export interface SyncRunTimestampReader {
  integrationSyncRun: {
    findFirst(args?: {
      where?: unknown;
      orderBy?: unknown;
      select?: unknown;
    }): Promise<{ startedAt: Date; finishedAt: Date | null } | null>;
  };
}

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
  pageParam: string | null;
  pageSizeParam: string | null;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  syncInitialDelaySeconds: number;
  staleGuardPercent: number;
  upsertBatchSize: number;
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

export function describeBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl ? "invalid URL" : "not set";
  }
}

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
