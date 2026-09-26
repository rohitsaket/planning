import { NextResponse } from "next/server";
import { withApi, idSchema, qEnum, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { SARIN_STONE_BLOCK_PARSE_STATUSES } from "@/lib/sarin/domain";
import { listStoneBlocks, SARIN_BLOCK_PAGE } from "@/lib/sarin/validation-queries";

// One page of an import's stone blocks in file order. Scoped in the query (404 outside it).
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const url = api.url;
  const parseStatus = url.searchParams.get("parseStatus") ? qEnum(url, "parseStatus", SARIN_STONE_BLOCK_PARSE_STATUSES, "PARSED") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_BLOCK_PAGE.default, min: 1, max: SARIN_BLOCK_PAGE.max });
  const result = await listStoneBlocks(api.scope, batchId, parseStatus, { page, pageSize });
  if (!result) throw notFound("Sarin import");
  return NextResponse.json(result);
});
