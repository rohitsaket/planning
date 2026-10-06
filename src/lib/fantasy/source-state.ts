import type { CanonicalSourceMode } from "./canonical";

export const FANTASY_CONFIGURED_MODES = ["FIXTURE_SIMULATION", "LIVE_FANTASY", "NOT_CONFIGURED"] as const;
export type FantasyConfiguredMode = (typeof FANTASY_CONFIGURED_MODES)[number];

export const FANTASY_RUNTIME_HEALTHS = ["READY", "DEGRADED", "UNAVAILABLE", "NOT_APPLICABLE"] as const;
export type FantasyRuntimeHealth = (typeof FANTASY_RUNTIME_HEALTHS)[number];

export const FANTASY_EFFECTIVE_SOURCE_STATES = [
  "FIXTURE_SIMULATION",
  "LIVE_FANTASY",
  "LIVE_FANTASY_DEGRADED",
  "NOT_CONFIGURED",
] as const;
export type FantasyEffectiveSourceState = (typeof FANTASY_EFFECTIVE_SOURCE_STATES)[number];

export const FANTASY_SOURCE_REASON_CODES = [
  "FIXTURE_SIMULATION_ACTIVE",
  "SOURCE_NOT_CONFIGURED",
  "UNSUPPORTED_SOURCE_MODE",
  "FILE_IMPORT_NOT_SUPPORTED",
  "PROVIDER_NOT_IMPLEMENTED",
  "LIVE_CONFIGURATION_INCOMPLETE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_DEGRADED",
  "LIVE_NEVER_SYNCHRONIZED",
  "LAST_OPERATION_FAILED",
  "LIVE_DATA_STALE",
  "LIVE_PROVIDER_HISTORY_UNVERIFIED",
  "LIVE_FRESHNESS_WINDOW_INVALID",
  "LIVE_SOURCE_READY",
] as const;
export type FantasySourceReasonCode = (typeof FANTASY_SOURCE_REASON_CODES)[number];

export type LegacyCanonicalSyncMode = Extract<CanonicalSourceMode, "FIXTURE" | "FANTASY_API">;

export interface ConfiguredSourceModeResult {
  readonly configuredMode: FantasyConfiguredMode;
  readonly reasonCode: FantasySourceReasonCode;
  readonly canonicalSourceMode: LegacyCanonicalSyncMode | null;
}

export function parseConfiguredSourceMode(rawValue: string | null | undefined): ConfiguredSourceModeResult {
  const value = (rawValue ?? "").trim().toUpperCase();

  if (value === "") {
    return { configuredMode: "NOT_CONFIGURED", reasonCode: "SOURCE_NOT_CONFIGURED", canonicalSourceMode: null };
  }
  if (value === "FIXTURE" || value === "FIXTURE_SIMULATION") {
    return { configuredMode: "FIXTURE_SIMULATION", reasonCode: "FIXTURE_SIMULATION_ACTIVE", canonicalSourceMode: "FIXTURE" };
  }
  if (value === "FANTASY_API" || value === "LIVE_FANTASY") {
    return { configuredMode: "LIVE_FANTASY", reasonCode: "PROVIDER_NOT_IMPLEMENTED", canonicalSourceMode: "FANTASY_API" };
  }
  if (value === "FILE_IMPORT") {
    return { configuredMode: "NOT_CONFIGURED", reasonCode: "FILE_IMPORT_NOT_SUPPORTED", canonicalSourceMode: null };
  }
  return { configuredMode: "NOT_CONFIGURED", reasonCode: "UNSUPPORTED_SOURCE_MODE", canonicalSourceMode: null };
}

export type FantasyDeliveryMode = "FULL_SNAPSHOT" | "PROVIDER_CURSOR";

export interface FantasyProviderCapabilities {
  readonly providerId: string;
  readonly contractVersion: string;
  readonly deliveryMode: FantasyDeliveryMode;
  readonly implementationStatus: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  readonly supportsDryRunFetch: boolean;
  readonly simulated: boolean;
}

export const DEFAULT_LIVE_FRESHNESS_WINDOW_MS = 6 * 60 * 60 * 1000;

export function isUsableFreshnessWindow(candidate: unknown): candidate is number {
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0;
}

export interface EffectiveSourceStateInput {
  readonly configuredMode: FantasyConfiguredMode;
  readonly configuredReasonCode: FantasySourceReasonCode;
  readonly providerInstalled: boolean;
  readonly configurationComplete: boolean;
  readonly providerHealth: FantasyRuntimeHealth;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly now: Date;
  readonly freshnessWindowMs?: number;
  readonly providerHistoryTrusted?: boolean;
}

export interface EffectiveSourceState {
  readonly effectiveState: FantasyEffectiveSourceState;
  readonly runtimeHealth: FantasyRuntimeHealth;
  readonly reasonCode: FantasySourceReasonCode;
}

export function deriveEffectiveSourceState(input: EffectiveSourceStateInput): EffectiveSourceState {
  if (input.configuredMode === "NOT_CONFIGURED") {
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "NOT_APPLICABLE", reasonCode: input.configuredReasonCode };
  }

  if (input.configuredMode === "FIXTURE_SIMULATION") {
    return { effectiveState: "FIXTURE_SIMULATION", runtimeHealth: "NOT_APPLICABLE", reasonCode: "FIXTURE_SIMULATION_ACTIVE" };
  }

  if (!input.providerInstalled) {
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "UNAVAILABLE", reasonCode: "PROVIDER_NOT_IMPLEMENTED" };
  }
  if (!input.configurationComplete) {
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "UNAVAILABLE", reasonCode: "LIVE_CONFIGURATION_INCOMPLETE" };
  }
  if (input.providerHealth === "UNAVAILABLE" || input.providerHealth === "NOT_APPLICABLE") {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "UNAVAILABLE", reasonCode: "PROVIDER_UNAVAILABLE" };
  }
  if (input.providerHealth === "DEGRADED") {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "PROVIDER_DEGRADED" };
  }

  if (input.providerHistoryTrusted !== true) {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "LIVE_PROVIDER_HISTORY_UNVERIFIED" };
  }

  if (input.lastSuccessAt === null) {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "LIVE_NEVER_SYNCHRONIZED" };
  }
  if (input.lastFailureAt !== null && input.lastFailureAt.getTime() > input.lastSuccessAt.getTime()) {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "LAST_OPERATION_FAILED" };
  }

  const window = input.freshnessWindowMs ?? DEFAULT_LIVE_FRESHNESS_WINDOW_MS;
  if (!isUsableFreshnessWindow(window)) {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "LIVE_FRESHNESS_WINDOW_INVALID" };
  }
  if (input.now.getTime() - input.lastSuccessAt.getTime() > window) {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "LIVE_DATA_STALE" };
  }

  return { effectiveState: "LIVE_FANTASY", runtimeHealth: "READY", reasonCode: "LIVE_SOURCE_READY" };
}

export function deriveHistoricalSourceState(isSimulated: boolean, storedSourceMode: string): FantasyEffectiveSourceState {
  const parsed = parseConfiguredSourceMode(storedSourceMode);
  if (isSimulated || parsed.configuredMode === "FIXTURE_SIMULATION") return "FIXTURE_SIMULATION";
  if (parsed.configuredMode === "LIVE_FANTASY") return "LIVE_FANTASY";
  return "NOT_CONFIGURED";
}

export const FANTASY_SOURCE_STATE_LABELS: Record<FantasyEffectiveSourceState, string> = {
  FIXTURE_SIMULATION: "Fixture Simulation",
  LIVE_FANTASY: "Live Fantasy",
  LIVE_FANTASY_DEGRADED: "Live Fantasy — Degraded",
  NOT_CONFIGURED: "Not Configured",
};

export const FANTASY_SOURCE_REASON_EXPLANATIONS: Record<FantasySourceReasonCode, string> = {
  FIXTURE_SIMULATION_ACTIVE:
    "All data shown is generated from built-in simulation fixtures. This is not a connection to the Fantasy ERP.",
  SOURCE_NOT_CONFIGURED: "No data source has been configured, so no synchronization can run.",
  UNSUPPORTED_SOURCE_MODE: "The configured data source is not one this version supports, so it has been refused.",
  FILE_IMPORT_NOT_SUPPORTED: "File import is not an available data source in this version.",
  PROVIDER_NOT_IMPLEMENTED: "Live Fantasy is selected, but no live connector is installed in this version.",
  LIVE_CONFIGURATION_INCOMPLETE: "Live Fantasy is selected, but its required configuration is incomplete.",
  PROVIDER_UNAVAILABLE: "The live Fantasy connection is not responding.",
  PROVIDER_DEGRADED: "The live Fantasy connection is reporting reduced service.",
  LIVE_NEVER_SYNCHRONIZED: "The live Fantasy connection has not completed a successful synchronization yet.",
  LAST_OPERATION_FAILED: "The most recent synchronization did not succeed.",
  LIVE_DATA_STALE: "Live data has not refreshed within the expected window.",
  LIVE_PROVIDER_HISTORY_UNVERIFIED:
    "The live Fantasy connection cannot yet prove which synchronizations were its own, so it is not reported as ready.",
  LIVE_FRESHNESS_WINDOW_INVALID: "The freshness setting for live data is not usable, so live data is not reported as current.",
  LIVE_SOURCE_READY: "Connected to the Fantasy ERP with recent, successful synchronization.",
};

export interface FantasySourceStateSummary {
  readonly configuredMode: FantasyConfiguredMode;
  readonly effectiveState: FantasyEffectiveSourceState;
  readonly runtimeHealth: FantasyRuntimeHealth;
  readonly isSimulated: boolean;
  readonly providerInstalled: boolean;
  readonly configurationComplete: boolean;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly reasonCode: FantasySourceReasonCode;
  readonly statusLabel: string;
  readonly statusExplanation: string;
}

export function toSourceStateSummary(input: {
  configuredMode: FantasyConfiguredMode;
  derived: EffectiveSourceState;
  providerInstalled: boolean;
  configurationComplete: boolean;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}): FantasySourceStateSummary {
  return {
    configuredMode: input.configuredMode,
    effectiveState: input.derived.effectiveState,
    runtimeHealth: input.derived.runtimeHealth,
    isSimulated: input.derived.effectiveState === "FIXTURE_SIMULATION",
    providerInstalled: input.providerInstalled,
    configurationComplete: input.configurationComplete,
    lastSuccessAt: input.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: input.lastFailureAt?.toISOString() ?? null,
    reasonCode: input.derived.reasonCode,
    statusLabel: FANTASY_SOURCE_STATE_LABELS[input.derived.effectiveState],
    statusExplanation: FANTASY_SOURCE_REASON_EXPLANATIONS[input.derived.reasonCode],
  };
}
