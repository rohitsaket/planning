import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { getSarinImport } from "@/lib/sarin/import-queries";
import { getValidationSummary } from "@/lib/sarin/validation-queries";
import { deleteSarinImport } from "@/lib/sarin/import-service";

export const GET = withApi<{ batchId: string }>({ permission: "sarin.import.read" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const batch = await getSarinImport(api.scope, batchId);
  if (!batch) throw notFound("Sarin import");
  return NextResponse.json({ batch, validation: await getValidationSummary(batch.id) });
});

export const DELETE = withApi<{ batchId: string }>({ permission: "sarin.import.upload" }, async (_req, { params }, api) => {
  const batchId = idSchema.parse((await params).batchId);
  const batch = await getSarinImport(api.scope, batchId);
  if (!batch) throw notFound("Sarin import");
  await deleteSarinImport(batch.id, api);
  return NextResponse.json({ ok: true, deletedBatchId: batch.id });
});
