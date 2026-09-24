/**
 * EXPORT ROW LIMITS — the one place an export ceiling comes from.
 *
 * The validation itself is `numeric-env.ts`, which every numeric setting shares. What
 * belongs here is the part specific to exports: the ceiling past which a single export
 * stops being an export, and the names the export readers import.
 *
 * Server-only.
 */

import { resolveNumericEnv, validateNumericEnv, type NumericEnvRejection, type NumericEnvValue } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("config/export-limits is server-only and must not be imported by client code.");
}

/**
 * The largest ceiling any export configuration may set.
 *
 * It is not a business rule: it is the point beyond which one export becomes a table scan
 * that will exhaust memory or time out. A deployment that genuinely needs more rows than
 * this needs a different mechanism, not a larger number.
 */
export const EXPORT_ROW_LIMIT_MAX = 250_000;

export type ExportLimitRejection = NumericEnvRejection;

export interface ExportRowLimit {
  readonly variable: string;
  /** The ceiling to use. Always a positive, finite, whole number at or below the maximum. */
  readonly rows: number;
  readonly source: NumericEnvValue["source"];
  readonly configurationRejected: boolean;
  readonly rejection: ExportLimitRejection | null;
}

function toLimit(v: NumericEnvValue): ExportRowLimit {
  return {
    variable: v.variable,
    rows: v.value,
    source: v.source,
    configurationRejected: v.configurationRejected,
    rejection: v.rejection,
  };
}

/** Validates one configured row ceiling without reading the environment. */
export function validateExportRowLimit(
  variable: string,
  raw: string | undefined,
  fallbackRows: number,
): ExportRowLimit {
  return toLimit(validateNumericEnv(variable, raw, { fallback: fallbackRows, max: EXPORT_ROW_LIMIT_MAX }));
}

/**
 * Resolves an export ceiling from the environment at module load.
 *
 * An unusable value is refused and the approved default applies, so the arithmetic in
 * every export reader — `Math.min(total, limit)`, `rows.length < target`,
 * `total > limit` — always has a real number to work with. That is the whole point: a
 * zero-row export can never be reported as complete because the ceiling was unreadable.
 */
export function resolveExportRowLimit(variable: string, fallbackRows: number): ExportRowLimit {
  return toLimit(resolveNumericEnv(variable, { fallback: fallbackRows, max: EXPORT_ROW_LIMIT_MAX }));
}
