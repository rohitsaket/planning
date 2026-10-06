export interface Paged<T> {
  rows: T[];
  total: number;
  hasMore: boolean;
}

export interface UploadConstraints {
  acceptedExtension: string;
  maxFileBytes: number;
  maxRecords: number;
  labs: string[];
}

export interface ImportSummary {
  id: string;
  status: string;
  packetType: string;
  planningDate: string;
  labId: string | null;
  sourceFile: { fileName: string; byteSize: number };
  createdAt: string;
  revalidationRequired: boolean;
  currentOutputId: string | null;
  currentOutputUnmappedRows: number;
}

interface AttemptView {
  status: string;
}

export interface ValidationSummary {
  latestAttempt: AttemptView | null;
  lastCompletedAttempt: (AttemptView & { issues: { total: number | null; blocking: number | null } }) | null;
  revalidationRequired: boolean;
}

export interface ImportDetail {
  batch: ImportSummary;
  validation: ValidationSummary;
}

export interface Finding {
  id: string;
  title: string;
  explanation: string;
  nextStep: string;
  blocking: boolean;
  sourceRowNumber: number | null;
  block: { sequence: number; stoneName: string } | null;
  details: Record<string, unknown> | null;
}

export interface OutputVersion {
  id: string;
  packetType: string;
  generatedAt: string;
  counts: { stones: number; options: number; pieces: number };
}

export interface ProcessingRights {
  upload: boolean;
  validate: boolean;
  generate: boolean;
  export: boolean;
  readMappings: boolean;
}

export function rightsOf(permissions: readonly string[]): ProcessingRights {
  return {
    upload: permissions.includes("sarin.import.upload"),
    validate: permissions.includes("sarin.import.validate"),
    generate: permissions.includes("sarin.output.generate"),
    export: permissions.includes("sarin.output.export"),
    readMappings: permissions.includes("sarin.mapping.read"),
  };
}

export type ProcessingStage = "uploading" | "checking" | "preparing";

export const STAGE_LABEL: Record<ProcessingStage | "ready", string> = {
  uploading: "Uploading file",
  checking: "Checking file",
  preparing: "Preparing output",
  ready: "Output ready",
};

export class SarinRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(code);
    this.name = "SarinRequestError";
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const IMPORTS = "/api/planning/sarin/imports";
export const importPath = (batchId: string) => `${IMPORTS}/${encodeURIComponent(batchId)}`;
export const outputPath = (batchId: string, versionId: string) => `${importPath(batchId)}/outputs/${encodeURIComponent(versionId)}`;

export async function toRequestError(res: Response): Promise<SarinRequestError> {
  let code = "REQUEST_FAILED";
  let requestId: string | null = null;
  try {
    const e = ((await res.json()) as { error?: { code?: unknown; requestId?: unknown } }).error;
    if (typeof e?.code === "string") code = e.code;
    if (typeof e?.requestId === "string") requestId = e.requestId;
  } catch {
    // Not the error contract: the status alone is reported.
  }
  return new SarinRequestError(res.status, code, requestId);
}

export async function sendRequest(fetcher: Fetcher, url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetcher(url, { credentials: "same-origin", ...init });
  } catch {
    throw new SarinRequestError(0, "NETWORK", null);
  }
  if (!res.ok) throw await toRequestError(res);
  return res;
}

async function send<T>(fetcher: Fetcher, url: string, init?: RequestInit): Promise<T> {
  return (await (await sendRequest(fetcher, url, init)).json()) as T;
}

const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface SarinFileDetails {
  packetType: string;
  labId: string | null;
  planningDate: string;
}

export interface ProcessingResult {
  batchId: string | null;
  failure: { stage: ProcessingStage; error: SarinRequestError } | null;
}

export function nextStep(detail: ImportDetail, recheck: boolean, rights: ProcessingRights): "check" | "prepare" | null {
  const { batch, validation } = detail;
  if (batch.status === "ARCHIVED" || batch.status === "VALIDATING") return null;
  const checked = (batch.status === "VALIDATED" || batch.status === "NEEDS_REVIEW") && !validation.revalidationRequired;
  const withWarnings = batch.status === "VALIDATED" && batch.currentOutputId !== null && batch.currentOutputUnmappedRows > 0;
  if (!checked || (recheck && (batch.status === "NEEDS_REVIEW" || withWarnings))) return rights.validate ? "check" : null;
  if (batch.status === "VALIDATED" && batch.currentOutputId === null && rights.generate) return "prepare";
  return null;
}

export async function continueProcessing(
  fetcher: Fetcher,
  batchId: string,
  recheck: boolean,
  rights: ProcessingRights,
  onStage: (stage: ProcessingStage) => void = () => {},
): Promise<ProcessingResult> {
  let stage: ProcessingStage = "checking";
  try {
    let detail = await send<ImportDetail>(fetcher, importPath(batchId));
    let again = recheck;
    for (let step = nextStep(detail, again, rights); step !== null; step = nextStep(detail, again, rights)) {
      if (step === "check") {
        stage = "checking";
        onStage(stage);
        detail = await send<ImportDetail>(fetcher, `${importPath(batchId)}/validate`, postJson({}));
        again = false;
        if (detail.batch.status !== "VALIDATED") break;
      } else {
        stage = "preparing";
        onStage(stage);
        await send<unknown>(fetcher, `${importPath(batchId)}/outputs`, postJson({}));
        break;
      }
    }
    return { batchId, failure: null };
  } catch (e) {
    return { batchId, failure: { stage, error: e instanceof SarinRequestError ? e : new SarinRequestError(0, "UNEXPECTED", null) } };
  }
}

export async function processFile(
  fetcher: Fetcher,
  file: Blob & { name: string },
  details: SarinFileDetails,
  rights: ProcessingRights,
  onStage: (stage: ProcessingStage) => void = () => {},
): Promise<ProcessingResult> {
  onStage("uploading");
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("packetType", details.packetType);
  if (details.labId) form.append("labId", details.labId);
  form.append("planningDate", details.planningDate);
  let batchId: string;
  try {
    batchId = (await send<{ batch: { id: string } }>(fetcher, IMPORTS, { method: "POST", body: form })).batch.id;
  } catch (e) {
    return { batchId: null, failure: { stage: "uploading", error: e instanceof SarinRequestError ? e : new SarinRequestError(0, "UNEXPECTED", null) } };
  }
  return continueProcessing(fetcher, batchId, true, rights, onStage);
}

const UNSUPPORTED = new Set(["NOT_A_CSV_FILE", "BINARY_CONTENT", "UNSUPPORTED_ENCODING", "INVALID_UTF8", "CONTROL_CHARACTERS", "BARE_CARRIAGE_RETURN"]);
const TOO_LARGE = new Set(["FILE_TOO_LARGE", "RECORD_TOO_LARGE", "FIELD_TOO_LARGE"]);

const reference = (error: SarinRequestError) => (error.status >= 500 && error.requestId ? ` Reference ${error.requestId.slice(0, 8)}.` : "");

export function uploadFailureMessage(error: SarinRequestError, constraints: UploadConstraints | null): string {
  if (UNSUPPORTED.has(error.code)) return "The file format is not supported.";
  if (TOO_LARGE.has(error.code)) return "The file is too large.";
  if (error.code === "TOO_MANY_RECORDS") return constraints ? `The file has more than ${constraints.maxRecords.toLocaleString("en-IN")} records.` : "The file has too many records.";
  if (error.code === "EMPTY_FILE") return "The file is empty.";
  if (error.code === "UNKNOWN_LAB") return "The selected lab is not available.";
  if (error.status === 403) return "You do not have permission to upload files.";
  if (error.status === 429) return "Too many uploads. Wait a moment and try again.";
  return `The file could not be uploaded.${reference(error)}`;
}

export function processingFailureMessage(error: SarinRequestError): string {
  if (error.code === "BLOCKING_FINDINGS_OPEN") return "The file needs attention before output can be prepared.";
  if (error.code === "VALIDATION_IN_PROGRESS" || error.code === "OUTPUT_GENERATION_IN_PROGRESS") return "This file is already being processed. Try again in a moment.";
  if (error.code === "MAPPINGS_NOT_CONFIGURED") return "Shape mappings are not configured.";
  if (error.code === "MAPPING_WITHDRAWN" || error.code === "VALIDATION_PROFILE_OUTDATED" || error.code === "VALIDATION_CHANGED") return "This file needs to be processed again.";
  if (error.status === 403) return "You do not have permission to continue processing this file.";
  if (error.status === 404) return "This file is not available.";
  if (error.status === 429) return "Too many requests. Wait a moment and try again.";
  return `Output could not be prepared. Try again.${reference(error)}`;
}

export function exportFailureMessage(error: SarinRequestError): string {
  if (error.status === 403) return "You do not have permission to export this output.";
  return `Export could not be completed.${reference(error)}`;
}

export type FileStatus = "Processing" | "Needs Attention" | "Output Ready" | "Output Ready with Warnings" | "Failed" | "Archived";

export function fileStatus(batch: Pick<ImportSummary, "status" | "revalidationRequired" | "currentOutputId" | "currentOutputUnmappedRows">): FileStatus {
  if (batch.status === "ARCHIVED") return "Archived";
  if (batch.status === "FAILED") return "Failed";
  if (batch.revalidationRequired || batch.status === "NEEDS_REVIEW") return "Needs Attention";
  if (batch.status === "VALIDATED" && batch.currentOutputId) return batch.currentOutputUnmappedRows > 0 ? "Output Ready with Warnings" : "Output Ready";
  return "Processing";
}

export type ResultView =
  | { kind: "ready"; outputId: string; advisories: number }
  | { kind: "attention"; blocking: number }
  | { kind: "reprocess" }
  | { kind: "retry" }
  | { kind: "submitted" }
  | { kind: "awaiting-output" }
  | { kind: "checking" }
  | { kind: "archived" };

export function resultView(detail: ImportDetail, rights: ProcessingRights): ResultView {
  const { batch, validation } = detail;
  const last = validation.lastCompletedAttempt;
  if (batch.status === "ARCHIVED") return { kind: "archived" };
  if (batch.status === "VALIDATING") return { kind: "checking" };
  if (validation.revalidationRequired) return { kind: "reprocess" };
  if (batch.status === "NEEDS_REVIEW") return { kind: "attention", blocking: last?.issues.blocking ?? 0 };
  if (batch.status === "VALIDATED" && batch.currentOutputId) {
    return { kind: "ready", outputId: batch.currentOutputId, advisories: Math.max(0, (last?.issues.total ?? 0) - (last?.issues.blocking ?? 0) - batch.currentOutputUnmappedRows) };
  }
  if (batch.status === "VALIDATED") return rights.generate ? { kind: "retry" } : { kind: "awaiting-output" };
  if (batch.status === "FAILED") return { kind: "retry" };
  return { kind: "submitted" };
}
