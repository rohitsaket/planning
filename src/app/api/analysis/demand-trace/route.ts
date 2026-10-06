import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";
import { resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";
import { loadWipPolicy } from "@/lib/demand/wip-classification";
import {
  internalRecordClasses,
  isRecordType,
  toBusinessReason,
  toBusinessStatus,
  toCategoryLabel,
  toRecordType,
  toWipCoverageState,
  type RecordType,
} from "@/lib/demand/demand-result-presentation";
import { deriveHistoricalSourceState } from "@/lib/fantasy/source-state";
import { describeScope, describeScopeApplication, scopeWhere } from "@/lib/auth/access-scope";
import { PLAN_COVERAGE } from "@/lib/demand/plan-coverage";

const USABLE_RUN_STATUSES = ["COMPLETED", "REVIEW_REQUIRED"];

export const GET = withApi(
  { permission: "analysis.read", scoped: true },
  async (req: Request, _ctx, { principal, scope }) => {
  const url = new URL(req.url);
  const sourceState = await resolveFantasySourceStateWithHistory(db);
  const runIdParam = qStr(url, "runId");
  const selectedCategoryParam = qStr(url, "category", 200);
  const recordTypeParam = qStr(url, "recordType", 40);
  const page = qInt(url, "page", { def: 1, min: 1, max: 10000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const canSeeRecords = principal.permissions.includes("demand.trace");
  const canSeeCustomers = principal.permissions.includes("customers.read");
  const canSeeSaleValues = principal.permissions.includes("sales.read");

  const [targetRun, wipPolicy] = await Promise.all([
    db.demandRun.findFirst({
      where: runIdParam ? { id: runIdParam } : { status: { in: USABLE_RUN_STATUSES } },
      orderBy: { runDate: "desc" },
      include: {
        metrics: {
          where: { ...scopeWhere(scope, { country: null, lab: "labNormalized" }) },
          orderBy: { planningCategory: "asc" },
        },
      },
    }),
    loadWipPolicy(db),
  ]);

  if (!targetRun) {
    const runUnavailable = Boolean(runIdParam);
    return ok({
      hasEverRun: false,
      runUnavailable,
      status: runUnavailable ? "RUN_UNAVAILABLE" : "NOT_RUN",
      statusLabel: runUnavailable
        ? "Selected demand run is unavailable"
        : "No demand calculation available",
      runId: null,
      calculatedAt: null,
      calculatedAtIst: null,
      businessDateIst: null,
      windowDays: 90,
      lookbackStart: null,
      lookbackEnd: null,
      sourceMode: sourceState.effectiveState,
      isSimulated: sourceState.isSimulated,
      recordsConsidered: { sales: 0, inventory: 0, manufacturing: 0, excluded: 0 },
      planCoverage: PLAN_COVERAGE,
      wipCoverage: toWipCoverageState({ policyConfigured: wipPolicy.appliesCoverage, appliedInRun: false }),
      canViewSupportingRecords: canSeeRecords,
      categories: [],
      selectedCategory: null,
      supportingRecords: null,
      summary: {
        totalCategories: 0,
        totalShortage: 0,
        totalExcess: 0,
        totalTarget: 0,
        totalPhysicalStock: 0,
        totalMemo: 0,
        totalWipCoverage: 0,
        totalPipelineNeed: 0,
        totalApprovedPlanCoverage: null,
        totalRemainingUnplanned: 0,
        categoriesWithShortage: 0,
        categoriesWithExcess: 0,
      },
    });
  }

  const wipCoverage = toWipCoverageState({
    policyConfigured: wipPolicy.appliesCoverage,
    appliedInRun: targetRun.wipPolicyStatus === "CONFIGURED",
  });

  const categories = targetRun.metrics.map((m) => {
    const parts = m.planningCategory.split("|");
    const lab = m.labNormalized || parts[0] || "—";
    const shape = m.shapeNormalized || parts[1] || "—";
    const weightBand = m.weightBandLabel || parts.slice(2).join("|") || "—";

    const physicalShortage = num(m.physicalShortage);
    const remainingUnplanned = num(m.pipelineNeed);
    const excessStock = num(m.excessStock);
    const businessStatus = toBusinessStatus({
      metricStatus: m.status,
      physicalShortage,
      remainingUnplanned,
      excessStock,
    });

    return {
      category: m.planningCategory,
      label: toCategoryLabel(lab, shape, weightBand),
      lab,
      shape,
      weightBand,
      status: m.status,
      businessStatus,
      sales90d: num(m.sales90d),
      roundedTarget: num(m.roundedTarget),
      availableStock: num(m.availableStock),
      memoQty: num(m.memoQty),
      reservedQty: num(m.reservedQty),
      blockedQty: num(m.blockedQty),
      physicalShortage,
      wipCoverage: wipCoverage.appliedInRun ? num(m.wipCoverage) : null,
      unallocatedWip: num(m.unallocatedWip),
      pipelineNeed: num(m.pipelineNeed),
      approvedPlanCoverage: null,
      remainingUnplanned,
      excessStock,
    };
  });

  const selectedCategory = selectedCategoryParam
    ? categories.find((c) => c.category === selectedCategoryParam) ?? null
    : null;
  const selectedCategoryUnavailable = Boolean(selectedCategoryParam) && selectedCategory === null;

  let supportingRecords: {
    recordType: RecordType | null;
    rows: Array<Record<string, unknown>>;
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  } | null = null;

  if (canSeeRecords && selectedCategory) {
    const requestedType: RecordType | null =
      recordTypeParam && isRecordType(recordTypeParam) ? recordTypeParam : null;

    const where: Prisma.DemandMetricTraceItemWhereInput = {
      runId: targetRun.id,
      planningCategory: selectedCategory.category,
      ...scopeWhere(scope, { country: null, lab: "lab" }),
    };
    if (requestedType) where.traceType = { in: internalRecordClasses(requestedType) };

    const [items, total] = await Promise.all([
      db.demandMetricTraceItem.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ traceType: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      db.demandMetricTraceItem.count({ where }),
    ]);

    supportingRecords = {
      recordType: requestedType,
      rows: items.map((item) => {
        const inclusionStatus = item.isIncluded ? "INCLUDED" : "EXCLUDED";
        return {
          id: item.id,
          recordType: toRecordType(item.traceType),
          businessId: item.lotId ?? "—",
          inclusionStatus,
          reason: toBusinessReason(item.isIncluded, item.reason),
          docDate: item.docDate?.toISOString() ?? null,
          quantity: num(item.quantity),
          weight: item.weight === null ? null : num(item.weight),
          lab: item.lab,
          shape: item.shape,
          weightBand: item.weightBand,
          manufacturingStage: item.wipStage,
          customerName: canSeeCustomers ? item.customerName : null,
          saleValue: canSeeSaleValues && item.saleTotalUsd !== null ? num(item.saleTotalUsd) : null,
        };
      }),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  const summary = {
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["LAB"]),
    totalCategories: categories.length,
    totalShortage: categories.reduce((s, c) => s + c.physicalShortage, 0),
    totalExcess: categories.reduce((s, c) => s + c.excessStock, 0),
    totalTarget: categories.reduce((s, c) => s + c.roundedTarget, 0),
    totalPhysicalStock: categories.reduce((s, c) => s + c.availableStock, 0),
    totalMemo: categories.reduce((s, c) => s + c.memoQty, 0),
    totalWipCoverage: categories.reduce((s, c) => s + (c.wipCoverage ?? 0), 0),
    totalPipelineNeed: categories.reduce((s, c) => s + c.pipelineNeed, 0),
    totalApprovedPlanCoverage: null,
    totalRemainingUnplanned: categories.reduce((s, c) => s + c.remainingUnplanned, 0),
    categoriesWithShortage: categories.filter((c) => c.physicalShortage > 0).length,
    categoriesWithExcess: categories.filter((c) => c.excessStock > 0).length,
  };

  return ok({
    hasEverRun: true,
    runUnavailable: false,
    status: targetRun.status,
    statusLabel: targetRun.status === "REVIEW_REQUIRED" ? "Review required" : "Calculation completed",
    runId: targetRun.id,
    calculatedAt: targetRun.runDate.toISOString(),
    calculatedAtIst: formatIST(targetRun.runDate),
    businessDateIst: targetRun.businessDateIst,
    windowDays: targetRun.windowDays,
    lookbackStart: targetRun.lookbackStart?.toISOString() ?? null,
    lookbackEnd: targetRun.lookbackEnd?.toISOString() ?? null,
    sourceMode: deriveHistoricalSourceState(targetRun.isSimulated, targetRun.sourceMode),
    isSimulated: targetRun.isSimulated,
    recordsConsidered: {
      sales: targetRun.salesCount,
      inventory: targetRun.inventoryCount,
      manufacturing: targetRun.wipCount,
      excluded: targetRun.excludedCount,
    },
    wipCoverage,
    planCoverage: PLAN_COVERAGE,
    canViewSupportingRecords: canSeeRecords,
    categories,
    selectedCategory,
    selectedCategoryUnavailable,
    supportingRecords,
    summary,
  });
},
);
