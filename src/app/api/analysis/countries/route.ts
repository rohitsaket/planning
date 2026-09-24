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

/**
 * COUNTRY & BRANCH — one bounded read endpoint over what is known per location.
 *
 * It returns no country target, no country shortage, no country excess, no pipeline
 * requirement, no remaining unplanned quantity and no transfer candidate, because the
 * authoritative demand result has no country or branch dimension and none of those
 * figures can be derived from it.
 *
 * The route this replaces produced all of them, from the seeded `Requirement` table and
 * the seeded `PolishedStone` mirror rather than from the persisted demand result — while
 * the Transfer Analyzer, reading the same data, reported on screen that a location-level
 * shortage cannot be calculated. The two pages contradicted each other, and this one was
 * the page that was wrong.
 *
 * What it returns instead is factual and clearly separated: confirmed sales by location
 * from the same 90-day snapshot as Customers & Orders, and current inventory by location
 * from the same shared summary as Stock Aging and the Aging Dashboard.
 *
 * Read-only.
 */
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

  // Derived from the authenticated server session, never from the request. It withholds
  // the distinct-customer figure only; the sales themselves are location facts.
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
    // Stated on every response, not only when a snapshot happens to be missing.
    geographicDemandAvailable: false,
    geographicDemandMessage: GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE,
    geographicDemandDetail: GEOGRAPHIC_DEMAND_UNAVAILABLE_DETAIL,
    customerIdentityVisible: canSeeCustomers,
    // This page reads two datasets. If either is simulated the page is simulated.
    sourceDisclosure: mergeSourceDisclosures([sales.sourceDisclosure, inventory.sourceDisclosure]),

    accessScope: describeScope(scope),
    sales,
    // Two separate tables on purpose: one is history, the other is a present position,
    // and subtracting them is what produced the shortage figure this route removed.
    inventory: {
      currentLots: inventory.currentLots,
      byLocation: inventory.byLocation,
      locations: inventory.locations,
    },
  });
  },
);
