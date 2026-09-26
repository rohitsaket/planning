/**
 * Sarin output generation limits — resolved once, validated, never taken on trust.
 *
 * Server-only.
 */

import { resolveNumericEnv, type NumericEnvBounds } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-config is server-only and must not be imported by client code.");
}

export const SARIN_OUTPUT_BOUNDS = {
  /** Upper bound on one output generation's transaction. */
  SARIN_OUTPUT_TRANSACTION_TIMEOUT_MS: { fallback: 600_000, max: 1_800_000 },
  /** Stones read and written per round; their options and pieces are written with them. */
  SARIN_OUTPUT_WRITE_BATCH: { fallback: 200, max: 2000 },
} as const satisfies Record<string, NumericEnvBounds>;

/**
 * How long a generation waits for another generation (or validation claim) of the same
 * batch to finish before answering 409. A waiter that gets the lock re-reads everything.
 */
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
