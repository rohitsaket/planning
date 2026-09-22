import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qInt } from "@/lib/api/with-api";
import { analyzeTransfers, rollupByCountry } from "@/lib/analytics/stock-position";

// Transfer Candidate Analyzer — advisory only, BR-TRANSFER-001 is not client-confirmed.
//
// Candidates come from the shared stock-position service (the Country & Branch view
// reads the same analysis), matched inside one exact category:
//   source country has excess, destination country has remaining unplanned shortage,
//   quantity = MIN(source excess, destination shortage), source ≠ destination.
//
// Nothing here creates a transfer, requirement, reservation or order.
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const { positions, transfers, wipPolicy, wipCoverageUnavailable } = await analyzeTransfers(db);

  const total = transfers.candidates.length;
  const rows = transfers.candidates.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Country balance is built from the same per-category positions, not from the
  // candidate list, so excess and shortage are not double counted across pairs.
  const countryBalance = rollupByCountry(positions)
    .map((c) => ({
      country: c.country,
      totalExcess: c.excess,
      totalShortage: c.remainingUnplanned,
      netBalance: c.excess - c.remainingUnplanned,
      categories: c.categories,
    }))
    .sort((a, b) => b.netBalance - a.netBalance || a.country.localeCompare(b.country));

  return ok({
    status: transfers.status,
    ruleId: transfers.ruleId,
    ruleStatus: transfers.ruleStatus,
    advisoryNotice: transfers.message,
    autoExecuted: transfers.autoExecuted,
    summary: {
      candidateCount: transfers.candidateCount,
      totalTransferQty: transfers.totalTransferQty,
      countriesWithExcess: transfers.countriesWithExcess,
      countriesWithShortage: transfers.countriesWithShortage,
      categoriesAnalyzed: positions.length,
    },
    wipPolicy: {
      status: wipPolicy.status,
      message: wipPolicy.message,
    },
    wipCoverageUnavailable,
    countryBalance,
    rows,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
});
