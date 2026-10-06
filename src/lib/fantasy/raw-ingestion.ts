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

export const ALLOWED_PROVIDER_METADATA_KEYS = [
  "providerName",
  "datasetId",
  "environment",
  "apiVersion",
  "deliveryKind",
] as const;

export class FantasyRawIngestionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FantasyRawIngestionError";
    this.code = code;
  }
}

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
  readonly idempotentReplay: boolean;
  readonly conflict: boolean;
  readonly conflictsWithBatchId: string | null;
  readonly batchId: string | null;
  readonly counts: {
    readonly received: number;
    readonly accepted: number;
    readonly quarantined: number;
    readonly rejected: number;
    readonly withDrift: number;
  };
  readonly diagnostics: ReturnType<typeof toContractDiagnostics>;
  readonly rowOutcomes: readonly RawRowOutcomeSummary[];
  readonly droppedMetadataKeyCount: number;
}

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
    else dropped++;
  }
  return { json: Object.keys(allowed).length ? canonicalJson(allowed) : null, droppedKeyCount: dropped };
}

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

function prepareBatch(batch: FantasySourceBatch): PreparedBatch {
  const validation = validateFantasySourceBatch(batch);
  const contractVersion = validation.contractVersion;
  const headerOk = validation.headerValidation.ok;

  const batchDriftCodes = validation.headerValidation.issues
    .filter((i) => i.severity === "DRIFT")
    .map((i) => i.code);

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

interface IngestionIdentity {
  readonly sourceMode: string;
  readonly contractVersion: string;
  readonly providerBatchId: string;
}

function advisoryLockKey(identity: IngestionIdentity): bigint {
  const digest = sha256Hex(
    canonicalJson({
      scope: "fantasy.raw-ingestion.identity",
      sourceMode: identity.sourceMode,
      contractVersion: identity.contractVersion,
      providerBatchId: identity.providerBatchId,
    }),
  );
  return BigInt.asIntN(64, BigInt(`0x${digest.slice(0, 16)}`));
}

const RETRYABLE_PRISMA_CODES = new Set([
  "P2034",
  "P2002",
]);

const MAX_PERSIST_ATTEMPTS = 3;

function isRetryable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_PRISMA_CODES.has(error.code);
}

export interface RawIngestionProvenance {
  readonly effectiveSourceState: string;
  readonly providerId: string | null;
}

export interface RawIngestionOptions {
  readonly mode: RawIngestionMode;
  readonly db: RawIngestionDb;
  readonly provenance: RawIngestionProvenance;
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

const EARLIEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }];

const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 30_000 };

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

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;

  const existing = await tx.fantasyRawBatch.findFirst({
    where: { ...identity, batchHash: prepared.batchHash },
    select: { ...STORED_BATCH_SELECT },
  });
  if (existing) return replayResult(base, existing);

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
    conflictsWithBatchId: stored.conflictsWithBatchId,
    batchId: stored.id,
    counts: {
      received: stored.rowsReceived,
      accepted: stored.rowsAccepted,
      quarantined: stored.rowsQuarantined,
      rejected: stored.rowsRejected,
      withDrift: stored.rowsWithDrift,
    },
  };
}
