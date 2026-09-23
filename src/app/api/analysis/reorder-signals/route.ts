import { ok } from "@/lib/api-utils";
import { withApi, qEnum, qInt, qStr } from "@/lib/api/with-api";
import {
  readStockoutSnapshotStatus,
  SORT_DIRECTIONS,
  STOCKOUT_SORTS,
  type StockoutSortKey,
} from "@/lib/analysis/stockout";
import { parseFilters, describeFilters } from "@/app/api/analysis/stockout/route";
import { readReorderSignals, SIGNAL_PAGE_DEFAULT, SIGNAL_PAGE_MAX } from "@/lib/analysis/reorder-signals";

/**
 * REORDER SIGNALS — one bounded read endpoint.
 *
 * Replaces a route that derived a "likely reorder date" and a confidence score from the
 * average gap between past sales, read the legacy seeded mirrors, and returned every
 * category unpaged. None of that model was an approved business rule.
 *
 * A signal is now exactly one thing: the demand engine persisted a physical shortage for
 * this category. The route shares the Stockout filters and reader, so the two pages
 * cannot disagree about whether a category is short.
 *
 * Read-only. No planning, no approval and no mutation of any kind.
 */

const SECTIONS = ["status", "signals"] as const;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const section = qEnum(url, "section", SECTIONS, "status");

  const status = await readStockoutSnapshotStatus(undefined, qStr(url, "runId", 64));

  if (section === "status") {
    return ok({ section, ...status });
  }

  if (!status.hasRun || !status.runId) {
    // A state, not a table of zero signals.
    return ok({
      section,
      available: false,
      runId: null,
      unavailableMessage: status.unavailableMessage,
      availabilityState: status.availabilityState,
      rows: [],
    });
  }

  // Shares the Stockout filter vocabulary: the same stored rows, filtered the same way.
  const filters = parseFilters(url);
  const sort = {
    key: qEnum(url, "sort", STOCKOUT_SORTS, "physicalShortage") as StockoutSortKey,
    dir: qEnum(url, "dir", SORT_DIRECTIONS, "desc"),
  };
  const paging = {
    page: qInt(url, "page", { def: 1, min: 1, max: 100_000 }),
    pageSize: qInt(url, "pageSize", { def: SIGNAL_PAGE_DEFAULT, min: 1, max: SIGNAL_PAGE_MAX }),
  };

  const result = await readReorderSignals(
    status.runId,
    filters,
    paging,
    sort,
    status.inventoryChangedSinceRun,
  );

  return ok({
    section,
    available: true,
    runId: status.runId,
    unavailableMessage: null,
    // Stated on every response: these are observations, not instructions.
    advisory: true,
    activeFilters: describeFilters(filters),
    ...result,
  });
});
