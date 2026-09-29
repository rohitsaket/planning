import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { removeShapeMapping } from "@/lib/sarin/mapping-service";

// Removes one mapping from the effective catalog, as a new snapshot. Earlier snapshots, and
// every validation and output made with them, are unchanged.
export const DELETE = withApi<{ ruleId: string }>({ permission: "sarin.mapping.manage" }, async (_req, { params }, api) => {
  return NextResponse.json(await removeShapeMapping({ userId: api.principal.userId, audit: api.audit }, idSchema.parse((await params).ruleId)));
});
