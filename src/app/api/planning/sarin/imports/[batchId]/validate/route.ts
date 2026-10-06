import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, idSchema } from "@/lib/api/with-api";
import { LIMITS } from "@/lib/api/rate-limit";
import { validateSarinImport } from "@/lib/sarin/validation-service";
import { getSarinImport } from "@/lib/sarin/import-queries";
import { getValidationSummary } from "@/lib/sarin/validation-queries";

const bodySchema = z.object({}).strict();

export const POST = withApi<{ batchId: string }, z.infer<typeof bodySchema>>(
  { permission: "sarin.import.validate", body: bodySchema, rateLimit: LIMITS.expensive },
  async (_req, { params }, api) => {
    const batchId = idSchema.parse((await params).batchId);
    const outcome = await validateSarinImport({ userId: api.principal.userId, scope: api.scope, audit: api.audit, requestId: api.requestId }, batchId);
    const [batch, validation] = await Promise.all([getSarinImport(api.scope, batchId), getValidationSummary(batchId)]);
    return NextResponse.json({ reused: outcome.reused, batch, validation });
  },
);
