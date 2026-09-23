import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  CUSTOMERS_PAGE_DEFAULT,
  CUSTOMERS_PAGE_MAX,
  CUSTOMER_DATA_STATES,
  readCustomerDetail,
  readCustomerSummary,
  readCustomersOrdersReadiness,
  resolveOrderSourceState,
  type CustomerDataState,
  type CustomerFilters,
  type CustomerSortKey,
} from "@/lib/analysis/customers-orders";

/**
 * CUSTOMERS AND ORDERS — one bounded read endpoint.
 *
 * Read-only: the handler performs no write of any kind.
 *
 * Authorization is layered. `customers.read` admits the customer sections; the orders
 * section additionally requires `orders.read`, so holding one does not grant the other.
 * Customer names are withheld at the service, not hidden in the browser.
 */

const SECTIONS = ["readiness", "customers", "customer-detail", "orders"] as const;
const SORTS = ["confirmedQuantity", "measuredWeight", "saleRecordCount", "latestSaleDate", "customerCode"] as const;
const DIRECTIONS = ["asc", "desc"] as const;

export const GET = withApi({ permission: "customers.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "readiness");

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
  // page works without names, so they are granted separately rather than assumed.
  const canSeeCustomerNames = principal.permissions.includes("customers.read");
  const canSeeOrders = principal.permissions.includes("orders.read");

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

    case "orders": {
      if (!canSeeOrders) {
        // Order access is its own authority; holding customers.read does not grant it.
        throw new ApiError(403, "FORBIDDEN", "You do not have permission to read order data.");
      }
      const orderSource = await resolveOrderSourceState();
      return ok({
        section,
        // There is no authoritative order source, so there are no rows and no totals —
        // and deliberately no seeded rows presented as if there were.
        available: false,
        unavailableReason: orderSource.reasonCode,
        orderSource,
        rows: [],
        activeFilters,
      });
    }

    default: {
      const readiness = await readCustomersOrdersReadiness();
      return ok({ section: "readiness", activeFilters, ...readiness });
    }
  }
});
