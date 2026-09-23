/**
 * FANTASY PROVIDER REGISTRY — server-only.
 *
 * Everything about a data-source connector that must never reach a browser bundle:
 * which providers are installed, which environment keys they need, whether those keys
 * are present, and the construction of the one context object the orchestrator will
 * accept.
 *
 * The `.server.ts` suffix is the boundary marker. The companion module
 * `source-state.ts` is client-safe and must never re-export anything from here; the
 * Phase 4 test suite asserts both directions. The `server-only` package would give a
 * build-time error instead of the runtime guard below, but adding a dependency for one
 * guard is not warranted while the guard is enforced by tests.
 *
 * Only a boolean leaves this module. Which keys are missing, and what they contain, do
 * not.
 */

import type {
  FantasyProviderCapabilities,
  FantasySourceStateSummary,
} from "./source-state";
import type { FantasyRowSourceProvider } from "./row-contract";

if (typeof window !== "undefined") {
  throw new Error("fantasy/provider-registry.server is server-only and must not be imported by client code.");
}

/** Only the keys this module reads. Nothing writes to, enumerates or returns it. */
export type SourceEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * A provider's full server-side registration: its public capabilities plus the
 * configuration it needs. `requiredConfigKeys` names environment variables, so this
 * type must not appear in a client-facing response or a client bundle.
 */
export interface FantasyProviderRegistration extends FantasyProviderCapabilities {
  /**
   * Environment keys this provider needs before it may run. Only a boolean derived
   * from them ever leaves the server — never a key name, a value, or a count that
   * would reveal how many are missing.
   */
  readonly requiredConfigKeys: readonly string[];
  /**
   * True only when this provider stamps a non-sensitive, auditable provider identifier
   * on every `IntegrationSyncRun` it produces. Until a provider does, its run history
   * cannot be distinguished from any other non-simulated history, so health derived
   * from that history is not trusted and the source stays degraded.
   */
  readonly stampsRunProviderId: boolean;
}

/**
 * Live Fantasy row providers installed in this build.
 *
 * Deliberately empty. The Fantasy API endpoint, authentication scheme, response
 * schema, cursor format and status semantics are all still unconfirmed, so there is
 * nothing truthful to register. While this is empty, selecting live mode resolves to
 * NOT_CONFIGURED rather than to a connector that would fail at its first request.
 *
 * A real implementation is registered here once the API contract exists; nothing else
 * in the application has to change for the effective state to start reporting
 * LIVE_FANTASY.
 */
export const INSTALLED_LIVE_PROVIDERS: readonly FantasyProviderRegistration[] = [];

export function findInstalledLiveProvider(): FantasyProviderRegistration | null {
  return INSTALLED_LIVE_PROVIDERS[0] ?? null;
}

/**
 * Whether every key a provider declared is present and non-empty.
 *
 * Returns a bare boolean on purpose: reporting which key is missing would tell an
 * unauthorized caller what the integration is configured with.
 */
export function isLiveConfigurationComplete(
  registration: FantasyProviderRegistration | null,
  env: SourceEnvironment,
): boolean {
  if (registration === null) return false;
  return registration.requiredConfigKeys.every((key) => (env[key] ?? "").trim() !== "");
}

/** Whether history for this provider can be attributed to it. See the field's note. */
export function isProviderHistoryTrusted(registration: FantasyProviderRegistration | null): boolean {
  return registration?.stampsRunProviderId === true;
}

/** The public subset of a registration. Safe to return; carries no configuration key. */
export function toPublicCapabilities(registration: FantasyProviderRegistration): FantasyProviderCapabilities {
  return {
    providerId: registration.providerId,
    contractVersion: registration.contractVersion,
    deliveryMode: registration.deliveryMode,
    implementationStatus: registration.implementationStatus,
    supportsDryRunFetch: registration.supportsDryRunFetch,
    simulated: registration.simulated,
  };
}

// ---------------------------------------------------------------------------
// Provider context
// ---------------------------------------------------------------------------

/**
 * Runtime brand. The orchestrator checks for it rather than trusting a TypeScript
 * type, so a caller cannot assemble a source state and a provider that were never
 * resolved together — which is how a simulated connector would end up running under a
 * live source state, or the reverse.
 */
const PROVIDER_CONTEXT_BRAND = Symbol.for("fantasy.provider-context.v1");

/**
 * A source state and the provider that was resolved for it, bound together by this
 * module. It is the only thing `orchestrateFantasyRawIngestion` accepts.
 */
export interface FantasyProviderContext {
  readonly [PROVIDER_CONTEXT_BRAND]: true;
  readonly sourceState: FantasySourceStateSummary;
  readonly capabilities: FantasyProviderCapabilities;
  readonly provider: FantasyRowSourceProvider;
}

/**
 * Binds a resolved source state to the provider that serves it.
 *
 * Tests pass controlled inputs here; production code reaches it through the registry
 * above, which is empty, so no live context can be produced today. The capabilities
 * are reduced to their public subset on the way through, so no configuration key can
 * travel inside a context.
 */
export function createFantasyProviderContext(input: {
  sourceState: FantasySourceStateSummary;
  capabilities: FantasyProviderCapabilities | FantasyProviderRegistration;
  provider: FantasyRowSourceProvider;
}): FantasyProviderContext {
  const { providerId, contractVersion, deliveryMode, implementationStatus, supportsDryRunFetch, simulated } =
    input.capabilities;
  return {
    [PROVIDER_CONTEXT_BRAND]: true,
    sourceState: input.sourceState,
    capabilities: { providerId, contractVersion, deliveryMode, implementationStatus, supportsDryRunFetch, simulated },
    provider: input.provider,
  };
}

/** Runtime proof that a context came from this module. */
export function isFantasyProviderContext(value: unknown): value is FantasyProviderContext {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<PropertyKey, unknown>;
  return (
    candidate[PROVIDER_CONTEXT_BRAND] === true &&
    typeof candidate.sourceState === "object" &&
    candidate.sourceState !== null &&
    typeof candidate.capabilities === "object" &&
    candidate.capabilities !== null &&
    typeof candidate.provider === "object" &&
    candidate.provider !== null
  );
}
