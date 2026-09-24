import { ok } from "@/lib/api-utils";
import { withApi, qInt } from "@/lib/api/with-api";
import { readAgingSummary } from "@/lib/analysis/stock-aging";
import { describeAgingFilters, parseAgingFilters } from "../aging/route";
import { describeScope } from "@/lib/auth/access-scope";

/**
 * TRANSFER ANALYZER — whether an authoritative transfer recommendation can be made.
 *
 * It cannot, and the reason is structural rather than temporary.
 *
 * A transfer recommendation needs a source location holding excess and a destination
 * location holding a shortage of the same category. That requires demand calculated per
 * country or branch. `DemandMetric` — the authoritative demand result — has no country
 * and no branch column: the target is calculated once per planning category across the
 * whole business.
 *
 * The page this replaces worked around that by taking country demand from the
 * `Requirement` table and availability from `PolishedStone`. Both are seeded
 * demonstration tables, neither is the authoritative 90-day demand result, and combining
 * them produced transfer quantities that looked like findings. Applying a global target
 * to location-scoped stock would show every location as short by nearly the whole target
 * — the same shortage counted once per location.
 *
 * So this route generates no candidates. It returns the unavailable state and, for
 * reference, the factual distribution of current canonical stock by location — labelled
 * as distribution, not as a recommendation.
 *
 * Read-only. No transfer is created, proposed or executed.
 */

export const TRANSFER_UNAVAILABLE_MESSAGE =
  "Transfer recommendations are unavailable because demand is not currently calculated by country or branch. " +
  "Current inventory distribution is shown for reference only.";

export const TRANSFER_UNAVAILABLE_DETAIL =
  "A recommendation needs to know which location is short and which holds a surplus of the same category. " +
  "The demand target is calculated once for the whole business, so it cannot answer either question. " +
  "Calculating demand per location would make transfer analysis possible.";

/** What the client still has to confirm before recommendations become possible. */
export const TRANSFER_PREREQUISITES = [
  "Demand calculated by country or branch, not only per planning category.",
  "Confirmed transfer eligibility rules between locations.",
  "Confirmed transit and lead-time expectations.",
  "Confirmed treatment of reserved, memo and held stock at the source location.",
  "Approved source and destination rules, including which locations may supply which.",
] as const;

export const GET = withApi({ permission: "analysis.read", scoped: true }, async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const filters = parseAgingFilters(url, scope);
  // Bounded: the distribution is a summary, and the caller cannot widen it into a scan.
  void qInt(url, "page", { def: 1, min: 1, max: 1_000 });

  const summary = await readAgingSummary(filters);

  return ok({
    // No candidates, no quantities, no source or destination, no savings, no priority.
    recommendationsAvailable: false,
    unavailableMessage: TRANSFER_UNAVAILABLE_MESSAGE,
    unavailableDetail: TRANSFER_UNAVAILABLE_DETAIL,
    prerequisites: TRANSFER_PREREQUISITES,
    candidates: [],
    activeFilters: describeAgingFilters(filters),
    accessScope: describeScope(scope),
    // The distribution below is canonical stock, so it carries the same source
    // attribution as every other stock surface.
    sourceDisclosure: summary.sourceDisclosure,
    // Factual only. Country and branch are real dimensions of a stock record, so this
    // distribution is authoritative — it is the demand side that has no location.
    distribution: {
      currentLots: summary.currentLots,
      byLocation: summary.byLocation,
      byBucket: summary.byBucket,
      // How many locations exist versus how many are listed. A distribution that is only
      // part of the picture says so rather than reading as the whole of it.
      locations: summary.locations,
    },
  });
});
