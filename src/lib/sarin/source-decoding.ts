/**
 * Turns uploaded bytes into physical lines, refusing anything that is not a plain UTF-8
 * text file. The bytes themselves are never altered: this module only reads them, so the
 * stored content and its SHA-256 are exactly what was uploaded.
 *
 * Line rule, deterministic for CRLF, LF and any mix of the two: a record ends at LF, and
 * one CR immediately before that LF belongs to the terminator. A CR anywhere else is
 * refused, because it would make the record boundary depend on the reader. A single
 * terminator at the very end of the file does not open another record.
 *
 * Server-only.
 */

import { ApiError } from "@/lib/api/errors";
import type { SarinIngestionLimits } from "@/lib/sarin/ingestion-config";

if (typeof window !== "undefined") {
  throw new Error("sarin/source-decoding is server-only and must not be imported by client code.");
}

/** A refusal that is the uploader's to fix. The code is stable; the message is fixed text. */
export class SarinUploadRejection extends ApiError {
  constructor(status: 400 | 411 | 413, code: string, message: string) {
    super(status, code, message);
  }
}

const reject = (code: string, message: string) => new SarinUploadRejection(400, code, message);

// Payloads that are recognisably not text, whatever the file is called.
const SIGNATURES: Array<{ bytes: number[]; label: string }> = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], label: "a ZIP or Excel archive" },
  { bytes: [0x50, 0x4b, 0x05, 0x06], label: "a ZIP or Excel archive" },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0], label: "a legacy Office document" },
  { bytes: [0x4d, 0x5a], label: "an executable" },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], label: "an executable" },
  { bytes: [0x25, 0x50, 0x44, 0x46], label: "a PDF" },
  { bytes: [0x1f, 0x8b], label: "a compressed archive" },
];

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

// C0 controls other than TAB, LF and CR, plus DEL. Plain CSV text never contains them.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface DecodedSource {
  readonly encoding: "UTF-8" | "UTF-8-BOM";
  /** Physical lines without their terminators, in file order. Line n is record n. */
  readonly lines: string[];
}

export function decodeSarinSource(bytes: Uint8Array, limits: Pick<SarinIngestionLimits, "maxRecords" | "maxLineBytes">): DecodedSource {
  if (bytes.length === 0) throw reject("EMPTY_FILE", "The uploaded file is empty.");
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    throw reject("UNSUPPORTED_ENCODING", "The file is UTF-16 encoded. Upload the Sarin export as UTF-8 CSV.");
  }
  for (const s of SIGNATURES) {
    if (startsWith(bytes, s.bytes)) throw reject("NOT_A_CSV_FILE", `The file is ${s.label}, not a CSV file.`);
  }
  if (bytes.includes(0)) throw reject("BINARY_CONTENT", "The file contains binary data and is not a CSV text file.");

  const hasBom = startsWith(bytes, UTF8_BOM);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(hasBom ? bytes.subarray(3) : bytes);
  } catch {
    throw reject("INVALID_UTF8", "The file is not valid UTF-8 text.");
  }
  if (text.length === 0) throw reject("EMPTY_FILE", "The uploaded file contains no records.");
  if (CONTROL.test(text)) throw reject("CONTROL_CHARACTERS", "The file contains control characters that are not allowed in a CSV file.");

  const segments = text.split("\n");
  if (segments[segments.length - 1] === "") segments.pop();
  if (segments.length > limits.maxRecords) {
    throw new SarinUploadRejection(413, "TOO_MANY_RECORDS", `The file has more than ${limits.maxRecords} records.`);
  }

  const lines = segments.map((s) => (s.endsWith("\r") ? s.slice(0, -1) : s));
  const encoder = new TextEncoder();
  for (const line of lines) {
    if (line.includes("\r")) throw reject("BARE_CARRIAGE_RETURN", "The file contains a carriage return that does not end a line.");
    if (encoder.encode(line).length > limits.maxLineBytes) {
      throw new SarinUploadRejection(413, "RECORD_TOO_LARGE", `A record is longer than ${limits.maxLineBytes} bytes.`);
    }
  }
  return { encoding: hasBom ? "UTF-8-BOM" : "UTF-8", lines };
}
