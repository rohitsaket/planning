import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";
import { loadWipPolicy, type WipPolicy } from "@/lib/demand/wip-classification";

/**
 * The calculation policy, served from the authoritative API so every screen shows
 * the same rules instead of keeping its own copy of the explanation text.
 */
function buildRuleMetadata(wipPolicy: WipPolicy, run: { wipPolicyStatus: string; wipEligibleStages: string | null } | null) {
  const wipAppliedInRun = run ? run.wipPolicyStatus === "CONFIGURED" : wipPolicy.appliesCoverage;
  return {
    wipPolicy: {
      ruleId: wipPolicy.ruleId,
      status: wipPolicy.status,
      reason: wipPolicy.reason,
      message: wipPolicy.message,
      ruleStatus: wipPolicy.ruleStatus,
      ruleVersion: wipPolicy.ruleVersion,
      eligibleStages: wipPolicy.eligibleStages,
      appliesCoverage: wipPolicy.appliesCoverage,
    },
    // What the run that produced these numbers actually did.
    wipAppliedInRun,
    runEligibleStages: run?.wipEligibleStages ? run.wipEligibleStages.split(",").filter(Boolean) : [],
    formula: [
      "Monthly Average = Sales90D ÷ 3",
      "Target = Round-half-up(Monthly Average × 2)",
      "Physical Shortage = MAX(0, Target − Available Physical Polished Stock)",
      "Pipeline Requirement = MAX(0, Physical Shortage − Eligible WIP Coverage)",
      "Remaining Unplanned Requirement = MAX(0, Pipeline Requirement − Approved Plan Coverage)",
    ],
    statements: [
      { code: "MEMO", applies: true, text: "Memo consignment stock does not reduce physical shortage (BR-MEMO-001)." },
      {
        code: "RESERVED_BLOCKED",
        applies: true,
        text: "Reserved, blocked, held, unavailable and historical stock do not reduce physical shortage.",
      },
      {
        code: "WIP",
        applies: wipAppliedInRun,
        text: wipAppliedInRun
          ? "Eligible manufacturing WIP reduces the pipeline requirement only — never the physical shortage."
          : `Eligible WIP coverage is not applied: ${wipPolicy.message}`,
      },
      {
        code: "PLAN",
        applies: true,
        text: "Approved plan coverage reduces the remaining unplanned requirement only.",
      },
      { code: "FORECAST", applies: true, text: "Forecast signals are advisory and never create confirmed demand." },
      {
        code: "UNMAPPED_WIP",
        applies: true,
        text: "WIP that cannot be mapped to a planning category stays unallocated and is quarantined for review.",
      },
      {
        code: "NO_DOUBLE_COUNT",
        applies: true,
        text: "No piece is counted twice: output already tracked as WIP or as polished stock is excluded from approved plan coverage.",
      },
    ],
  };
}

// Demand Calculation Trace — exposes every intermediate calculation step,
// confirmed sale events, finished inventory lots, memo consignments, WIP lots,
// exclusions, and exact formula reconciliations per planning category.
export const GET = withApi({ permission: "analysis.read" }, async (req: Request, _ctx, { principal }) => {
  const url = new URL(req.url);
  const config = getFantasyConfig();
  const runIdParam = qStr(url, "runId");
  const selectedCategoryParam = qStr(url, "category");
  const traceTypeParam = qStr(url, "traceType");
  const page = qInt(url, "page", { def: 1, min: 1, max: 10000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });
  const hasTracePermission = principal.permissions.includes("demand.trace");

  // 1. Fetch latest or specified demand run
  // A run that finished needing review is still the newest usable snapshot: show it
  // (its status travels with the response) rather than silently serving an older run.
  const whereRun = runIdParam ? { id: runIdParam } : { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } };
  const [targetRun, wipPolicy] = await Promise.all([
    db.demandRun.findFirst({
      where: whereRun,
      orderBy: { runDate: "desc" },
      include: {
        metrics: {
          orderBy: { planningCategory: "asc" },
        },
      },
    }),
    loadWipPolicy(db),
  ]);

  if (!targetRun) {
    return ok({
      hasEverRun: false,
      rules: buildRuleMetadata(wipPolicy, null),
      sourceMode: config.sourceMode,
      isSimulated: config.isSimulation,
      ruleVersion: "DEMAND-V1",
      runId: null,
      runDate: null,
      businessDateIst: null,
      lookbackStart: null,
      lookbackEnd: null,
      windowDays: 90,
      checkpoint: 0,
      lastBatchId: null,
      sourceCutoff: null,
      sourcePolicy: "CANONICAL_FANTASY",
      mappingFingerprint: null,
      hasTracePermission,
      categories: [],
      traceItems: [],
      traceItemsTotal: 0,
      page,
      pageSize,
      total: 0,
      hasMore: false,
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
      },
    });
  }

  // Fetch paginated trace items if caller has demand.trace permission
  let traceItems: Array<{
    id: string;
    planningCategory: string;
    traceType: string;
    lotId: string | null;
    sourceRecordId: string | null;
    eventKey: string | null;
    quantity: number;
    weight: number | null;
    lab: string | null;
    shape: string | null;
    weightBand: string | null;
    wipStage: string | null;
    customerName: string | null;
    saleTotalUsd: number | null;
    docDate: string | null;
    reason: string | null;
    isIncluded: boolean;
  }> = [];
  let traceItemsTotal = 0;

  if (hasTracePermission) {
    const traceWhere: Prisma.DemandMetricTraceItemWhereInput = { runId: targetRun.id };
    if (selectedCategoryParam) {
      traceWhere.planningCategory = selectedCategoryParam;
    }
    if (traceTypeParam) {
      traceWhere.traceType = traceTypeParam;
    }

    const [items, total] = await Promise.all([
      db.demandMetricTraceItem.findMany({
        where: traceWhere,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ planningCategory: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      }),
      db.demandMetricTraceItem.count({ where: traceWhere }),
    ]);

    traceItemsTotal = total;
    traceItems = items.map((item) => ({
      id: item.id,
      planningCategory: item.planningCategory,
      traceType: item.traceType,
      lotId: item.lotId,
      sourceRecordId: item.sourceRecordId,
      eventKey: item.eventKey,
      quantity: num(item.quantity),
      weight: item.weight ? num(item.weight) : null,
      lab: item.lab,
      shape: item.shape,
      weightBand: item.weightBand,
      wipStage: item.wipStage,
      customerName: item.customerName,
      saleTotalUsd: item.saleTotalUsd ? num(item.saleTotalUsd) : null,
      docDate: item.docDate?.toISOString() ?? null,
      reason: item.reason,
      isIncluded: item.isIncluded,
    }));
  }

  // 2. Map metrics into full trace objects
  const categories = targetRun.metrics.map((m) => {
    const sales90d = num(m.sales90d);
    const monthlyAverage = num(m.monthlyAverage);
    const unroundedTarget = num(m.unroundedTarget);
    const roundedTarget = num(m.roundedTarget);
    const availableStock = num(m.availableStock);
    const memoQty = num(m.memoQty);
    const reservedQty = num(m.reservedQty);
    const blockedQty = num(m.blockedQty);
    const physicalShortage = num(m.physicalShortage);
    const excessStock = num(m.excessStock);
    const wipCoverage = num(m.wipCoverage);
    const unallocatedWip = num(m.unallocatedWip);
    const pipelineNeed = num(m.pipelineNeed);
    const approvedPlanCoverage = num(m.approvedPlanCoverage);
    const remainingUnplanned = num(m.remainingUnplanned);
    const forecastSignal = num(m.forecastSignal);

    let traceDetails = {
      contributingSalesLots: [] as Array<{
        lotId: string;
        sourceRecordId?: string | null;
        docDate: string;
        saleTotalUsd?: number | null;
        customerName?: string | null;
        shape: string;
        weight: number;
        lab: string;
      }>,
      physicalStockLots: [] as Array<{
        lotId: string;
        sourceRecordId?: string | null;
        shape: string;
        weight: number;
        color?: string | null;
        clarity?: string | null;
        locationName?: string | null;
      }>,
      memoLots: [] as Array<{
        lotId: string;
        customerName?: string | null;
        weight: number;
        docDate: string;
      }>,
      eligibleWipLots: [] as Array<{
        lotId: string;
        wipStage?: string | null;
        weight: number;
        kapan?: string | null;
      }>,
      excludedLots: [] as Array<{
        lotId: string;
        reason: string;
      }>,
    };

    if (hasTracePermission && m.traceJson) {
      try {
        traceDetails = JSON.parse(m.traceJson);
      } catch {
        // Fallback to empty trace structures
      }
    }

    const parts = m.planningCategory.split("|");
    const lab = m.labNormalized || parts[0] || "—";
    const shape = m.shapeNormalized || parts[1] || "—";
    const weightBand = m.weightBandLabel || parts.slice(2).join("|") || "—";

    const steps = [
      {
        step: 1,
        label: "90-Day Confirmed Sales (IST Lookback Window)",
        value: sales90d,
        formula: `COUNT(LotHistoryRecord WHERE status IN ['SOLD','INVOICE','EXPLICIT_SALE'] AND docDate BETWEEN ${targetRun.businessDateIst ? `${targetRun.businessDateIst} - 90d` : 'Window'} AND category matches)`,
        source: targetRun.sourcePolicy === "LEGACY_SALES" ? "Legacy Sales Records" : "Canonical Fantasy Sales History (Deduplicated Lifecycles)",
        contributingLotsCount: traceDetails.contributingSalesLots.length,
      },
      {
        step: 2,
        label: "Monthly Average Sales",
        value: monthlyAverage,
        formula: "Sales90d / 3",
        source: "Step 1 / 3",
      },
      {
        step: 3,
        label: "Unrounded 2-Month Target Quantity",
        value: unroundedTarget,
        formula: "Monthly Average × 2",
        source: "Step 2 × 2",
      },
      {
        step: 4,
        label: "Target Stock Quantity (Rounded)",
        value: roundedTarget,
        formula: "round_half_up(Unrounded Target)",
        source: "Step 3 (conventional rounding, 0.5 rounds up)",
      },
      {
        step: 5,
        label: "Physical Available Finished Stock",
        value: availableStock,
        formula: "COUNT(PolishedStone WHERE isCurrent=true AND status='STOCK' AND planningClass IN ['PHYSICAL','PLANNING_AVAILABLE'])",
        source: "Authoritative Operational Polished Stock",
        contributingLotsCount: traceDetails.physicalStockLots.length,
      },
      {
        step: 6,
        label: "Physical Shortage",
        value: physicalShortage,
        formula: "MAX(0, Target Stock - Physical Available)",
        source: "MAX(0, Step 4 - Step 5)",
        tone: physicalShortage > 0 ? "shortage" : "neutral",
      },
      {
        step: 7,
        label: "Memo Consignment Stock (NOT Deducted)",
        value: memoQty,
        formula: "COUNT(PolishedStone WHERE isCurrent=true AND planningClass='MEMO') — Memo stock is NOT deducted from shortage",
        source: "Memo Consignment Mirror",
        tone: "advisory",
        contributingLotsCount: traceDetails.memoLots.length,
      },
      {
        step: 8,
        label: "Eligible Manufacturing WIP Coverage",
        value: wipCoverage,
        formula:
          targetRun.wipPolicyStatus === "CONFIGURED"
            ? `COUNT(current WIP lots whose normalized stage is in [${targetRun.wipEligibleStages || ""}] and whose lab, shape and weight band match this category)`
            : "Not applied — no confirmed WIP coverage rule (BR-WIP-001) was in force for this run",
        source:
          targetRun.wipPolicyStatus === "CONFIGURED"
            ? `Eligible manufacturing WIP per ${wipPolicy.ruleId}${targetRun.wipRuleVersion ? ` v${targetRun.wipRuleVersion}` : ""}`
            : "WIP coverage unavailable (policy not configured)",
        tone: wipCoverage > 0 ? "coverage" : "neutral",
        contributingLotsCount: traceDetails.eligibleWipLots.length,
        unavailable: targetRun.wipPolicyStatus !== "CONFIGURED",
      },
      {
        step: 9,
        label: "Pipeline-Adjusted Requirement",
        value: pipelineNeed,
        formula: "MAX(0, Physical Shortage - Eligible WIP Coverage)",
        source: "MAX(0, Step 6 - Step 8)",
        tone: pipelineNeed > 0 ? "shortage" : "neutral",
      },
      {
        step: 10,
        label: "Approved Plan Coverage",
        value: approvedPlanCoverage,
        formula:
          "COUNT(pieces of selected APPROVED plan options, excluding pieces already tracked as WIP or as polished output)",
        source: "Approved rough production plans (no double count with WIP or polished stock)",
        tone: approvedPlanCoverage > 0 ? "coverage" : "neutral",
      },
      {
        step: 11,
        label: "Remaining Planning Requirement",
        value: remainingUnplanned,
        formula: "MAX(0, Pipeline Need - Approved Plan Coverage)",
        source: "MAX(0, Step 9 - Step 10)",
        tone: remainingUnplanned > 0 ? "shortage" : "neutral",
      },
      {
        step: 12,
        label: "Excess Finished Stock",
        value: excessStock,
        formula: "MAX(0, Physical Available - Target Stock)",
        source: "MAX(0, Step 5 - Step 4)",
        tone: excessStock > 0 ? "excess" : "neutral",
      },
      {
        step: 13,
        label: "Forecast Signal (Advisory Only)",
        value: forecastSignal,
        formula: "Advisory heuristic signal (NOT deducted from operational shortage)",
        source: "Demand calculation advisory model",
        tone: "advisory",
      },
    ];

    return {
      category: m.planningCategory,
      lab,
      shape,
      weightBand,
      sales90d,
      monthlyAverage,
      unroundedTarget,
      roundedTarget,
      availableStock,
      memoQty,
      reservedQty,
      blockedQty,
      physicalShortage,
      excessStock,
      wipCoverage,
      unallocatedWip,
      pipelineNeed,
      approvedPlanCoverage,
      remainingUnplanned,
      forecastSignal,
      status: m.status,
      steps,
      traceDetails: hasTracePermission ? traceDetails : undefined,
      traceAccessRestricted: !hasTracePermission,
      fourNumbers: {
        physicalShortage,
        pipelineAdjusted: pipelineNeed,
        planningAdjusted: remainingUnplanned,
        forecastRequirement: forecastSignal,
      },
    };
  });

  const totalCategories = categories.length;
  const totalShortage = categories.reduce((s, c) => s + c.physicalShortage, 0);
  const totalExcess = categories.reduce((s, c) => s + c.excessStock, 0);
  const totalTarget = categories.reduce((s, c) => s + c.roundedTarget, 0);
  const totalPhysicalStock = categories.reduce((s, c) => s + c.availableStock, 0);
  const totalMemo = categories.reduce((s, c) => s + c.memoQty, 0);
  const totalWipCoverage = categories.reduce((s, c) => s + c.wipCoverage, 0);
  const totalPipelineNeed = categories.reduce((s, c) => s + c.pipelineNeed, 0);
  const totalApprovedPlanCoverage = categories.reduce((s, c) => s + c.approvedPlanCoverage, 0);
  const totalRemainingUnplanned = categories.reduce((s, c) => s + c.remainingUnplanned, 0);

  return ok({
    hasEverRun: true,
    sourceMode: targetRun.sourceMode,
    isSimulated: targetRun.isSimulated,
    ruleVersion: targetRun.ruleVersion,
    sourcePolicy: targetRun.sourcePolicy,
    mappingFingerprint: targetRun.mappingFingerprint,
    mappingVersion: targetRun.mappingVersion,
    status: targetRun.status,
    runId: targetRun.id,
    runDate: targetRun.runDate.toISOString(),
    runDateIST: formatIST(targetRun.runDate),
    businessDateIst: targetRun.businessDateIst,
    lookbackStart: targetRun.lookbackStart?.toISOString() ?? null,
    lookbackEnd: targetRun.lookbackEnd?.toISOString() ?? null,
    windowDays: targetRun.windowDays,
    checkpoint: targetRun.checkpoint,
    lastBatchId: targetRun.lastBatchId,
    sourceCutoff: targetRun.sourceCutoff?.toISOString() ?? null,
    salesCount: targetRun.salesCount,
    inventoryCount: targetRun.inventoryCount,
    wipCount: targetRun.wipCount,
    planCount: targetRun.planCount,
    excludedCount: targetRun.excludedCount,
    hasTracePermission,
    rules: buildRuleMetadata(wipPolicy, targetRun),
    page,
    pageSize,
    traceItemsTotal,
    total: traceItemsTotal,
    hasMore: page * pageSize < traceItemsTotal,
    traceItems,
    categories,
    selectedCategory: selectedCategoryParam
      ? categories.find((c) => c.category === selectedCategoryParam) ?? null
      : null,
    summary: {
      totalCategories,
      totalShortage,
      totalExcess,
      totalTarget,
      totalPhysicalStock,
      totalMemo,
      totalWipCoverage,
      totalPipelineNeed,
      totalApprovedPlanCoverage,
      totalRemainingUnplanned,
      categoriesWithShortage: categories.filter((c) => c.physicalShortage > 0).length,
      categoriesWithExcess: categories.filter((c) => c.excessStock > 0).length,
    },
  });
});
