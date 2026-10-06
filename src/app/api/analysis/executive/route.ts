import { ok } from "@/lib/api-utils";
import { withApi, qInt, qStr, qEnum } from "@/lib/api/with-api";
import {
  EXECUTIVE_PAGE_DEFAULT,
  EXECUTIVE_PAGE_MAX,
  readAttentionRequired,
  readExecutiveReadiness,
  readInventoryPosition,
  readSalesAndDemand,
  readShortageAndExcess,
  type CategorySort,
  type ExecutiveFilters,
  type ShortageExcessMode,
} from "@/lib/analysis/executive-summary";
import { describeScope } from "@/lib/auth/access-scope";

const SECTIONS = ["readiness", "sales-demand", "inventory", "shortage-excess", "attention"] as const;
const SORTS = ["category", "shortage", "excess", "target", "sales"] as const;
const MODES = ["ALL", "SHORTAGE_ONLY", "EXCESS_ONLY"] as const;

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "readiness");

  const filters: ExecutiveFilters = {
    scope,
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    lab: qStr(url, "lab", 60),
    search: qStr(url, "search", 120),
  };

  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 10_000 }),
    pageSize: qInt(url, "pageSize", { def: EXECUTIVE_PAGE_DEFAULT, min: 1, max: EXECUTIVE_PAGE_MAX }),
  };

  const activeFilters = Object.entries(filters)
    .filter(([k, v]) => k !== "scope" && v !== null && v !== "")
    .map(([k, v]) => ({ key: k, value: String(v) }));
  const accessScope = describeScope(scope);

  switch (section) {
    case "sales-demand": {
      const sort = qEnum(url, "sort", SORTS, "sales") as CategorySort;
      const result = await readSalesAndDemand(filters, paging, sort);
      return ok({ section, sort, activeFilters, accessScope, ...result });
    }
    case "inventory": {
      const result = await readInventoryPosition(filters, paging);
      return ok({ section, activeFilters, accessScope, ...result });
    }
    case "shortage-excess": {
      const mode = qEnum(url, "mode", MODES, "ALL") as ShortageExcessMode;
      const sort = qEnum(url, "sort", SORTS, "shortage") as CategorySort;
      const result = await readShortageAndExcess(filters, paging, mode, sort);
      return ok({ section, mode, sort, activeFilters, accessScope, ...result });
    }
    case "attention": {
      const result = await readAttentionRequired(filters, paging);
      return ok({ section, activeFilters, accessScope, ...result });
    }
    default: {
      const result = await readExecutiveReadiness();
      return ok({ section: "readiness", activeFilters, accessScope, ...result });
    }
  }
},
);
