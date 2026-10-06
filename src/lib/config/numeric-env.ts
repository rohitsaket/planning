import { log } from "@/lib/api/log";

if (typeof window !== "undefined") {
  throw new Error("config/numeric-env is server-only and must not be imported by client code.");
}

export const NUMERIC_ENV_REJECTIONS = [
  "NOT_A_NUMBER",
  "NOT_FINITE",
  "NOT_AN_INTEGER",
  "NOT_POSITIVE",
  "ABOVE_MAXIMUM",
] as const;
export type NumericEnvRejection = (typeof NUMERIC_ENV_REJECTIONS)[number];

export interface NumericEnvValue {
  readonly variable: string;
  readonly value: number;
  readonly source: "ENVIRONMENT" | "DEFAULT";
  readonly configurationRejected: boolean;
  readonly rejection: NumericEnvRejection | null;
}

export interface NumericEnvBounds {
  readonly fallback: number;
  readonly max: number;
}

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

  const parsed = Number(trimmed);
  if (Number.isNaN(parsed)) return fallback("NOT_A_NUMBER");
  if (!Number.isFinite(parsed)) return fallback("NOT_FINITE");
  if (!Number.isInteger(parsed)) return fallback("NOT_AN_INTEGER");
  if (parsed <= 0) return fallback("NOT_POSITIVE");
  if (parsed > bounds.max) return fallback("ABOVE_MAXIMUM");

  return { variable, value: parsed, source: "ENVIRONMENT", configurationRejected: false, rejection: null };
}

const resolved: NumericEnvValue[] = [];

export function resolveNumericEnv(variable: string, bounds: NumericEnvBounds): NumericEnvValue {
  if (!Number.isInteger(bounds.fallback) || bounds.fallback <= 0 || bounds.fallback > bounds.max) {
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

export function resolvedNumericEnv(): readonly NumericEnvValue[] {
  return resolved;
}
