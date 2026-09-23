import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  CUSTOMERS_PAGE_DEFAULT,
  CUSTOMERS_PAGE_MAX,
  CUSTOMER_DATA_STATES,
  readCustomerDetail,
  readCustomerSnapshotSummary,
  readCustomerSummary,
  type CustomerDataState,
  type CustomerFilters,
  type CustomerSortKey,
} from "@/lib/analysis/customers-orders";

/**
 * CUSTOMER SALES — bounded read endpoint for the customer sections only.
 *
 * Read-only: the handler performs no write of any kind.
 *
 * Orders live at `./orders` under `orders.read`. They were previously a branch of this
 * handler, which meant its `customers.read` guard refused an orders-only user before the
 * branch could run, and the customer summary carried order diagnostics to every customer
 * reader. Each section now carries exactly its own permission.
 *
 * Customer names are withheld at the service, not hidden in the browser.
 */

const SECTIONS = ["summary", "customers", "customer-detail"] as const;
const SORTS = ["confirmedQuantity", "measuredWeight", "saleRecordCount", "latestSaleDate", "customerCode"] as const;
const DIRECTIONS = ["asc", "desc"] as const;

export const GET = withApi({ permission: "customers.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "summary");

  const filters: CustomerFilters = {
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    lab: qStr(url, "lab", 60),
    customerSearch: qStr(url, "customerSearch", 120),
    categoryId: qStr(url, "categoryId", 200),
    shape: qStr(url, "shape", 60),
    weightBand: qStr(url, "weightBand", 60),
    dataState: qStr(url, "dataState", 40) as CustomerDataState | null,
  };
  if (filters.dataState && !(CUSTOMER_DATA_STATES as readonly string[]).includes(filters.dataState)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'dataState' is not a recognized value.");
  }

  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: CUSTOMERS_PAGE_DEFAULT, min: 1, max: CUSTOMERS_PAGE_MAX }),
  };

  // A customer NAME is personal information; the code is the business identifier. The
  // wrapper has already established `customers.read`, which is what grants the name.
  const canSeeCustomerNames = principal.permissions.includes("customers.read");

  const activeFilters = Object.entries(filters)
    .filter(([, v]) => v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));

  switch (section) {
    case "customers": {
      const sort = {
        key: qEnum(url, "sort", SORTS, "confirmedQuantity") as CustomerSortKey,
        dir: qEnum(url, "dir", DIRECTIONS, "desc"),
      };
      const result = await readCustomerSummary(filters, paging, sort, canSeeCustomerNames).catch((e: unknown) => {
        if (e instanceof Error && e.message === "CUSTOMER_GROUP_LIMIT_EXCEEDED") {
          throw new ApiError(
            503,
            "RESULT_LIMIT_EXCEEDED",
            "This selection produces more customers than the report can return in one request. Narrow the filters.",
          );
        }
        throw e;
      });
      if (!result) {
        // No snapshot is a state, not an empty table of zeros.
        return ok({ section, available: false, unavailableReason: "NOT_RUN", activeFilters, rows: [] });
      }
      return ok({ section, available: true, unavailableReason: null, sort, activeFilters, ...result });
    }

    case "customer-detail": {
      const customerKey = qStr(url, "customerKey", 120);
      if (!customerKey) throw new ApiError(400, "BAD_REQUEST", "A customer key is required.");
      const result = await readCustomerDetail(customerKey, filters, paging, canSeeCustomerNames);
      if (!result) {
        return ok({ section, available: false, unavailableReason: "NOT_RUN", activeFilters });
      }
      return ok({ section, available: true, unavailableReason: null, activeFilters, ...result });
    }

    default: {
      // Customer provenance only. No order state is read here, so a customer reader
      // never receives order information as a side effect.
      const summary = await readCustomerSnapshotSummary();
      return ok({ section: "summary", activeFilters, ...summary });
    }
  }
});
