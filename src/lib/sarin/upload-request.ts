/**
 * Reads and validates the multipart body of a Sarin upload. Nothing here trusts the
 * client beyond the five declared fields: an unknown or repeated field is refused, the
 * MIME type is ignored in favour of the content checks, and the file name is kept only as
 * untrusted metadata.
 *
 * Server-only.
 */

import { SARIN_STONE_TYPES, type SarinStoneType } from "@/lib/sarin/domain";
import type { SarinIngestionLimits } from "@/lib/sarin/ingestion-config";
import { SarinUploadRejection } from "@/lib/sarin/source-decoding";

if (typeof window !== "undefined") {
  throw new Error("sarin/upload-request is server-only and must not be imported by client code.");
}

export interface SarinUploadRequest {
  readonly bytes: Uint8Array;
  /** As the client sent it. Never used as a path or in a response header. */
  readonly originalFileName: string;
  readonly sanitizedFileName: string;
  readonly stoneType: SarinStoneType;
  readonly country: string;
  readonly labId: string | null;
  /** YYYY-MM-DD, as declared. */
  readonly planningDate: string;
}

const FIELDS = ["file", "stoneType", "country", "labId", "planningDate"] as const;
const reject = (code: string, message: string) => new SarinUploadRejection(400, code, message);

/** Scope values are compared verbatim, so the declared value must already be canonical. */
const COUNTRY = /^[A-Z]{2}$/;
const LAB = /^[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,62}[A-Za-z0-9])?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isCalendarDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * A display-safe name: the last path segment only, no control characters (so no CR/LF
 * header injection), no characters Windows or HTTP headers treat specially, no leading
 * dots, and bounded. Display and audit only — it is never a storage path.
 */
export function sanitizeSarinFileName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*;]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  if (cleaned.length <= 200) return cleaned || "upload.csv";
  const ext = cleaned.toLowerCase().endsWith(".csv") ? ".csv" : "";
  return cleaned.slice(0, 200 - ext.length) + ext;
}

export async function readSarinUploadRequest(req: Request, limits: SarinIngestionLimits): Promise<SarinUploadRequest> {
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) {
    throw reject("NOT_MULTIPART", "Send the upload as multipart/form-data.");
  }
  // The declared length is checked before the body is read. Anything that could exceed
  // the proxy's buffer is refused here, so the route never sees a silently truncated body.
  const declared = req.headers.get("content-length");
  if (declared === null || !/^\d{1,12}$/.test(declared)) {
    throw new SarinUploadRejection(411, "LENGTH_REQUIRED", "The upload must declare its Content-Length.");
  }
  if (Number(declared) > limits.maxRequestBytes) {
    throw new SarinUploadRejection(413, "FILE_TOO_LARGE", `The file exceeds the ${limits.maxFileBytes}-byte upload limit.`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw reject("MALFORMED_MULTIPART", "The upload body is not valid multipart/form-data.");
  }

  const keys = Array.from(form.keys());
  const unknown = keys.filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown.length) throw reject("UNKNOWN_FIELD", "The upload contains a field that is not part of the Sarin upload contract.");
  for (const k of FIELDS) {
    if (form.getAll(k).length > 1) throw reject(k === "file" ? "MULTIPLE_FILES" : "REPEATED_FIELD", k === "file" ? "Upload exactly one file." : "A field was sent more than once.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw reject("FILE_MISSING", "Attach one Sarin CSV file in the 'file' field.");
  const text = (k: (typeof FIELDS)[number]) => {
    const v = form.get(k);
    if (v !== null && typeof v !== "string") throw reject("INVALID_FIELD", "Only the 'file' field may carry a file.");
    return v;
  };

  const stoneType = text("stoneType");
  if (stoneType === null || !(SARIN_STONE_TYPES as readonly string[]).includes(stoneType)) {
    throw reject("INVALID_STONE_TYPE", "Declare the stone type as BLUE, WHITE or PINK.");
  }
  const country = text("country");
  if (country === null || !COUNTRY.test(country)) throw reject("INVALID_COUNTRY", "Declare the country as a two-letter upper-case country code.");
  // An empty lab field is the same as no lab: an optional form input submits "" when unused.
  const labRaw = text("labId");
  const labId = labRaw === null || labRaw === "" ? null : labRaw;
  if (labId !== null && !LAB.test(labId)) throw reject("INVALID_LAB", "The lab identifier is not valid.");
  const planningDate = text("planningDate");
  if (planningDate === null || !isCalendarDate(planningDate)) {
    throw reject("INVALID_PLANNING_DATE", "Declare the planning date as a valid YYYY-MM-DD date.");
  }

  const originalFileName = file.name;
  if (originalFileName.length === 0 || originalFileName.length > 1024) throw reject("INVALID_FILE_NAME", "The file name is missing or too long.");
  const lastSegment = originalFileName.split(/[\\/]/).pop() ?? "";
  if (!lastSegment.toLowerCase().endsWith(".csv")) throw reject("NOT_A_CSV_FILE", "Only .csv files are accepted.");
  if (file.size > limits.maxFileBytes) {
    throw new SarinUploadRejection(413, "FILE_TOO_LARGE", `The file exceeds the ${limits.maxFileBytes}-byte upload limit.`);
  }

  return {
    bytes: new Uint8Array(await file.arrayBuffer()),
    originalFileName,
    sanitizedFileName: sanitizeSarinFileName(originalFileName),
    stoneType: stoneType as SarinStoneType,
    country,
    labId,
    planningDate,
  };
}
