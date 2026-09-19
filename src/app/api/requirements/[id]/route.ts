import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { withApi, idSchema } from "@/lib/api/with-api";

export const GET = withApi({ permission: "requirement.read" }, async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = idSchema.parse((await params).id);
  const r = await db.requirement.findUnique({
    where: { id },
    include: { weightBand: true, allocations: { include: { planOption: true } } },
  });
  if (!r) throw notFound("Requirement");

  return ok({
    id: r.id,
    requirementCode: r.requirementCode,
    type: r.type,
    status: r.status,
    customerName: r.customerName,
    orderNumber: r.orderNumber,
    groupCode: r.groupCode,
    companyCode: r.companyCode,
    country: r.country,
    branch: r.branch,
    lab: r.labNormalized,
    shape: r.shape,
    weightBand: r.weightBand?.label ?? null,
    colorGroup: r.colorGroup,
    clarityGroup: r.clarityGroup,
    treatment: r.treatment,
    requiredQty: r.requiredQty,
    physicalStockQty: r.physicalStockQty,
    planningAvailableQty: r.planningAvailableQty,
    memoQty: r.memoQty,
    transferCoverage: r.transferCoverage,
    wipCoverage: r.wipCoverage,
    approvedPlanCoverage: r.approvedPlanCoverage,
    actualCoverage: r.actualCoverage,
    remainingUnplanned: r.remainingUnplanned,
    forecastQty: r.forecastQty,
    requiredBy: r.requiredBy?.toISOString() ?? null,
    ageDays: r.ageDays,
    daysRemaining: r.daysRemaining,
    daysOverdue: r.daysOverdue,
    customerPriority: r.customerPriority,
    orderPriority: r.orderPriority,
    requirementPriority: r.requirementPriority,
    priorityReason: r.priorityReason,
    calculationRunId: r.calculationRunId,
    businessRuleVersion: r.businessRuleVersion,
    sourceRecords: r.sourceRecords ? JSON.parse(r.sourceRecords) : null,
    allocations: r.allocations.map((a) => ({
      id: a.id,
      allocatedQty: a.allocatedQty,
      allocatedBy: a.allocatedBy,
      allocatedAt: a.allocatedAt.toISOString(),
      status: a.status,
      planOptionCode: a.planOption?.optionCode ?? null,
    })),
    fourNumbers: {
      physicalShortage: r.requiredQty - r.planningAvailableQty,
      pipelineAdjusted: Math.max(0, r.requiredQty - r.planningAvailableQty - r.wipCoverage),
      planningAdjusted: r.remainingUnplanned,
      forecastRequirement: r.forecastQty,
    },
  });
});
