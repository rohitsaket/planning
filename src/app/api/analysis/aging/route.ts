import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { isInventoryBucket, type InventoryBucket } from "@/lib/analysis/inventory-position";
import {
  AGING_PAGE_DEFAULT,
  AGING_PAGE_MAX,
  EMPTY_AGING_FILTERS,
  readAgingLots,
  readAgingSummary,
  type AgingFilters,
} from "@/lib/analysis/stock-aging";
import { describeScope, type EffectiveScope } from "@/lib/auth/access-scope";

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

export const GET = withApi({ permission: "analysis.read", scoped: true }, async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "lots");
  // The wrapper has already refused a request for a country or lab outside this
  // caller's scope. Carrying the scope into the filters is what narrows the query
  // itself, so an unfiltered request returns the caller's scope rather than everything.
  const filters = parseAgingFilters(url, scope);

  if (section === "summary") {
    return ok({ section, accessScope: describeScope(scope), ...(await readAgingSummary(filters)) });
  }

  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: AGING_PAGE_DEFAULT, min: 1, max: AGING_PAGE_MAX }),
  };

  return ok({
    section,
    activeFilters: describeAgingFilters(filters),
    // What this caller is allowed to see, so a narrowed page says why it is narrow.
    accessScope: describeScope(scope),
    ...(await readAgingLots(filters, paging)),
  });
});

/**
 * Every filter current stock can honour. An unknown bucket is refused.
 *
 * The accepted vocabulary is the derived one the summary emits — the seven inventory
 * buckets — so a drill-down from the Aging Dashboard arrives with a value this parser
 * recognizes. A raw `inventoryClass` value is not a bucket and is rejected as such.
 */
export function parseAgingFilters(url: URL, scope: EffectiveScope): AgingFilters {
  const rawBucket = qStr(url, "bucket", 40);
  let bucket: InventoryBucket | null = null;
  if (rawBucket !== null) {
    if (!isInventoryBucket(rawBucket)) {
      throw new ApiError(400, "BAD_REQUEST", "Query parameter 'bucket' is not a recognized inventory bucket.");
    }
    bucket = rawBucket;
  }

  return {
    ...EMPTY_AGING_FILTERS,
    scope,
    bucket,
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

/**
 * The filters the caller chose, for display.
 *
 * `scope` is deliberately excluded: it is an authorization decision, not something
 * the caller selected, and listing it as an active filter would invite someone to try
 * clearing it. The caller's own scope is disclosed separately and in full.
 */
export function describeAgingFilters(f: AgingFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
}
