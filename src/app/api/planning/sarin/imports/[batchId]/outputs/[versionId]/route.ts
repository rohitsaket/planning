import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { getOutputVersion } from "@/lib/sarin/output-queries";

// One output version's identity, lineage and bounded content totals. Scoped (404 outside it).
export const GET = withApi<{ batchId: string; versionId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const p = await params;
  const result = await getOutputVersion(api.scope, idSchema.parse(p.batchId), idSchema.parse(p.versionId));
  if (!result) throw notFound("Sarin output version");
  return NextResponse.json(result);
});
