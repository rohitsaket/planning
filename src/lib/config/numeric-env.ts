/**
 * NUMERIC ENVIRONMENT CONFIGURATION — one validated place where a number from the
 * environment becomes a number the code may rely on.
 *
 * Every numeric setting in this codebase used to be written the same way:
 *
 *   const LIMIT = Number(process.env.SOME_MAX || 20_000);
 *
 * `Number("abc")` is `NaN`, and `NaN` poisons everything downstream without ever failing.
 * The export ceilings showed it plainly: `Math.min(total, NaN)` is `NaN`,
 * `rows.length < NaN` is false so the fetch loop never runs, and `total > NaN` is also
 * false so the response says the export is complete. A single typo in an environment
 * variable produced an empty file labelled as the full result. The same shape sets a
 * session lifetime, a pagination ceiling and a lock lease, where a `NaN` is worse than a
 * wrong number: an expiry computed from it is an invalid date, and a limit compared
 * against it never triggers.
 *
 * `Infinity` fails the other way: the ceiling disappears and one request may read an
 * entire table, or a lease may never expire.
 *
 * So a value is resolved here, validated, and never taken on trust. An unusable
 * configuration does not take the application down and does not silently win: the
 * approved built-in default is used instead, the refusal is recorded on the resolved
 * value, and it is logged once so an operator can see it.
 *
 * Server-only. These values describe internal capacity and are never sent to a browser.
 */

import { log } from "@/lib/api/log";

if (typeof window !== "undefined") {
  throw new Error("config/numeric-env is server-only and must not be imported by client code.");
}

/** Why a configured value was refused. Each is a distinct, checkable condition. */
export const NUMERIC_ENV_REJECTIONS = [
  "NOT_A_NUMBER",
  "NOT_FINITE",
  "NOT_AN_INTEGER",
  "NOT_POSITIVE",
  "ABOVE_MAXIMUM",
] as const;
export type NumericEnvRejection = (typeof NUMERIC_ENV_REJECTIONS)[number];

export interface NumericEnvValue {
  /** The environment variable this value reads. */
  readonly variable: string;
  /** The value to use. Always a positive, finite, whole number at or below the maximum. */
  readonly value: number;
  readonly source: "ENVIRONMENT" | "DEFAULT";
  /** True when a value was present and had to be refused. */
  readonly configurationRejected: boolean;
  readonly rejection: NumericEnvRejection | null;
}

export interface NumericEnvBounds {
  /** The built-in value used when nothing is configured or the configuration is refused. */
  readonly fallback: number;
  /** The largest value any configuration may set. */
  readonly max: number;
}

/**
 * Validates one configured value.
 *
 * A value is usable only when it is a finite whole number greater than zero and at or
 * below `max`. Everything else — an empty string, text, a decimal, zero, a negative
 * number, `Infinity`, or a number past the maximum — is refused.
 *
 * `Number("")` is `0` and `Number(" ")` is also `0`, so a blank value would otherwise pass
 * the numeric test and then fail the positive test. It is reported as a refusal rather
 * than treated as "unset", because a variable that is present and empty is a deployment
 * mistake worth seeing. Genuinely unset — `undefined` — is not a refusal: it simply means
 * the built-in default applies.
 */
export function validateNumericEnv(
  variable: string,
  raw: string | undefined | null,
  bounds: NumericEnvBounds,
): NumericEnvValue {
  const fallback = (rejection: NumericEnvRejection | null): NumericEnvValue => ({
    variable,
    value: bounds.fallback,
    source: "DEFAULT",
    configurationRejected: rejection !== null,
    rejection,
  });

  if (raw === undefined || raw === null) return fallback(null);

  const trimmed = String(raw).trim();
  if (trimmed === "") return fallback("NOT_A_NUMBER");

  // `Number` accepts "Infinity", "1e400" and leading/trailing space, and rejects trailing
  // text. Each outcome is checked explicitly rather than assumed away.
  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return fallback("NOT_A_NUMBER");
  if (!Number.isFinite(parsed)) return fallback("NOT_FINITE");
  if (!Number.isInteger(parsed)) return fallback("NOT_AN_INTEGER");
  if (parsed <= 0) return fallback("NOT_POSITIVE");
  if (parsed > bounds.max) return fallback("ABOVE_MAXIMUM");

  return { variable, value: parsed, source: "ENVIRONMENT", configurationRejected: false, rejection: null };
}

/** Every value resolved in this process, so a refusal can be reported and audited. */
const resolved: NumericEnvValue[] = [];

/**
 * Resolves a value from the environment, normally at module load.
 *
 * The refusal is logged with the variable name, the reason and the value actually in
 * force. The configured value itself is never logged: it came from the environment, and
 * environment values are not written to logs.
 */
export function resolveNumericEnv(variable: string, bounds: NumericEnvBounds): NumericEnvValue {
  if (!Number.isInteger(bounds.fallback) || bounds.fallback <= 0 || bounds.fallback > bounds.max) {
    // A bad built-in default is a programming error, not a deployment problem, and there
    // is no safe value to fall back to.
    throw new Error(`Configuration default for ${variable} is not a usable value.`);
  }

  const value = validateNumericEnv(variable, process.env[variable], bounds);
  if (value.configurationRejected) {
    log("warn", "numeric_configuration_rejected", {
      variable: value.variable,
      reason: value.rejection,
      appliedValue: value.value,
      maximum: bounds.max,
    });
  }
  resolved.push(value);
  return value;
}

/** The values this process resolved, for a diagnostic surface. Never sent to a browser. */
export function resolvedNumericEnv(): readonly NumericEnvValue[] {
  return resolved;
}
