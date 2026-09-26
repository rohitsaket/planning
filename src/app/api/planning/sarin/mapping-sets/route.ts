import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, idSchema, qEnum, qInt } from "@/lib/api/with-api";
import { SARIN_SHAPE_MAPPING_SET_STATUSES } from "@/lib/sarin/domain";
import { createDraftSet, listMappingSets, SARIN_MAPPING_SET_PAGE } from "@/lib/sarin/mapping-service";

// Sarin shape-mapping sets, newest version first.
export const GET = withApi({ permission: "sarin.mapping.manage" }, async (_req, _ctx, api) => {
  const url = api.url;
  const status = url.searchParams.get("status") ? qEnum(url, "status", SARIN_SHAPE_MAPPING_SET_STATUSES, "APPROVED") : null;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_MAPPING_SET_PAGE.default, min: 1, max: SARIN_MAPPING_SET_PAGE.max });
  return NextResponse.json(await listMappingSets(status, { page, pageSize }));
});

const createSchema = z.object({ description: z.string().trim().max(500).optional(), copyFromSetId: idSchema.optional() }).strict();

// Creates a new DRAFT set, optionally starting from another set's rules.
export const POST = withApi<Record<string, never>, z.infer<typeof createSchema>>({ permission: "sarin.mapping.manage", body: createSchema }, async (_req, _ctx, api) => {
  const set = await createDraftSet({ userId: api.principal.userId, audit: api.audit }, api.body);
  return NextResponse.json({ set }, { status: 201 });
});
