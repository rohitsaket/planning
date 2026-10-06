import {
  isSupportedContractVersion,
  type FantasyRowSourceProvider,
  type FantasySourceBatch,
  type FantasySourceCursor,
} from "./row-contract";
import {
  ingestFantasyRawBatch,
  type RawIngestionDb,
  type RawIngestionMode,
} from "./raw-ingestion";
import type { FantasyProviderCapabilities, FantasySourceStateSummary } from "./source-state";
import { isFantasyProviderContext, type FantasyProviderContext } from "./provider-registry.server";

if (typeof window !== "undefined") {
  throw new Error("fantasy/raw-orchestration is server-only and must not be imported by client code.");
}

export const RAW_ORCHESTRATION_FAILURE_CODES = [
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_PROVIDER_MISMATCH",
  "PROVIDER_NOT_IMPLEMENTED",
  "PROVIDER_SIMULATION_MISMATCH",
  "DRY_RUN_FETCH_NOT_SUPPORTED",
  "PROVIDER_UNAVAILABLE",
  "CONTRACT_VERSION_MISMATCH",
  "DELIVERY_MODE_MISMATCH",
  "BATCH_VALIDATION_FAILED",
  "RAW_INGESTION_FAILED",
] as const;
export type RawOrchestrationFailureCode = (typeof RAW_ORCHESTRATION_FAILURE_CODES)[number];

const FAILURE_MESSAGES: Record<RawOrchestrationFailureCode, string> = {
  SOURCE_NOT_CONFIGURED: "No usable Fantasy data source is configured, so no batch was requested.",
  SOURCE_PROVIDER_MISMATCH: "The data source and the connector were not resolved together, so no batch was requested.",
  PROVIDER_NOT_IMPLEMENTED: "The selected Fantasy connector is not implemented in this version.",
  PROVIDER_SIMULATION_MISMATCH: "The connector does not match the configured data source, so no batch was requested.",
  DRY_RUN_FETCH_NOT_SUPPORTED: "The selected Fantasy connector cannot serve a preview, so nothing was requested or stored.",
  PROVIDER_UNAVAILABLE: "The Fantasy connector could not supply a batch.",
  CONTRACT_VERSION_MISMATCH: "The delivered batch does not match the column contract this version supports.",
  DELIVERY_MODE_MISMATCH: "The delivered batch does not match the delivery mode the connector declared.",
  BATCH_VALIDATION_FAILED: "The delivered batch was not structurally usable.",
  RAW_INGESTION_FAILED: "The delivered batch could not be stored. No partial batch was committed.",
};

export interface RawOrchestrationIngestedResult {
  readonly outcome: "INGESTED";
  readonly mode: RawIngestionMode;
  readonly effectiveSourceState: FantasySourceStateSummary["effectiveState"];
  readonly providerId: string;
  readonly providerSimulated: boolean;
  readonly deliveryMode: FantasyProviderCapabilities["deliveryMode"];
  readonly contractVersion: string;
  readonly encodingVersion: string;
  readonly providerBatchId: string;
  readonly rawBatchId: string | null;
  readonly batchStatus: string;
  readonly idempotentReplay: boolean;
  readonly conflict: boolean;
  readonly counts: {
    readonly received: number;
    readonly accepted: number;
    readonly quarantined: number;
    readonly rejected: number;
    readonly withDrift: number;
  };
  readonly diagnosticCodes: readonly string[];
}

export interface RawOrchestrationNoBatchResult {
  readonly outcome: "NO_BATCH";
  readonly effectiveSourceState: FantasySourceStateSummary["effectiveState"];
  readonly providerId: string;
  readonly message: string;
}

export interface RawOrchestrationRefusedResult {
  readonly outcome: "REFUSED";
  readonly effectiveSourceState: FantasySourceStateSummary["effectiveState"];
  readonly providerId: string;
  readonly failureCode: RawOrchestrationFailureCode;
  readonly message: string;
}

export type RawOrchestrationResult =
  | RawOrchestrationIngestedResult
  | RawOrchestrationNoBatchResult
  | RawOrchestrationRefusedResult;

export interface RawOrchestrationOptions {
  readonly mode: RawIngestionMode;
  readonly context: FantasyProviderContext;
  readonly db: RawIngestionDb;
  readonly cursor?: FantasySourceCursor;
  readonly logUnexpected?: (event: string, fields: Record<string, unknown>) => void;
}

export const FULL_SNAPSHOT_CURSOR: FantasySourceCursor = { kind: "FULL_SNAPSHOT", token: null };

export interface LiveCursorStore {
  read(providerId: string): Promise<FantasySourceCursor | null>;
  advance(providerId: string, cursor: FantasySourceCursor): Promise<void>;
}

function refuse(
  context: FantasyProviderContext | null,
  failureCode: RawOrchestrationFailureCode,
): RawOrchestrationRefusedResult {
  return {
    outcome: "REFUSED",
    effectiveSourceState: context?.sourceState.effectiveState ?? "NOT_CONFIGURED",
    providerId: context?.capabilities.providerId ?? "unknown",
    failureCode,
    message: FAILURE_MESSAGES[failureCode],
  };
}

function simulationMatchesSource(
  effectiveState: FantasySourceStateSummary["effectiveState"],
  simulated: boolean,
): boolean {
  if (effectiveState === "FIXTURE_SIMULATION") return simulated === true;
  if (effectiveState === "LIVE_FANTASY" || effectiveState === "LIVE_FANTASY_DEGRADED") return simulated === false;
  return false;
}

function diagnosticCodes(issues: readonly { code: string }[]): string[] {
  return Array.from(new Set(issues.map((i) => i.code))).sort();
}

export async function orchestrateFantasyRawIngestion(
  options: RawOrchestrationOptions,
): Promise<RawOrchestrationResult> {
  const rawContext = options.context;
  if (!isFantasyProviderContext(rawContext)) {
    return refuse(null, "SOURCE_PROVIDER_MISMATCH");
  }
  const context: FantasyProviderContext = rawContext;
  const { capabilities, provider, sourceState } = context;

  if (sourceState.effectiveState === "NOT_CONFIGURED") {
    return refuse(context, "SOURCE_NOT_CONFIGURED");
  }

  if (capabilities.implementationStatus !== "IMPLEMENTED") {
    return refuse(context, "PROVIDER_NOT_IMPLEMENTED");
  }

  if (!simulationMatchesSource(sourceState.effectiveState, capabilities.simulated)) {
    return refuse(context, "PROVIDER_SIMULATION_MISMATCH");
  }

  if (options.mode === "DRY_RUN" && !capabilities.supportsDryRunFetch) {
    return refuse(context, "DRY_RUN_FETCH_NOT_SUPPORTED");
  }

  if (!isSupportedContractVersion(capabilities.contractVersion) || provider.contractVersion !== capabilities.contractVersion) {
    return refuse(context, "CONTRACT_VERSION_MISMATCH");
  }

  const cursor: FantasySourceCursor =
    capabilities.deliveryMode === "FULL_SNAPSHOT" ? FULL_SNAPSHOT_CURSOR : options.cursor ?? { kind: "PROVIDER_SUPPLIED", token: null };

  let batch: FantasySourceBatch | null;
  try {
    batch = await provider.fetchBatch(cursor);
  } catch {
    options.logUnexpected?.("fantasy.raw_orchestration.provider_error", {
      providerId: capabilities.providerId,
      failureCode: "PROVIDER_UNAVAILABLE",
    });
    return refuse(context, "PROVIDER_UNAVAILABLE");
  }

  if (batch === null) {
    return {
      outcome: "NO_BATCH",
      effectiveSourceState: sourceState.effectiveState,
      providerId: capabilities.providerId,
      message: "The connector reported no batch available.",
    };
  }

  if (batch.contractVersion !== provider.contractVersion) {
    return refuse(context, "CONTRACT_VERSION_MISMATCH");
  }

  if (!Array.isArray(batch.headers) || !Array.isArray(batch.rows) || typeof batch.batchId !== "string" || batch.batchId === "") {
    return refuse(context, "BATCH_VALIDATION_FAILED");
  }

  if (!deliveryMatchesCapability(capabilities.deliveryMode, batch.cursor)) {
    return refuse(context, "DELIVERY_MODE_MISMATCH");
  }

  try {
    const ingestion = await ingestFantasyRawBatch(batch, {
      mode: options.mode,
      db: options.db,
      provenance: {
        effectiveSourceState: sourceState.effectiveState,
        providerId: capabilities.providerId,
      },
    });
    return {
      outcome: "INGESTED",
      mode: ingestion.mode,
      effectiveSourceState: sourceState.effectiveState,
      providerId: capabilities.providerId,
      providerSimulated: capabilities.simulated,
      deliveryMode: capabilities.deliveryMode,
      contractVersion: ingestion.contractVersion,
      encodingVersion: ingestion.encodingVersion,
      providerBatchId: ingestion.providerBatchId,
      rawBatchId: ingestion.batchId,
      batchStatus: ingestion.status,
      idempotentReplay: ingestion.idempotentReplay,
      conflict: ingestion.conflict,
      counts: ingestion.counts,
      diagnosticCodes: diagnosticCodes(ingestion.diagnostics.issues),
    };
  } catch {
    options.logUnexpected?.("fantasy.raw_orchestration.ingestion_error", {
      providerId: capabilities.providerId,
      failureCode: "RAW_INGESTION_FAILED",
    });
    return refuse(context, "RAW_INGESTION_FAILED");
  }
}

function deliveryMatchesCapability(
  declared: FantasyProviderCapabilities["deliveryMode"],
  cursor: FantasySourceCursor,
): boolean {
  if (declared === "FULL_SNAPSHOT") return cursor.kind === "FULL_SNAPSHOT" && cursor.token === null;
  return cursor.kind === "PROVIDER_SUPPLIED";
}
