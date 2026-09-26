import { NextResponse } from "next/server";
import { withApi, idSchema, qEnum, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { SARIN_SOURCE_ROW_OUTCOMES } from "@/lib/sarin/domain";
import { listSarinImportRows, SARIN_ROW_PAGE } from "@/lib/sarin/import-queries";

// One page of an import's source records in file order, optionally by outcome. Scoped in
// the query: an out-of-scope batch is a 404.
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const url = api.url;
  const outcome = url.searchParams.get("outcome") ? qEnum(url, "outcome", SARIN_SOURCE_ROW_OUTCOMES, "ACCEPTED") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_ROW_PAGE.default, min: 1, max: SARIN_ROW_PAGE.max });
  const result = await listSarinImportRows(api.scope, batchId, outcome, { page, pageSize });
  if (!result) throw notFound("Sarin import");
  return NextResponse.json(result);
});
