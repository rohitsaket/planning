import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { badRequest } from "@/lib/api/errors";
import { withApi, qStr } from "@/lib/api/with-api";

// Demand Export API — exports snapshot metrics and planning categories for a demand run.
// Protected strictly by demand.export permission.
export const GET = withApi({ permission: "demand.export" }, async (req: Request) => {
  const url = new URL(req.url);
  const runIdParam = qStr(url, "runId");
  const format = qStr(url, "format") || "json";

  const targetRun = await db.demandRun.findFirst({
    where: runIdParam ? { id: runIdParam } : { status: "COMPLETED" },
    orderBy: { runDate: "desc" },
    include: {
      metrics: {
        orderBy: { planningCategory: "asc" },
      },
    },
  });

  if (!targetRun) {
    throw badRequest("No completed demand run found for export.");
  }

  if (format === "csv") {
    const headers = [
      "Planning Category",
      "Lab",
      "Shape",
      "Weight Band",
      "90d Sales",
      "Monthly Avg",
      "Target Stock",
      "Physical Available",
      "Memo Qty",
      "Reserved Qty",
      "Blocked Qty",
      "Physical Shortage",
      "Excess Stock",
      "WIP Coverage",
      "Unallocated WIP",
      "Pipeline Need",
      "Approved Plan Coverage",
      "Remaining Unplanned",
      "Status",
    ];

    const csvRows = targetRun.metrics.map((m) => [
      `"${m.planningCategory}"`,
      `"${m.labNormalized || ""}"`,
      `"${m.shapeNormalized || ""}"`,
      `"${m.weightBandLabel || ""}"`,
      m.sales90d,
      Number(m.monthlyAverage).toFixed(2),
      m.roundedTarget,
      m.availableStock,
      m.memoQty,
      m.reservedQty,
      m.blockedQty,
      m.physicalShortage,
      m.excessStock,
      m.wipCoverage,
      m.unallocatedWip,
      m.pipelineNeed,
      m.approvedPlanCoverage,
      m.remainingUnplanned,
      `"${m.status}"`,
    ].join(","));

    const csvContent = [headers.join(","), ...csvRows].join("\n");
    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="demand-run-${targetRun.id}.csv"`,
      },
    });
  }

  return ok({
    runId: targetRun.id,
    runDate: targetRun.runDate.toISOString(),
    businessDateIst: targetRun.businessDateIst,
    sourcePolicy: targetRun.sourcePolicy,
    mappingFingerprint: targetRun.mappingFingerprint,
    ruleVersion: targetRun.ruleVersion,
    status: targetRun.status,
    totalShortage: targetRun.totalShortage,
    totalExcess: targetRun.totalExcess,
    metrics: targetRun.metrics,
  });
});
