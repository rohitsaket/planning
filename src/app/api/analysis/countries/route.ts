import { ok } from "@/lib/api-utils";
import { withApi, qStr } from "@/lib/api/with-api";
import {
  EMPTY_GEOGRAPHY_FILTERS,
  GEOGRAPHIC_DEMAND_UNAVAILABLE_DETAIL,
  GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE,
  readSalesByGeography,
  type GeographyFilters,
} from "@/lib/analysis/geography";
import { EMPTY_AGING_FILTERS, readAgingSummary } from "@/lib/analysis/stock-aging";
import { describeScope } from "@/lib/auth/access-scope";
import { mergeSourceDisclosures } from "@/lib/analysis/source-disclosure";

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { principal, scope }) => {
  const url = new URL(req.url);
  const filters: GeographyFilters = {
    ...EMPTY_GEOGRAPHY_FILTERS,
    scope,
    country: qStr(url, "country", 60),
    branch: qStr(url, "branch", 60),
    lab: qStr(url, "lab", 60),
  };

  const canSeeCustomers = principal.permissions.includes("customers.read");

  const [sales, inventory] = await Promise.all([
    readSalesByGeography(filters, canSeeCustomers),
    readAgingSummary({
      ...EMPTY_AGING_FILTERS,
      scope,
      country: filters.country,
      branch: filters.branch,
      lab: filters.lab,
    }),
  ]);

  return ok({
    geographicDemandAvailable: false,
    geographicDemandMessage: GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE,
    geographicDemandDetail: GEOGRAPHIC_DEMAND_UNAVAILABLE_DETAIL,
    customerIdentityVisible: canSeeCustomers,
    sourceDisclosure: mergeSourceDisclosures([sales.sourceDisclosure, inventory.sourceDisclosure]),

    accessScope: describeScope(scope),
    sales,
    inventory: {
      currentLots: inventory.currentLots,
      byLocation: inventory.byLocation,
      locations: inventory.locations,
    },
  });
  },
);
