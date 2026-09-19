import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Country/Branch Analysis — local vs global shortage, transfer candidates
export async function GET() {
  const latestRun = await db.demandRun.findFirst({
    orderBy: { runDate: "desc" },
  });
  if (!latestRun) return ok({ rows: [] });

  const metrics = await db.demandMetric.findMany({
    where: { runId: latestRun.id },
  });

  // Group by country extracted from category (we use planningCategory which is lab|shape|band)
  // Country-specific demand comes from Requirements instead
  const requirements = await db.requirement.findMany({
    where: { remainingUnplanned: { gt: 0 } },
  });

  const byCountry = new Map<string, { shortage: number; target: number; available: number; excess: number; wip: number; planCov: number; transfer: number }>();
  for (const r of requirements) {
    const cur = byCountry.get(r.country) ?? { shortage: 0, target: 0, available: 0, excess: 0, wip: 0, planCov: 0, transfer: 0 };
    cur.shortage += r.remainingUnplanned;
    cur.target += r.requiredQty;
    cur.available += r.physicalStockQty;
    cur.wip += r.wipCoverage;
    cur.planCov += r.approvedPlanCoverage;
    byCountry.set(r.country, cur);
  }
  // Global aggregates
  const globalAgg = metrics.reduce((acc, m) => {
    acc.target += num(m.roundedTarget);
    acc.available += num(m.availableStock);
    acc.shortage += num(m.physicalShortage);
    acc.excess += num(m.excessStock);
    acc.wip += num(m.wipCoverage);
    acc.planCov += num(m.approvedPlanCoverage);
    return acc;
  }, { target: 0, available: 0, shortage: 0, excess: 0, wip: 0, planCov: 0 });

  const rows = Array.from(byCountry.entries()).map(([country, v]) => ({
    country,
    physicalShortage: v.shortage,
    target: v.target,
    available: v.available,
    excess: Math.max(0, v.available - v.target + v.shortage), // approx
    wip: v.wip,
    planCov: v.planCov,
    transferCandidates: 0, // OPEN rule — display separately
  })).sort((a, b) => b.physicalShortage - a.physicalShortage);

  return ok({
    rows,
    global: {
      target: globalAgg.target,
      available: globalAgg.available,
      shortage: globalAgg.shortage,
      excess: globalAgg.excess,
      wip: globalAgg.wip,
      planCov: globalAgg.planCov,
    },
  });
}
