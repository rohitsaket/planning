import { NextResponse } from "next/server";
import type { z } from "zod";
import { withApi, idSchema, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { addMappingRule, listMappingRules, SARIN_MAPPING_RULE_BODY, SARIN_MAPPING_RULE_PAGE } from "@/lib/sarin/mapping-service";

// One page of a set's rules, in a stable order.
export const GET = withApi<{ setId: string }>({ permission: "sarin.mapping.manage" }, async (_req, { params }, api) => {
  const setId = idSchema.parse((await params).setId);
  const page = qInt(api.url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(api.url, "pageSize", { def: SARIN_MAPPING_RULE_PAGE.default, min: 1, max: SARIN_MAPPING_RULE_PAGE.max });
  const result = await listMappingRules(setId, { page, pageSize });
  if (!result) throw notFound("Mapping set");
  return NextResponse.json(result);
});

// Adds a rule to a DRAFT set. Overlapping or duplicate rules are refused (409).
export const POST = withApi<{ setId: string }, z.infer<typeof SARIN_MAPPING_RULE_BODY>>({ permission: "sarin.mapping.manage", body: SARIN_MAPPING_RULE_BODY }, async (_req, { params }, api) => {
  const setId = idSchema.parse((await params).setId);
  const rule = await addMappingRule({ userId: api.principal.userId, audit: api.audit }, setId, api.body);
  return NextResponse.json({ rule }, { status: 201 });
});
