import { db } from "@/lib/db";
import { PLAN_COVERAGE, type PlanCoverageAvailability } from "@/lib/demand/plan-coverage";
import { Prisma } from "@prisma/client";
import { recordOperationalFailure, serializePublicFailure } from "@/lib/api/operational-failure";
import {
  CANONICAL_CLAIM_LEASE_MS,
  CanonicalStateBusyError,
  CanonicalStateFencedError,
  claimCanonicalState,
  isClaimStillHeld,
  releaseCanonicalState,
} from "@/lib/fantasy/canonical-state-claim";
import {
  QUANTITY_REVIEW_REASONS,
  WEIGHT_REVIEW_REASONS,
  resolveCanonicalQuantity,
  resolveCanonicalWeight,
} from "@/lib/fantasy/quantity-weight";
import { resolveLabNormalization } from "@/lib/fantasy/canonical";
import {
  loadCategoryMappings,
  QUARANTINE_CATEGORY,
  resolveApprovedShape,
  resolveWeightBand,
  type CategoryMappings,
} from "@/lib/demand/planning-category";
import {
  classifyCurrentWip,
  loadWipClassificationContext,
  loadWipPolicy,
  type WipPolicy,
} from "@/lib/demand/wip-classification";
import { resolveFantasySourceState } from "@/lib/fantasy/config";
import { getISTDateString, parseISTDateToUTC, nowUTC } from "@/lib/fantasy/time";
import { roundHalfUpInt } from "@/lib/domain/diamond-rules";
import crypto from "crypto";
import { resolveEffectiveClassification, isMirroredInventoryClass } from "@/lib/fantasy/classification";
import { LEGACY_FIXTURE_PROFILE, loadClassificationProfile } from "@/lib/fantasy/classification-profile";
import { loadConfirmedSaleFacts } from "@/lib/demand/confirmed-sales";
import { checkProjectionInvariant, reconcileOperationalProjection } from "@/lib/fantasy/operational-projection";

export type DemandSourcePolicy = "CANONICAL_FANTASY" | "LEGACY_SALES";

export interface DemandRunOptions {
  actor?: string;
  actorUserId?: string;
  sourcePolicy?: DemandSourcePolicy;
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
  remainingUnplanned: number;
  forecastSignal: number;
  status: string;
  contributingSalesLots: Array<{
    lotId: string;
    sourceRecordId?: string | null;
    eventKey?: string | null;
    docDate: string;
    saleTotalUsd?: number | null;
    customerName?: string | null;
    shape: string;
    weight: number;
    lab: string;
    quantity: number;
  }>;
  physicalStockLots: Array<{
    lotId: string;
    sourceRecordId?: string | null;
    shape: string;
    weight: number;
    color?: string | null;
    clarity?: string | null;
    locationName?: string | null;
    quantity: number;
  }>;
  memoLots: Array<{
    lotId: string;
    customerName?: string | null;
    weight: number;
    docDate: string;
    quantity: number;
  }>;
  eligibleWipLots: Array<{
    lotId: string;
    wipStage?: string | null;
    weight: number;
    kapan?: string | null;
    quantity: number;
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
  sourcePolicy: string;
  mappingFingerprint: string;
  totalCategories: number;
  totalShortage: number;
  totalExcess: number;
  totalTarget: number;
  totalPhysicalStock: number;
  totalMemo: number;
  totalReserved: number;
  totalBlocked: number;
  totalWipCoverage: number;
  totalUnallocatedWip: number;
  totalAmbiguousWip: number;
  totalPipelineNeed: number;
  planCoverage: PlanCoverageAvailability;
  totalRemainingUnplanned: number;
  wipPolicy: WipPolicy;
  salesCount: number;
  inventoryCount: number;
  wipCount: number;
  excludedCount: number;
  checkpoint: number;
  lastBatchId: string | null;
  sourceCutoff: string | null;
  isSimulated: boolean;
  durationMs: number;
  categories: DemandCategoryTrace[];
}

export function wipPolicyFingerprint(policy: WipPolicy): string {
  return `${policy.status}:${policy.ruleStatus ?? "NONE"}:${policy.ruleVersion ?? "NONE"}:${policy.eligibleStages.join(",")}`;
}

export function computeMappingFingerprint(mappings: CategoryMappings, wipFingerprint: string): string {
  const labParts: string[] = [];
  for (const [raw, normalized] of mappings.labMappings) labParts.push(`${raw}:${normalized.trim().toUpperCase()}`);
  labParts.sort();

  const shapeParts: string[] = [];
  for (const [raw, normalized] of mappings.shapeMappings) shapeParts.push(`${raw}:${normalized.trim().toUpperCase()}`);
  shapeParts.sort();

  const bandParts = [...mappings.weightBands]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((w) => `${w.code}:${Number(w.minCt).toFixed(4)}-${Number(w.maxCt).toFixed(4)}`);

  const payload = JSON.stringify({
    labs: labParts,
    shapes: shapeParts,
    bands: bandParts,
    wipPolicy: wipFingerprint,
  });

  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export async function computeCurrentMappingFingerprint(): Promise<string> {
  const [mappings, policy] = await Promise.all([loadCategoryMappings(db), loadWipPolicy(db)]);
  return computeMappingFingerprint(mappings, wipPolicyFingerprint(policy));
}

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
      // Ignore race
    }
  }
}

export async function runDemandCalculation(options: DemandRunOptions = {}): Promise<DemandRunResult> {
  const startTime = Date.now();
  const sourceState = resolveFantasySourceState();
  const classificationProfile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE);
  const classificationCache = new Map<string, ReturnType<typeof resolveEffectiveClassification>>();
  const classificationOf = (
    record: Parameters<typeof resolveEffectiveClassification>[0] & { lotId: string },
    mirrorPlanningClass: string | null,
  ) => {
    const hit = classificationCache.get(record.lotId);
    if (hit) return hit;
    const resolved = resolveEffectiveClassification(record, classificationProfile, mirrorPlanningClass);
    classificationCache.set(record.lotId, resolved);
    return resolved;
  };
  const sourcePolicy: DemandSourcePolicy = options.sourcePolicy ?? "CANONICAL_FANTASY";
  await ensureLockRecord();

  const lockToken = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - CANONICAL_CLAIM_LEASE_MS);
  const lockAcquired = await db.demandCalculationLock.updateMany({
    where: {
      id: "DEMAND_CALCULATION",
      OR: [{ isLocked: false }, { lockedAt: { lt: staleBefore } }],
    },
    data: {
      isLocked: true,
      lockToken,
      lockedAt: nowUTC(),
      lockedBy: options.actor ?? "SYSTEM",
      lockedByUserId: options.actorUserId ?? null,
    },
  });

  if (lockAcquired.count === 0) {
    throw new Error("A demand calculation run is currently in progress by another worker. Concurrent runs are prevented.");
  }

  const canonicalClaimResult = await claimCanonicalState("DEMAND", options.actor ?? "SYSTEM");
  if (!canonicalClaimResult.acquired) {
    await db.demandCalculationLock.updateMany({
      where: { id: "DEMAND_CALCULATION", lockToken },
      data: { isLocked: false, lockToken: null, lockedAt: null, lockedBy: null, lockedByUserId: null },
    });
    throw new CanonicalStateBusyError(canonicalClaimResult.heldBy);
  }
  const canonicalClaim = canonicalClaimResult.claim;
  let canonicalClaimReleased = false;

  const boundSyncRun = await db.integrationSyncRun.findFirst({
    where: { source: { in: ["FANTASY", "Fantasy"] }, status: "SUCCESS", finishedAt: { not: null } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: { id: true, endingCheckpoint: true, batchId: true, finishedAt: true },
  });

  const windowDays = options.windowDays ?? 90;
  const refDate = options.referenceDate ?? new Date();
  const businessDateIst = getISTDateString(refDate);
  const refDateUtc = parseISTDateToUTC(businessDateIst);
  const lookbackStart = new Date(refDateUtc.getTime() - (windowDays - 1) * 24 * 60 * 60 * 1000);
  const lookbackEnd = new Date(refDateUtc.getTime() + 24 * 60 * 60 * 1000 - 1);

  const initialRun = await db.demandRun.create({
    data: {
      runDate: nowUTC(),
      windowDays,
      ruleVersion: "DEMAND-V1",
      status: "RUNNING",
      sourcePolicy,
      startedAt: new Date(startTime),
      businessDateIst,
      lookbackStart,
      lookbackEnd,
      sourceMode: sourceState.effectiveState,
      isSimulated: sourceState.isSimulated,
      sourceSyncRunId: boundSyncRun?.id ?? null,
      checkpoint: boundSyncRun?.endingCheckpoint ?? 0,
      lastBatchId: boundSyncRun?.batchId ?? null,
      lockToken,
      actor: options.actor ?? "SYSTEM",
      actorUserId: options.actorUserId ?? null,
    },
  });

  await db.demandCalculationLock.updateMany({
    where: { id: "DEMAND_CALCULATION", lockToken },
    data: { runId: initialRun.id },
  });

  let lockReleased = false;

  try {
    const mappings = await loadCategoryMappings(db);
    const wipContext = await loadWipClassificationContext(db, { mappings });
    const wipPolicy: WipPolicy = wipContext.policy;

    const labMappingsMap = mappings.labMappings;
    const shapeMappingsMap = mappings.shapeMappings;
    const weightBands = mappings.weightBands;

    const mappingFingerprint = computeMappingFingerprint(mappings, wipPolicyFingerprint(wipPolicy));

    const currentCheckpoint = boundSyncRun?.endingCheckpoint ?? 0;
    const lastBatchId = boundSyncRun?.batchId ?? null;
    const boundSyncDetail = boundSyncRun
      ? await db.integrationSyncRun.findUnique({
          where: { id: boundSyncRun.id },
          select: { sourceCutoff: true },
        })
      : null;
    const actualSourceCutoff = boundSyncDetail?.sourceCutoff ?? null;
    const projectionRepair = await reconcileOperationalProjection({
      actor: options.actor ?? "demand-calculation",
    });
    const projectionInvariant = await checkProjectionInvariant(db);

    const confirmedSales = await loadConfirmedSaleFacts({
      windowDays,
      policy: sourcePolicy,
      referenceDate: refDate,
      client: db,
    });
    const confirmedSaleFacts = confirmedSales.facts;

    const [currentInventoryLots, polishedMirrors] = await Promise.all([
      db.lotMasterRecord.findMany({
        where: {
          isCurrent: true,
          roughOrPolished: "POLISHED",
          currentStatus: {
            notIn: [
              "SOLD",
              "ARCHIVED",
              "CANCELLED",
              "TRANSFERRED",
              "REMOVED_UNKNOWN",
              "INVOICE",
              "COMPLETED",
              "WIP_COMPLETED",
            ],
          },
        },
      }),
      db.polishedStone.findMany(),
    ]);

    const polishedMirrorMap = new Map<string, typeof polishedMirrors[0]>();
    for (const p of polishedMirrors) {
      polishedMirrorMap.set(p.fantasyLotId, p);
    }

    const wipInventory = await classifyCurrentWip(db, { context: wipContext });

    const nonSaleRemovalLots = await db.lotMasterRecord.findMany({
      where: {
        docDate: {
          gte: lookbackStart,
          lte: lookbackEnd,
        },
        removalReason: {
          in: [
            "UNKNOWN_DISAPPEARANCE",
            "SOURCE_DISAPPEARANCE_UNKNOWN",
            "BRANCH_TRANSFER",
            "TRANSFERRED",
            "ARCHIVED",
            "CANCELLED",
            "CORRECTION",
            "MEMO_RETURN",
            "WIP_COMPLETED",
          ],
        },
      },
    });

    const categoryTraces = new Map<string, DemandCategoryTrace>();
    const traceItemsToPersist: Array<Prisma.DemandMetricTraceItemCreateManyInput> = [];
    const dqIssuesToCreate: Array<Prisma.DataQualityIssueCreateManyInput> = [];

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
          remainingUnplanned: 0,
          forecastSignal: 0,
          status: "COMPLETED",
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

    for (const rec of confirmedSaleFacts) {
      salesCount++;
      const category = persistedCategoryOf(rec);
      const normLab = category.labNormalized;
      const normShape = category.shapeNormalized;
      const saleWeight =
        rec.sourceType === "LEGACY_SEED"
          ? null
          : resolveCanonicalWeight({ weight: rec.weight, sourceType: rec.sourceType ?? null, isSimulated: rec.isSimulated });
      const saleCarats = saleWeight === null ? Number(rec.weight) : saleWeight.carats;
      const band = saleCarats === null ? null : resolveWeightBand(saleCarats, weightBands);

      if (!category.approved || !band || normLab === null || normShape === null) {
        excludedCount++;
        const dqCode = `DQ-UNMAPPED-SALE-${rec.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "SaleEvent",
          recordId: rec.lotId,
          rule: categoryIssueRule(category, band),
          message: `Sale record ${rec.lotId} has unapproved mapping (Lab: ${rec.labRaw}, Shape: ${rec.shape}, Wt: ${rec.weight})`,
          severity: "WARNING",
          status: "OPEN",
          affectedField: categoryIssueField(category, band),
          rawValue: categoryIssueRawValue(category, band, rec.labRaw, rec.shape, rec.weight),
          normalizedValue: normLab,
          downstreamImpact: "Excluded from automated sales replenishment demand",
        });

        if (band && normLab !== null && normShape !== null) {
          const trace = getOrCreateCategoryTrace(normLab, normShape, band);
          trace.status = "REVIEW_REQUIRED";
          trace.excludedLots.push({
            lotId: rec.lotId,
            reason: `Unapproved planning mapping (Lab: ${rec.labRaw}, Shape: ${rec.shape})`,
          });
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: trace.category,
            traceType: "EXCLUSION",
            lotId: rec.lotId,
            sourceRecordId: rec.sourceRecordId,
            eventKey: rec.eventKey,
            quantity: rec.quantity,
            weight: rec.weight,
            lab: rec.labRaw,
            shape: rec.shape,
            weightBand: band.label,
            reason: `Unapproved planning mapping for sale event`,
            isIncluded: false,
          });
        } else {
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: QUARANTINE_CATEGORY,
            traceType: "EXCLUSION",
            lotId: rec.lotId,
            sourceRecordId: rec.sourceRecordId,
            eventKey: rec.eventKey,
            quantity: rec.quantity,
            weight: rec.weight,
            lab: rec.labRaw,
            shape: rec.shape,
            weightBand: undefined,
            reason: `Unapproved planning mapping for sale event`,
            isIncluded: false,
          });
        }
        continue;
      }

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);
      trace.sales90d += Math.round(rec.quantity);
      trace.contributingSalesLots.push({
        lotId: rec.lotId,
        sourceRecordId: rec.sourceRecordId,
        eventKey: rec.eventKey,
        docDate: rec.docDate.toISOString(),
        saleTotalUsd: rec.saleTotalUsd,
        customerName: rec.customerName,
        shape: rec.shape,
        weight: rec.weight,
        lab: normLab,
        quantity: rec.quantity,
      });

      traceItemsToPersist.push({
        runId: initialRun.id,
        planningCategory: trace.category,
        traceType: "SALE",
        lotId: rec.lotId,
        sourceRecordId: rec.sourceRecordId,
        eventKey: rec.eventKey,
        quantity: rec.quantity,
        weight: rec.weight,
        lab: normLab,
        shape: normShape,
        weightBand: band.label,
        customerName: rec.customerName,
        saleTotalUsd: rec.saleTotalUsd,
        docDate: rec.docDate,
        isIncluded: true,
      });
    }

    for (const nr of nonSaleRemovalLots) {
      excludedCount++;
      const normLab = nr.labNormalized || resolveLabNormalization(nr.labRaw, labMappingsMap).normalized;
      const normShape = resolveApprovedShape(nr.shape, shapeMappingsMap);
      const removalWeight = resolveCanonicalWeight({
        weight: nr.weight,
        sourceType: nr.sourceType ?? null,
        isSimulated: nr.isSimulated,
      });
      const band = removalWeight.carats === null ? null : resolveWeightBand(removalWeight.carats, weightBands);

      if (band && normShape !== "UNKNOWN") {
        const trace = getOrCreateCategoryTrace(normLab, normShape, band);
        const reason = `Non-sale removal (${nr.removalReason || nr.currentStatus}) excluded from demand calculation`;
        trace.excludedLots.push({ lotId: nr.lotId, reason });
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "EXCLUSION",
          lotId: nr.lotId,
          sourceRecordId: nr.sourceRecordId,
          quantity: resolveCanonicalQuantity(nr).rawValue ?? 0,
          quantityProvenance: resolveCanonicalQuantity(nr).provenance,
          weight: Number(nr.weight),
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          reason,
          isIncluded: false,
          checkpoint: nr.checkpoint,
          batchId: nr.lastSyncBatchId,
        });
      }
    }

    for (const inv of currentInventoryLots) {
      inventoryCount++;
      const category = persistedCategoryOf(inv);
      const normLab = category.labNormalized;
      const normShape = category.shapeNormalized;

      const quantityDecision = resolveCanonicalQuantity(inv);
      const weightDecision = resolveCanonicalWeight(inv);
      const weight = weightDecision.rawValue ?? Number(inv.weight);
      const qty = quantityDecision.pieces;
      const band = weightDecision.carats === null ? null : resolveWeightBand(weightDecision.carats, weightBands);

      if (qty === null) {
        excludedCount++;
        dqIssuesToCreate.push({
          issueCode: `DQ-QTY-INV-${inv.lotId}`,
          source: "DEMAND_CALCULATION",
          entity: "PolishedInventory",
          recordId: inv.lotId,
          rule: `QUANTITY_${quantityDecision.provenance}`,
          message: QUANTITY_REVIEW_REASONS[quantityDecision.provenance],
          severity: "WARNING",
          status: "OPEN",
          affectedField: "quantity",
          downstreamImpact: "Excluded from available, memo, reserved and blocked piece totals",
        });
        if (band && category.approved && normLab !== null && normShape !== null) {
          const reviewTrace = getOrCreateCategoryTrace(normLab, normShape, band);
          reviewTrace.status = "REVIEW_REQUIRED";
          reviewTrace.excludedLots.push({
            lotId: inv.lotId,
            reason: QUANTITY_REVIEW_REASONS[quantityDecision.provenance],
          });
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: reviewTrace.category,
            traceType: "EXCLUSION",
            lotId: inv.lotId,
            sourceRecordId: inv.sourceRecordId,
            quantity: quantityDecision.rawValue ?? 0,
            quantityProvenance: quantityDecision.provenance,
            weight,
            lab: inv.labRaw,
            shape: inv.shape,
            weightBand: band.label,
            reason: QUANTITY_REVIEW_REASONS[quantityDecision.provenance],
            isIncluded: false,
          });
        }
        continue;
      }

      if (!category.approved || !band || normLab === null || normShape === null) {
        excludedCount++;
        const dqCode = `DQ-UNMAPPED-INV-${inv.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "PolishedInventory",
          recordId: inv.lotId,
          rule: !band && weightDecision.state !== "USABLE"
            ? `WEIGHT_${weightDecision.state}`
            : categoryIssueRule(category, band),
          message: !band && weightDecision.state !== "USABLE"
            ? WEIGHT_REVIEW_REASONS[weightDecision.state]
            : `Polished lot ${inv.lotId} has unapproved mapping attributes`,
          severity: "WARNING",
          status: "OPEN",
          affectedField: categoryIssueField(category, band),
          rawValue: categoryIssueRawValue(category, band, inv.labRaw, inv.shape, weight),
          downstreamImpact: "Excluded from live finished availability calculation",
        });

        if (band && normLab !== null && normShape !== null) {
          const trace = getOrCreateCategoryTrace(normLab, normShape, band);
          trace.status = "REVIEW_REQUIRED";
          trace.blockedQty += Math.round(qty);
          trace.excludedLots.push({
            lotId: inv.lotId,
            reason: categoryExclusionReason(category, band, inv.labRaw, inv.shape),
          });
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: trace.category,
            traceType: "EXCLUSION",
            lotId: inv.lotId,
            sourceRecordId: inv.sourceRecordId,
            quantity: qty,
            weight,
            lab: inv.labRaw,
            shape: inv.shape,
            weightBand: band.label,
            reason: "Unapproved planning mapping for inventory record",
            isIncluded: false,
          });
        } else {
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: QUARANTINE_CATEGORY,
            traceType: "EXCLUSION",
            lotId: inv.lotId,
            sourceRecordId: inv.sourceRecordId,
            quantity: qty,
            weight,
            lab: inv.labRaw,
            shape: inv.shape,
            weightBand: band?.label,
            reason: categoryExclusionReason(category, band, inv.labRaw, inv.shape),
            isIncluded: false,
          });
        }
        continue;
      }

      const mirror = polishedMirrorMap.get(inv.lotId);
      const effClass = classificationOf(inv, mirror?.planningClass ?? null);

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);

      if (isMirroredInventoryClass(effClass.inventoryClass) && !mirror) {
        trace.status = "REVIEW_REQUIRED";
        trace.blockedQty += Math.round(qty);
        const reason = `Operational polished mirror missing for lot ${inv.lotId}`;
        trace.excludedLots.push({ lotId: inv.lotId, reason });

        const dqCode = `DQ-MISSING-MIRROR-${inv.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "PolishedStoneMirror",
          recordId: inv.lotId,
          rule: "MISSING_OPERATIONAL_MIRROR",
          message: `Polished lot ${inv.lotId} lacks operational PolishedStone classification mirror`,
          severity: "WARNING",
          status: "OPEN",
          affectedField: "planningClass",
          downstreamImpact: "Blocked from available stock until operational mirror verified",
        });

        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "BLOCKED",
          lotId: inv.lotId,
          sourceRecordId: inv.sourceRecordId,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          reason,
          isIncluded: false,
        });
      } else if (effClass.available) {
        trace.availableStock += Math.round(qty);
        trace.physicalStockLots.push({
          lotId: inv.lotId,
          sourceRecordId: inv.sourceRecordId,
          shape: inv.shape,
          weight,
          color: inv.color,
          clarity: inv.clarity,
          locationName: inv.locationName,
          quantity: qty,
        });
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "STOCK",
          lotId: inv.lotId,
          sourceRecordId: inv.sourceRecordId,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          isIncluded: true,
        });
      } else if (effClass.inventoryClass === "MEMO") {
        trace.memoQty += Math.round(qty);
        trace.memoLots.push({
          lotId: inv.lotId,
          customerName: inv.customerName,
          weight,
          docDate: inv.docDate.toISOString(),
          quantity: qty,
        });
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "MEMO",
          lotId: inv.lotId,
          customerName: inv.customerName,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          reason: "Memo consignment stock — does NOT reduce physical shortage",
          isIncluded: true,
        });
      } else if (effClass.inventoryClass === "RESERVED") {
        trace.reservedQty += Math.round(qty);
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "RESERVED",
          lotId: inv.lotId,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          reason: "Reserved stock — does NOT reduce physical shortage",
          isIncluded: false,
        });
      } else {
        trace.blockedQty += Math.round(qty);
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "BLOCKED",
          lotId: inv.lotId,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          reason: `Excluded by canonical classification (${effClass.inventoryClass})${effClass.reasons ? `: ${effClass.reasons}` : ""}`,
          isIncluded: false,
        });
      }
    }

    const bandByCode = new Map(weightBands.map((b) => [b.code, b]));
    let ambiguousWipPieces = 0;

    for (const wip of wipInventory.results) {
      wipCount++;

      if (wip.outcome === "COMPLETED" || wip.outcome === "ALREADY_POLISHED") {
        continue;
      }

      const band = wip.weightBandCode ? bandByCode.get(wip.weightBandCode) : undefined;

      if (wip.outcome === "ELIGIBLE" && band && wip.category && wip.quantity !== null) {
        const trace = getOrCreateCategoryTrace(wip.lab, wip.shape, band);
        trace.wipCoverage += wip.quantity;
        trace.eligibleWipLots.push({
          lotId: wip.lotId,
          wipStage: wip.stageRaw,
          weight: wip.weight,
          kapan: wip.kapan,
          quantity: wip.quantity,
        });
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "WIP_ELIGIBLE",
          lotId: wip.lotId,
          wipStage: wip.stageRaw,
          quantity: wip.quantity ?? 0,
          quantityProvenance: wip.quantityProvenance,
          weight: wip.weight,
          lab: wip.lab,
          shape: wip.shape,
          weightBand: band.label,
          reason: wip.reason,
          isIncluded: true,
        });
        continue;
      }

      excludedCount++;
      dqIssuesToCreate.push({
        issueCode: `DQ-UNMAPPED-WIP-${wip.lotId}`,
        source: "DEMAND_CALCULATION",
        entity: "ManufacturingWIP",
        recordId: wip.lotId,
        rule:
          wip.outcome === "INELIGIBLE_STAGE"
            ? "INELIGIBLE_WIP_STAGE"
            : wip.outcome === "POLICY_NOT_CONFIGURED"
            ? "WIP_POLICY_NOT_CONFIGURED"
            : wip.categoryFailure === "UNMAPPED_SHAPE"
            ? "UNMAPPED_SHAPE"
            : wip.categoryFailure === "UNMAPPED_WEIGHT_BAND"
            ? "UNMAPPED_WEIGHT_BAND"
            : "UNMAPPED_WIP_ATTRIBUTES",
        message: `WIP record ${wip.lotId} does not reduce shortage (stage ${wip.stage}, outcome ${wip.outcome})`,
        severity: wip.outcome === "AMBIGUOUS" ? "WARNING" : "INFO",
        status: "OPEN",
        affectedField: wip.outcome === "INELIGIBLE_STAGE" ? "wipStage" : wip.outcome === "AMBIGUOUS" ? "attributes" : "businessRule",
        rawValue: wip.stageRaw,
        downstreamImpact: "Tracked as unallocated WIP; does not deduct from shortage",
      });

      if (wip.outcome === "AMBIGUOUS" || !band || !wip.category) {
        ambiguousWipPieces += wip.quantity ?? 0;
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: QUARANTINE_CATEGORY,
          traceType: "WIP_UNALLOCATED",
          lotId: wip.lotId,
          wipStage: wip.stageRaw,
          quantity: wip.quantity ?? 0,
          quantityProvenance: wip.quantityProvenance,
          weight: wip.weight,
          lab: wip.lab,
          shape: wip.shape,
          weightBand: wip.weightBandLabel,
          reason: wip.reason,
          isIncluded: false,
        });
        continue;
      }

      const trace = getOrCreateCategoryTrace(wip.lab, wip.shape, band);
      trace.unallocatedWip += wip.quantity ?? 0;
      trace.excludedLots.push({ lotId: wip.lotId, reason: wip.reason });
      traceItemsToPersist.push({
        runId: initialRun.id,
        planningCategory: trace.category,
        traceType: "WIP_UNALLOCATED",
        lotId: wip.lotId,
        wipStage: wip.stageRaw,
        quantity: wip.quantity ?? 0,
        quantityProvenance: wip.quantityProvenance,
        weight: wip.weight,
        lab: wip.lab,
        shape: wip.shape,
        weightBand: band.label,
        reason: wip.reason,
        isIncluded: false,
      });
    }

    const allPlanningCategories = await db.planningCategory.findMany({
      where: { active: true },
      include: { weightBand: true },
    });

    for (const pc of allPlanningCategories) {
      if (pc.weightBand) {
        getOrCreateCategoryTrace(pc.labNormalized, pc.shape, pc.weightBand);
      }
    }

    let totalShortage = 0;
    let totalExcess = 0;
    let totalTarget = 0;
    let totalPhysicalStock = 0;
    let totalMemo = 0;
    let totalReserved = 0;
    let totalBlocked = 0;
    let totalWipCoverage = 0;
    let totalUnallocatedWip = 0;
    let totalPipelineNeed = 0;
    let totalRemainingUnplanned = 0;
    let anyCategoryReviewRequired = false;

    const finalCategories: DemandCategoryTrace[] = [];

    for (const trace of categoryTraces.values()) {
      const monthlyAvg = trace.sales90d / 3;
      const unroundedTarget = monthlyAvg * 2;
      const roundedTarget = roundHalfUpInt(unroundedTarget);

      const physicalShortage = Math.max(0, roundedTarget - trace.availableStock);
      const excessStock = Math.max(0, trace.availableStock - roundedTarget);
      const pipelineNeed = Math.max(0, physicalShortage - trace.wipCoverage);
      const remainingUnplanned = pipelineNeed;
      const forecastSignal = Math.round(trace.sales90d * 0.15);

      trace.monthlyAverage = Math.round(monthlyAvg * 1000) / 1000;
      trace.unroundedTarget = Math.round(unroundedTarget * 1000) / 1000;
      trace.roundedTarget = roundedTarget;
      trace.physicalShortage = physicalShortage;
      trace.excessStock = excessStock;
      trace.pipelineNeed = pipelineNeed;
      trace.remainingUnplanned = remainingUnplanned;
      trace.forecastSignal = forecastSignal;

      if (trace.status === "REVIEW_REQUIRED" || trace.blockedQty > 0) {
        anyCategoryReviewRequired = true;
      }

      totalShortage += physicalShortage;
      totalExcess += excessStock;
      totalTarget += roundedTarget;
      totalPhysicalStock += trace.availableStock;
      totalMemo += trace.memoQty;
      totalReserved += trace.reservedQty;
      totalBlocked += trace.blockedQty;
      totalWipCoverage += trace.wipCoverage;
      totalUnallocatedWip += trace.unallocatedWip;
      totalPipelineNeed += pipelineNeed;
      totalRemainingUnplanned += remainingUnplanned;

      finalCategories.push(trace);
    }

    finalCategories.sort((a, b) => a.category.localeCompare(b.category));
    const durationMs = Date.now() - startTime;

    const countedSalePieces = finalCategories.reduce((sum, c) => sum + c.sales90d, 0);
    const everySaleExcluded = salesCount > 0 && countedSalePieces === 0;
    const noCountableInventory =
      inventoryCount > 0 && totalPhysicalStock === 0 && totalMemo === 0 && totalReserved === 0;
    const blockedByInputs = everySaleExcluded || (salesCount > 0 && noCountableInventory);

    if (blockedByInputs) {
      dqIssuesToCreate.push({
        issueCode: `DQ-RUN-INPUTS-${initialRun.id}`,
        source: "DEMAND_CALCULATION",
        entity: "DemandRun",
        recordId: initialRun.id,
        rule: "NO_COUNTABLE_INPUTS",
        message:
          "This calculation could not count any confirmed quantity, so its results are not " +
          "authoritative. Confirm the source quantity and weight contract, then recalculate.",
        severity: "ERROR",
        status: "OPEN",
        affectedField: "quantity",
        downstreamImpact: "Run marked review required; shortage figures are not presented as authoritative",
      });
    }

    if (!projectionInvariant.satisfied) {
      dqIssuesToCreate.push({
        issueCode: `DQ-RUN-PROJECTION-${initialRun.id}`,
        source: "DEMAND_CALCULATION",
        entity: "DemandRun",
        recordId: initialRun.id,
        rule: "OPERATIONAL_PROJECTION_INCOMPLETE",
        message: projectionInvariant.message ?? "Operational projection is incomplete.",
        severity: "ERROR",
        status: "OPEN",
        affectedField: "projection",
        downstreamImpact: "Run marked review required; availability figures are not presented as authoritative",
      });
    }

    const finalRunStatus =
      anyCategoryReviewRequired || blockedByInputs || !projectionInvariant.satisfied
        ? "REVIEW_REQUIRED"
        : "COMPLETED";

    if (!(await isClaimStillHeld(canonicalClaim))) {
      throw new CanonicalStateFencedError();
    }

    await db.$transaction(async (tx) => {
      if (dqIssuesToCreate.length > 0) {
        await tx.dataQualityIssue.createMany({
          data: dqIssuesToCreate,
          skipDuplicates: true,
        });
      }

      const metricRows = finalCategories.map((c) => ({
        runId: initialRun.id,
        planningCategory: c.category,
        labNormalized: c.labNormalized,
        shapeNormalized: c.shapeNormalized,
        weightBandCode: c.weightBandCode,
        weightBandLabel: c.weightBandLabel,
        sales90d: c.sales90d,
        monthlyAverage: new Prisma.Decimal(c.monthlyAverage),
        unroundedTarget: new Prisma.Decimal(c.unroundedTarget),
        roundedTarget: c.roundedTarget,
        availableStock: c.availableStock,
        memoQty: c.memoQty,
        reservedQty: c.reservedQty,
        blockedQty: c.blockedQty,
        physicalShortage: c.physicalShortage,
        excessStock: c.excessStock,
        wipCoverage: c.wipCoverage,
        unallocatedWip: c.unallocatedWip,
        pipelineNeed: c.pipelineNeed,
        remainingUnplanned: c.remainingUnplanned,
        forecastSignal: c.forecastSignal,
        status: c.status,
        traceJson: JSON.stringify({
          contributingSalesLots: c.contributingSalesLots,
          physicalStockLots: c.physicalStockLots,
          memoLots: c.memoLots,
          eligibleWipLots: c.eligibleWipLots,
          excludedLots: c.excludedLots,
        }),
      }));

      await tx.demandMetric.createMany({ data: metricRows });

      if (traceItemsToPersist.length > 0) {
        await tx.demandMetricTraceItem.createMany({
          data: traceItemsToPersist,
          skipDuplicates: true,
        });
      }

      await tx.demandRun.update({
        where: { id: initialRun.id },
        data: {
          status: finalRunStatus,
          totalShortage,
          totalExcess,
          mappingVersion: "CONFIG-V1",
          mappingFingerprint,
          wipPolicyStatus: wipPolicy.status,
          wipRuleVersion: wipPolicy.ruleVersion,
          wipEligibleStages: wipPolicy.eligibleStages.join(","),
          checkpoint: currentCheckpoint,
          lastBatchId,
          sourceCutoff: actualSourceCutoff,
          salesCount,
          inventoryCount,
          wipCount,
          excludedCount,
          finishedAt: nowUTC(),
          durationMs,
        },
      });

      await tx.demandCalculationLock.updateMany({
        where: {
          id: "DEMAND_CALCULATION",
          lockToken,
        },
        data: {
          isLocked: false,
          lockToken: null,
          lockedAt: null,
          lockedBy: null,
          lockedByUserId: null,
          runId: initialRun.id,
        },
      });
    });

    lockReleased = true;
    await releaseCanonicalState(canonicalClaim);
    canonicalClaimReleased = true;

    return {
      success: true,
      status: finalRunStatus,
      runId: initialRun.id,
      runDate: initialRun.runDate.toISOString(),
      categoriesProcessed: finalCategories.length,
      businessDateIst,
      lookbackStart: lookbackStart.toISOString(),
      lookbackEnd: lookbackEnd.toISOString(),
      windowDays,
      ruleVersion: "DEMAND-V1",
      sourcePolicy,
      mappingFingerprint,
      totalCategories: finalCategories.length,
      totalShortage,
      totalExcess,
      totalTarget,
      totalPhysicalStock,
      totalMemo,
      totalReserved,
      totalBlocked,
      totalWipCoverage,
      totalUnallocatedWip,
      totalAmbiguousWip: ambiguousWipPieces,
      totalPipelineNeed,
      planCoverage: PLAN_COVERAGE,
      totalRemainingUnplanned,
      wipPolicy,
      salesCount,
      inventoryCount,
      wipCount,
      excludedCount,
      checkpoint: currentCheckpoint,
      lastBatchId,
      sourceCutoff: actualSourceCutoff ? actualSourceCutoff.toISOString() : null,
      isSimulated: sourceState.isSimulated,
      durationMs,
      categories: finalCategories,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const failure = recordOperationalFailure(err, {
      operation: "demand.run",
      entity: "DemandRun",
      entityId: initialRun.id,
      actorUserId: options.actorUserId ?? null,
    });

    try {
      await db.demandRun.update({
        where: { id: initialRun.id },
        data: {
          status: "FAILED",
          errorSummary: serializePublicFailure(failure),
          finishedAt: nowUTC(),
          durationMs,
        },
      });
    } catch {
      // Ignore secondary update error
    }

    if (!canonicalClaimReleased) {
      try {
        await releaseCanonicalState(canonicalClaim);
      } catch {
        // Ignore secondary release error
      }
    }

    if (!lockReleased) {
      try {
        await db.demandCalculationLock.updateMany({
          where: {
            id: "DEMAND_CALCULATION",
            lockToken,
          },
          data: {
            isLocked: false,
            lockToken: null,
            lockedAt: null,
            lockedBy: null,
            lockedByUserId: null,
          },
        });
      } catch {
        // Ignore secondary release error
      }
    }

    throw err;
  }
}

export async function getLatestDemandRun() {
  const latestRun = await db.demandRun.findFirst({
    where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] } },
    orderBy: { runDate: "desc" },
    include: {
      metrics: {
        orderBy: { planningCategory: "asc" },
      },
    },
  });

  return latestRun;
}

interface ResolvedPersistedCategory {
  readonly approved: boolean;
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly labApproved: boolean;
  readonly shapeApproved: boolean;
}

function persistedCategoryOf(r: {
  categoryState?: string | null;
  categoryLabState?: string | null;
  categoryShapeState?: string | null;
  labNormalized?: string | null;
  shapeNormalized?: string | null;
}): ResolvedPersistedCategory {
  const labApproved = r.categoryLabState === "APPROVED" && typeof r.labNormalized === "string";
  const shapeApproved = r.categoryShapeState === "APPROVED" && typeof r.shapeNormalized === "string";
  return {
    approved: r.categoryState === "APPROVED" && labApproved && shapeApproved,
    labNormalized: labApproved ? r.labNormalized! : null,
    shapeNormalized: shapeApproved ? r.shapeNormalized! : null,
    labApproved,
    shapeApproved,
  };
}

function categoryIssueRule(c: ResolvedPersistedCategory, band: { label: string } | null): string {
  if (!band) return "UNMAPPED_WEIGHT_BAND";
  if (!c.shapeApproved) return "UNMAPPED_SHAPE";
  return "UNMAPPED_LAB";
}

function categoryIssueField(c: ResolvedPersistedCategory, band: { label: string } | null): string {
  if (!band) return "weight";
  if (!c.shapeApproved) return "shape";
  return "labRaw";
}

function categoryIssueRawValue(
  c: ResolvedPersistedCategory,
  band: { label: string } | null,
  labRaw: string | null | undefined,
  shapeRaw: string | null | undefined,
  weight: unknown,
): string {
  if (!band) return String(weight);
  if (!c.shapeApproved) return String(shapeRaw ?? "");
  return String(labRaw ?? "");
}

function categoryExclusionReason(
  c: ResolvedPersistedCategory,
  band: { label: string } | null,
  labRaw: string | null | undefined,
  shapeRaw: string | null | undefined,
): string {
  if (!band) return "Unmapped weight band";
  if (!c.shapeApproved) return `Unapproved shape '${shapeRaw ?? ""}'`;
  return `Unapproved lab '${labRaw ?? ""}'`;
}
