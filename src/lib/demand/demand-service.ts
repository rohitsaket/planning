/**
 * Authoritative Demand & Inventory Calculation Service.
 * 
 * Implements:
 * - Deterministic planning category resolution (Lab + Shape + Weight Band)
 * - Authoritative sale event extraction & deduplication
 * - 90-day IST calendar boundary lookback
 * - Current finished inventory, memo, WIP, and plan coverage separation
 * - Exact confirmed demand formulas (Physical Shortage, Excess, Pipeline Need, Planning Need)
 * - Immutable run snapshots and 100% explainable Demand Trace
 * - Database-backed atomic concurrency control & authorized unlock
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { resolveLabNormalization, normalizeShape } from "@/lib/fantasy/canonical";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST, getISTDateString, parseISTDateToUTC, nowUTC } from "@/lib/fantasy/time";
import { roundHalfUpInt } from "@/lib/domain/diamond-rules";

export interface DemandRunOptions {
  actor?: string;
  actorUserId?: string;
  windowDays?: number;
  referenceDate?: Date;
}

export interface DemandCategoryTrace {
  category: string;
  labNormalized: string;
  shapeNormalized: string;
  weightBandCode: string;
  weightBandLabel: string;
  sales90d: number;
  monthlyAverage: number;
  unroundedTarget: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  excessStock: number;
  wipCoverage: number;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastSignal: number;
  contributingSalesLots: Array<{
    lotId: string;
    sourceRecordId?: string | null;
    docDate: string;
    saleTotalUsd?: number | null;
    customerName?: string | null;
    shape: string;
    weight: number;
    lab: string;
  }>;
  physicalStockLots: Array<{
    lotId: string;
    sourceRecordId?: string | null;
    shape: string;
    weight: number;
    color?: string | null;
    clarity?: string | null;
    locationName?: string | null;
  }>;
  memoLots: Array<{
    lotId: string;
    customerName?: string | null;
    weight: number;
    docDate: string;
  }>;
  eligibleWipLots: Array<{
    lotId: string;
    wipStage?: string | null;
    weight: number;
    kapan?: string | null;
  }>;
  excludedLots: Array<{
    lotId: string;
    reason: string;
  }>;
}

export interface DemandRunResult {
  success: boolean;
  status: string;
  runId: string;
  runDate: string;
  categoriesProcessed: number;
  businessDateIst: string;
  lookbackStart: string;
  lookbackEnd: string;
  windowDays: number;
  ruleVersion: string;
  totalCategories: number;
  totalShortage: number;
  totalExcess: number;
  totalTarget: number;
  totalPhysicalStock: number;
  totalMemo: number;
  totalWipCoverage: number;
  totalPipelineNeed: number;
  totalApprovedPlanCoverage: number;
  totalRemainingUnplanned: number;
  salesCount: number;
  inventoryCount: number;
  wipCount: number;
  excludedCount: number;
  checkpoint: number;
  lastBatchId: string | null;
  isSimulated: boolean;
  durationMs: number;
  categories: DemandCategoryTrace[];
  errorSummary?: string;
}

/**
 * Ensures the singleton DemandCalculationLock record exists.
 */
async function ensureLockRecord() {
  const existing = await db.demandCalculationLock.findUnique({
    where: { id: "DEMAND_CALCULATION" },
  });
  if (!existing) {
    try {
      await db.demandCalculationLock.create({
        data: {
          id: "DEMAND_CALCULATION",
          isLocked: false,
        },
      });
    } catch {
      // Ignore race on initialization
    }
  }
}

/**
 * Explicitly releases a stuck demand calculation lock.
 */
export async function unlockDemandCalculation(actor: string, reason?: string): Promise<{ success: boolean; message: string }> {
  await ensureLockRecord();
  await db.demandCalculationLock.update({
    where: { id: "DEMAND_CALCULATION" },
    data: {
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      runId: null,
    },
  });

  return {
    success: true,
    message: `Demand calculation lock explicitly released by ${actor}. Reason: ${reason ?? "Administrative release"}`,
  };
}

/**
 * Resolves exactly one WeightBand for a given carat weight.
 */
function resolveWeightBand(weight: number, bands: Array<{ id: string; code: string; label: string; minCt: Prisma.Decimal; maxCt: Prisma.Decimal }>) {
  for (const b of bands) {
    const min = Number(b.minCt);
    const max = Number(b.maxCt);
    if (weight >= min && weight <= max) {
      return b;
    }
  }
  return null;
}

/**
 * Executes a full, deterministic 90-day Demand & Inventory calculation run.
 */
export async function runDemandCalculation(options: DemandRunOptions = {}): Promise<DemandRunResult> {
  const startTime = Date.now();
  const config = getFantasyConfig();
  await ensureLockRecord();

  // 1. ATOMIC LOCK ACQUISITION
  const lockResult = await db.demandCalculationLock.updateMany({
    where: {
      id: "DEMAND_CALCULATION",
      isLocked: false,
    },
    data: {
      isLocked: true,
      lockedAt: nowUTC(),
      lockedBy: options.actor ?? "SYSTEM",
    },
  });

  if (lockResult.count === 0) {
    throw new Error("A demand calculation run is currently in progress by another worker. Concurrent runs are prevented.");
  }

  let lockReleasedInTx = false;

  try {
    const windowDays = options.windowDays ?? 90;
    const refDate = options.referenceDate ?? new Date();

    // 2. Compute 90-Day IST Calendar Boundaries
    const businessDateIst = getISTDateString(refDate);
    const refDateUtc = parseISTDateToUTC(businessDateIst); // 00:00:00 IST

    // Start of lookback: 90 days before reference date in IST
    const lookbackStartIstDate = new Date(refDateUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
    const lookbackStart = lookbackStartIstDate; // UTC representation
    const lookbackEnd = new Date(refDateUtc.getTime() + 24 * 60 * 60 * 1000 - 1); // 23:59:59.999 IST

    // 3. Load active mappings and weight bands
    const [labMappingsList, shapeMappingsList, weightBands] = await Promise.all([
      db.labMapping.findMany({ where: { active: true } }),
      db.shapeMapping.findMany({ where: { active: true } }),
      db.weightBand.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    ]);

    const labMappingsMap = new Map<string, string>();
    for (const m of labMappingsList) {
      labMappingsMap.set(m.rawLab.trim(), m.normalizedLab);
      labMappingsMap.set(m.rawLab.trim().toUpperCase(), m.normalizedLab);
    }

    const shapeMappingsMap = new Map<string, string>();
    for (const m of shapeMappingsList) {
      shapeMappingsMap.set(m.rawShape.trim().toUpperCase(), m.normalizedShape.toUpperCase());
    }

    // Checkpoint & Sync info
    const checkpointRecord = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
    const currentCheckpoint = checkpointRecord?.currentCheckpoint ?? 0;
    const lastBatchId = checkpointRecord?.lastBatchId ?? null;

    // 4. FETCH AUTHORITATIVE SALES FACTS (Canonical LotMaster + LotHistory + Deduplication)
    // Only count confirmed sale evidence: currentStatus IN ['SOLD', 'INVOICE'] OR removalReason = 'EXPLICIT_SALE'
    // Exclude: SOURCE_DISAPPEARANCE_UNKNOWN, MEMO_RETURN, CANCELLED, ARCHIVED, CORRECTION
    const rawSalesLots = await db.lotMasterRecord.findMany({
      where: {
        OR: [
          { currentStatus: { in: ["SOLD", "INVOICE"] } },
          { removalReason: "EXPLICIT_SALE" },
        ],
        docDate: {
          gte: lookbackStart,
          lte: lookbackEnd,
        },
      },
      orderBy: { docDate: "asc" },
    });

    // Also check SalesRecord for legacy compatibility, deduplicating by lotId
    const legacySales = await db.salesRecord.findMany({
      where: {
        lotStatusDb: { in: ["Invoice", "SOLD"] },
        docDate: {
          gte: lookbackStart,
          lte: lookbackEnd,
        },
      },
    });

    const seenSaleLots = new Set<string>();
    const salesRecordsToProcess: Array<{
      lotId: string;
      sourceRecordId?: string | null;
      docDate: Date;
      shape: string;
      weight: number;
      labRaw?: string | null;
      labNormalized?: string | null;
      saleTotalUsd?: number | null;
      customerName?: string | null;
    }> = [];

    for (const l of rawSalesLots) {
      if (!seenSaleLots.has(l.lotId)) {
        seenSaleLots.add(l.lotId);
        salesRecordsToProcess.push({
          lotId: l.lotId,
          sourceRecordId: l.sourceRecordId,
          docDate: l.docDate,
          shape: l.shape,
          weight: Number(l.weight),
          labRaw: l.labRaw,
          labNormalized: l.labNormalized,
          saleTotalUsd: l.saleTotalUsd ? Number(l.saleTotalUsd) : null,
          customerName: l.customerName,
        });
      }
    }

    for (const s of legacySales) {
      if (!seenSaleLots.has(s.lotId)) {
        seenSaleLots.add(s.lotId);
        salesRecordsToProcess.push({
          lotId: s.lotId,
          sourceRecordId: null,
          docDate: s.docDate,
          shape: s.shape,
          weight: Number(s.weight),
          labRaw: s.labRaw,
          labNormalized: s.labNormalized,
          saleTotalUsd: s.saleTotalUsd ? Number(s.saleTotalUsd) : null,
          customerName: null,
        });
      }
    }

    // 5. FETCH CURRENT FINISHED INVENTORY (Physical Stock vs Memo)
    const currentInventoryLots = await db.lotMasterRecord.findMany({
      where: {
        isCurrent: true,
        roughOrPolished: "POLISHED",
      },
    });

    // 6. FETCH CURRENT MANUFACTURING WIP
    const currentWipLots = await db.lotMasterRecord.findMany({
      where: {
        isCurrent: true,
        OR: [
          { roughOrPolished: "WIP" },
          { entityType: "WIP" },
        ],
      },
    });

    // 6b. FETCH NON-SALE REMOVALS IN 90D WINDOW (for traceability & exclusion reporting)
    const nonSaleRemovalLots = await db.lotMasterRecord.findMany({
      where: {
        docDate: {
          gte: lookbackStart,
          lte: lookbackEnd,
        },
        removalReason: {
          in: [
            "UNKNOWN_DISAPPEARANCE",
            "BRANCH_TRANSFER",
            "ARCHIVED",
            "CANCELLED",
            "CORRECTION",
            "MEMO_RETURN",
            "SOURCE_DISAPPEARANCE_UNKNOWN",
          ],
        },
      },
    });

    // 7. FETCH APPROVED PLAN COVERAGE
    const approvedPlanOptions = await db.planOption.findMany({
      where: {
        approvalStatus: "APPROVED",
      },
      include: {
        pieces: true,
      },
    });

    // 8. AGGREGATE CATEGORIES & BUILD TRACE
    const categoryTraces = new Map<string, DemandCategoryTrace>();

    function getOrCreateCategoryTrace(
      labNormalized: string,
      shapeNormalized: string,
      band: { id: string; code: string; label: string }
    ): DemandCategoryTrace {
      const key = `${labNormalized}|${shapeNormalized}|${band.label}`;
      let trace = categoryTraces.get(key);
      if (!trace) {
        trace = {
          category: key,
          labNormalized,
          shapeNormalized,
          weightBandCode: band.code,
          weightBandLabel: band.label,
          sales90d: 0,
          monthlyAverage: 0,
          unroundedTarget: 0,
          roundedTarget: 0,
          availableStock: 0,
          memoQty: 0,
          reservedQty: 0,
          blockedQty: 0,
          physicalShortage: 0,
          excessStock: 0,
          wipCoverage: 0,
          unallocatedWip: 0,
          pipelineNeed: 0,
          approvedPlanCoverage: 0,
          remainingUnplanned: 0,
          forecastSignal: 0,
          contributingSalesLots: [],
          physicalStockLots: [],
          memoLots: [],
          eligibleWipLots: [],
          excludedLots: [],
        };
        categoryTraces.set(key, trace);
      }
      return trace;
    }

    let salesCount = 0;
    let inventoryCount = 0;
    let wipCount = 0;
    let excludedCount = 0;

    // Process Sales Records
    for (const rec of salesRecordsToProcess) {
      salesCount++;
      const normLab = rec.labNormalized || resolveLabNormalization(rec.labRaw, labMappingsMap).normalized;
      const normShape = shapeMappingsMap.get(rec.shape.trim().toUpperCase()) || normalizeShape(rec.shape);
      const band = resolveWeightBand(rec.weight, weightBands);

      if (!band || normShape === "UNKNOWN") {
        excludedCount++;
        continue;
      }

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);
      trace.sales90d += 1;
      trace.contributingSalesLots.push({
        lotId: rec.lotId,
        sourceRecordId: rec.sourceRecordId,
        docDate: rec.docDate.toISOString(),
        saleTotalUsd: rec.saleTotalUsd,
        customerName: rec.customerName,
        shape: rec.shape,
        weight: rec.weight,
        lab: normLab,
      });
    }

    // Process Non-Sale Removals (Exclusion reporting)
    for (const nr of nonSaleRemovalLots) {
      excludedCount++;
      const normLab = nr.labNormalized || resolveLabNormalization(nr.labRaw, labMappingsMap).normalized;
      const normShape = shapeMappingsMap.get(nr.shape.trim().toUpperCase()) || normalizeShape(nr.shape);
      const band = resolveWeightBand(Number(nr.weight), weightBands);

      if (band && normShape !== "UNKNOWN") {
        const trace = getOrCreateCategoryTrace(normLab, normShape, band);
        trace.excludedLots.push({
          lotId: nr.lotId,
          reason: `Non-sale removal (${nr.removalReason || nr.currentStatus}) excluded from demand calculation`,
        });
      }
    }

    // Process Finished Inventory Records
    for (const inv of currentInventoryLots) {
      inventoryCount++;
      const normLab = inv.labNormalized || resolveLabNormalization(inv.labRaw, labMappingsMap).normalized;
      const normShape = shapeMappingsMap.get(inv.shape.trim().toUpperCase()) || normalizeShape(inv.shape);
      const weight = Number(inv.weight);
      const band = resolveWeightBand(weight, weightBands);

      if (!band || normShape === "UNKNOWN") {
        excludedCount++;
        continue;
      }

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);

      if (inv.currentStatus === "STOCK") {
        trace.availableStock += 1;
        trace.physicalStockLots.push({
          lotId: inv.lotId,
          sourceRecordId: inv.sourceRecordId,
          shape: inv.shape,
          weight,
          color: inv.color,
          clarity: inv.clarity,
          locationName: inv.locationName,
        });
      } else if (inv.currentStatus === "MEMO") {
        trace.memoQty += 1;
        trace.memoLots.push({
          lotId: inv.lotId,
          customerName: inv.customerName,
          weight,
          docDate: inv.docDate.toISOString(),
        });
      }
    }

    // Process WIP Records
    for (const wip of currentWipLots) {
      wipCount++;
      const normLab = wip.labNormalized || resolveLabNormalization(wip.labRaw, labMappingsMap).normalized;
      const normShape = shapeMappingsMap.get(wip.shape.trim().toUpperCase()) || normalizeShape(wip.shape);
      const weight = Number(wip.weight);
      const band = resolveWeightBand(weight, weightBands);

      if (band && normShape !== "UNKNOWN" && normLab !== "UNKNOWN") {
        const trace = getOrCreateCategoryTrace(normLab, normShape, band);
        trace.wipCoverage += 1;
        trace.eligibleWipLots.push({
          lotId: wip.lotId,
          wipStage: wip.wipStage,
          weight,
          kapan: wip.kapan,
        });
      } else {
        excludedCount++;
        if (band) {
          const fallbackLab = normLab !== "UNKNOWN" ? normLab : "NON_CERTIFIED";
          const fallbackShape = normShape !== "UNKNOWN" ? normShape : "ROUND";
          const trace = getOrCreateCategoryTrace(fallbackLab, fallbackShape, band);
          trace.unallocatedWip += 1;
          trace.excludedLots.push({
            lotId: wip.lotId,
            reason: `Ambiguous WIP record (missing mapped lab or shape attributes)`,
          });
        }
      }
    }

    // Process Approved Plan Coverage
    for (const plan of approvedPlanOptions) {
      for (const p of plan.pieces) {
        const normLab = p.certificationIntent ? resolveLabNormalization(p.certificationIntent, labMappingsMap).normalized : "GIA";
        const normShape = shapeMappingsMap.get(p.expectedShape.trim().toUpperCase()) || normalizeShape(p.expectedShape);
        const weight = Number(p.expectedWeight);
        const band = resolveWeightBand(weight, weightBands);

        if (band && normShape !== "UNKNOWN") {
          const trace = getOrCreateCategoryTrace(normLab, normShape, band);
          trace.approvedPlanCoverage += 1;
        }
      }
    }

    // Ensure all planning categories from PlanningCategory table are populated
    const allPlanningCategories = await db.planningCategory.findMany({
      where: { active: true },
      include: { weightBand: true },
    });

    for (const pc of allPlanningCategories) {
      if (pc.weightBand) {
        getOrCreateCategoryTrace(pc.labNormalized, pc.shape, pc.weightBand);
      }
    }

    // 9. COMPUTE FORMULAS FOR ALL CATEGORIES
    let totalShortage = 0;
    let totalExcess = 0;
    let totalTarget = 0;
    let totalPhysicalStock = 0;
    let totalMemo = 0;
    let totalWipCoverage = 0;
    let totalPipelineNeed = 0;
    let totalApprovedPlanCoverage = 0;
    let totalRemainingUnplanned = 0;

    const finalCategories: DemandCategoryTrace[] = [];

    for (const trace of categoryTraces.values()) {
      // Formula Steps
      const monthlyAvg = trace.sales90d / 3;
      const unroundedTarget = monthlyAvg * 2;
      const roundedTarget = roundHalfUpInt(unroundedTarget);

      const physicalShortage = Math.max(0, roundedTarget - trace.availableStock);
      const excessStock = Math.max(0, trace.availableStock - roundedTarget);
      const pipelineNeed = Math.max(0, physicalShortage - trace.wipCoverage);
      const remainingUnplanned = Math.max(0, pipelineNeed - trace.approvedPlanCoverage);
      const forecastSignal = Math.round(trace.sales90d * 0.15);

      trace.monthlyAverage = Math.round(monthlyAvg * 1000) / 1000;
      trace.unroundedTarget = Math.round(unroundedTarget * 1000) / 1000;
      trace.roundedTarget = roundedTarget;
      trace.physicalShortage = physicalShortage;
      trace.excessStock = excessStock;
      trace.pipelineNeed = pipelineNeed;
      trace.remainingUnplanned = remainingUnplanned;
      trace.forecastSignal = forecastSignal;

      totalShortage += physicalShortage;
      totalExcess += excessStock;
      totalTarget += roundedTarget;
      totalPhysicalStock += trace.availableStock;
      totalMemo += trace.memoQty;
      totalWipCoverage += trace.wipCoverage;
      totalPipelineNeed += pipelineNeed;
      totalApprovedPlanCoverage += trace.approvedPlanCoverage;
      totalRemainingUnplanned += remainingUnplanned;

      finalCategories.push(trace);
    }

    // Sort categories deterministically by category string
    finalCategories.sort((a, b) => a.category.localeCompare(b.category));

    const durationMs = Date.now() - startTime;

    // 10. PERSIST IMMUTABLE SNAPSHOT IN A SINGLE TRANSACTION
    const createdRun = await db.$transaction(async (tx) => {
      const run = await tx.demandRun.create({
        data: {
          runDate: nowUTC(),
          windowDays,
          ruleVersion: "DEMAND-V1",
          status: "COMPLETED",
          totalShortage,
          totalExcess,
          startedAt: new Date(startTime),
          finishedAt: nowUTC(),
          businessDateIst,
          lookbackStart,
          lookbackEnd,
          mappingVersion: "CONFIG-V1",
          sourceMode: config.sourceMode,
          isSimulated: config.isSimulation,
          checkpoint: currentCheckpoint,
          lastBatchId,
          sourceCutoff: checkpointRecord?.lastSyncAt ?? null,
          salesCount,
          inventoryCount,
          wipCount,
          excludedCount,
          actor: options.actor ?? "SYSTEM",
          actorUserId: options.actorUserId ?? null,
          durationMs,
        },
      });

      // Persist metrics
      for (const cat of finalCategories) {
        await tx.demandMetric.create({
          data: {
            runId: run.id,
            planningCategory: cat.category,
            labNormalized: cat.labNormalized,
            shapeNormalized: cat.shapeNormalized,
            weightBandCode: cat.weightBandCode,
            weightBandLabel: cat.weightBandLabel,
            sales90d: cat.sales90d,
            monthlyAverage: new Prisma.Decimal(cat.monthlyAverage),
            unroundedTarget: new Prisma.Decimal(cat.unroundedTarget),
            roundedTarget: cat.roundedTarget,
            availableStock: cat.availableStock,
            memoQty: cat.memoQty,
            reservedQty: cat.reservedQty,
            blockedQty: cat.blockedQty,
            physicalShortage: cat.physicalShortage,
            excessStock: cat.excessStock,
            wipCoverage: cat.wipCoverage,
            unallocatedWip: cat.unallocatedWip,
            pipelineNeed: cat.pipelineNeed,
            approvedPlanCoverage: cat.approvedPlanCoverage,
            remainingUnplanned: cat.remainingUnplanned,
            forecastSignal: cat.forecastSignal,
            status: "COMPLETED",
            traceJson: JSON.stringify({
              contributingSalesLots: cat.contributingSalesLots,
              physicalStockLots: cat.physicalStockLots,
              memoLots: cat.memoLots,
              eligibleWipLots: cat.eligibleWipLots,
              excludedLots: cat.excludedLots,
            }),
          },
        });
      }

      // Release calculation lock
      await tx.demandCalculationLock.update({
        where: { id: "DEMAND_CALCULATION" },
        data: {
          isLocked: false,
          lockedAt: null,
          lockedBy: null,
          runId: run.id,
        },
      });

      return run;
    });

    lockReleasedInTx = true;

    return {
      success: true,
      status: createdRun.status,
      runId: createdRun.id,
      runDate: createdRun.runDate.toISOString(),
      businessDateIst,
      lookbackStart: lookbackStart.toISOString(),
      lookbackEnd: lookbackEnd.toISOString(),
      windowDays,
      ruleVersion: "DEMAND-V1",
      categoriesProcessed: finalCategories.length,
      totalCategories: finalCategories.length,
      totalShortage,
      totalExcess,
      totalTarget,
      totalPhysicalStock,
      totalMemo,
      totalWipCoverage,
      totalPipelineNeed,
      totalApprovedPlanCoverage,
      totalRemainingUnplanned,
      salesCount,
      inventoryCount,
      wipCount,
      excludedCount,
      checkpoint: currentCheckpoint,
      lastBatchId,
      isSimulated: config.isSimulation,
      durationMs,
      categories: finalCategories,
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorSummary = err instanceof Error ? err.message : String(err);

    // If lock was not released in transaction, release it safely
    if (!lockReleasedInTx) {
      try {
        await db.demandCalculationLock.update({
          where: { id: "DEMAND_CALCULATION" },
          data: { isLocked: false, lockedAt: null, lockedBy: null },
        });
      } catch {
        // Ignore secondary unlock error
      }
    }

    throw err;
  }
}

/**
 * Retrieves the latest completed demand run with categories and summary.
 */
export async function getLatestDemandRun() {
  const latestRun = await db.demandRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { runDate: "desc" },
    include: {
      metrics: {
        orderBy: { planningCategory: "asc" },
      },
    },
  });

  return latestRun;
}
