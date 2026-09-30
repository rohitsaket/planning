import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qInt, qStr } from "@/lib/api/with-api";
import { badRequest } from "@/lib/api/errors";
import { PLAN_COVERAGE } from "@/lib/demand/plan-coverage";
import { PLAN_DERIVED_REQUIREMENT_STATUSES, presentRequirementStatus, requirementRemainingNeed } from "@/lib/domain/requirement-need";

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
  if (status) {
    // Plan-derived statuses came from fabricated plan coverage; those requirements are ACTIVE.
    if (PLAN_DERIVED_REQUIREMENT_STATUSES.includes(status)) throw badRequest(`Status '${status}' is not a current requirement status.`);
    where.status = status === "ACTIVE" ? { in: ["ACTIVE", ...PLAN_DERIVED_REQUIREMENT_STATUSES] } : status;
  }
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;
  if (shape) where.shape = shape;
  if (weightBandId) where.weightBandId = weightBandId;
  // % and _ are LIKE wildcards that Prisma does not escape: make them literals.
  if (search) {
    const escaped = search.replace(/[\\%_]/g, "\\$&");
    where.OR = [
      { requirementCode: { contains: escaped, mode: "insensitive" } },
      { customerName: { contains: escaped, mode: "insensitive" } },
      { orderNumber: { contains: escaped, mode: "insensitive" } },
      { shape: { contains: escaped, mode: "insensitive" } },
    ];
  }

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
      status: presentRequirementStatus(r.status),
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
      // Need after stock and WIP; planned coverage is unavailable and never subtracted.
      remainingUnplanned: requirementRemainingNeed(r),
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
    planCoverage: PLAN_COVERAGE,
  });
});
