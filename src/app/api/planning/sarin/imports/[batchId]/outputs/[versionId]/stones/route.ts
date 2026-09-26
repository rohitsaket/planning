import { NextResponse } from "next/server";
import { withApi, idSchema, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { listOutputStones, SARIN_OUTPUT_STONE_PAGE } from "@/lib/sarin/output-queries";

// One page of an output version's stones in file order, with their option totals.
export const GET = withApi<{ batchId: string; versionId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const p = await params;
  const page = qInt(api.url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(api.url, "pageSize", { def: SARIN_OUTPUT_STONE_PAGE.default, min: 1, max: SARIN_OUTPUT_STONE_PAGE.max });
  const result = await listOutputStones(api.scope, idSchema.parse(p.batchId), idSchema.parse(p.versionId), { page, pageSize });
  if (!result) throw notFound("Sarin output version");
  return NextResponse.json(result);
});
