/**
 * FANTASY SOURCE STATE — the single vocabulary for "where is our data coming from?".
 *
 * Three separate questions, deliberately not collapsed into one string:
 *
 *   1. Configured mode   — what an operator selected (or failed to select).
 *   2. Runtime health    — what the integration is actually doing right now.
 *   3. Effective state   — the one honest answer a page or API is allowed to show,
 *                          derived from the first two by `deriveEffectiveSourceState`.
 *
 * Every source label in the application comes from this module. Pages and routes must
 * not re-derive one: a page that decides for itself what "simulated" means is how a
 * fixture ends up presented as a live ERP connection.
 *
 * CLIENT-SAFE. This module is pure: it reads no environment variable, names no
 * configuration key, holds no provider registry, opens no connection and constructs no
 * provider, so it is safe to bundle for the browser. Anything that could name or read a
 * credential lives behind the server-only boundary in `provider-registry.server.ts`;
 * reading the configured mode from the environment is `config.ts`; orchestrating a
 * provider is `raw-orchestration.ts`. Nothing here may re-export a value from any of
 * those modules.
 */

import type { CanonicalSourceMode } from "./canonical";

// ---------------------------------------------------------------------------
// 1. Configured mode
// ---------------------------------------------------------------------------

/**
 * What an operator can select. Degraded is deliberately absent: degradation is an
 * observed runtime condition, never a configuration choice.
 */
export const FANTASY_CONFIGURED_MODES = ["FIXTURE_SIMULATION", "LIVE_FANTASY", "NOT_CONFIGURED"] as const;
export type FantasyConfiguredMode = (typeof FANTASY_CONFIGURED_MODES)[number];

// ---------------------------------------------------------------------------
// 2. Runtime health
// ---------------------------------------------------------------------------

/**
 * READY          — a live integration is answering and its data is within the
 *                  freshness window.
 * DEGRADED       — configured and implemented, but stale, failing or self-reported
 *                  as degraded.
 * UNAVAILABLE    — configured, but not answering, not implemented or not configured
 *                  completely.
 * NOT_APPLICABLE — there is no live integration to be healthy: fixture simulation, or
 *                  nothing configured at all. Fixtures never report READY, because
 *                  READY would assert connectivity that does not exist.
 */
export const FANTASY_RUNTIME_HEALTHS = ["READY", "DEGRADED", "UNAVAILABLE", "NOT_APPLICABLE"] as const;
export type FantasyRuntimeHealth = (typeof FANTASY_RUNTIME_HEALTHS)[number];

// ---------------------------------------------------------------------------
// 3. Effective state
// ---------------------------------------------------------------------------

export const FANTASY_EFFECTIVE_SOURCE_STATES = [
  "FIXTURE_SIMULATION",
  "LIVE_FANTASY",
  "LIVE_FANTASY_DEGRADED",
  "NOT_CONFIGURED",
] as const;
export type FantasyEffectiveSourceState = (typeof FANTASY_EFFECTIVE_SOURCE_STATES)[number];

/** Fixed codes. An exception message is never used in their place. */
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

// ---------------------------------------------------------------------------
// Legacy compatibility
// ---------------------------------------------------------------------------

/**
 * Canonical modes the legacy fixture synchronization can actually be driven with.
 * `FILE_IMPORT` is deliberately excluded — see `parseConfiguredSourceMode`.
 */
export type LegacyCanonicalSyncMode = Extract<CanonicalSourceMode, "FIXTURE" | "FANTASY_API">;

export interface ConfiguredSourceModeResult {
  readonly configuredMode: FantasyConfiguredMode;
  readonly reasonCode: FantasySourceReasonCode;
  /**
   * The legacy canonical mode this configuration drives, or null when it drives
   * nothing. The legacy canonical fixture synchronization is the only consumer.
   */
  readonly canonicalSourceMode: LegacyCanonicalSyncMode | null;
}

/**
 * Parses a configured source-mode value, including the legacy vocabulary that is
 * already persisted on `IntegrationSyncRun.sourceMode`, `SyncCheckpoint.mode` and
 * `DemandRun.sourceMode`.
 *
 * Evidence for each mapping:
 *   - `FIXTURE` is what every existing row and the previous default carry, and it is
 *     produced by `FixtureFantasyProvider`. It maps to FIXTURE_SIMULATION.
 *   - `FANTASY_API` was only ever reachable through `LiveFantasyProvider`, whose
 *     `getBatch` throws "not yet configured". It maps to a *configured* LIVE_FANTASY
 *     selection, but no live provider is installed, so the effective state derived
 *     below stays NOT_CONFIGURED until one is. Selecting it can never, by itself,
 *     claim a working connection.
 *   - `FILE_IMPORT` has no provider, no importer, no route and no test. It was
 *     accepted here and then threw `Unsupported source mode` inside the provider
 *     factory at run time. It is now rejected at configuration time instead: it fails
 *     closed to NOT_CONFIGURED with its own code, and is never mapped onto live
 *     Fantasy. Reintroducing it means adding a real import capability.
 *   - Anything else, including an empty value, fails closed.
 */
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

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export type FantasyDeliveryMode = "FULL_SNAPSHOT" | "PROVIDER_CURSOR";

/**
 * What a row provider declares about itself, limited to facts that are safe to show a
 * browser. Capability is declared, never inferred from the rows a provider returns.
 *
 * Configuration key names, endpoints, credentials and the installed-provider registry
 * are deliberately *not* here — they live in `provider-registry.server.ts`, so a client
 * bundle cannot learn which environment variables a live connector would need.
 */
export interface FantasyProviderCapabilities {
  /** Stable, non-sensitive identifier. Never a URL, host name or credential. */
  readonly providerId: string;
  readonly contractVersion: string;
  readonly deliveryMode: FantasyDeliveryMode;
  readonly implementationStatus: "IMPLEMENTED" | "NOT_IMPLEMENTED";
  /** Whether the provider can serve a batch intended purely for a dry run. */
  readonly supportsDryRunFetch: boolean;
  /** True when the provider serves synthetic data rather than a real ERP. */
  readonly simulated: boolean;
}

// ---------------------------------------------------------------------------
// Effective-state derivation — the one place this decision is made
// ---------------------------------------------------------------------------

/**
 * Operational default for how old live data may be before it is called stale. This is
 * an integration health threshold, not a confirmed business rule, and it is stated
 * here so that "fresh" is never an implicit judgement.
 */
export const DEFAULT_LIVE_FRESHNESS_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Validates a freshness threshold. Anything that is not a finite, strictly positive
 * number of milliseconds is refused rather than defaulted: a zero, negative, NaN or
 * infinite window would silently make every live source look permanently fresh or
 * permanently stale. Callers must never feed this from an unvalidated browser value —
 * the threshold is decided server-side.
 */
export function isUsableFreshnessWindow(candidate: unknown): candidate is number {
  return typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0;
}

export interface EffectiveSourceStateInput {
  readonly configuredMode: FantasyConfiguredMode;
  readonly configuredReasonCode: FantasySourceReasonCode;
  /** True only when a real live provider implementation is registered. */
  readonly providerInstalled: boolean;
  /** True only when every key that provider declared is present and non-empty. */
  readonly configurationComplete: boolean;
  /** Health the provider reports about itself. */
  readonly providerHealth: FantasyRuntimeHealth;
  readonly lastSuccessAt: Date | null;
  readonly lastFailureAt: Date | null;
  readonly now: Date;
  /**
   * Operational threshold, not a client-confirmed business rule. Omitted means the
   * documented default; an unusable value fails closed instead of being replaced.
   */
  readonly freshnessWindowMs?: number;
  /**
   * True only when the synchronization history being judged can be proven to belong to
   * this live provider. No provider stamps an auditable provider identifier on its run
   * records yet, so this is false today and a live source cannot be called ready on the
   * strength of history it cannot claim. A future real provider must stamp a
   * non-sensitive provider identifier on `IntegrationSyncRun` before this may be true.
   */
  readonly providerHistoryTrusted?: boolean;
}

export interface EffectiveSourceState {
  readonly effectiveState: FantasyEffectiveSourceState;
  readonly runtimeHealth: FantasyRuntimeHealth;
  readonly reasonCode: FantasySourceReasonCode;
}

/**
 * Derives the single state a page or API may display.
 *
 * Fails closed throughout: every path that cannot *prove* a healthy live connection
 * resolves to NOT_CONFIGURED or LIVE_FANTASY_DEGRADED. Fixture simulation can never
 * reach a live state, and nothing can reach LIVE_FANTASY without an installed
 * provider, complete configuration, ready health and a recent success.
 */
export function deriveEffectiveSourceState(input: EffectiveSourceStateInput): EffectiveSourceState {
  if (input.configuredMode === "NOT_CONFIGURED") {
    // Nothing is running, so there is no health to report.
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "NOT_APPLICABLE", reasonCode: input.configuredReasonCode };
  }

  if (input.configuredMode === "FIXTURE_SIMULATION") {
    // A fixture is never READY: READY would assert connectivity to Fantasy.
    return { effectiveState: "FIXTURE_SIMULATION", runtimeHealth: "NOT_APPLICABLE", reasonCode: "FIXTURE_SIMULATION_ACTIVE" };
  }

  // Live selected. Everything below has to be positively established.
  if (!input.providerInstalled) {
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "UNAVAILABLE", reasonCode: "PROVIDER_NOT_IMPLEMENTED" };
  }
  if (!input.configurationComplete) {
    return { effectiveState: "NOT_CONFIGURED", runtimeHealth: "UNAVAILABLE", reasonCode: "LIVE_CONFIGURATION_INCOMPLETE" };
  }
  if (input.providerHealth === "UNAVAILABLE" || input.providerHealth === "NOT_APPLICABLE") {
    // An unreachable or unknown provider is reported as degraded service, never as ready.
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "UNAVAILABLE", reasonCode: "PROVIDER_UNAVAILABLE" };
  }
  if (input.providerHealth === "DEGRADED") {
    return { effectiveState: "LIVE_FANTASY_DEGRADED", runtimeHealth: "DEGRADED", reasonCode: "PROVIDER_DEGRADED" };
  }

  // History that cannot be attributed to this provider is not evidence of readiness.
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

/**
 * The effective state of a *stored historical record* — a completed sync or demand run
 * that carries its own `isSimulated` flag and legacy source-mode string. It reports
 * what that record was produced from, not what is configured now.
 */
export function deriveHistoricalSourceState(isSimulated: boolean, storedSourceMode: string): FantasyEffectiveSourceState {
  const parsed = parseConfiguredSourceMode(storedSourceMode);
  if (isSimulated || parsed.configuredMode === "FIXTURE_SIMULATION") return "FIXTURE_SIMULATION";
  if (parsed.configuredMode === "LIVE_FANTASY") return "LIVE_FANTASY";
  return "NOT_CONFIGURED";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

export const FANTASY_SOURCE_STATE_LABELS: Record<FantasyEffectiveSourceState, string> = {
  FIXTURE_SIMULATION: "Fixture Simulation",
  LIVE_FANTASY: "Live Fantasy",
  LIVE_FANTASY_DEGRADED: "Live Fantasy — Degraded",
  NOT_CONFIGURED: "Not Configured",
};

/** Fixed, value-free explanations. No environment value, key name or error text. */
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

/**
 * Sanitized source state. This is the whole of what an authorized page or API may see.
 *
 * Deliberately absent: credentials, environment values, provider URLs, configuration
 * key names, cursor tokens, cursor-token hashes, raw rows, provider response bodies,
 * database errors and stack traces.
 */
export interface FantasySourceStateSummary {
  readonly configuredMode: FantasyConfiguredMode;
  readonly effectiveState: FantasyEffectiveSourceState;
  readonly runtimeHealth: FantasyRuntimeHealth;
  /** True whenever the displayed data is simulation output. */
  readonly isSimulated: boolean;
  readonly providerInstalled: boolean;
  /** Boolean only — never which keys are missing, and never their values. */
  readonly configurationComplete: boolean;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly reasonCode: FantasySourceReasonCode;
  readonly statusLabel: string;
  readonly statusExplanation: string;
}

/** Builds the sanitized summary from a derived state. The only builder. */
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
