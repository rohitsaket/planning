/**
 * FANTASY RAW ENCODING — deterministic, type-tagged preservation of source values.
 *
 * Raw Fantasy cells are stored as canonical JSON text (this project stores JSON in
 * String columns, so there is no Prisma JSON coercion to reason about). Every cell
 * carries its own type tag, which keeps five states that JSON alone would blur —
 * missing, explicit null, empty string, zero and false — distinguishable on the way
 * out as well as the way in.
 *
 * A value whose runtime type is not supported at the boundary is recorded as its
 * *type name only*. Its content is never serialized, stringified or hashed.
 *
 * ENCODING VERSIONS
 *
 * V1 (superseded, still readable) stored a row as a bare array of positional cells and
 * a header row as an array of `string | null`. Both shapes lost information:
 *   - A keyed API/JSON row had to be flattened through its property values, so source
 *     field names and any unknown field were discarded and the stored payload depended
 *     on JavaScript property insertion order.
 *   - Every non-text header collapsed to `null`, so `undefined`, `false`, `0`, `""`
 *     and an object header became indistinguishable in storage and in the batch hash.
 *
 * V2 (current) stores a row as a discriminated POSITIONAL/KEYED structure that keeps
 * the source field names, and encodes headers as type-tagged cells like any other
 * value.
 *
 * Compatibility: already-stored V1 payloads are never rewritten. Every stored batch and
 * row records the encoding version that produced it, the decoders below read both
 * versions, and the encoding version is part of every fingerprint preimage — so a V1
 * and a V2 fingerprint of similar-looking content can never be equal.
 *
 * Server-only: encoded payloads contain raw Fantasy values.
 */

import { createHash } from "node:crypto";
import type { FantasySourceValue } from "@/lib/fantasy/row-contract";

if (typeof window !== "undefined") {
  throw new Error("fantasy/raw-encoding is server-only and must not be imported by client code.");
}

/** Superseded for writing, still read. Bump only with a documented migration path. */
export const FANTASY_RAW_ENCODING_V1 = "FANTASY_RAW_ENCODING_V1";
/** Current write format. */
export const FANTASY_RAW_ENCODING_V2 = "FANTASY_RAW_ENCODING_V2";
/** The version every new ingestion writes. */
export const FANTASY_RAW_ENCODING_CURRENT = FANTASY_RAW_ENCODING_V2;

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export type FantasyEncodedCell =
  | { readonly type: "undefined" }
  | { readonly type: "null" }
  | { readonly type: "string"; readonly value: string }
  | { readonly type: "number"; readonly value: number }
  | { readonly type: "boolean"; readonly value: boolean }
  /** Unsupported runtime value: only its type name is kept, never its content. */
  | { readonly type: "unsupported"; readonly valueType: string };

/** Marker returned when decoding a cell whose original value could not be preserved. */
export const UNSUPPORTED_VALUE = Symbol("fantasy.unsupportedValue");

export type FantasyDecodedValue = FantasySourceValue | typeof UNSUPPORTED_VALUE;

/** Name of an unsupported runtime type, carrying nothing from the value itself. */
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

/** Encodes one source cell. Never calls String() or JSON on an unsupported value. */
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

/** Restores the exact supported scalar, or the unsupported marker. */
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

/** Encodes a positional row exactly as supplied, preserving cell order. */
export function encodePositionalRow(row: readonly unknown[]): FantasyEncodedCell[] {
  return row.map(encodeCell);
}

/** Encodes a keyed record, preserving every key present. */
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

// ---------------------------------------------------------------------------
// Rows (V2)
// ---------------------------------------------------------------------------

/**
 * A source row as stored. A spreadsheet row keeps its cell order; an API/JSON row keeps
 * its own field names, including fields this contract version does not recognize, so a
 * keyed delivery is never flattened through `Object.values` and never depends on
 * property insertion order.
 */
export type FantasyEncodedSourceRow =
  | { readonly form: "POSITIONAL"; readonly cells: readonly FantasyEncodedCell[] }
  | { readonly form: "KEYED"; readonly fields: Readonly<Record<string, FantasyEncodedCell>> };

export type FantasyDecodedSourceRow =
  | { readonly form: "POSITIONAL"; readonly cells: FantasyDecodedValue[] }
  | { readonly form: "KEYED"; readonly fields: Record<string, FantasyDecodedValue> };

/** Encodes a provider row in the form the provider actually delivered it. */
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

/** True when any cell of the row could not be preserved as a supported scalar. */
export function sourceRowHasUnsupportedCell(row: FantasyEncodedSourceRow): boolean {
  return row.form === "POSITIONAL"
    ? row.cells.some(isUnsupportedCell)
    : Object.values(row.fields).some(isUnsupportedCell);
}

// ---------------------------------------------------------------------------
// Headers (V2)
// ---------------------------------------------------------------------------

/**
 * Encodes a supplied header row. Headers are ordinary source values: a header that is
 * `undefined`, `null`, `""`, `0`, `false` or an unsupported object stays distinguishable
 * from every other one instead of collapsing into a single "invalid" marker.
 */
export function encodeHeaders(headers: readonly unknown[]): FantasyEncodedCell[] {
  return headers.map(encodeCell);
}

export function decodeHeaders(headers: readonly FantasyEncodedCell[]): FantasyDecodedValue[] {
  return headers.map(decodeCell);
}

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/** JSON values this module is willing to serialize deterministically. */
export type CanonicalValue = string | number | boolean | null | CanonicalValue[] | { [key: string]: CanonicalValue };

/** Every structure this module produces is type-tagged and therefore JSON-safe. */
export type CanonicalSafe =
  | CanonicalValue
  | FantasyEncodedCell
  | readonly FantasyEncodedCell[]
  | Readonly<Record<string, FantasyEncodedCell>>
  | FantasyEncodedSourceRow;

/**
 * Canonical JSON: object keys sorted, array order preserved, no whitespace. Byte-stable
 * for hashing and for storage comparison. Sorting the keys is what makes a keyed row's
 * property insertion order irrelevant to its stored payload and its fingerprint.
 */
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

/** Encoded structures are type-tagged, so widening them for serialization is safe. */
function canonicalOf(value: unknown): CanonicalValue {
  return value as CanonicalValue;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Fingerprints
// ---------------------------------------------------------------------------

/**
 * Batch fingerprint inputs, one shape per encoding version. The V1 shape is retained so
 * an already-persisted V1 fingerprint stays reproducible for verification; new
 * ingestion always uses V2.
 */
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

/**
 * Batch fingerprint: encoding version, contract version, the supplied headers in order,
 * and every encoded row in order.
 *
 * Deliberately excluded so the fingerprint identifies content and nothing else:
 * database ids, timestamps, processing status, cursor token, provider metadata and
 * diagnostics. The encoding version is included, so the same logical batch fingerprints
 * differently under V1 and V2 rather than colliding.
 */
export function computeBatchHash(input: FantasyBatchHashInput): string {
  return sha256Hex(
    canonicalJson({
      encodingVersion: input.encodingVersion,
      contractVersion: input.contractVersion,
      // Header order is part of the identity: a reordered header row is a different batch.
      headers: canonicalOf(input.headers),
      rows: canonicalOf(input.rows),
    }),
  );
}

/**
 * Row fingerprint inputs, one shape per encoding version.
 *
 * V2 fingerprints the raw source row as delivered, so renaming a keyed field or
 * changing any value changes the fingerprint, while re-ordering the properties of a
 * keyed row does not — canonical JSON sorts the keys, and the row's position within the
 * batch lives in its own column rather than in the hash.
 */
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

// ---------------------------------------------------------------------------
// Reading already-stored payloads
// ---------------------------------------------------------------------------

/** Raised when a stored payload does not match any encoding version this build knows. */
export class FantasyRawEncodingError extends Error {
  readonly code = "RAW_ENCODING_UNREADABLE";
  constructor(message: string) {
    super(message);
    this.name = "FantasyRawEncodingError";
  }
}

/**
 * Decodes a stored `rawPayloadJson`. V1 stored a bare positional cell array; V2 stores
 * the discriminated row. Nothing is rewritten — the stored row's own `encodingVersion`
 * selects the reader.
 */
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

/**
 * Decodes a stored `headersJson`. V1 stored `string | null` entries, so an invalid
 * header can only be read back as "not a usable header"; V2 stores type-tagged cells
 * and reads back exactly what was supplied.
 */
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
