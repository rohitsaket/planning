import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { INVENTORY_BUCKETS, type InventoryBucket } from "@/lib/analysis/inventory-position";
import {
  AGING_PAGE_DEFAULT,
  AGING_PAGE_MAX,
  EMPTY_AGING_FILTERS,
  readAgingLots,
  readAgingSummary,
  type AgingFilters,
} from "@/lib/analysis/stock-aging";

/**
 * STOCK AGING — one bounded read endpoint.
 *
 * Replaces a route that read `PolishedStone` — a legacy seeded mirror — and computed age
 * as `NOW() - lastUpdated`, a row-update timestamp with no business meaning, then sorted
 * the result into six hardcoded bands nobody approved.
 *
 * This route reports current canonical stock and states plainly that inventory age
 * cannot be derived until the client confirms which event starts the clock. It returns
 * no age, no age band and no "slow-moving" verdict, because it has no basis for any of
 * them.
 *
 * Read-only. Every field is mapped explicitly.
 */

const SECTIONS = ["lots", "summary"] as const;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "lots");
  const filters = parseAgingFilters(url);

  if (section === "summary") {
    return ok({ section, ...(await readAgingSummary(filters)) });
  }

  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: AGING_PAGE_DEFAULT, min: 1, max: AGING_PAGE_MAX }),
  };

  return ok({
    section,
    activeFilters: describeAgingFilters(filters),
    ...(await readAgingLots(filters, paging)),
  });
});

/** Every filter current stock can honour. An unknown bucket is refused. */
export function parseAgingFilters(url: URL): AgingFilters {
  const bucket = qStr(url, "bucket", 40);
  if (bucket && !(INVENTORY_BUCKETS as readonly string[]).includes(bucket)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'bucket' is not a recognized inventory bucket.");
  }

  return {
    ...EMPTY_AGING_FILTERS,
    bucket: (bucket as InventoryBucket | null) ?? null,
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    // Country and branch are real dimensions of a stock record, so they genuinely apply
    // here — unlike on the demand pages, where the stored target has no location.
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    department: qStr(url, "department", 120),
    location: qStr(url, "location", 120),
    search: qStr(url, "search", 120),
  };
}

export function describeAgingFilters(f: AgingFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([, v]) => v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
}
