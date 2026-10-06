import { NextResponse } from "next/server";
import type { z } from "zod";
import { withApi } from "@/lib/api/with-api";
import { readMappingCatalog, saveShapeMapping, SHAPE_MAPPING_SAVE_BODY } from "@/lib/sarin/mapping-service";

export const GET = withApi({ permission: "sarin.mapping.read" }, async (_req, _ctx, api) => {
  return NextResponse.json(await readMappingCatalog(api.scope));
});

export const POST = withApi<Record<string, never>, z.infer<typeof SHAPE_MAPPING_SAVE_BODY>>({ permission: "sarin.mapping.manage", body: SHAPE_MAPPING_SAVE_BODY }, async (_req, _ctx, api) => {
  return NextResponse.json(await saveShapeMapping({ userId: api.principal.userId, audit: api.audit }, api.body));
});
