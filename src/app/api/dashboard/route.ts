import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Executive Dashboard KPIs - all values drilldown to evidence
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");
  const lab = url.searchParams.get("lab");

  // Aggregate from DemandMetric (latest run)
  const latestRun = await db.demandRun.findFirst({
    orderBy: { runDate: "desc" },
    include: { metrics: true },
  });

  let physicalShortage = 0;
  let pipelineAdjusted = 0;
  let approvedPlanCoverage = 0;
  let remainingUnplanned = 0;
  let forecastRequirement = 0;

  if (latestRun) {
    for (const m of latestRun.metrics) {
      if (lab && m.labNormalized !== lab && m.labNormalized !== "Non-Cert") continue;
      physicalShortage += num(m.physicalShortage);
      pipelineAdjusted += num(m.pipelineNeed);
      approvedPlanCoverage += num(m.approvedPlanCoverage);
      remainingUnplanned += num(m.remainingUnplanned);
      forecastRequirement += num(m.forecastSignal);
    }
  }

  const polishedWhere: Record<string, unknown> = {};
  if (country) polishedWhere.country = country;
  if (branch) polishedWhere.branch = branch;
  if (lab) polishedWhere.labNormalized = lab;

  const roughWhere: Record<string, unknown> = {};
  if (country) roughWhere.country = country;
  if (branch) roughWhere.branch = branch;

  const reqWhere: Record<string, unknown> = { remainingUnplanned: { gt: 0 } };
  if (country) reqWhere.country = country;
  if (branch) reqWhere.branch = branch;
  if (lab) reqWhere.labNormalized = lab;

  const orderWhere: Record<string, unknown> = { status: { in: ["OPEN", "PARTIAL"] } };
  if (country) orderWhere.country = country;
  if (branch) orderWhere.branch = branch;

  const memoWhere: Record<string, unknown> = { status: "OPEN" };
  if (country) memoWhere.country = country;
  if (branch) memoWhere.branch = branch;

  const polishedStock = await db.polishedStone.count({ where: polishedWhere });
  const roughAvailable = await db.roughStone.count({
    where: { ...roughWhere, planningStatus: "AVAILABLE", planningEligible: true },
  });
  const roughReserved = await db.roughStone.count({
    where: { ...roughWhere, planningStatus: { in: ["RESERVED", "PLAN_APPROVED", "RELEASED_TO_MANUFACTURING"] } },
  });
  const currentWip = await db.planOptionPiece.count({
    where: {
      planOption: {
        approvalStatus: { in: ["APPROVED", "RELEASED"] },
      },
    },
  });

  const criticalRequirements = await db.requirement.count({
    where: { ...reqWhere, requirementPriority: "CRITICAL" },
  });
  const highRequirements = await db.requirement.count({
    where: { ...reqWhere, requirementPriority: "HIGH" },
  });
  const overdueRequirements = await db.requirement.count({
    where: { ...reqWhere, daysOverdue: { gt: 0 } },
  });
  const openOrders = await db.salesOrder.count({ where: orderWhere });
  const backorders = await db.salesOrderLine.aggregate({
    _sum: { backorderQty: true },
  });
  const memoExposure = await db.memoRecord.aggregate({
    _sum: { memoValueUsd: true },
    where: memoWhere,
  });

  // Sync health
  const lastSyncs = await db.integrationSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  const hasFailed = lastSyncs.some((s) => s.status === "FAILED");
  const hasPartial = lastSyncs.some((s) => s.status === "PARTIAL");
  const fantasySyncHealth = hasFailed ? "FAILED" : hasPartial ? "PARTIAL" : "HEALTHY";

  // Yield variance
  const reconciliations = await db.planActualReconciliation.findMany({ take: SCAN_MAX }).then(scanned);
  let plannedYield = 0;
  let actualYield = 0;
  let yieldVariance = 0;
  if (reconciliations.length > 0) {
    plannedYield = num(reconciliations.reduce((s, r) => s + num(r.plannedYieldPct), 0) / reconciliations.length);
    actualYield = num(reconciliations.reduce((s, r) => s + num(r.actualYieldPct), 0) / reconciliations.length);
    yieldVariance = num(reconciliations.reduce((s, r) => s + num(r.yieldVariance), 0) / reconciliations.length);
  }

  return ok({
    physicalShortage,
    pipelineAdjusted,
    approvedPlanCoverage,
    remainingUnplanned,
    forecastRequirement,
    polishedStock,
    roughAvailable,
    roughReserved,
    currentWip,
    criticalRequirements,
    highRequirements,
    overdueRequirements,
    openOrders,
    backorders: num(backorders._sum.backorderQty),
    memoExposure: num(memoExposure._sum.memoValueUsd),
    fantasySyncHealth,
    plannedYield,
    actualYield,
    yieldVariance,
    demandRunId: latestRun?.id ?? null,
    demandRunDate: latestRun?.runDate?.toISOString() ?? null,
    ruleVersion: latestRun?.ruleVersion ?? null,
  });
});
