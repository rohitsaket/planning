import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { getSarinImport } from "@/lib/sarin/import-queries";
import { getValidationSummary } from "@/lib/sarin/validation-queries";

// One import's metadata, row-outcome counts and a bounded validation summary. The lookup
// is scoped in the query, so a batch outside the caller's country or lab is
// indistinguishable from one that does not exist. Blocks, findings and interpretations
// are served by their own paginated routes, never embedded here.
export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const batch = await getSarinImport(api.scope, batchId);
  if (!batch) throw notFound("Sarin import");
  return NextResponse.json({ batch, validation: await getValidationSummary(batch.id) });
});
