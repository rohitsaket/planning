import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { readAgingSummary } from "@/lib/analysis/stock-aging";
import { describeAgingFilters, parseAgingFilters } from "../aging/route";
import { describeScope } from "@/lib/auth/access-scope";

export const GET = withApi({ permission: "analysis.read", scoped: true }, async (req: Request, _ctx, { scope }) => {
  const filters = parseAgingFilters(new URL(req.url), scope);
  return ok({
    activeFilters: describeAgingFilters(filters),
    accessScope: describeScope(scope),
    ...(await readAgingSummary(filters)),
  });
});
