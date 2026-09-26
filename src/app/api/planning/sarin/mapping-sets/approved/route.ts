import { NextResponse } from "next/server";
import { withApi, qInt } from "@/lib/api/with-api";
import { listApprovedMappingSets, SARIN_MAPPING_SET_PAGE } from "@/lib/sarin/mapping-service";

// The approved mapping sets a validator can choose from. Read-only: drafts, rules and
// editing are only under sarin.mapping.manage. Every default role holding
// sarin.mapping.manage also holds sarin.import.validate.
export const GET = withApi({ permission: "sarin.import.validate" }, async (_req, _ctx, api) => {
  const url = api.url;
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: SARIN_MAPPING_SET_PAGE.default, min: 1, max: SARIN_MAPPING_SET_PAGE.max });
  return NextResponse.json(await listApprovedMappingSets({ page, pageSize }));
});
