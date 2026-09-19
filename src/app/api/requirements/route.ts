import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qInt, qStr } from "@/lib/api/with-api";

// Requirements Matrix — high-density enterprise grid
// Supports filters: type, status, country, branch, lab, shape, weightBand, priority
// Supports sort, server-side pagination
export const GET = withApi({ permission: "requirement.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 100, min: 1, max: 500 });
  const type = qStr(url, "type");
  const status = qStr(url, "status");
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const shape = qStr(url, "shape");
  const weightBandId = qStr(url, "weightBandId");
  const priority = qStr(url, "priority");
  const search = qStr(url, "q", 100);

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (status) where.status = status;
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;
  if (shape) where.shape = shape;
  if (weightBandId) where.weightBandId = weightBandId;
  if (priority) where.requirementPriority = priority;
  // % and _ are LIKE wildcards that Prisma does not escape: make them literals.
  if (search) where.requirementCode = { contains: search.replace(/[\\%_]/g, "\\$&") };

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
});
