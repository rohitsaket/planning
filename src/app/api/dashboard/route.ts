import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { Prisma } from "@prisma/client";
import { withApi } from "@/lib/api/with-api";
import { REQUIREMENT_HAS_NEED_SQL } from "@/lib/domain/requirement-need";

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
  let forecastRequirement = 0;

  if (latestRun) {
    for (const m of latestRun.metrics) {
      if (lab && m.labNormalized !== lab && m.labNormalized !== "Non-Cert") continue;
      physicalShortage += num(m.physicalShortage);
      pipelineAdjusted += num(m.pipelineNeed);
      forecastRequirement += num(m.forecastSignal);
    }
  }

  const polishedWhere: Record<string, unknown> = {};
  if (country) polishedWhere.country = country;
  if (branch) polishedWhere.branch = branch;
  if (lab) polishedWhere.labNormalized = lab;

  // Requirements with need left after stock and WIP. The stored remainingUnplanned column
  // was reduced by fabricated legacy plan coverage and is not read.
  const reqFilters = [REQUIREMENT_HAS_NEED_SQL];
  if (country) reqFilters.push(Prisma.sql`"country" = ${country}`);
  if (branch) reqFilters.push(Prisma.sql`"branch" = ${branch}`);
  if (lab) reqFilters.push(Prisma.sql`"labNormalized" = ${lab}`);
  const countRequirements = async (extra: Prisma.Sql) => {
    const [row] = await db.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM "Requirement" WHERE ${Prisma.join([...reqFilters, extra], " AND ")}`;
    return row?.n ?? 0;
  };

  const orderWhere: Record<string, unknown> = { status: { in: ["OPEN", "PARTIAL"] } };
  if (country) orderWhere.country = country;
  if (branch) orderWhere.branch = branch;

  const memoWhere: Record<string, unknown> = { status: "OPEN" };
  if (country) memoWhere.country = country;
  if (branch) memoWhere.branch = branch;

  const polishedStock = await db.polishedStone.count({ where: polishedWhere });
  // No rough-stock or planning-case figures: there is no authoritative rough source, and the
  // legacy planning cases were seed data.
  const criticalRequirements = await countRequirements(Prisma.sql`"requirementPriority" = 'CRITICAL'`);
  const highRequirements = await countRequirements(Prisma.sql`"requirementPriority" = 'HIGH'`);
  const overdueRequirements = await countRequirements(Prisma.sql`"daysOverdue" > 0`);
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
  // No run yet is NOT_RUN, never a healthy default.
  const fantasySyncHealth = lastSyncs.length === 0 ? "NOT_RUN" : hasFailed ? "FAILED" : hasPartial ? "PARTIAL" : "HEALTHY";

  // No yield figures: plan-versus-actual results are outside the planning utility, and the only
  // stored reconciliation records are demonstration data.

  return ok({
    physicalShortage,
    pipelineAdjusted,
    forecastRequirement,
    polishedStock,
    criticalRequirements,
    highRequirements,
    overdueRequirements,
    openOrders,
    backorders: num(backorders._sum.backorderQty),
    memoExposure: num(memoExposure._sum.memoValueUsd),
    fantasySyncHealth,
    demandRunId: latestRun?.id ?? null,
    demandRunDate: latestRun?.runDate?.toISOString() ?? null,
  });
});
