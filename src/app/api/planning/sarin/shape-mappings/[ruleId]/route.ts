import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { removeShapeMapping } from "@/lib/sarin/mapping-service";

export const DELETE = withApi<{ ruleId: string }>({ permission: "sarin.mapping.manage" }, async (_req, { params }, api) => {
  return NextResponse.json(await removeShapeMapping({ userId: api.principal.userId, audit: api.audit }, idSchema.parse((await params).ruleId)));
});
