import { NextResponse } from "next/server";
import { withApi, idSchema, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { listOutputPieces, SARIN_OUTPUT_PIECE_PAGE } from "@/lib/sarin/output-queries";

// One page of an output version's plan pieces in output-row order, optionally for one
// option or one stone, each traceable to its source row and mapping rule.
export const GET = withApi<{ batchId: string; versionId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const p = await params;
  const url = api.url;
  const option = url.searchParams.get("option");
  const optionId = option ? idSchema.parse(option) : null;
  const stoneSequence = url.searchParams.get("stone") ? qInt(url, "stone", { def: 1, min: 1, max: 10_000_000 }) : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_OUTPUT_PIECE_PAGE.default, min: 1, max: SARIN_OUTPUT_PIECE_PAGE.max });
  const result = await listOutputPieces(api.scope, idSchema.parse(p.batchId), idSchema.parse(p.versionId), { optionId, stoneSequence }, { page, pageSize });
  if (!result) throw notFound("Sarin output version");
  return NextResponse.json(result);
});
