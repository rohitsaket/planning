import { NextResponse } from "next/server";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { badRequest } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { SARIN_IMPORT_STATUSES, SARIN_PACKET_TYPES } from "@/lib/sarin/domain";
import { uploadLabs, uploadSarinImport } from "@/lib/sarin/import-service";
import { listSarinImports, SARIN_IMPORT_PAGE } from "@/lib/sarin/import-queries";
import { isCalendarDate } from "@/lib/sarin/upload-request";
import { SARIN_INGESTION_LIMITS } from "@/lib/sarin/ingestion-config";
import { mappingsConfigured } from "@/lib/sarin/mapping-service";

// Upload one headerless Sarin CSV. Stores the file and every record as an UPLOADED
// batch; it does not validate. 201 when created, 200 when an identical import already
// existed (duplicate: true).
export const POST = withApi({ permission: "sarin.import.upload", rateLimit: LIMITS.upload }, async (req, _ctx, api) => {
  const result = await uploadSarinImport(req, { userId: api.principal.userId, scope: api.scope, audit: api.audit, requestId: api.requestId });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});

// Import history within the caller's scope, newest first. Sarin imports carry no country;
// a lab filter outside the scope is refused by the wrapper, and the query itself is
// narrowed to the scope as well.
export const GET = withApi({ permission: "sarin.import.read", scoped: true }, async (_req, _ctx, api) => {
  const url = api.url;
  const lab = qStr(url, "lab", 64);
  const planningDate = qStr(url, "planningDate", 10);
  if (planningDate !== null && !isCalendarDate(planningDate)) throw badRequest("Query parameter 'planningDate' must be a YYYY-MM-DD date.");
  const status = url.searchParams.get("status") ? qEnum(url, "status", SARIN_IMPORT_STATUSES, "UPLOADED") : null;
  const packetType = url.searchParams.get("packetType") ? qEnum(url, "packetType", SARIN_PACKET_TYPES, "BLUE") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_IMPORT_PAGE.default, min: 1, max: SARIN_IMPORT_PAGE.max });
  const history = await listSarinImports(api.scope, { status, packetType, lab, planningDate }, { page, pageSize });
  // What an uploader may send, so the page can help before the server refuses: the limits,
  // and the labs they may declare. The server enforces all of it regardless.
  const upload = api.principal.permissions.includes("sarin.import.upload")
    ? {
        acceptedExtension: ".csv",
        maxFileBytes: SARIN_INGESTION_LIMITS.maxFileBytes,
        maxRecords: SARIN_INGESTION_LIMITS.maxRecords,
        labs: await uploadLabs(api.scope),
      }
    : null;
  // Whether files can be processed at all: processing uses the shape mappings in effect.
  return NextResponse.json({ ...history, upload, mappingsConfigured: await mappingsConfigured() });
});
