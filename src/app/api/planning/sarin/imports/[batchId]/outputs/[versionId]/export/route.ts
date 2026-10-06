import { db } from "@/lib/db";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { exportOutputVersion } from "@/lib/sarin/output-export";

export const GET = withApi<{ batchId: string; versionId: string }>(
  { permission: "sarin.output.export", rateLimit: { limit: 10, windowMs: 60_000 } },
  async (_req, { params }, api) => {
    const p = await params;
    const batchId = idSchema.parse(p.batchId);
    const file = await exportOutputVersion(api.scope, batchId, idSchema.parse(p.versionId));
    if (!file) throw notFound("Sarin output version");
    await api.audit(db, {
      action: "SARIN_OUTPUT_EXPORTED",
      entity: "SarinImportBatch",
      entityId: batchId,
      after: { outputVersionId: file.versionId, versionNumber: file.versionNumber, format: "CSV", rows: file.rows },
      reason: "Sarin structured output exported",
    });
    return new Response(file.csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-sarin-export-rows": String(file.rows),
      },
    });
  },
);
