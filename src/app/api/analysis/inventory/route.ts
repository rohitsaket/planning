import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { describeScope } from "@/lib/auth/access-scope";
import {
  INVENTORY_BUCKETS,
  INVENTORY_PAGE_DEFAULT,
  isInventoryBucket,
  readInventorySourceDisclosure,
  INVENTORY_PAGE_MAX,
  LOT_SORTS,
  POSITION_GROUPINGS,
  readCategoryInventory,
  readInventoryPosition,
  readInventoryReadiness,
  readLotInventory,
  reconcileWithMirrors,
  type InventoryBucket,
  type InventoryFilters,
  type LotSort,
  type PositionGrouping,
} from "@/lib/analysis/inventory-position";

const SECTIONS = ["readiness", "position", "categories", "lots", "reconciliation"] as const;
const STOCK_TYPES = ["POLISHED", "ROUGH", "WIP"] as const;

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { principal, scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "readiness");

  const bucket = qStr(url, "bucket", 40);
  if (bucket && !(INVENTORY_BUCKETS as readonly string[]).includes(bucket)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'bucket' is not a recognized inventory bucket.");
  }

  const filters: InventoryFilters = {
    scope,
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    department: qStr(url, "department", 120),
    location: qStr(url, "location", 120),
    bucket: bucket && isInventoryBucket(bucket) ? bucket : null,
    stockType: qEnumOrNull(url, "stockType", STOCK_TYPES),
    lifecycle: qStr(url, "lifecycle", 60),
    holdState: qStr(url, "holdState", 40),
    classificationState: qStr(url, "classificationState", 40),
    search: qStr(url, "search", 120),
  };

  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: INVENTORY_PAGE_DEFAULT, min: 1, max: INVENTORY_PAGE_MAX }),
  };

  const activeFilters = Object.entries(filters)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
  const accessScope = describeScope(scope);
  const sourceDisclosure = await readInventorySourceDisclosure(filters);

  switch (section) {
    case "position": {
      const grouping = qEnum(url, "grouping", POSITION_GROUPINGS, "bucket") as PositionGrouping;
      const result = await readInventoryPosition(filters, grouping);
      return ok({ section, activeFilters, accessScope, sourceDisclosure, ...result });
    }
    case "categories": {
      const result = await readCategoryInventory(filters, paging);
      return ok({ section, activeFilters, accessScope, sourceDisclosure, ...result });
    }
    case "lots": {
      const sort = qEnum(url, "sort", LOT_SORTS, "lastSeen") as LotSort;
      const canSeeSourceRecordId = principal.permissions.includes("fantasy.read");
      const result = await readLotInventory(filters, paging, sort, canSeeSourceRecordId);
      return ok({ section, sort, activeFilters, accessScope, sourceDisclosure, ...result });
    }
    case "reconciliation": {
      const result = await reconcileWithMirrors(scope);
      return ok({ section, activeFilters, accessScope, sourceDisclosure, ...result });
    }
    default: {
      const result = await readInventoryReadiness();
      return ok({ section: "readiness", activeFilters, accessScope, ...result });
    }
  }
  },
);

function qEnumOrNull<T extends string>(url: URL, name: string, values: readonly T[]): T | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (!(values as readonly string[]).includes(raw)) {
    throw new ApiError(400, "BAD_REQUEST", `Query parameter '${name}' must be one of: ${values.join(", ")}.`);
  }
  return raw as T;
}
