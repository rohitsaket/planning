import { resolveNumericEnv, type NumericEnvBounds } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-config is server-only and must not be imported by client code.");
}

export const SARIN_OUTPUT_BOUNDS = {
  SARIN_OUTPUT_TRANSACTION_TIMEOUT_MS: { fallback: 600_000, max: 1_800_000 },
  SARIN_OUTPUT_WRITE_BATCH: { fallback: 200, max: 2000 },
  SARIN_OUTPUT_EXPORT_MAX_ROWS: { fallback: 150_000, max: 500_000 },
} as const satisfies Record<string, NumericEnvBounds>;

export const OUTPUT_LOCK_WAIT_MS = 30_000;

export interface SarinOutputConfig {
  readonly transactionTimeoutMs: number;
  readonly writeBatch: number;
  readonly lockWaitMs: number;
}

export const SARIN_OUTPUT_CONFIG: SarinOutputConfig = {
  transactionTimeoutMs: resolveNumericEnv("SARIN_OUTPUT_TRANSACTION_TIMEOUT_MS", SARIN_OUTPUT_BOUNDS.SARIN_OUTPUT_TRANSACTION_TIMEOUT_MS).value,
  writeBatch: resolveNumericEnv("SARIN_OUTPUT_WRITE_BATCH", SARIN_OUTPUT_BOUNDS.SARIN_OUTPUT_WRITE_BATCH).value,
  lockWaitMs: OUTPUT_LOCK_WAIT_MS,
};

export const SARIN_OUTPUT_EXPORT_MAX_ROWS = resolveNumericEnv("SARIN_OUTPUT_EXPORT_MAX_ROWS", SARIN_OUTPUT_BOUNDS.SARIN_OUTPUT_EXPORT_MAX_ROWS).value;
