import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, idSchema, qInt } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { LIMITS } from "@/lib/api/rate-limit";
import { generateSarinOutput } from "@/lib/sarin/output-service";
import { getOutputVersion, listOutputVersions, SARIN_OUTPUT_VERSION_PAGE } from "@/lib/sarin/output-queries";

// The output versions of one import, newest first. Scoped in the query (404 outside it).
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const page = qInt(api.url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(api.url, "pageSize", { def: SARIN_OUTPUT_VERSION_PAGE.default, min: 1, max: SARIN_OUTPUT_VERSION_PAGE.max });
  const result = await listOutputVersions(api.scope, batchId, { page, pageSize });
  if (!result) throw notFound("Sarin import");
  return NextResponse.json(result);
});

// Strict: every value of the output is derived on the server. The caller may only name
// the validation attempt it reviewed, as a precondition; anything else is refused.
const bodySchema = z.object({ validationAttemptId: idSchema.optional() }).strict();

// Generates the Blue/White structured output of a validated import: 201 with a new
// version, or 200 with `reused: true` when the inputs are unchanged.
export const POST = withApi<{ batchId: string }, z.infer<typeof bodySchema>>(
  { permission: "sarin.output.generate", body: bodySchema, rateLimit: LIMITS.expensive },
  async (_req, { params }, api) => {
    const batchId = idSchema.parse((await params).batchId);
    const outcome = await generateSarinOutput({ userId: api.principal.userId, scope: api.scope, audit: api.audit, requestId: api.requestId }, batchId, api.body);
    const output = await getOutputVersion(api.scope, batchId, outcome.versionId);
    return NextResponse.json({ reused: outcome.reused, output }, { status: outcome.reused ? 200 : 201 });
  },
);
