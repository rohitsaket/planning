import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, idSchema } from "@/lib/api/with-api";
import { approveMappingSet } from "@/lib/sarin/mapping-service";

const bodySchema = z.object({}).strict();

// Approves a DRAFT set. The approver must be neither its creator nor its last editor (403).
export const POST = withApi<{ setId: string }, z.infer<typeof bodySchema>>({ permission: "sarin.mapping.manage", body: bodySchema }, async (_req, { params }, api) => {
  const set = await approveMappingSet({ userId: api.principal.userId, audit: api.audit }, idSchema.parse((await params).setId));
  return NextResponse.json({ set: { id: set.id, version: set.version, status: "APPROVED", approvedAt: set.approvedAt?.toISOString() ?? null } });
});
