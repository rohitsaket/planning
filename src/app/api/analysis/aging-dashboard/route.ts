import { ok } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { readAgingSummary } from "@/lib/analysis/stock-aging";
import { describeAgingFilters, parseAgingFilters } from "../aging/route";

/**
 * AGING DASHBOARD — the management view over the same records as Stock Aging.
 *
 * It calls `readAgingSummary` and computes nothing of its own. That matters: the page
 * this replaces carried its own copy of `NOW() - lastUpdated` and its own copy of the
 * six hardcoded age bands, so the dashboard and the lot page were two independent
 * calculations over a legacy mirror that could drift apart — and both were wrong in the
 * same unremarkable-looking way.
 *
 * One service, one availability decision, one answer.
 *
 * Read-only.
 */
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const filters = parseAgingFilters(new URL(req.url));
  return ok({
    activeFilters: describeAgingFilters(filters),
    ...(await readAgingSummary(filters)),
  });
});
