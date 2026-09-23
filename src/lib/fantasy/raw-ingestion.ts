/**
 * FANTASY RAW INGESTION — Phase 3A.
 *
 * Accepts a provider batch, validates it through the Phase 2 contract, and either
 * reports what would happen (DRY_RUN) or stores the batch, its type-tagged raw rows
 * and safe diagnostics (PERSIST).
 *
 * Boundaries this service keeps:
 *   - It writes only to the two raw staging models. Its database parameter is typed
 *     down to those delegates, so a canonical write is not expressible here.
 *   - It never interprets Fantasy business meaning: no date, quantity, weight, hold,
 *     status, process, department or estimate is parsed. Structure only.
 *   - Diagnostics carry codes and positions, never source values.
 *   - Identity comes from ingestion metadata and content hashes, never from a Fantasy
 *     business identifier.
 *
 * Server-only: batches contain raw Fantasy values.
 */

import { Prisma } from "@prisma/client";
import {
  toContractDiagnostics,
  validateFantasySourceBatch,
  type FantasyContractIssue,
  type FantasyRowResult,
  type FantasySourceBatch,
} from "@/lib/fantasy/row-contract";
import {
  canonicalJson,
  computeBatchHash,
  computeRowHash,
  encodeHeaders,
  encodeKeyedRecord,
  encodeSourceRow,
  sha256Hex,
  sourceRowHasUnsupportedCell,
  FANTASY_RAW_ENCODING_V2,
  type FantasyEncodedCell,
  type FantasyEncodedSourceRow,
} from "@/lib/fantasy/raw-encoding";

if (typeof window !== "undefined") {
  throw new Error("fantasy/raw-ingestion is server-only and must not be imported by client code.");
}

export const RAW_INGESTION_MODES = ["DRY_RUN", "PERSIST"] as const;
export type RawIngestionMode = (typeof RAW_INGESTION_MODES)[number];

export type RawRowOutcome = "ACCEPTED_RAW" | "QUARANTINED" | "REJECTED_STRUCTURE";
export type RawBatchStatus = "ACCEPTED" | "ACCEPTED_WITH_ISSUES" | "REJECTED" | "CONFLICT";

/**
 * Provider metadata keys that may be stored. Anything else is dropped without being
 * named, so an authorization header or token cannot be persisted by accident.
 */
export const ALLOWED_PROVIDER_METADATA_KEYS = [
  "providerName",
  "datasetId",
  "environment",
  "apiVersion",
  "deliveryKind",
] as const;

/** Raised instead of surfacing a database or driver error. Carries no source value. */
export class FantasyRawIngestionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FantasyRawIngestionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Narrow database surface
// ---------------------------------------------------------------------------

interface RawBatchCreateData {
  contractVersion: string;
  encodingVersion: string;
  sourceMode: string;
  providerBatchId: string;
  batchHash: string;
  headersJson: string;
  cursorKind: string;
  cursorTokenHash: string | null;
  providerMetadataJson: string | null;
  processingMode: string;
  status: string;
  processingStartedAt: Date;
  processingCompletedAt: Date;
  rowsReceived: number;
  rowsAccepted: number;
  rowsQuarantined: number;
  rowsRejected: number;
  rowsWithDrift: number;
  diagnosticsJson: string | null;
  conflictsWithBatchId: string | null;
  integrationSyncRunId: string | null;
  effectiveSourceStateAtIngestion: string;
  providerIdAtIngestion: string | null;
}

interface RawRowCreateData {
  batchId: string;
  sourceRowNumber: number;
  encodingVersion: string;
  rawPayloadJson: string;
  normalizedRecordJson: string | null;
  rowHash: string;
  outcome: string;
  diagnosticsJson: string | null;
  quarantineReasonCodes: string | null;
}

interface StoredBatch {
  id: string;
  status: string;
  batchHash: string;
  conflictsWithBatchId: string | null;
  rowsReceived: number;
  rowsAccepted: number;
  rowsQuarantined: number;
  rowsRejected: number;
  rowsWithDrift: number;
}

/**
 * Exactly the database capability this service needs. The Prisma client satisfies it
 * structurally, while canonical delegates stay out of reach. `$executeRaw` is the
 * tagged-template form only, so a caller cannot hand this service a composed SQL
 * string; the single statement it runs is written below with a bound parameter.
 */
export interface RawIngestionTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  fantasyRawBatch: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown> | Record<string, unknown>[];
      select?: Record<string, boolean>;
    }): Promise<StoredBatch | null>;
    create(args: { data: RawBatchCreateData }): Promise<StoredBatch>;
  };
  fantasyRawRow: {
    createMany(args: { data: RawRowCreateData[] }): Promise<{ count: number }>;
  };
}

export interface RawIngestionDb {
  $transaction<T>(fn: (tx: RawIngestionTx) => Promise<T>, options?: { timeout?: number; maxWait?: number }): Promise<T>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface RawRowOutcomeSummary {
  readonly sourceRowNumber: number;
  readonly outcome: RawRowOutcome;
  readonly rowHash: string;
  readonly quarantineReasonCodes: readonly string[];
}

export interface RawIngestionResult {
  readonly mode: RawIngestionMode;
  readonly contractVersion: string;
  readonly encodingVersion: string;
  readonly sourceMode: string;
  readonly providerBatchId: string;
  readonly batchHash: string;
  readonly status: RawBatchStatus;
  /** Set when an identical batch was already stored; nothing was written again. */
  readonly idempotentReplay: boolean;
  /** Set when this provider batch id was already used with different content. */
  readonly conflict: boolean;
  readonly conflictsWithBatchId: string | null;
  /** Null in DRY_RUN: no identifier is allocated. */
  readonly batchId: string | null;
  readonly counts: {
    readonly received: number;
    readonly accepted: number;
    readonly quarantined: number;
    readonly rejected: number;
    readonly withDrift: number;
  };
  /** Codes and positions only. */
  readonly diagnostics: ReturnType<typeof toContractDiagnostics>;
  readonly rowOutcomes: readonly RawRowOutcomeSummary[];
  readonly droppedMetadataKeyCount: number;
}

// ---------------------------------------------------------------------------
// Preparation (shared by both modes)
// ---------------------------------------------------------------------------

interface PreparedRow {
  sourceRowNumber: number;
  outcome: RawRowOutcome;
  rowHash: string;
  rawPayloadJson: string;
  normalizedRecordJson: string | null;
  diagnosticsJson: string | null;
  quarantineReasonCodes: string[];
}

interface PreparedBatch {
  contractVersion: string;
  batchHash: string;
  headersJson: string;
  status: RawBatchStatus;
  rows: PreparedRow[];
  counts: RawIngestionResult["counts"];
  diagnostics: ReturnType<typeof toContractDiagnostics>;
  providerMetadataJson: string | null;
  droppedMetadataKeyCount: number;
  cursorTokenHash: string | null;
}

/** Only scalar values under allowlisted keys survive. */
function prepareProviderMetadata(metadata: FantasySourceBatch["providerMetadata"]): {
  json: string | null;
  droppedKeyCount: number;
} {
  if (!metadata) return { json: null, droppedKeyCount: 0 };
  const allowed: Record<string, string | number | boolean | null> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(metadata)) {
    const permitted = (ALLOWED_PROVIDER_METADATA_KEYS as readonly string[]).includes(key);
    const scalar = value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    if (permitted && scalar) allowed[key] = value;
    else dropped++; // the key itself is not recorded: it may name a credential
  }
  return { json: Object.keys(allowed).length ? canonicalJson(allowed) : null, droppedKeyCount: dropped };
}

/** Diagnostics for storage: codes and positions, never values. */
function diagnosticsJson(issues: readonly FantasyContractIssue[]): string | null {
  if (issues.length === 0) return null;
  return canonicalJson(
    issues.map((i) => ({
      code: i.code,
      severity: i.severity,
      ...(i.header === undefined ? {} : { header: i.header }),
      ...(i.key === undefined ? {} : { key: i.key }),
      ...(i.column === undefined ? {} : { column: i.column }),
      ...(i.row === undefined ? {} : { row: i.row }),
      message: i.message,
    })),
  );
}

/**
 * Validates and encodes a batch without touching the database. Both DRY_RUN and
 * PERSIST run exactly this, so a dry run is a truthful preview of a persist.
 */
function prepareBatch(batch: FantasySourceBatch): PreparedBatch {
  const validation = validateFantasySourceBatch(batch);
  const contractVersion = validation.contractVersion;
  const headerOk = validation.headerValidation.ok;

  // Header-level drift applies to every row: rows are preserved but not trusted.
  const batchDriftCodes = validation.headerValidation.issues
    .filter((i) => i.severity === "DRIFT")
    .map((i) => i.code);

  // Headers are encoded as ordinary type-tagged values, so an empty, null, numeric,
  // boolean or unsupported header stays distinguishable in storage and in the hash.
  const encodedHeaders = encodeHeaders(batch.headers);
  const encodedRows: FantasyEncodedSourceRow[] = batch.rows.map(encodeSourceRow);
  const batchHash = computeBatchHash({
    encodingVersion: FANTASY_RAW_ENCODING_V2,
    contractVersion,
    headers: encodedHeaders,
    rows: encodedRows,
  });

  const rows: PreparedRow[] = batch.rows.map((_sourceRow, index) => {
    const sourceRowNumber = index + 1;
    const encodedRow = encodedRows[index];
    const rawPayloadJson = canonicalJson(encodedRow);
    const rowHash = computeRowHash({ encodingVersion: FANTASY_RAW_ENCODING_V2, contractVersion, row: encodedRow });

    // A fatally unusable header row means no field association is possible: the row is
    // preserved exactly as delivered and recorded as structurally rejected.
    if (!headerOk) {
      return {
        sourceRowNumber,
        outcome: "REJECTED_STRUCTURE",
        rowHash,
        rawPayloadJson,
        normalizedRecordJson: null,
        diagnosticsJson: null,
        quarantineReasonCodes: [],
      };
    }

    const rowResult: FantasyRowResult | undefined = validation.rows[index];
    const issues = rowResult?.issues ?? [];
    const hasFatal = issues.some((i) => i.severity === "FATAL");
    const hasUnsupportedCell = sourceRowHasUnsupportedCell(encodedRow);
    const record = rowResult?.record ?? null;

    // The normalized record holds mapped contract fields only; an unknown source field
    // survives in the raw payload above and is never promoted into a contract key.
    const keyed: Record<string, FantasyEncodedCell> | null = record
      ? encodeKeyedRecord(record as Readonly<Record<string, unknown>>)
      : null;

    const driftCodes = [
      ...issues.filter((i) => i.severity === "DRIFT").map((i) => i.code),
      ...batchDriftCodes,
    ];
    const quarantineReasonCodes = Array.from(new Set(driftCodes)).sort();

    const outcome: RawRowOutcome =
      hasFatal || hasUnsupportedCell
        ? "REJECTED_STRUCTURE"
        : quarantineReasonCodes.length > 0
        ? "QUARANTINED"
        : "ACCEPTED_RAW";

    return {
      sourceRowNumber,
      outcome,
      rowHash,
      rawPayloadJson,
      // Stored only when structural normalization actually produced a record.
      normalizedRecordJson: keyed ? canonicalJson(keyed) : null,
      diagnosticsJson: diagnosticsJson(issues),
      quarantineReasonCodes: outcome === "QUARANTINED" ? quarantineReasonCodes : [],
    };
  });

  const accepted = rows.filter((r) => r.outcome === "ACCEPTED_RAW").length;
  const quarantined = rows.filter((r) => r.outcome === "QUARANTINED").length;
  const rejected = rows.filter((r) => r.outcome === "REJECTED_STRUCTURE").length;
  const withDrift = rows.filter((r) => r.quarantineReasonCodes.length > 0).length;

  const status: RawBatchStatus = !headerOk
    ? "REJECTED"
    : quarantined > 0 || rejected > 0 || batchDriftCodes.length > 0
    ? "ACCEPTED_WITH_ISSUES"
    : "ACCEPTED";

  const metadata = prepareProviderMetadata(batch.providerMetadata);

  return {
    contractVersion,
    batchHash,
    headersJson: canonicalJson(encodedHeaders),
    status,
    rows,
    counts: { received: batch.rows.length, accepted, quarantined, rejected, withDrift },
    diagnostics: toContractDiagnostics(validation),
    providerMetadataJson: metadata.json,
    droppedMetadataKeyCount: metadata.droppedKeyCount,
    // The opaque cursor token is never stored; only a correlation hash of it.
    cursorTokenHash: batch.cursor.token ? sha256Hex(batch.cursor.token) : null,
  };
}

function summarize(prepared: PreparedBatch): RawRowOutcomeSummary[] {
  return prepared.rows.map((r) => ({
    sourceRowNumber: r.sourceRowNumber,
    outcome: r.outcome,
    rowHash: r.rowHash,
    quarantineReasonCodes: r.quarantineReasonCodes,
  }));
}

// ---------------------------------------------------------------------------
// Ingestion identity and its concurrency boundary
// ---------------------------------------------------------------------------

interface IngestionIdentity {
  readonly sourceMode: string;
  readonly contractVersion: string;
  readonly providerBatchId: string;
}

/**
 * Serializes every decision for one ingestion identity behind a PostgreSQL
 * transaction-scoped advisory lock.
 *
 * The replay lookup, the conflict lookup and the insert have to happen inside one
 * concurrency boundary: otherwise two submissions carrying the same provider batch id
 * but different payloads both find no prior batch and both commit as normal originals.
 * The lock is held until the transaction ends and is enforced by the database, so it
 * also holds across application instances and workers — an in-process mutex would not.
 *
 * The key is a hash of the ingestion identity only. No Fantasy business field and no
 * source value takes part in it, and the identity itself is never reconstructable from
 * the number.
 */
function advisoryLockKey(identity: IngestionIdentity): bigint {
  const digest = sha256Hex(
    canonicalJson({
      scope: "fantasy.raw-ingestion.identity",
      sourceMode: identity.sourceMode,
      contractVersion: identity.contractVersion,
      providerBatchId: identity.providerBatchId,
    }),
  );
  // pg_advisory_xact_lock takes a signed 64-bit key.
  return BigInt.asIntN(64, BigInt(`0x${digest.slice(0, 16)}`));
}

/** Transient database outcomes that are worth one more attempt. */
const RETRYABLE_PRISMA_CODES = new Set([
  "P2034", // transaction conflict / deadlock, retry advised by Prisma
  "P2002", // lost a unique-constraint race; the winner is re-read on the next attempt
]);

const MAX_PERSIST_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_PRISMA_CODES.has(error.code);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Where a batch came from, as it was AT THE MOMENT OF INGESTION.
 *
 * Required, not optional. A batch stored without provenance can never be projected —
 * projection refuses it with SOURCE_PROVENANCE_NOT_CONFIGURED rather than guessing — so
 * making the caller supply it is the difference between a usable batch and a dead one.
 */
export interface RawIngestionProvenance {
  readonly effectiveSourceState: string;
  readonly providerId: string | null;
}

export interface RawIngestionOptions {
  readonly mode: RawIngestionMode;
  readonly db: RawIngestionDb;
  readonly provenance: RawIngestionProvenance;
  /** Optional soft correlation to an existing sync run. Never written back to it. */
  readonly integrationSyncRunId?: string | null;
}

const STORED_BATCH_SELECT = {
  id: true,
  status: true,
  batchHash: true,
  conflictsWithBatchId: true,
  rowsReceived: true,
  rowsAccepted: true,
  rowsQuarantined: true,
  rowsRejected: true,
  rowsWithDrift: true,
} as const;

/** Deterministic "earliest first" ordering; the id breaks ties on equal timestamps. */
const EARLIEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }];

/** Holding the lock for the whole batch insert needs more than Prisma's 5s default. */
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

/**
 * Ingests one provider batch.
 *
 * DRY_RUN validates, encodes and fingerprints, and writes nothing at all — no batch,
 * no row, no checkpoint, no audit record.
 *
 * PERSIST stores the batch and its rows in one transaction, serialized per ingestion
 * identity. Re-submitting identical content returns the stored ingestion untouched;
 * re-using a provider batch id with different content is stored separately and flagged
 * as a conflict against the earliest committed original rather than overwriting it.
 */
export async function ingestFantasyRawBatch(
  batch: FantasySourceBatch,
  options: RawIngestionOptions,
): Promise<RawIngestionResult> {
  const prepared = prepareBatch(batch);

  const base = {
    mode: options.mode,
    contractVersion: prepared.contractVersion,
    encodingVersion: FANTASY_RAW_ENCODING_V2,
    sourceMode: batch.sourceMode,
    providerBatchId: batch.batchId,
    batchHash: prepared.batchHash,
    counts: prepared.counts,
    diagnostics: prepared.diagnostics,
    rowOutcomes: summarize(prepared),
    droppedMetadataKeyCount: prepared.droppedMetadataKeyCount,
  } as const;

  if (options.mode === "DRY_RUN") {
    return {
      ...base,
      status: prepared.status,
      idempotentReplay: false,
      conflict: false,
      conflictsWithBatchId: null,
      batchId: null,
    };
  }

  const identity: IngestionIdentity = {
    sourceMode: batch.sourceMode,
    contractVersion: prepared.contractVersion,
    providerBatchId: batch.batchId,
  };
  const lockKey = advisoryLockKey(identity);

  for (let attempt = 1; attempt <= MAX_PERSIST_ATTEMPTS; attempt++) {
    try {
      return await options.db.$transaction(
        (tx) => persistWithinIdentityLock(tx, { batch, prepared, identity, lockKey, base, options }),
        TRANSACTION_OPTIONS,
      );
    } catch (error) {
      if (attempt < MAX_PERSIST_ATTEMPTS && isRetryable(error)) continue;
      // Never surface a driver or constraint message: it can quote stored values, and
      // it can name the provider batch id.
      throw new FantasyRawIngestionError(
        "RAW_INGESTION_PERSIST_FAILED",
        "The raw Fantasy batch could not be stored. No partial batch was committed.",
      );
    }
  }

  throw new FantasyRawIngestionError(
    "RAW_INGESTION_PERSIST_FAILED",
    "The raw Fantasy batch could not be stored. No partial batch was committed.",
  );
}

/**
 * Everything that decides and records this batch's identity, inside one transaction and
 * behind the identity lock.
 */
async function persistWithinIdentityLock(
  tx: RawIngestionTx,
  context: {
    batch: FantasySourceBatch;
    prepared: PreparedBatch;
    identity: IngestionIdentity;
    lockKey: bigint;
    base: Omit<RawIngestionResult, "status" | "idempotentReplay" | "conflict" | "conflictsWithBatchId" | "batchId">;
    options: RawIngestionOptions;
  },
): Promise<RawIngestionResult> {
  const { batch, prepared, identity, lockKey, base, options } = context;

  // Bound parameter, never string interpolation. Waiting here is the point: the next
  // submission for this identity only reads after the previous one has committed.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

  // Exact replay: identical content under the same provider batch id.
  const existing = await tx.fantasyRawBatch.findFirst({
    where: { ...identity, batchHash: prepared.batchHash },
    select: { ...STORED_BATCH_SELECT },
  });
  if (existing) return replayResult(base, existing);

  // The original is the earliest committed non-conflict batch for this identity. Any
  // other payload under the same provider batch id is recorded against it.
  const original = await tx.fantasyRawBatch.findFirst({
    where: { ...identity, status: { not: "CONFLICT" } },
    orderBy: EARLIEST_FIRST,
    select: { ...STORED_BATCH_SELECT },
  });

  const status: RawBatchStatus = original ? "CONFLICT" : prepared.status;
  const startedAt = new Date();

  const created = await tx.fantasyRawBatch.create({
    data: {
      contractVersion: prepared.contractVersion,
      encodingVersion: FANTASY_RAW_ENCODING_V2,
      sourceMode: batch.sourceMode,
      providerBatchId: batch.batchId,
      batchHash: prepared.batchHash,
      headersJson: prepared.headersJson,
      cursorKind: batch.cursor.kind,
      cursorTokenHash: prepared.cursorTokenHash,
      providerMetadataJson: prepared.providerMetadataJson,
      processingMode: "PERSIST",
      status,
      processingStartedAt: startedAt,
      processingCompletedAt: new Date(),
      rowsReceived: prepared.counts.received,
      rowsAccepted: prepared.counts.accepted,
      rowsQuarantined: prepared.counts.quarantined,
      rowsRejected: prepared.counts.rejected,
      rowsWithDrift: prepared.counts.withDrift,
      diagnosticsJson: diagnosticsJson(prepared.diagnostics.issues),
      conflictsWithBatchId: original?.id ?? null,
      integrationSyncRunId: options.integrationSyncRunId ?? null,
      // Bound to this batch forever. Re-projecting it years later must classify it under
      // the provenance it actually arrived with, not whatever is configured then.
      effectiveSourceStateAtIngestion: options.provenance.effectiveSourceState,
      providerIdAtIngestion: options.provenance.providerId,
    },
  });

  if (prepared.rows.length > 0) {
    await tx.fantasyRawRow.createMany({
      data: prepared.rows.map((r) => ({
        batchId: created.id,
        sourceRowNumber: r.sourceRowNumber,
        encodingVersion: FANTASY_RAW_ENCODING_V2,
        rawPayloadJson: r.rawPayloadJson,
        normalizedRecordJson: r.normalizedRecordJson,
        rowHash: r.rowHash,
        outcome: r.outcome,
        diagnosticsJson: r.diagnosticsJson,
        quarantineReasonCodes: r.quarantineReasonCodes.length ? r.quarantineReasonCodes.join(",") : null,
      })),
    });
  }

  return {
    ...base,
    status,
    idempotentReplay: false,
    conflict: Boolean(original),
    conflictsWithBatchId: original?.id ?? null,
    batchId: created.id,
  };
}

function replayResult(
  base: Omit<RawIngestionResult, "status" | "idempotentReplay" | "conflict" | "conflictsWithBatchId" | "batchId">,
  stored: StoredBatch,
): RawIngestionResult {
  const status = stored.status as RawBatchStatus;
  return {
    ...base,
    status,
    idempotentReplay: true,
    conflict: status === "CONFLICT",
    // Replay reports what is stored, so a replayed conflict still names its original.
    conflictsWithBatchId: stored.conflictsWithBatchId,
    batchId: stored.id,
    // Counts come from what is actually stored, not from this re-validation.
    counts: {
      received: stored.rowsReceived,
      accepted: stored.rowsAccepted,
      quarantined: stored.rowsQuarantined,
      rejected: stored.rowsRejected,
      withDrift: stored.rowsWithDrift,
    },
  };
}
