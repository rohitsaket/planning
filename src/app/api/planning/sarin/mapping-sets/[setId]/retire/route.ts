import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, idSchema, reasonSchema } from "@/lib/api/with-api";
import { retireMappingSet } from "@/lib/sarin/mapping-service";

const bodySchema = z.object({ reason: reasonSchema }).strict();

// Retires an APPROVED set so no new validation can use it. Refused (409) while a
// validation is running with it. Past attempts keep their lineage to the retired set.
export const POST = withApi<{ setId: string }, z.infer<typeof bodySchema>>({ permission: "sarin.mapping.manage", body: bodySchema }, async (_req, { params }, api) => {
  const result = await retireMappingSet({ userId: api.principal.userId, audit: api.audit }, idSchema.parse((await params).setId), api.body.reason);
  return NextResponse.json({ set: result });
});
