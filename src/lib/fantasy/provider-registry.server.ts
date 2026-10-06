import type {
  FantasyProviderCapabilities,
  FantasySourceStateSummary,
} from "./source-state";
import type { FantasyRowSourceProvider } from "./row-contract";

if (typeof window !== "undefined") {
  throw new Error("fantasy/provider-registry.server is server-only and must not be imported by client code.");
}

export type SourceEnvironment = Readonly<Record<string, string | undefined>>;

export interface FantasyProviderRegistration extends FantasyProviderCapabilities {
  readonly requiredConfigKeys: readonly string[];
  readonly stampsRunProviderId: boolean;
}

export const INSTALLED_LIVE_PROVIDERS: readonly FantasyProviderRegistration[] = [];

export function findInstalledLiveProvider(): FantasyProviderRegistration | null {
  return INSTALLED_LIVE_PROVIDERS[0] ?? null;
}

export function isLiveConfigurationComplete(
  registration: FantasyProviderRegistration | null,
  env: SourceEnvironment,
): boolean {
  if (registration === null) return false;
  return registration.requiredConfigKeys.every((key) => (env[key] ?? "").trim() !== "");
}

export function isProviderHistoryTrusted(registration: FantasyProviderRegistration | null): boolean {
  return registration?.stampsRunProviderId === true;
}

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

const PROVIDER_CONTEXT_BRAND = Symbol.for("fantasy.provider-context.v1");

export interface FantasyProviderContext {
  readonly [PROVIDER_CONTEXT_BRAND]: true;
  readonly sourceState: FantasySourceStateSummary;
  readonly capabilities: FantasyProviderCapabilities;
  readonly provider: FantasyRowSourceProvider;
}

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
