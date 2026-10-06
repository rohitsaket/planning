import { createHash } from "node:crypto";
import type { FantasySourceValue } from "@/lib/fantasy/row-contract";

if (typeof window !== "undefined") {
  throw new Error("fantasy/raw-encoding is server-only and must not be imported by client code.");
}

export const FANTASY_RAW_ENCODING_V1 = "FANTASY_RAW_ENCODING_V1";
export const FANTASY_RAW_ENCODING_V2 = "FANTASY_RAW_ENCODING_V2";
export const FANTASY_RAW_ENCODING_CURRENT = FANTASY_RAW_ENCODING_V2;

export type FantasyEncodedCell =
  | { readonly type: "undefined" }
  | { readonly type: "null" }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "unsupported"; readonly valueType: string };

export const UNSUPPORTED_VALUE = Symbol("fantasy.unsupportedValue");

export type FantasyDecodedValue = FantasySourceValue | typeof UNSUPPORTED_VALUE;

function unsupportedTypeName(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : "non-finite-number";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (value instanceof Date) return "date";
  if (typeof value === "object") return "object";
  return typeof value;
}

export function encodeCell(value: unknown): FantasyEncodedCell {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { type: "number", value }
      : { type: "unsupported", valueType: unsupportedTypeName(value) };
  }
  return { type: "unsupported", valueType: unsupportedTypeName(value) };
}

export function decodeCell(cell: FantasyEncodedCell): FantasyDecodedValue {
  switch (cell.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "string":
      return cell.value;
    case "number":
      return cell.value;
    case "boolean":
      return cell.value;
    case "unsupported":
      return UNSUPPORTED_VALUE;
  }
}

export function isUnsupportedCell(cell: FantasyEncodedCell): boolean {
  return cell.type === "unsupported";
}

export function encodePositionalRow(row: readonly unknown[]): FantasyEncodedCell[] {
  return row.map(encodeCell);
}

export function encodeKeyedRecord(record: Readonly<Record<string, unknown>>): Record<string, FantasyEncodedCell> {
  const out: Record<string, FantasyEncodedCell> = {};
  for (const [key, value] of Object.entries(record)) out[key] = encodeCell(value);
  return out;
}

export function decodePositionalRow(cells: readonly FantasyEncodedCell[]): FantasyDecodedValue[] {
  return cells.map(decodeCell);
}

export function decodeKeyedRecord(cells: Readonly<Record<string, FantasyEncodedCell>>): Record<string, FantasyDecodedValue> {
  const out: Record<string, FantasyDecodedValue> = {};
  for (const [key, cell] of Object.entries(cells)) out[key] = decodeCell(cell);
  return out;
}

export type FantasyEncodedSourceRow =
  | { readonly form: "POSITIONAL"; readonly cells: readonly FantasyEncodedCell[] }
  | { readonly form: "KEYED"; readonly fields: Readonly<Record<string, FantasyEncodedCell>> };

export type FantasyDecodedSourceRow =
  | { readonly form: "POSITIONAL"; readonly cells: FantasyDecodedValue[] }
  | { readonly form: "KEYED"; readonly fields: Record<string, FantasyDecodedValue> };

export function encodeSourceRow(row: readonly unknown[] | Readonly<Record<string, unknown>>): FantasyEncodedSourceRow {
  return Array.isArray(row)
    ? { form: "POSITIONAL", cells: encodePositionalRow(row) }
    : { form: "KEYED", fields: encodeKeyedRecord(row as Readonly<Record<string, unknown>>) };
}

export function decodeSourceRow(row: FantasyEncodedSourceRow): FantasyDecodedSourceRow {
  return row.form === "POSITIONAL"
    ? { form: "POSITIONAL", cells: decodePositionalRow(row.cells) }
    : { form: "KEYED", fields: decodeKeyedRecord(row.fields) };
}

export function sourceRowHasUnsupportedCell(row: FantasyEncodedSourceRow): boolean {
  return row.form === "POSITIONAL"
    ? row.cells.some(isUnsupportedCell)
    : Object.values(row.fields).some(isUnsupportedCell);
}

export function encodeHeaders(headers: readonly unknown[]): FantasyEncodedCell[] {
  return headers.map(encodeCell);
}

export function decodeHeaders(headers: readonly FantasyEncodedCell[]): FantasyDecodedValue[] {
  return headers.map(decodeCell);
}

export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

export type CanonicalSafe =
  | CanonicalValue
  | FantasyEncodedCell
  | readonly FantasyEncodedCell[]
  | Readonly<Record<string, FantasyEncodedCell>>
  | FantasyEncodedSourceRow;

export function canonicalJson(value: CanonicalSafe): string {
  return JSON.stringify(sortValue(value as CanonicalValue));
}

function sortValue(value: CanonicalValue): CanonicalValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: CanonicalValue } = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key]);
    return sorted;
  }
  return value;
}

function canonicalOf(value: unknown): CanonicalValue {
  return value as CanonicalValue;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export type FantasyBatchHashInput =
  | {
      readonly encodingVersion: typeof FANTASY_RAW_ENCODING_V1;
      readonly contractVersion: string;
      readonly headers: readonly (string | null)[];
      readonly rows: readonly (readonly FantasyEncodedCell[])[];
    }
  | {
      readonly encodingVersion: typeof FANTASY_RAW_ENCODING_V2;
      readonly contractVersion: string;
      readonly headers: readonly FantasyEncodedCell[];
      readonly rows: readonly FantasyEncodedSourceRow[];
    };

export function computeBatchHash(input: FantasyBatchHashInput): string {
  return sha256Hex(
    canonicalJson({
      encodingVersion: input.encodingVersion,
      contractVersion: input.contractVersion,
      headers: canonicalOf(input.headers),
      rows: canonicalOf(input.rows),
    }),
  );
}

export type FantasyRowHashInput =
  | {
      readonly encodingVersion: typeof FANTASY_RAW_ENCODING_V1;
      readonly contractVersion: string;
      readonly keyed?: Readonly<Record<string, FantasyEncodedCell>> | null;
      readonly positional?: readonly FantasyEncodedCell[] | null;
    }
  | {
      readonly encodingVersion: typeof FANTASY_RAW_ENCODING_V2;
      readonly contractVersion: string;
      readonly row: FantasyEncodedSourceRow;
    };

export function computeRowHash(input: FantasyRowHashInput): string {
  const body: { [key: string]: CanonicalValue } =
    input.encodingVersion === FANTASY_RAW_ENCODING_V1
      ? input.keyed
        ? { form: "keyed", cells: canonicalOf(input.keyed) }
        : { form: "positional", cells: canonicalOf(input.positional ?? []) }
      : { row: canonicalOf(input.row) };

  return sha256Hex(
    canonicalJson({
      encodingVersion: input.encodingVersion,
      contractVersion: input.contractVersion,
      ...body,
    }),
  );
}

export class FantasyRawEncodingError extends Error {
  readonly code = "RAW_ENCODING_UNREADABLE";
  constructor(message: string) {
    super(message);
    this.name = "FantasyRawEncodingError";
  }
}

export function decodeStoredSourceRow(rawPayloadJson: string, encodingVersion: string): FantasyDecodedSourceRow {
  const parsed: unknown = JSON.parse(rawPayloadJson);

  if (encodingVersion === FANTASY_RAW_ENCODING_V1) {
    if (!Array.isArray(parsed)) throw new FantasyRawEncodingError("Stored V1 raw payload is not a positional cell array.");
    return { form: "POSITIONAL", cells: decodePositionalRow(parsed as FantasyEncodedCell[]) };
  }

  if (encodingVersion === FANTASY_RAW_ENCODING_V2) {
    const row = parsed as FantasyEncodedSourceRow | null;
    if (row && (row.form === "POSITIONAL" || row.form === "KEYED")) return decodeSourceRow(row);
    throw new FantasyRawEncodingError("Stored V2 raw payload has no recognized row form.");
  }

  throw new FantasyRawEncodingError("Stored raw payload uses an unknown encoding version.");
}

export function decodeStoredHeaders(headersJson: string, encodingVersion: string): FantasyDecodedValue[] {
  const parsed: unknown = JSON.parse(headersJson);
  if (!Array.isArray(parsed)) throw new FantasyRawEncodingError("Stored header payload is not an array.");

  if (encodingVersion === FANTASY_RAW_ENCODING_V1) {
    return (parsed as (string | null)[]).map((h) => (typeof h === "string" ? h : null));
  }

  if (encodingVersion === FANTASY_RAW_ENCODING_V2) {
    return decodeHeaders(parsed as FantasyEncodedCell[]);
  }

  throw new FantasyRawEncodingError("Stored header payload uses an unknown encoding version.");
}
