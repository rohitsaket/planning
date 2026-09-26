/**
 * The Sarin raw CSV contract: one record per physical line, exactly 11 positional fields,
 * no header. Positions follow the confirmed contract (design v1.7 §15.1):
 *
 *   1 Stone Name   2 Rough Weight   3 Shape   4 Est. Weight   5 Clarity   6 Color
 *   7 Depth %      8 Ratio          9 Length  10 Width        11 MM (total depth)
 *
 * This module only reads a record. It never parses Stone Name, normalizes a shape or
 * calculates anything: a value that does not read cleanly is reported, not repaired.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("sarin/raw-contract is server-only and must not be imported by client code.");
}

export const SARIN_RAW_CONTRACT_VERSION = "SARIN_RAW_CSV_V1";
export const SARIN_RAW_FIELD_COUNT = 11;

// ---------------------------------------------------------------------------------------
// Reading one physical line as a CSV record
// ---------------------------------------------------------------------------------------

export type CsvRecordRead = { readonly ok: true; readonly fields: string[] } | { readonly ok: false };

/**
 * Splits one line into fields. RFC 4180 quoting within a line: a field may be wrapped in
 * double quotes, a doubled quote inside it is one quote, and commas inside it are data.
 * A quote anywhere else, text after a closing quote, or a quote left open at the end of
 * the line makes the whole record unreadable — records never continue onto another line.
 */
export function readCsvRecord(line: string): CsvRecordRead {
  const fields: string[] = [];
  let i = 0;
  for (;;) {
    if (line[i] === '"') {
      let value = "";
      i++;
      for (;;) {
        if (i >= line.length) return { ok: false };
        const ch = line[i];
        if (ch === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += ch;
        i++;
      }
      fields.push(value);
      if (i === line.length) return { ok: true, fields };
      if (line[i] !== ",") return { ok: false };
      i++;
    } else {
      const comma = line.indexOf(",", i);
      const end = comma === -1 ? line.length : comma;
      const value = line.slice(i, end);
      if (value.includes('"')) return { ok: false };
      fields.push(value);
      if (comma === -1) return { ok: true, fields };
      i = comma + 1;
    }
    // A comma at the very end of the line opens one final, empty field.
    if (i === line.length) {
      fields.push("");
      return { ok: true, fields };
    }
  }
}

// ---------------------------------------------------------------------------------------
// Strict fixed-decimal reading
// ---------------------------------------------------------------------------------------

export type DecimalRead =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: "BLANK" | "INVALID" | "OUT_OF_RANGE" | "PRECISION_EXCEEDED" };

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Reads a complete plain decimal: digits, optionally a point and more digits. No sign
 * other than a leading minus (which is then out of range), no exponent, no whitespace,
 * no NaN or Infinity, and no rounding: more fractional digits than the column holds is an
 * error, never a smaller number. The returned string is exact and fits the column.
 */
export function readFixedDecimal(raw: string, o: { integerDigits: number; fractionDigits: number; allowZero: boolean }): DecimalRead {
  if (raw.trim() === "") return { ok: false, reason: "BLANK" };
  const m = DECIMAL.exec(raw);
  if (!m) return { ok: false, reason: "INVALID" };
  const [, minus, intPart, fracPart = ""] = m;
  if (fracPart.length > o.fractionDigits) return { ok: false, reason: "PRECISION_EXCEEDED" };
  const significant = intPart.replace(/^0+(?=\d)/, "");
  if (minus || significant.length > o.integerDigits) return { ok: false, reason: "OUT_OF_RANGE" };
  const isZero = /^0+$/.test(intPart) && /^0*$/.test(fracPart);
  if (isZero && !o.allowZero) return { ok: false, reason: "OUT_OF_RANGE" };
  return { ok: true, value: fracPart ? `${significant}.${fracPart}` : significant };
}

// Column capacities from the Phase 2 schema: Decimal(12,3) weights, Decimal(9,3) dimensions.
const WEIGHT = { integerDigits: 9, fractionDigits: 3 } as const;
const DIMENSION = { integerDigits: 6, fractionDigits: 3, allowZero: true } as const;

// ---------------------------------------------------------------------------------------
// Interpreting a record against the contract
// ---------------------------------------------------------------------------------------

export type SarinRowOutcome = "ACCEPTED" | "QUARANTINED" | "REJECTED_STRUCTURE";

export interface SarinTypedValues {
  stoneNameRaw: string | null;
  roughWeight: string | null;
  shapeRaw: string | null;
  estimatedWeight: string | null;
  clarity: string | null;
  color: string | null;
  depthPct: string | null;
  ratio: string | null;
  length: string | null;
  width: string | null;
  depthMm: string | null;
}

export interface SarinRecordInterpretation {
  readonly outcome: SarinRowOutcome;
  /** The fields exactly as read, or null when the quoting could not be read. */
  readonly fields: string[] | null;
  readonly fieldCount: number;
  readonly typed: SarinTypedValues;
  /** Empty exactly when ACCEPTED. */
  readonly rejectionCodes: string[];
}

const NO_VALUES: SarinTypedValues = {
  stoneNameRaw: null,
  roughWeight: null,
  shapeRaw: null,
  estimatedWeight: null,
  clarity: null,
  color: null,
  depthPct: null,
  ratio: null,
  length: null,
  width: null,
  depthMm: null,
};

const text = (raw: string) => (raw.trim() === "" ? null : raw);

/**
 * Classifies one record:
 *   REJECTED_STRUCTURE — unreadable quoting, or not exactly 11 fields. Positions are not
 *     assigned: a 10- or 12-field record is never padded, truncated or guessed at.
 *   QUARANTINED — 11 fields, but a value breaks the contract. Values that did read are
 *     kept; the broken ones stay NULL and are named in the reason codes.
 *   ACCEPTED — every value reads under the contract. Nothing has been validated beyond that.
 */
export function interpretSarinRecord(line: string): SarinRecordInterpretation {
  const read = readCsvRecord(line);
  if (!read.ok) {
    return { outcome: "REJECTED_STRUCTURE", fields: null, fieldCount: 0, typed: NO_VALUES, rejectionCodes: ["MALFORMED_QUOTING"] };
  }
  const f = read.fields;
  if (f.length !== SARIN_RAW_FIELD_COUNT) {
    return { outcome: "REJECTED_STRUCTURE", fields: f, fieldCount: f.length, typed: NO_VALUES, rejectionCodes: ["FIELD_COUNT_MISMATCH"] };
  }

  const codes: string[] = [];
  const decimal = (raw: string, code: string, o: { integerDigits: number; fractionDigits: number; allowZero: boolean }, required: boolean) => {
    const r = readFixedDecimal(raw, o);
    if (r.ok) return r.value;
    if (r.reason !== "BLANK" || required) codes.push(`${code}_${r.reason}`);
    return null;
  };
  const requiredText = (raw: string, code: string) => {
    const v = text(raw);
    if (v === null) codes.push(`${code}_BLANK`);
    return v;
  };

  const typed: SarinTypedValues = {
    stoneNameRaw: requiredText(f[0], "STONE_NAME"),
    // Confirmed: Rough Weight is positive; Est. Weight is non-negative, so zero is kept.
    roughWeight: decimal(f[1], "ROUGH_WEIGHT", { ...WEIGHT, allowZero: false }, true),
    shapeRaw: requiredText(f[2], "SHAPE"),
    estimatedWeight: decimal(f[3], "ESTIMATED_WEIGHT", { ...WEIGHT, allowZero: true }, true),
    clarity: text(f[4]),
    color: text(f[5]),
    // Measurements are not required by the contract; a blank one stays NULL, a zero stays
    // zero, and unreadable text is an error rather than either.
    depthPct: decimal(f[6], "DEPTH_PCT", DIMENSION, false),
    ratio: decimal(f[7], "RATIO", DIMENSION, false),
    length: decimal(f[8], "LENGTH", DIMENSION, false),
    width: decimal(f[9], "WIDTH", DIMENSION, false),
    depthMm: decimal(f[10], "DEPTH_MM", DIMENSION, false),
  };

  return { outcome: codes.length ? "QUARANTINED" : "ACCEPTED", fields: f, fieldCount: f.length, typed, rejectionCodes: codes };
}
