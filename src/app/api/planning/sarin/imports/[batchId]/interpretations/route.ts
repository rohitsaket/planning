import { NextResponse } from "next/server";
import { withApi, idSchema, qEnum, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { SARIN_SHAPE_MAPPING_RESULTS } from "@/lib/sarin/domain";
import { listRowInterpretations, SARIN_INTERPRETATION_PAGE } from "@/lib/sarin/validation-queries";

// One page of how each source row's shape was resolved, in file order, for operational
// review. Defaults to the latest completed attempt. Scoped in the query (404 outside it).
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const url = api.url;
  const attempt = url.searchParams.get("attempt") ? qInt(url, "attempt", { def: 1, min: 1, max: 1_000_000 }) : null;
  const mappingResult = url.searchParams.get("mappingResult") ? qEnum(url, "mappingResult", SARIN_SHAPE_MAPPING_RESULTS, "MAPPED") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_INTERPRETATION_PAGE.default, min: 1, max: SARIN_INTERPRETATION_PAGE.max });
  const result = await listRowInterpretations(api.scope, batchId, { attempt, mappingResult }, { page, pageSize });
  if (!result) throw notFound("Sarin import");
  return NextResponse.json(result);
});
