/**
 * Sarin validation limits — resolved once, validated, never taken on trust.
 *
 * The claim lease is derived, not configured: it is always the transaction timeout plus a
 * fixed margin, so a worker that is still inside its transaction can never have its claim
 * reclaimed by another. A worker that crashed is reclaimable once the lease has passed.
 *
 * Server-only.
 */

import { resolveNumericEnv, type NumericEnvBounds } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("sarin/validation-config is server-only and must not be imported by client code.");
}

export const SARIN_VALIDATION_BOUNDS = {
  /** Upper bound on one validation attempt's transaction. */
  SARIN_VALIDATION_TRANSACTION_TIMEOUT_MS: { fallback: 600_000, max: 1_800_000 },
  /** Blocks per write round; their interpretations and findings are written with them. */
  SARIN_VALIDATION_WRITE_BATCH: { fallback: 500, max: 5000 },
} as const satisfies Record<string, NumericEnvBounds>;

/** Time beyond the transaction timeout before an unfinished claim may be reclaimed. */
export const LEASE_MARGIN_MS = 5 * 60_000;
/** Source rows read per query while an attempt streams through the file. */
export const SOURCE_READ_PAGE = 5000;
/** A mapping set larger than this is refused rather than loaded. */
export const MAX_RULES_PER_SET = 10_000;

export interface SarinValidationConfig {
  readonly transactionTimeoutMs: number;
  readonly leaseMs: number;
  readonly writeBatch: number;
}

const timeout = resolveNumericEnv("SARIN_VALIDATION_TRANSACTION_TIMEOUT_MS", SARIN_VALIDATION_BOUNDS.SARIN_VALIDATION_TRANSACTION_TIMEOUT_MS).value;

export const SARIN_VALIDATION_CONFIG: SarinValidationConfig = {
  transactionTimeoutMs: timeout,
  leaseMs: timeout + LEASE_MARGIN_MS,
  writeBatch: resolveNumericEnv("SARIN_VALIDATION_WRITE_BATCH", SARIN_VALIDATION_BOUNDS.SARIN_VALIDATION_WRITE_BATCH).value,
};
