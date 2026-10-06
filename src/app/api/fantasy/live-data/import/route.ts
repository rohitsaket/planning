import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, log } from "@/lib/api/with-api";
import { ApiError, badRequest, tooLarge } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { sanitizeFileName, WORKBOOK_LIMITS } from "@/lib/domain/workbook-guard";
import { parseLiveExport } from "@/lib/fantasy/live-import";
import { runLiveDataSync } from "@/lib/fantasy/live-sync";
import type { FantasyClient } from "@/lib/fantasy/live-api";

// POST a Fantasy grid export (.xlsx or .csv, multipart field "file"). The rows run through the
// exact same sync as the live listing (mapper, validation, upsert, stale guard, run history) and
// the run is recorded with trigger "import". Same permission as Sync Now. Parsed in memory only.
export const POST = withApi({ permission: "fantasy.sync", rateLimit: LIMITS.upload }, async (req, _ctx, api) => {
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > 25 * 1024 * 1024 + 64 * 1024) throw tooLarge("File exceeds the 25MB limit");
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) throw badRequest("Use multipart/form-data with a 'file' field.");
  let file: File | null = null;
  try {
    const entry = (await req.formData()).get("file");
    if (entry instanceof File) file = entry;
  } catch {
    throw badRequest("Malformed multipart body.");
  }
  if (!file) throw badRequest("No file uploaded. Use multipart/form-data with a 'file' field.");
  const fileName = sanitizeFileName(file.name);
  if (fileName.toLowerCase().endsWith(".xlsx") && file.size > WORKBOOK_LIMITS.maxFileBytes) throw tooLarge("File exceeds 10MB limit");

  const parsed = parseLiveExport(await file.arrayBuffer(), fileName);
  if (!parsed.ok) {
    log("warn", "fantasy_import_rejected", { requestId: api.requestId, userId: api.principal.userId, reason: parsed.message, size: file.size });
    throw new ApiError(parsed.status, parsed.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_EXPORT", parsed.message);
  }

  const client = { fetchLots: async () => ({ rows: parsed.rows, pages: 1, requests: 0, durationMs: 0, complete: true }) } as unknown as FantasyClient;
  const r = await runLiveDataSync({ trigger: "import", actor: api.principal.username, actorUserId: api.principal.userId, client, chainCanonical: "background" });
  if (r.status === "LOCKED") throw new ApiError(409, "SYNC_RUNNING", "Synchronization is already running.");
  await api.audit(db, {
    action: "FANTASY_LIVE_IMPORT",
    entity: "IntegrationSyncRun",
    entityId: r.syncRunId,
    after: { fileName, fileSize: file.size, format: parsed.format, headers: parsed.headers.length, status: r.status, recordsFetched: r.recordsFetched, inserted: r.recordsInserted, updated: r.recordsUpdated, unchanged: r.recordsUnchanged, failed: r.recordsFailed, staled: r.recordsStaled, errorCode: r.errorCode ?? null },
    reason: "Fantasy grid export imported into Live Data",
  });
  return ok({
    success: r.success, syncRunId: r.syncRunId, status: r.status.toLowerCase(), fileName, format: parsed.format, sheetName: parsed.sheetName, headers: parsed.headers,
    recordsFetched: r.recordsFetched, recordsInserted: r.recordsInserted, recordsUpdated: r.recordsUpdated, recordsUnchanged: r.recordsUnchanged, recordsFailed: r.recordsFailed, recordsStaled: r.recordsStaled,
    mappingWarnings: r.mappingWarnings ?? 0, unmappedSourceColumns: r.unmappedSourceColumns ?? [], durationMs: r.durationMs, errorCode: r.errorCode ?? null, errorSummary: r.errorSummary ?? null,
  });
});
