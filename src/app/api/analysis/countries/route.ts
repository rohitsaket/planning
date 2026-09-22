import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr } from "@/lib/api/with-api";
import {
  analyzeTransfers,
  rollupByBranch,
  rollupByCountry,
  type CategoryPosition,
} from "@/lib/analytics/stock-position";

// Country / Branch position — every figure is derived per exact category
// (Country + Lab + Shape + Weight Band) and only then rolled up, so a shortage in
// one category is never netted against an excess in another.
//
// Transfer candidates come from the shared transfer service used by the Transfer
// Analyzer; the count is the real number of candidate pairs, or null when the
// analysis cannot run.
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");

  const { positions, transfers, wipPolicy, wipCoverageUnavailable } = await analyzeTransfers(db);

  const filtered: CategoryPosition[] = positions.filter(
    (p) =>
      (!country || p.country === country) &&
      (!branch || p.branch === branch) &&
      (!lab || p.lab === lab.trim().toUpperCase()),
  );

  const countries = rollupByCountry(filtered);
  const branches = rollupByBranch(filtered);

  // Candidate counts per source country, from the same shared analysis.
  const candidatesByCountry = new Map<string, number>();
  if (transfers.candidateCount !== null) {
    for (const c of transfers.candidates) {
      candidatesByCountry.set(c.fromCountry, (candidatesByCountry.get(c.fromCountry) ?? 0) + 1);
    }
  }

  const rows = countries.map((c) => ({
    country: c.country,
    target: c.target,
    available: c.available,
    physicalShortage: c.physicalShortage,
    excess: c.excess,
    wip: c.eligibleWip,
    planCov: c.approvedPlanCoverage,
    pipelineRequirement: c.pipelineRequirement,
    remainingUnplanned: c.remainingUnplanned,
    categories: c.categories,
    categoriesWithShortage: c.categoriesWithShortage,
    categoriesWithExcess: c.categoriesWithExcess,
    // null (not 0) when transfer analysis could not run at all.
    transferCandidates: transfers.candidateCount === null ? null : candidatesByCountry.get(c.country) ?? 0,
    transferStatus: transfers.status,
  }));

  const global = filtered.reduce(
    (acc, p) => {
      acc.target += p.target;
      acc.available += p.available;
      acc.shortage += p.physicalShortage;
      acc.excess += p.excess;
      acc.wip += p.eligibleWip;
      acc.planCov += p.approvedPlanCoverage;
      acc.pipelineRequirement += p.pipelineRequirement;
      acc.remainingUnplanned += p.remainingUnplanned;
      return acc;
    },
    { target: 0, available: 0, shortage: 0, excess: 0, wip: 0, planCov: 0, pipelineRequirement: 0, remainingUnplanned: 0 },
  );

  return ok({
    rows,
    branches: branches.map((b) => ({
      country: b.country,
      branch: b.branch,
      target: b.target,
      available: b.available,
      physicalShortage: b.physicalShortage,
      excess: b.excess,
      wip: b.eligibleWip,
      planCov: b.approvedPlanCoverage,
      remainingUnplanned: b.remainingUnplanned,
      categories: b.categories,
    })),
    global,
    categoryCount: filtered.length,
    wipPolicy: {
      status: wipPolicy.status,
      message: wipPolicy.message,
      ruleId: wipPolicy.ruleId,
      eligibleStages: wipPolicy.eligibleStages,
    },
    wipCoverageUnavailable,
    transfer: {
      status: transfers.status,
      ruleId: transfers.ruleId,
      ruleStatus: transfers.ruleStatus,
      candidateCount: transfers.candidateCount,
      message: transfers.message,
      autoExecuted: transfers.autoExecuted,
    },
  });
});
