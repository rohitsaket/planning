import { NextResponse } from "next/server";
import { withApi, idSchema } from "@/lib/api/with-api";
import { notFound } from "@/lib/api/errors";
import { getMappingSet } from "@/lib/sarin/mapping-service";

// One mapping set's metadata and counts. Its rules are served, paginated, by /rules.
export const GET = withApi<{ setId: string }>({ permission: "sarin.mapping.manage" }, async (_req, { params }) => {
  const set = await getMappingSet(idSchema.parse((await params).setId));
  if (!set) throw notFound("Mapping set");
  return NextResponse.json({ set });
});
