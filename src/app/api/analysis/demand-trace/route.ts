import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";
import { loadWipPolicy } from "@/lib/demand/wip-classification";
import {
  internalRecordClasses,
  isRecordType,
  toBusinessReason,
  toBusinessStatus,
  toCategoryLabel,
  toRecordType,
  toSourceMode,
  toWipCoverageState,
  type RecordType,
} from "@/lib/demand/demand-result-presentation";

/**
 * DEMAND RESULT DETAILS — safe browser response.
 *
 * The demand engine keeps the formulas, rule identifiers, mapping fingerprints and
 * stored reason text; this route returns business results and the business records
 * behind them, and nothing about how the result is produced. Every field below is
 * mapped explicitly — no internal record is serialized straight to the browser.
 *
 * Aggregates require analysis.read. Record-level evidence additionally requires
 * demand.trace, and is neither queried nor returned without it.
 */

/** Runs that produced a usable snapshot. A failed or running snapshot is never shown as a result. */
const USABLE_RUN_STATUSES = ["COMPLETED", "REVIEW_REQUIRED"];

export const GET = withApi({ permission: "analysis.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const config = getFantasyConfig();
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
      include: { metrics: { orderBy: { planningCategory: "asc" } } },
    }),
    loadWipPolicy(db),
  ]);

  // -------------------------------------------- not run yet, or requested run missing
  if (!targetRun) {
    // A run asked for by id that does not exist is reported as unavailable. The latest run
    // is never substituted for it, because that would answer a different question.
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
      sourceMode: toSourceMode(config.isSimulation, config.sourceMode),
      isSimulated: config.isSimulation,
      recordsConsidered: { sales: 0, inventory: 0, manufacturing: 0, approvedPlanPieces: 0, excluded: 0 },
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
        totalApprovedPlanCoverage: 0,
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

  // ------------------------------------------------------------ category results
  const categories = targetRun.metrics.map((m) => {
    const parts = m.planningCategory.split("|");
    const lab = m.labNormalized || parts[0] || "—";
    const shape = m.shapeNormalized || parts[1] || "—";
    const weightBand = m.weightBandLabel || parts.slice(2).join("|") || "—";

    const physicalShortage = num(m.physicalShortage);
    const remainingUnplanned = num(m.remainingUnplanned);
    const excessStock = num(m.excessStock);
    const businessStatus = toBusinessStatus({
      metricStatus: m.status,
      physicalShortage,
      remainingUnplanned,
      excessStock,
    });

    return {
      // Canonical business key (lab | shape | weight band) used for selection.
      category: m.planningCategory,
      label: toCategoryLabel(lab, shape, weightBand),
      lab,
      shape,
      weightBand,
      // Raw metric state kept for existing consumers; the page shows businessStatus.
      status: m.status,
      businessStatus,
      sales90d: num(m.sales90d),
      roundedTarget: num(m.roundedTarget),
      availableStock: num(m.availableStock),
      memoQty: num(m.memoQty),
      reservedQty: num(m.reservedQty),
      blockedQty: num(m.blockedQty),
      physicalShortage,
      // Null — not zero — when this run could not apply manufacturing coverage.
      wipCoverage: wipCoverage.appliedInRun ? num(m.wipCoverage) : null,
      unallocatedWip: num(m.unallocatedWip),
      pipelineNeed: num(m.pipelineNeed),
      approvedPlanCoverage: num(m.approvedPlanCoverage),
      remainingUnplanned,
      excessStock,
    };
  });

  const selectedCategory = selectedCategoryParam
    ? categories.find((c) => c.category === selectedCategoryParam) ?? null
    : null;
  // A category key that is not part of this run is reported as unavailable rather
  // than silently falling back to another category.
  const selectedCategoryUnavailable = Boolean(selectedCategoryParam) && selectedCategory === null;

  // --------------------------------------------------- supporting business records
  let supportingRecords: {
    recordType: RecordType | null;
    rows: Array<Record<string, unknown>>;
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  } | null = null;

  // Record-level evidence is only queried when the caller may receive it.
  if (canSeeRecords && selectedCategory) {
    const requestedType: RecordType | null =
      recordTypeParam && isRecordType(recordTypeParam) ? recordTypeParam : null;

    const where: Prisma.DemandMetricTraceItemWhereInput = {
      runId: targetRun.id,
      planningCategory: selectedCategory.category,
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
          // Commercial detail follows its own permission, not demand.trace alone.
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
    totalCategories: categories.length,
    totalShortage: categories.reduce((s, c) => s + c.physicalShortage, 0),
    totalExcess: categories.reduce((s, c) => s + c.excessStock, 0),
    totalTarget: categories.reduce((s, c) => s + c.roundedTarget, 0),
    totalPhysicalStock: categories.reduce((s, c) => s + c.availableStock, 0),
    totalMemo: categories.reduce((s, c) => s + c.memoQty, 0),
    totalWipCoverage: categories.reduce((s, c) => s + (c.wipCoverage ?? 0), 0),
    totalPipelineNeed: categories.reduce((s, c) => s + c.pipelineNeed, 0),
    totalApprovedPlanCoverage: categories.reduce((s, c) => s + c.approvedPlanCoverage, 0),
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
    sourceMode: toSourceMode(targetRun.isSimulated, targetRun.sourceMode),
    isSimulated: targetRun.isSimulated,
    recordsConsidered: {
      sales: targetRun.salesCount,
      inventory: targetRun.inventoryCount,
      manufacturing: targetRun.wipCount,
      approvedPlanPieces: targetRun.planCount,
      excluded: targetRun.excludedCount,
    },
    wipCoverage,
    canViewSupportingRecords: canSeeRecords,
    categories,
    selectedCategory,
    selectedCategoryUnavailable,
    supportingRecords,
    summary,
  });
});
