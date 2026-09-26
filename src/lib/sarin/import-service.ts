/**
 * Sarin CSV ingestion: stores one uploaded file as immutable evidence and one UPLOADED
 * import batch with every physical record, in a single transaction.
 *
 * Correctness under retries and concurrency comes from the database, not from this
 * process. The source file is unique by SHA-256 and the batch by its duplicate identity
 * (bytes, stone type, contract, country, lab, planning date). Both are inserted with ON
 * CONFLICT DO NOTHING, so a concurrent identical upload waits on the first one's
 * uncommitted row, then finds it committed and reuses it; if the first one rolls back,
 * the waiter creates the batch instead. The in-memory rate limit in front of the route is
 * defence in depth only.
 *
 * Nothing here validates, parses Stone Names or normalizes shapes. A batch leaves this
 * service UPLOADED with validationAttempt 0 — stored, not validated.
 *
 * Server-only.
 */

import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiError, forbidden } from "@/lib/api/errors";
import { log } from "@/lib/api/log";
import type { ApiContext } from "@/lib/api/with-api";
import { assertWithinScope, type EffectiveScope } from "@/lib/auth/access-scope";
import { SARIN_INGESTION_LIMITS, type SarinIngestionLimits } from "@/lib/sarin/ingestion-config";
import { interpretSarinRecord, SARIN_RAW_CONTRACT_VERSION, type SarinRecordInterpretation } from "@/lib/sarin/raw-contract";
import { decodeSarinSource, SarinUploadRejection } from "@/lib/sarin/source-decoding";
import { readSarinUploadRequest, type SarinUploadRequest } from "@/lib/sarin/upload-request";
import { getSarinImportById, type SarinImportSummary } from "@/lib/sarin/import-queries";
import { isCountryRegistered, isLabRegistered } from "@/lib/sarin/registry";

if (typeof window !== "undefined") {
  throw new Error("sarin/import-service is server-only and must not be imported by client code.");
}

export const SARIN_AUDIT_ACTIONS = {
  uploaded: "SARIN_IMPORT_UPLOADED",
  duplicateReused: "SARIN_IMPORT_DUPLICATE_REUSED",
  uploadRejected: "SARIN_IMPORT_UPLOAD_REJECTED",
  uploadFailed: "SARIN_IMPORT_UPLOAD_FAILED",
} as const;

const AUDIT_ENTITY = "SarinImportBatch";

type AuditWriter = ApiContext<unknown>["audit"];

export interface SarinUploadActor {
  readonly userId: string;
  readonly scope: EffectiveScope;
  readonly audit: AuditWriter;
  readonly requestId: string;
}

export interface SarinUploadResult {
  readonly created: boolean;
  readonly duplicate: boolean;
  readonly batch: SarinImportSummary;
}

const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/**
 * The declared country must be inside the actor's scope, and so must a declared lab. An
 * actor limited to particular labs must declare one: a batch without a lab would sit
 * outside their own scope, where they could never see it again.
 */
export function assertUploadScope(scope: EffectiveScope, country: string, labId: string | null): void {
  assertWithinScope(scope, { country, lab: labId });
  if (scope.labs !== null && labId === null) {
    throw forbidden("Your access is limited to specific labs. Declare the lab for this import.");
  }
}

/**
 * The declared country must exist in the country registry and a declared lab in the lab
 * registry. Checked after scope, so an out-of-scope request is still refused with 403.
 */
async function assertRegistered(country: string, labId: string | null): Promise<void> {
  if (!(await isCountryRegistered(country))) throw new SarinUploadRejection(400, "UNKNOWN_COUNTRY", "The declared country is not in the country registry.");
  if (labId !== null && !(await isLabRegistered(labId))) throw new SarinUploadRejection(400, "UNKNOWN_LAB", "The declared lab is not an active lab in the lab registry.");
}

function assertFieldLengths(records: SarinRecordInterpretation[], limits: Pick<SarinIngestionLimits, "maxFieldChars">): void {
  for (const r of records) {
    if (r.fields?.some((f) => f.length > limits.maxFieldChars)) {
      throw new SarinUploadRejection(413, "FIELD_TOO_LARGE", `A field is longer than ${limits.maxFieldChars} characters.`);
    }
  }
}

/** Safe audit summary of a request that was refused: the reason code and validated facts only. */
async function auditRejection(actor: SarinUploadActor, error: ApiError, request: SarinUploadRequest | null): Promise<void> {
  try {
    await actor.audit(db, {
      action: SARIN_AUDIT_ACTIONS.uploadRejected,
      entity: AUDIT_ENTITY,
      outcome: error.status === 403 ? "DENIED" : "FAILED",
      after: {
        reasonCode: error.code,
        status: error.status,
        ...(request ? { stoneType: request.stoneType, country: request.country, labId: request.labId, planningDate: request.planningDate, byteSize: request.bytes.length } : {}),
      },
      reason: "Sarin upload refused",
    });
  } catch (e) {
    log("error", "sarin.import.audit_failed", { requestId: actor.requestId, userId: actor.userId, error: e instanceof Error ? e.name : "unknown" });
  }
}

/** Handles POST /api/planning/sarin/imports end to end. */
export async function uploadSarinImport(req: Request, actor: SarinUploadActor, limits: SarinIngestionLimits = SARIN_INGESTION_LIMITS): Promise<SarinUploadResult> {
  let request: SarinUploadRequest | null = null;
  let records: SarinRecordInterpretation[];
  let lines: string[];
  let encoding: string;
  try {
    request = await readSarinUploadRequest(req, limits);
    assertUploadScope(actor.scope, request.country, request.labId);
    await assertRegistered(request.country, request.labId);
    const decoded = decodeSarinSource(request.bytes, limits);
    lines = decoded.lines;
    encoding = decoded.encoding;
    records = lines.map(interpretSarinRecord);
    assertFieldLengths(records, limits);
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) await auditRejection(actor, e, request);
    throw e;
  }
  return ingestSarinSource(actor, request, { lines, records, encoding }, limits);
}

/** Persists an already-read upload. Exported for the ingestion tests that vary the batch size. */
export async function ingestSarinSource(
  actor: SarinUploadActor,
  request: SarinUploadRequest,
  source: { lines: string[]; records: SarinRecordInterpretation[]; encoding: string },
  limits: Pick<SarinIngestionLimits, "rowInsertBatchSize" | "transactionTimeoutMs">,
): Promise<SarinUploadResult> {
  const sha256 = sha256Hex(request.bytes);
  const notAccepted = source.records.filter((r) => r.outcome !== "ACCEPTED").length;
  const identity = {
    stoneType: request.stoneType,
    country: request.country,
    labScope: request.labId,
    contractVersion: SARIN_RAW_CONTRACT_VERSION,
    planningDate: new Date(`${request.planningDate}T00:00:00.000Z`),
  };
  const facts = {
    sha256Prefix: sha256.slice(0, 12),
    stoneType: request.stoneType,
    country: request.country,
    labId: request.labId,
    planningDate: request.planningDate,
    byteSize: request.bytes.length,
  };

  let outcome: { created: boolean; batchId: string };
  try {
    outcome = await db.$transaction(
      async (tx) => {
        const fileId = randomUUID();
        const inserted = await tx.sarinSourceFile.createMany({
          data: [{ id: fileId, sha256, originalFileName: request.originalFileName, sanitizedFileName: request.sanitizedFileName, byteSize: request.bytes.length, detectedEncoding: source.encoding }],
          skipDuplicates: true,
        });
        if (inserted.count === 1) {
          await tx.sarinSourceFileContent.create({ data: { sourceFileId: fileId, content: Buffer.from(request.bytes) } });
        }
        const file = await tx.sarinSourceFile.findUniqueOrThrow({ where: { sha256 }, select: { id: true } });

        const batchId = randomUUID();
        const batch = await tx.sarinImportBatch.createMany({
          data: [{ id: batchId, sourceFileId: file.id, ...identity, uploadedByUserId: actor.userId, rowCount: source.records.length, quarantinedRowCount: notAccepted }],
          skipDuplicates: true,
        });

        if (batch.count === 0) {
          // The same import already exists — archived or not, it is the historical record.
          const existing = await tx.sarinImportBatch.findFirstOrThrow({ where: { sourceFileId: file.id, ...identity }, select: { id: true } });
          await actor.audit(tx, { action: SARIN_AUDIT_ACTIONS.duplicateReused, entity: AUDIT_ENTITY, entityId: existing.id, after: { ...facts, batchId: existing.id }, reason: "Identical Sarin upload returned the existing import" });
          return { created: false, batchId: existing.id };
        }

        for (let start = 0; start < source.records.length; start += limits.rowInsertBatchSize) {
          const end = Math.min(start + limits.rowInsertBatchSize, source.records.length);
          const data: Prisma.SarinSourceRowCreateManyInput[] = [];
          for (let i = start; i < end; i++) {
            const r = source.records[i];
            data.push({
              batchId,
              sourceRowNumber: i + 1,
              rawLine: source.lines[i],
              fieldCount: r.fieldCount,
              rowHash: sha256Hex(source.lines[i]),
              outcome: r.outcome,
              rawFieldsJson: r.fields ? JSON.stringify(r.fields) : null,
              rejectionCodes: r.rejectionCodes.length ? r.rejectionCodes.join(",") : null,
              ...r.typed,
            });
          }
          await tx.sarinSourceRow.createMany({ data });
        }

        await actor.audit(tx, {
          action: SARIN_AUDIT_ACTIONS.uploaded,
          entity: AUDIT_ENTITY,
          entityId: batchId,
          after: { ...facts, batchId, records: source.records.length, accepted: source.records.length - notAccepted, notAccepted, status: "UPLOADED" },
          reason: "Sarin CSV stored for validation",
        });
        return { created: true, batchId };
      },
      { timeout: limits.transactionTimeoutMs, maxWait: 10_000 },
    );
  } catch (e) {
    // Logged by class and code only: a database error message can quote the failing row.
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : null;
    log("error", "sarin.import.failed", { requestId: actor.requestId, userId: actor.userId, error: e instanceof Error ? e.name : "unknown", code });
    try {
      await actor.audit(db, { action: SARIN_AUDIT_ACTIONS.uploadFailed, entity: AUDIT_ENTITY, outcome: "FAILED", after: facts, reason: "Sarin upload could not be stored; nothing was kept" });
    } catch {
      log("error", "sarin.import.audit_failed", { requestId: actor.requestId, userId: actor.userId });
    }
    throw new ApiError(500, "UPLOAD_NOT_STORED", "The upload could not be stored. Nothing was saved; retry the upload.");
  }

  const summary = await getSarinImportById(outcome.batchId);
  if (!summary) throw new ApiError(500, "UPLOAD_NOT_STORED", "The upload could not be read back after storing.");
  return { created: outcome.created, duplicate: !outcome.created, batch: summary };
}

