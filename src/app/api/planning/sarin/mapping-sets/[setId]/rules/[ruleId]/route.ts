import { NextResponse } from "next/server";
import type { z } from "zod";
import { withApi, idSchema } from "@/lib/api/with-api";
import { SARIN_MAPPING_RULE_BODY, updateMappingRule } from "@/lib/sarin/mapping-service";

// Replaces one rule of a DRAFT set. Approved and retired sets are immutable (409).
export const PATCH = withApi<{ setId: string; ruleId: string }, z.infer<typeof SARIN_MAPPING_RULE_BODY>>(
  { permission: "sarin.mapping.manage", body: SARIN_MAPPING_RULE_BODY },
  async (_req, { params }, api) => {
    const p = await params;
    const rule = await updateMappingRule({ userId: api.principal.userId, audit: api.audit }, idSchema.parse(p.setId), idSchema.parse(p.ruleId), api.body);
    return NextResponse.json({ rule });
  },
);
