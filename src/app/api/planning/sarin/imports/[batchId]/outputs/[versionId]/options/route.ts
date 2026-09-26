import { NextResponse } from "next/server";
import { withApi, idSchema, qEnum, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { SARIN_PLAN_OPTION_KINDS } from "@/lib/sarin/domain";
import { listOutputOptions, SARIN_OUTPUT_OPTION_PAGE } from "@/lib/sarin/output-queries";

// One page of an output version's plan options in output order, optionally for one stone
// or one kind. Yields are the stored values; nothing is ranked.
export const GET = withApi<{ batchId: string; versionId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const p = await params;
  const url = api.url;
  const stoneSequence = url.searchParams.get("stone") ? qInt(url, "stone", { def: 1, min: 1, max: 10_000_000 }) : null;
  const kind = url.searchParams.get("kind") ? qEnum(url, "kind", SARIN_PLAN_OPTION_KINDS, "MAIN") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_OUTPUT_OPTION_PAGE.default, min: 1, max: SARIN_OUTPUT_OPTION_PAGE.max });
  const result = await listOutputOptions(api.scope, idSchema.parse(p.batchId), idSchema.parse(p.versionId), { stoneSequence, kind }, { page, pageSize });
  if (!result) throw notFound("Sarin output version");
  return NextResponse.json(result);
});
