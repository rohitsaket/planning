import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { CONFIRMED_WEIGHT_BANDS } from "@/lib/domain/diamond-rules";
import { withApi, qStr, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Reports — multiple pre-built report bundles
export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const type = qStr(url, "type") || "summary";

  if (type === "summary") {
    const totalSales = await db.salesRecord.count({ where: { lotStatusDb: "Invoice" } });
    const totalPolished = await db.polishedStone.count();
    const totalRough = await db.roughStone.count();
    const totalRequirements = await db.requirement.count();
    const totalCases = await db.planningCase.count();
    const approvedCases = await db.planningCase.count({ where: { status: { in: ["APPROVED", "RELEASED_TO_MANUFACTURING"] } } });
    return ok({
      type,
      summary: {
        totalSalesInvoices: totalSales,
        totalPolishedLots: totalPolished,
        totalRoughStones: totalRough,
        totalRequirements,
        totalPlanningCases: totalCases,
        approvedPlanningCases: approvedCases,
        approvalRate: totalCases > 0 ? num((approvedCases / totalCases) * 100) : 0,
      },
    });
  }

  if (type === "sales-by-category") {
    const records = await db.salesRecord.findMany({ take: SCAN_MAX, where: { lotStatusDb: "Invoice" }, include: { weightBand: true } }).then(scanned);
    const agg = new Map<string, { pieces: number; value: number }>();
    for (const r of records) {
      const cat = `${r.labNormalized ?? "Non-Cert"}|${r.shape}|${r.weightBand?.label ?? "Unmapped"}`;
      const cur = agg.get(cat) ?? { pieces: 0, value: 0 };
      cur.pieces += 1; cur.value += num(r.saleTotalUsd);
      agg.set(cat, cur);
    }
    return ok({
      type,
      rows: Array.from(agg.entries()).map(([cat, v]) => ({ category: cat, pieces: v.pieces, value: num(v.value) })).sort((a, b) => b.pieces - a.pieces),
    });
  }

  if (type === "critical-requirements") {
    const reqs = await db.requirement.findMany({ take: SCAN_MAX,
      where: { requirementPriority: "CRITICAL", remainingUnplanned: { gt: 0 } },
      include: { weightBand: true },
      orderBy: { remainingUnplanned: "desc" },
    }).then(scanned);
    return ok({
      type,
      rows: reqs.map((r) => ({
        requirementCode: r.requirementCode,
        type: r.type,
        country: r.country,
        lab: r.labNormalized,
        shape: r.shape,
        weightBand: r.weightBand?.label,
        remainingUnplanned: r.remainingUnplanned,
        requiredBy: r.requiredBy?.toISOString() ?? null,
        priorityReason: r.priorityReason,
      })),
    });
  }

  if (type === "yield-variance") {
    const recs = await db.planActualReconciliation.findMany({ take: SCAN_MAX, include: { planOption: true } }).then(scanned);
    return ok({
      type,
      rows: recs.map((r) => ({
        planOptionCode: r.planOption?.optionCode,
        expectedPieces: r.expectedPieces,
        actualPieces: r.actualPieces,
        plannedYield: num(r.plannedYieldPct),
        actualYield: num(r.actualYieldPct),
        variance: num(r.yieldVariance),
        expectedCoverage: r.expectedCoverage,
        actualCoverage: r.actualCoverage,
        status: r.status,
      })),
    });
  }

  if (type === "weight-bands-config") {
    return ok({ type, rows: CONFIRMED_WEIGHT_BANDS });
  }

  return ok({ type: "unknown", message: "Use ?type=summary|sales-by-category|critical-requirements|yield-variance|weight-bands-config" });
});
