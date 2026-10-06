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
import { describeScope } from "@/lib/auth/access-scope";

const SECTIONS = ["summary", "customers", "customer-detail"] as const;
const SORTS = ["confirmedQuantity", "measuredWeight", "saleRecordCount", "latestSaleDate", "customerCode"] as const;
const DIRECTIONS = ["asc", "desc"] as const;

export const GET = withApi(
  { permission: "customers.read", scoped: true },
  async (req: Request, _ctx, { principal, scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "summary");

  const filters: CustomerFilters = {
    scope,
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

  const canSeeCustomerNames = principal.permissions.includes("customers.read");

  const activeFilters = Object.entries(filters)
    .filter(([key, v]) => key !== "scope" && v !== null && v !== "")
    .map(([key, value]) => ({ key, value: String(value) }));
  const accessScope = describeScope(scope);
  const sourceDisclosure = (await readCustomerSnapshotSummary()).sourceDisclosure;

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
        return ok({ section, available: false, unavailableReason: "NOT_RUN", activeFilters, accessScope, sourceDisclosure, rows: [] });
      }
      return ok({ section, available: true, unavailableReason: null, sort, activeFilters, accessScope, sourceDisclosure, ...result });
    }

    case "customer-detail": {
      const customerKey = qStr(url, "customerKey", 120);
      if (!customerKey) throw new ApiError(400, "BAD_REQUEST", "A customer key is required.");
      const result = await readCustomerDetail(customerKey, filters, paging, canSeeCustomerNames);
      if (!result) {
        return ok({ section, available: false, unavailableReason: "NOT_RUN", activeFilters, accessScope });
      }
      return ok({ section, available: true, unavailableReason: null, activeFilters, accessScope, sourceDisclosure, ...result });
    }

    default: {
      const summary = await readCustomerSnapshotSummary();
      return ok({ section: "summary", activeFilters, accessScope, ...summary });
    }
  }
},
);
