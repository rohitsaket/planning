import { resolveNumericEnv, validateNumericEnv, type NumericEnvRejection, type NumericEnvValue } from "@/lib/config/numeric-env";

if (typeof window !== "undefined") {
  throw new Error("config/export-limits is server-only and must not be imported by client code.");
}

export const EXPORT_ROW_LIMIT_MAX = 250_000;

export type ExportLimitRejection = NumericEnvRejection;

export interface ExportRowLimit {
  readonly variable: string;
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

export function validateExportRowLimit(
  variable: string,
  raw: string | undefined,
  fallbackRows: number,
): ExportRowLimit {
  return toLimit(validateNumericEnv(variable, raw, { fallback: fallbackRows, max: EXPORT_ROW_LIMIT_MAX }));
}

export function resolveExportRowLimit(variable: string, fallbackRows: number): ExportRowLimit {
  return toLimit(resolveNumericEnv(variable, { fallback: fallbackRows, max: EXPORT_ROW_LIMIT_MAX }));
}
