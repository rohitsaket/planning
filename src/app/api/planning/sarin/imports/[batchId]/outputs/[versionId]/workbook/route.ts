import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { exportOutputWorkbook, XLSX_CONTENT_TYPE } from "@/lib/sarin/output-workbook";

export const GET = withApi<{ batchId: string; versionId: string }>(
  { permission: "sarin.output.export", rateLimit: { limit: 10, windowMs: 60_000 } },
  async (_req, { params }, api) => {
    const p = await params;
    const batchId = idSchema.parse(p.batchId);
    const file = await exportOutputWorkbook({ userId: api.principal.userId, scope: api.scope, audit: api.audit, requestId: api.requestId }, batchId, idSchema.parse(p.versionId));
    if (!file) throw notFound("Sarin output version");
    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "content-type": XLSX_CONTENT_TYPE,
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-sarin-export-rows": String(file.rows),
      },
    });
  },
);
