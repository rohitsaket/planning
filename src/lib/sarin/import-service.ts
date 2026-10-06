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
import { isLabRegistered } from "@/lib/sarin/registry";

if (typeof window !== "undefined") {
  throw new Error("sarin/import-service is server-only and must not be imported by client code.");
}

export const SARIN_AUDIT_ACTIONS = {
  uploaded: "SARIN_IMPORT_UPLOADED",
  duplicateReused: "SARIN_IMPORT_DUPLICATE_REUSED",
  uploadRejected: "SARIN_IMPORT_UPLOAD_REJECTED",
  uploadFailed: "SARIN_IMPORT_UPLOAD_FAILED",
  archived: "SARIN_IMPORT_ARCHIVED",
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

const UPLOAD_CHOICES_MAX = 300;

export async function uploadLabs(scope: EffectiveScope): Promise<string[]> {
  const rows = await db.labMapping.findMany({
    where: { active: true, ...(scope.labs === null ? {} : { normalizedLab: { in: [...scope.labs] } }) },
    distinct: ["normalizedLab"],
    select: { normalizedLab: true },
    orderBy: { normalizedLab: "asc" },
    take: UPLOAD_CHOICES_MAX,
  });
  return rows.map((r) => r.normalizedLab);
}

export function assertUploadScope(scope: EffectiveScope, labId: string | null): void {
  assertWithinScope(scope, { lab: labId });
  if (scope.labs !== null && labId === null) {
    throw forbidden("Your access is limited to specific labs. Declare the lab for this import.");
  }
}

async function assertRegistered(labId: string | null): Promise<void> {
  if (labId !== null && !(await isLabRegistered(labId))) throw new SarinUploadRejection(400, "UNKNOWN_LAB", "The declared lab is not an active lab in the lab registry.");
}

function assertFieldLengths(records: SarinRecordInterpretation[], limits: Pick<SarinIngestionLimits, "maxFieldChars">): void {
  for (const r of records) {
    if (r.fields?.some((f) => f.length > limits.maxFieldChars)) {
      throw new SarinUploadRejection(413, "FIELD_TOO_LARGE", `A field is longer than ${limits.maxFieldChars} characters.`);
    }
  }
}

async function auditRejection(actor: SarinUploadActor, error: ApiError, request: SarinUploadRequest | null): Promise<void> {
  try {
    await actor.audit(db, {
      action: SARIN_AUDIT_ACTIONS.uploadRejected,
      entity: AUDIT_ENTITY,
      outcome: error.status === 403 ? "DENIED" : "FAILED",
      after: {
        reasonCode: error.code,
        status: error.status,
        ...(request ? { packetType: request.packetType, labId: request.labId, planningDate: request.planningDate, byteSize: request.bytes.length } : {}),
      },
      reason: "Sarin upload refused",
    });
  } catch (e) {
    log("error", "sarin.import.audit_failed", { requestId: actor.requestId, userId: actor.userId, error: e instanceof Error ? e.name : "unknown" });
  }
}

export async function uploadSarinImport(req: Request, actor: SarinUploadActor, limits: SarinIngestionLimits = SARIN_INGESTION_LIMITS): Promise<SarinUploadResult> {
  let request: SarinUploadRequest | null = null;
  let records: SarinRecordInterpretation[];
  let lines: string[];
  let encoding: string;
  try {
    request = await readSarinUploadRequest(req, limits);
    assertUploadScope(actor.scope, request.labId);
    await assertRegistered(request.labId);
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

export async function ingestSarinSource(
  actor: SarinUploadActor,
  request: SarinUploadRequest,
  source: { lines: string[]; records: SarinRecordInterpretation[]; encoding: string },
  limits: Pick<SarinIngestionLimits, "rowInsertBatchSize" | "transactionTimeoutMs">,
): Promise<SarinUploadResult> {
  const sha256 = sha256Hex(request.bytes);
  const notAccepted = source.records.filter((r) => r.outcome !== "ACCEPTED").length;
  const identity = {
    packetType: request.packetType,
    labScope: request.labId,
    contractVersion: SARIN_RAW_CONTRACT_VERSION,
    planningDate: new Date(`${request.planningDate}T00:00:00.000Z`),
  };
  const facts = {
    sha256Prefix: sha256.slice(0, 12),
    packetType: request.packetType,
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
          const existing = await tx.sarinImportBatch.findFirstOrThrow({ where: { sourceFileId: file.id, ...identity, status: { not: "ARCHIVED" } }, select: { id: true } });
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

export async function deleteSarinImport(batchId: string, api: ApiContext<unknown>): Promise<void> {
  const batch = await db.sarinImportBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true,
      sourceFileId: true,
      status: true,
      labScope: true,
      packetType: true,
      planningDate: true,
      sourceFile: { select: { sanitizedFileName: true } },
    },
  });

  if (!batch) {
    throw new ApiError(404, "NOT_FOUND", "Sarin import not found");
  }

  assertWithinScope(api.scope, { lab: batch.labScope });

  if (batch.status === "ARCHIVED") {
    return;
  }

  if (batch.status === "VALIDATING") {
    throw new ApiError(409, "BATCH_BUSY", "Cannot delete a batch that is currently validating.");
  }

  await db.$transaction(
    async (tx) => {
      await tx.sarinImportBatch.update({
        where: { id: batchId },
        data: {
          status: "ARCHIVED",
          archivedAt: new Date(),
          statusChangedAt: new Date(),
        },
      });

      await api.audit(tx, {
        action: SARIN_AUDIT_ACTIONS.archived,
        entity: AUDIT_ENTITY,
        entityId: batchId,
        before: {
          batchId: batch.id,
          fileName: batch.sourceFile?.sanitizedFileName,
          labId: batch.labScope,
          packetType: batch.packetType,
          status: batch.status,
          planningDate: batch.planningDate,
        },
        after: {
          batchId: batch.id,
          status: "ARCHIVED",
        },
        reason: "User deleted Sarin import file",
      });
    },
    { timeout: 10_000, maxWait: 5_000 }
  );
}

