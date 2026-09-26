/**
 * Sarin CSV ingestion limits — resolved once, validated, never taken on trust.
 *
 * The request body of an upload passes through the Next.js proxy (src/proxy.ts matches
 * /api/*). The proxy buffers at most `proxyClientMaxBodySize` bytes — 10 MB, because this
 * project does not configure it — and beyond that it silently hands the route a truncated
 * body. The upload route therefore refuses any request whose declared length exceeds the
 * file limit plus a fixed multipart allowance, and the file limit itself can never be
 * configured high enough for that sum to reach the proxy cap. A truncated upload is
 * impossible rather than merely unlikely.
 *
 * If next.config.ts ever sets `experimental.proxyClientMaxBodySize`, update
 * PROXY_BODY_LIMIT_BYTES to the same value.
 *
 * Server-only.
 */

import { resolveNumericEnv, type NumericEnvBounds } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("sarin/ingestion-config is server-only and must not be imported by client code.");
}

/** The Next.js default proxy body buffer (proxyClientMaxBodySize), in bytes. */
export const PROXY_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

/** Room for multipart boundaries, part headers and the four metadata fields. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const SARIN_INGESTION_BOUNDS = {
  /** 8 MiB holds roughly 130,000 Sarin records — the largest reference output is 116,460 rows. */
  SARIN_IMPORT_MAX_FILE_BYTES: { fallback: 8 * 1024 * 1024, max: PROXY_BODY_LIMIT_BYTES - MULTIPART_OVERHEAD_BYTES },
  SARIN_IMPORT_MAX_RECORDS: { fallback: 150_000, max: 500_000 },
  /** A Sarin record is ~60 bytes; 4 KiB is far above any real line. */
  SARIN_IMPORT_MAX_LINE_BYTES: { fallback: 4096, max: 65_536 },
  /** Capped at 256 because a Stone Name longer than that cannot form a stone block. */
  SARIN_IMPORT_MAX_FIELD_CHARS: { fallback: 256, max: 256 },
  /** Rows per INSERT statement inside the ingestion transaction. */
  SARIN_IMPORT_ROW_INSERT_BATCH: { fallback: 1000, max: 5000 },
  /** Upper bound on the ingestion transaction, including time spent waiting on a concurrent identical upload. */
  SARIN_IMPORT_TRANSACTION_TIMEOUT_MS: { fallback: 120_000, max: 600_000 },
} as const satisfies Record<string, NumericEnvBounds>;

export interface SarinIngestionLimits {
  readonly maxFileBytes: number;
  /** Largest acceptable request body: the file plus the multipart allowance. */
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
