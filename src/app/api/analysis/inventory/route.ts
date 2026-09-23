import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  INVENTORY_BUCKETS,
  INVENTORY_PAGE_DEFAULT,
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

/**
 * ANALYSIS INVENTORY — one bounded read endpoint.
 *
 * Read-only: the handler performs no write of any kind, and in particular never repairs
 * a classification as a side effect of a page load. Classification repair is a separate,
 * authorized and audited mutation.
 */

const SECTIONS = ["readiness", "position", "categories", "lots", "reconciliation"] as const;
const STOCK_TYPES = ["POLISHED", "ROUGH", "WIP"] as const;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "readiness");

  const bucket = qStr(url, "bucket", 40);
  if (bucket && !(INVENTORY_BUCKETS as readonly string[]).includes(bucket)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'bucket' is not a recognized inventory bucket.");
  }

  const filters: InventoryFilters = {
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    lab: qStr(url, "lab", 60),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    department: qStr(url, "department", 120),
    location: qStr(url, "location", 120),
    bucket: (bucket as InventoryBucket | null) ?? null,
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
    .filter(([, v]) => v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));

  switch (section) {
    case "position": {
      const grouping = qEnum(url, "grouping", POSITION_GROUPINGS, "bucket") as PositionGrouping;
      const result = await readInventoryPosition(filters, grouping);
      return ok({ section, activeFilters, ...result });
    }
    case "categories": {
      const result = await readCategoryInventory(filters, paging);
      return ok({ section, activeFilters, ...result });
    }
    case "lots": {
      const sort = qEnum(url, "sort", LOT_SORTS, "lastSeen") as LotSort;
      // The source record id identifies a row inside the provider feed; it is shown only
      // to a caller already trusted with Fantasy source detail.
      const canSeeSourceRecordId = principal.permissions.includes("fantasy.read");
      const result = await readLotInventory(filters, paging, sort, canSeeSourceRecordId);
      return ok({ section, sort, activeFilters, ...result });
    }
    case "reconciliation": {
      const result = await reconcileWithMirrors();
      return ok({ section, activeFilters, ...result });
    }
    default: {
      const result = await readInventoryReadiness();
      return ok({ section: "readiness", activeFilters, ...result });
    }
  }
});

/** An optional enum parameter: absent is null, present-but-unknown is refused. */
function qEnumOrNull<T extends string>(url: URL, name: string, values: readonly T[]): T | null {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === "") return null;
  if (!(values as readonly string[]).includes(raw)) {
    throw new ApiError(400, "BAD_REQUEST", `Query parameter '${name}' must be one of: ${values.join(", ")}.`);
  }
  return raw as T;
}
