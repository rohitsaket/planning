import { NextResponse } from "next/server";
import { parseWorkbook } from "@/lib/domain/workbook-parser";
import { inspectXlsxContainer, sanitizeFileName, WORKBOOK_LIMITS } from "@/lib/domain/workbook-guard";
import { withApi, log } from "@/lib/api/with-api";
import { ApiError, badRequest, tooLarge } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

// POST a .xlsx file for parsing — implements the confirmed workbook contract (spec §31-43).
// The file is parsed in memory only; nothing is written to disk.
export const POST = withApi({ permission: "plan.create", rateLimit: LIMITS.upload }, async (req, _ctx, api) => {
  // Reject oversized bodies before buffering them (multipart overhead allowance: 64KB).
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > WORKBOOK_LIMITS.maxFileBytes + 64 * 1024) throw tooLarge("File exceeds 10MB limit");
  if (!(req.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) {
    throw badRequest("Use multipart/form-data with a 'file' field.");
  }

  let file: File | null = null;
  try {
    const entry = (await req.formData()).get("file");
    if (entry instanceof File) file = entry;
  } catch {
    throw badRequest("Malformed multipart body.");
  }
  if (!file) throw badRequest("No file uploaded. Use multipart/form-data with a 'file' field.");

  const fileName = sanitizeFileName(file.name);
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw badRequest("Only .xlsx files are allowed");
  if (file.size > WORKBOOK_LIMITS.maxFileBytes) throw tooLarge("File exceeds 10MB limit");

  const arrayBuffer = await file.arrayBuffer();
  const guard = inspectXlsxContainer(arrayBuffer);
  if (!guard.ok) {
    log("warn", "workbook.rejected", { requestId: api.requestId, userId: api.principal.userId, reason: guard.message, size: file.size });
    throw new ApiError(guard.status, guard.status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_WORKBOOK", guard.message);
  }

  const result = parseWorkbook(arrayBuffer);
  await api.audit(db, {
    action: "WORKBOOK_PARSED",
    entity: "Workbook",
    after: { fileName, fileSize: file.size, parseErrors: result.parseErrors.length },
    reason: "Planning workbook uploaded for parsing",
  });

  return NextResponse.json({ fileName, fileSize: file.size, parsedAt: new Date().toISOString(), ...result });
});
