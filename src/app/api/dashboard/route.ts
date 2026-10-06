import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi } from "@/lib/api/with-api";
import { scopeWhere } from "@/lib/auth/access-scope";
import { memoWhere, readMemoFilters } from "@/lib/analysis/memo";

// Overview KPIs. Every figure is narrowed to the caller's access scope first; the page's
// country, branch and lab filters can narrow it further, never widen it. Requirement and
// order figures are gone: those records were seeded and their workflows are out of scope.
export const GET = withApi({ permission: "analysis.read", scoped: true, query: ["country", "branch", "lab"] }, async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  // Read and validated once; memo exposure uses exactly the Memo Analysis filter.
  const filters = readMemoFilters(url, scope);
  const { country, branch, lab } = filters;

  // The latest demand calculation, summed in the database. Demand categories carry a lab but
  // no location. A lab filter keeps that lab's categories and the Non-Cert ones.
  const latestRun = await db.demandRun.findFirst({ orderBy: { runDate: "desc" }, select: { id: true, runDate: true } });
  const metricWhere: Prisma.DemandMetricWhereInput = latestRun
    ? { AND: [{ runId: latestRun.id }, scopeWhere(scope, { country: null, lab: "labNormalized" }), lab ? { labNormalized: { in: [lab, "Non-Cert"] } } : {}] }
    : {};
  const demand = latestRun
    ? await db.demandMetric.aggregate({ where: metricWhere, _sum: { physicalShortage: true, pipelineNeed: true, forecastSignal: true } })
    : null;

  const polishedWhere: Prisma.PolishedStoneWhereInput = {
    AND: [
      scopeWhere(scope, { country: "country", lab: "labNormalized" }),
      { ...(country ? { country } : {}), ...(branch ? { branch } : {}), ...(lab ? { labNormalized: lab } : {}) },
    ],
  };

  // No rough-stock, planning-case, requirement or order figures: there is no authoritative
  // source for any of them.
  const [polishedStock, memoExposure, lastSyncs] = await Promise.all([
    db.polishedStone.count({ where: polishedWhere }),
    db.memoRecord.aggregate({ _sum: { memoValueUsd: true }, where: memoWhere({ ...filters, status: "OPEN" }) }),
    db.integrationSyncRun.findMany({ orderBy: { startedAt: "desc" }, take: 5, select: { status: true } }),
  ]);

  // Sync health. No run yet is NOT_RUN, never a healthy default.
  const hasFailed = lastSyncs.some((s) => s.status === "FAILED");
  const hasPartial = lastSyncs.some((s) => s.status === "PARTIAL");
  const fantasySyncHealth = lastSyncs.length === 0 ? "NOT_RUN" : hasFailed ? "FAILED" : hasPartial ? "PARTIAL" : "HEALTHY";

  // No yield figures: plan-versus-actual results are outside the planning utility, and the only
  // stored reconciliation records are demonstration data.

  return ok({
    physicalShortage: num(demand?._sum.physicalShortage),
    pipelineAdjusted: num(demand?._sum.pipelineNeed),
    forecastRequirement: num(demand?._sum.forecastSignal),
    polishedStock,
    memoExposure: num(memoExposure._sum.memoValueUsd),
    fantasySyncHealth,
    demandRunId: latestRun?.id ?? null,
    demandRunDate: latestRun?.runDate?.toISOString() ?? null,
  });
});
