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

const SECTIONS = ["lots", "summary"] as const;

export const GET = withApi({ permission: "analysis.read", scoped: true }, async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "lots");
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
    accessScope: describeScope(scope),
    ...(await readAgingLots(filters, paging)),
  });
});

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
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    department: qStr(url, "department", 120),
    location: qStr(url, "location", 120),
    search: qStr(url, "search", 120),
  };
}

export function describeAgingFilters(f: AgingFilters): Array<{ key: string; value: string }> {
  return Object.entries(f)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
}
