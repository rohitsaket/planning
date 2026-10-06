import { resolveNumericEnv, type NumericEnvBounds } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("sarin/ingestion-config is server-only and must not be imported by client code.");
}

export const PROXY_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const SARIN_INGESTION_BOUNDS = {
  SARIN_IMPORT_MAX_FILE_BYTES: { fallback: 8 * 1024 * 1024, max: PROXY_BODY_LIMIT_BYTES - MULTIPART_OVERHEAD_BYTES },
  SARIN_IMPORT_MAX_RECORDS: { fallback: 150_000, max: 500_000 },
  SARIN_IMPORT_MAX_LINE_BYTES: { fallback: 4096, max: 65_536 },
  SARIN_IMPORT_MAX_FIELD_CHARS: { fallback: 256, max: 256 },
  SARIN_IMPORT_ROW_INSERT_BATCH: { fallback: 1000, max: 5000 },
  SARIN_IMPORT_TRANSACTION_TIMEOUT_MS: { fallback: 120_000, max: 600_000 },
} as const satisfies Record<string, NumericEnvBounds>;

export interface SarinIngestionLimits {
  readonly maxFileBytes: number;
  readonly maxRequestBytes: number;
  readonly maxRecords: number;
  readonly maxLineBytes: number;
  readonly maxFieldChars: number;
  readonly rowInsertBatchSize: number;
  readonly transactionTimeoutMs: number;
}

const value = (name: keyof typeof SARIN_INGESTION_BOUNDS) => resolveNumericEnv(name, SARIN_INGESTION_BOUNDS[name]).value;

const maxFileBytes = value("SARIN_IMPORT_MAX_FILE_BYTES");

export const SARIN_INGESTION_LIMITS: SarinIngestionLimits = {
  maxFileBytes,
  maxRequestBytes: maxFileBytes + MULTIPART_OVERHEAD_BYTES,
  maxRecords: value("SARIN_IMPORT_MAX_RECORDS"),
  maxLineBytes: value("SARIN_IMPORT_MAX_LINE_BYTES"),
  maxFieldChars: value("SARIN_IMPORT_MAX_FIELD_CHARS"),
  rowInsertBatchSize: value("SARIN_IMPORT_ROW_INSERT_BATCH"),
  transactionTimeoutMs: value("SARIN_IMPORT_TRANSACTION_TIMEOUT_MS"),
};
