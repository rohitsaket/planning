/**
 * FANTASY RAW ORCHESTRATION — Phase 4.
 *
 * Connects an injected Phase 2 row provider to Phase 3A raw ingestion:
 *
 *   configured source → provider → batch + cursor metadata → contract validation
 *   → raw ingestion (DRY_RUN or PERSIST)
 *
 * What this service deliberately does not do:
 *   - It creates no canonical record. Projecting raw rows into inventory, demand, WIP,
 *     requirements, planning or history is Phase 3B and is not implemented anywhere.
 *   - It advances no synchronization checkpoint. The legacy canonical fixture pipeline
 *     in `sync-service.ts` owns `SyncCheckpoint`; this path never touches it.
 *   - It instantiates no provider. The provider is injected, so a fictional live
 *     connector cannot be created here by accident.
 *   - It returns no source row, no cursor token and no provider response body.
 *
 * Relationship to the existing pipeline: the legacy canonical fixture synchronization
 * remains the application's data path and is unchanged. It converts fixture *canonical
 * records*, not 46-column Fantasy rows, so it is not exercising this raw pipeline. The
 * two run side by side until Phase 3B defines projection.
 *
 * Server-only: provider batches contain raw Fantasy values.
 */

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

/** Fixed codes. A provider, network, Prisma or parsing message is never returned. */
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

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface RawOrchestrationIngestedResult {
  readonly outcome: "INGESTED";
  readonly mode: RawIngestionMode;
  readonly effectiveSourceState: FantasySourceStateSummary["effectiveState"];
  readonly providerId: string;
  readonly providerSimulated: boolean;
  readonly deliveryMode: FantasyProviderCapabilities["deliveryMode"];
  readonly contractVersion: string;
  readonly encodingVersion: string;
  /** Provider-supplied batch identifier. Not a cursor and not a uniqueness key. */
  readonly providerBatchId: string;
  /** Null in DRY_RUN: nothing was written. */
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
  /** Diagnostic codes only — no header values, no positions, no source values. */
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

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RawOrchestrationOptions {
  readonly mode: RawIngestionMode;
  /**
   * A source state and the provider resolved for it, bound together by
   * `createFantasyProviderContext` in the server-only registry. The brand on that
   * object is checked at run time, not merely typed, so a caller cannot pair a source
   * state with a provider that was never resolved for it.
   */
  readonly context: FantasyProviderContext;
  readonly db: RawIngestionDb;
  /**
   * Opaque provider cursor for an incremental fetch. Held in memory for the duration of
   * this call, handed to the provider, and never stored or returned. Phase 3A already
   * stores only a hash of it.
   */
  readonly cursor?: FantasySourceCursor;
  /**
   * Sanitized server log sink. Receives a fixed event name and code only. Raw source
   * data, credentials and exception text are never passed to it.
   */
  readonly logUnexpected?: (event: string, fields: Record<string, unknown>) => void;
}

/**
 * The cursor a full-snapshot provider is given. A snapshot provider is told explicitly
 * that there is no incremental position, rather than being handed a token it might
 * reinterpret.
 */
export const FULL_SNAPSHOT_CURSOR: FantasySourceCursor = { kind: "FULL_SNAPSHOT", token: null };

/**
 * Durable storage for a live incremental cursor is deliberately not implemented.
 *
 * Persisting a resumable position is only safe once the Fantasy API's own cursor
 * format, its expiry and replay semantics, and whether the token is bearer-equivalent
 * are known. Guessing any of those risks either silent data loss on resume or storing
 * a credential. The narrow interface a future implementation must satisfy is declared
 * here so the orchestrator can adopt it without being redesigned; no implementation is
 * registered, and no orchestration path depends on one.
 */
export interface LiveCursorStore {
  read(providerId: string): Promise<FantasySourceCursor | null>;
  /** Advanced only after the corresponding batch is committed. */
  advance(providerId: string, cursor: FantasySourceCursor): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Fixed code, fixed message, and only identifiers that are safe to show. A refusal
 * never carries a configuration value, a provider response or an exception string.
 */
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

/**
 * A connector may only serve the kind of source it was resolved for. Running a
 * simulated connector under a live state would present fixtures as ERP data; running a
 * real connector under fixture state would pull live records into a simulation.
 */
function simulationMatchesSource(
  effectiveState: FantasySourceStateSummary["effectiveState"],
  simulated: boolean,
): boolean {
  if (effectiveState === "FIXTURE_SIMULATION") return simulated === true;
  // A degraded live source may still be retried, but only by a real live connector.
  if (effectiveState === "LIVE_FANTASY" || effectiveState === "LIVE_FANTASY_DEGRADED") return simulated === false;
  return false;
}

/** Diagnostic codes, deduplicated and ordered. Positions and values are dropped. */
function diagnosticCodes(issues: readonly { code: string }[]): string[] {
  return Array.from(new Set(issues.map((i) => i.code))).sort();
}

/**
 * Runs one provider fetch through raw ingestion.
 *
 * Every check that can be made without contacting anything is made first, so a refusal
 * costs no provider request and no database write: the context must have come from the
 * server registry, the source must be configured, the connector must be implemented,
 * its simulated/live nature must match the source it is serving, it must be able to
 * serve the requested mode, and the contract versions must line up. Every failure is a
 * fixed code.
 */
export async function orchestrateFantasyRawIngestion(
  options: RawOrchestrationOptions,
): Promise<RawOrchestrationResult> {
  // 1. Run-time proof that the source state and the provider were resolved together by
  //    the server registry, rather than assembled by a caller.
  const rawContext = options.context;
  if (!isFantasyProviderContext(rawContext)) {
    return refuse(null, "SOURCE_PROVIDER_MISMATCH");
  }
  const context: FantasyProviderContext = rawContext;
  const { capabilities, provider, sourceState } = context;

  // 2. A source that is not configured never reaches a provider.
  if (sourceState.effectiveState === "NOT_CONFIGURED") {
    return refuse(context, "SOURCE_NOT_CONFIGURED");
  }

  // 3. A declared-but-unimplemented connector is refused rather than called.
  if (capabilities.implementationStatus !== "IMPLEMENTED") {
    return refuse(context, "PROVIDER_NOT_IMPLEMENTED");
  }

  // 4. A simulated connector may only serve a simulated source, and a real connector
  //    only a live one. Enforced here, before any fetch, so a mismatch can never reach
  //    a result and be read as the wrong kind of data.
  if (!simulationMatchesSource(sourceState.effectiveState, capabilities.simulated)) {
    return refuse(context, "PROVIDER_SIMULATION_MISMATCH");
  }

  // 5. A preview is only run against a connector that declared it can serve one. The
  //    alternative — quietly performing a normal fetch — would contact the source on
  //    behalf of a caller who asked for a dry run.
  if (options.mode === "DRY_RUN" && !capabilities.supportsDryRunFetch) {
    return refuse(context, "DRY_RUN_FETCH_NOT_SUPPORTED");
  }

  // 6. The connector's declared contract version must be one this build ingests, and
  //    the provider instance must agree with its own capability declaration.
  if (!isSupportedContractVersion(capabilities.contractVersion) || provider.contractVersion !== capabilities.contractVersion) {
    return refuse(context, "CONTRACT_VERSION_MISMATCH");
  }

  // 7. The cursor a provider receives follows from its declared delivery mode, never
  //    from anything inside the rows.
  const cursor: FantasySourceCursor =
    capabilities.deliveryMode === "FULL_SNAPSHOT" ? FULL_SNAPSHOT_CURSOR : options.cursor ?? { kind: "PROVIDER_SUPPLIED", token: null };

  let batch: FantasySourceBatch | null;
  try {
    batch = await provider.fetchBatch(cursor);
  } catch {
    // A provider, network or SDK message can quote a URL, a credential or a source row.
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

  // 8. The batch has to declare the same contract version the provider does.
  if (batch.contractVersion !== provider.contractVersion) {
    return refuse(context, "CONTRACT_VERSION_MISMATCH");
  }

  // 9. Structural sanity before anything is encoded or stored.
  if (!Array.isArray(batch.headers) || !Array.isArray(batch.rows) || typeof batch.batchId !== "string" || batch.batchId === "") {
    return refuse(context, "BATCH_VALIDATION_FAILED");
  }

  // 10. Delivery mode must match what was declared. A full-snapshot connector returning
  //    an incremental token, or a cursor connector returning a snapshot, is refused:
  //    the difference decides whether absent rows mean "unchanged" or "gone", and that
  //    is not something to infer.
  if (!deliveryMatchesCapability(capabilities.deliveryMode, batch.cursor)) {
    return refuse(context, "DELIVERY_MODE_MISMATCH");
  }

  // 11. Hand over to Phase 3A. Idempotency, conflict handling, quarantine, hashing and
  //    concurrency are already enforced there and are not re-implemented.
  try {
    const ingestion = await ingestFantasyRawBatch(batch, {
      mode: options.mode,
      db: options.db,
      // The state and provider verified above, recorded with the batch so projection can
      // bind to it later instead of re-deriving it from a configuration that may since
      // have changed.
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

/**
 * A full-snapshot connector must deliver a snapshot and no token; a cursor connector
 * must deliver a provider-supplied cursor. No row field — including `Doc Date`,
 * `Allocation Date` and `Doc ID` — and no row position or batch id ever participates.
 */
function deliveryMatchesCapability(
  declared: FantasyProviderCapabilities["deliveryMode"],
  cursor: FantasySourceCursor,
): boolean {
  if (declared === "FULL_SNAPSHOT") return cursor.kind === "FULL_SNAPSHOT" && cursor.token === null;
  return cursor.kind === "PROVIDER_SUPPLIED";
}
