import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Requirements Matrix — high-density enterprise grid
// Supports filters: type, status, country, branch, lab, shape, weightBand, priority
// Supports sort, server-side pagination
export async function GET(req: Request) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(500, Math.max(10, parseInt(url.searchParams.get("pageSize") || "100", 10)));
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const country = url.searchParams.get("country");
  const branch = url.searchParams.get("branch");
  const lab = url.searchParams.get("lab");
  const shape = url.searchParams.get("shape");
  const weightBandId = url.searchParams.get("weightBandId");
  const priority = url.searchParams.get("priority");
  const search = url.searchParams.get("q");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;
  if (shape) where.shape = shape;
  if (weightBandId) where.weightBandId = weightBandId;
  if (priority) where.requirementPriority = priority;
  if (search) where.requirementCode = { contains: search };

  const [total, rows] = await Promise.all([
    db.requirement.count({ where }),
    db.requirement.findMany({
      where,
      include: { weightBand: true },
      orderBy: { requirementPriority: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return ok({
    data: rows.map((r) => ({
      id: r.id,
      requirementCode: r.requirementCode,
      type: r.type,
      status: r.status,
      customerName: r.customerName,
      orderNumber: r.orderNumber,
      country: r.country,
      branch: r.branch,
      lab: r.labNormalized,
      shape: r.shape,
      weightBand: r.weightBand?.label ?? null,
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
      sourceRecords: r.sourceRecords,
      businessRuleVersion: r.businessRuleVersion,
    })),
    total,
    page,
    pageSize,
  });
}
