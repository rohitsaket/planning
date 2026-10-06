import { SARIN_PACKET_TYPES, type SarinPacketType } from "@/lib/sarin/domain";
import type { SarinIngestionLimits } from "@/lib/sarin/ingestion-config";
import { SarinUploadRejection } from "@/lib/sarin/source-decoding";

if (typeof window !== "undefined") {
  throw new Error("sarin/upload-request is server-only and must not be imported by client code.");
}

export interface SarinUploadRequest {
  readonly bytes: Uint8Array;
  readonly originalFileName: string;
  readonly sanitizedFileName: string;
  readonly packetType: SarinPacketType;
  readonly labId: string | null;
  readonly planningDate: string;
}

const FIELDS = ["file", "packetType", "labId", "planningDate"] as const;
const reject = (code: string, message: string) => new SarinUploadRejection(400, code, message);

const LAB = /^[A-Za-z0-9](?:[A-Za-z0-9._ -]{0,62}[A-Za-z0-9])?$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCalendarDate(value: string): boolean {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

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

  const packetType = text("packetType");
  if (packetType === null || !(SARIN_PACKET_TYPES as readonly string[]).includes(packetType)) {
    throw reject("INVALID_PACKET_TYPE", "Declare the packet type as BLUE, WHITE or PINK.");
  }
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
    packetType: packetType as SarinPacketType,
    labId,
    planningDate,
  };
}
