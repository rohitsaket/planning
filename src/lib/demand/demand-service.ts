/**
 * DIAMOND MANUFACTURING — AUTHORITATIVE DEMAND & INVENTORY CALCULATION SERVICE
 * 
 * Hardened Features:
 * 1. Explicit Sales Policy: CANONICAL_FANTASY (default) vs LEGACY_SALES (never unioned)
 * 2. Immutable canonical sale events from LotHistoryRecord with lifecycle deduplication
 * 3. Exact non-sales exclusions (disappearance, transfer, archive, memo return, etc.)
 * 4. Polished inventory classification: Available, Memo, Reserved, Blocked (with mirror reconciliation)
 * 5. Strict category mapping with deterministic DataQualityIssue generation
 * 6. Configurable WIP eligibility & unallocated WIP tracking
 * 7. Approved-plan coverage validation (no defaulting certification intent to GIA)
 * 8. Deterministic SHA-256 mapping & rule version fingerprints
 * 9. Owner-safe atomic concurrency lock with unique lock tokens & failure safety
 * 10. Persisted DemandMetricTraceItem for paginated lot provenance
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { resolveLabNormalization, normalizeShape } from "@/lib/fantasy/canonical";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST, getISTDateString, parseISTDateToUTC, nowUTC } from "@/lib/fantasy/time";
import { roundHalfUpInt } from "@/lib/domain/diamond-rules";
import crypto from "crypto";

export type DemandSourcePolicy = "CANONICAL_FANTASY" | "LEGACY_SALES";

export interface DemandRunOptions {
  actor?: string;
  actorUserId?: string;
  sourcePolicy?: DemandSourcePolicy;
  windowDays?: number;
  referenceDate?: Date;
  cursorBatchSize?: number;
  wipEligibleStages?: string[];
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
  totalPipelineNeed: number;
  totalApprovedPlanCoverage: number;
  totalRemainingUnplanned: number;
  salesCount: number;
  inventoryCount: number;
  wipCount: number;
  planCount: number;
  excludedCount: number;
  checkpoint: number;
  lastBatchId: string | null;
  sourceCutoff: string | null;
  isSimulated: boolean;
  durationMs: number;
  categories: DemandCategoryTrace[];
  errorSummary?: string;
}

/**
 * Computes a deterministic SHA-256 fingerprint for active mappings, weight bands, and rules.
 */
export function computeMappingFingerprint(
  labMappings: Array<{ rawLab: string; normalizedLab: string; active?: boolean }>,
  shapeMappings: Array<{ rawShape: string; normalizedShape: string; active?: boolean }>,
  weightBands: Array<{ code: string; minCt: Prisma.Decimal | number; maxCt: Prisma.Decimal | number; active?: boolean }>,
  wipRule?: string
): string {
  const labParts = [...labMappings]
    .filter((l) => l.active !== false)
    .sort((a, b) => a.rawLab.localeCompare(b.rawLab))
    .map((l) => `${l.rawLab.trim().toUpperCase()}:${l.normalizedLab.trim().toUpperCase()}`);

  const shapeParts = [...shapeMappings]
    .filter((s) => s.active !== false)
    .sort((a, b) => a.rawShape.localeCompare(b.rawShape))
    .map((s) => `${s.rawShape.trim().toUpperCase()}:${s.normalizedShape.trim().toUpperCase()}`);

  const bandParts = [...weightBands]
    .filter((w) => w.active !== false)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((w) => `${w.code}:${Number(w.minCt).toFixed(4)}-${Number(w.maxCt).toFixed(4)}`);

  const payload = JSON.stringify({
    labs: labParts,
    shapes: shapeParts,
    bands: bandParts,
    wipRule: wipRule || "DEFAULT_STAGES",
  });

  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/**
 * Computes current active mapping fingerprint from the database.
 */
export async function computeCurrentMappingFingerprint(): Promise<string> {
  const [labs, shapes, bands, wipRule] = await Promise.all([
    db.labMapping.findMany({ where: { active: true } }),
    db.shapeMapping.findMany({ where: { active: true } }),
    db.weightBand.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.businessRule.findUnique({ where: { ruleId: "BR-WIP-001" } }),
  ]);
  return computeMappingFingerprint(labs, shapes, bands, wipRule?.version);
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
      // Ignore race
    }
  }
}

/**
 * Explicitly releases a stuck demand calculation lock with mandatory audit logging.
 */
export async function unlockDemandCalculation(
  actor: string,
  reason: string,
  actorUserId?: string
): Promise<{ success: boolean; message: string }> {
  if (!reason || !reason.trim()) {
    throw new Error("A reason is mandatory for manual demand calculation unlock");
  }

  await ensureLockRecord();
  const currentLock = await db.demandCalculationLock.findUnique({
    where: { id: "DEMAND_CALCULATION" },
  });

  await db.demandCalculationLock.update({
    where: { id: "DEMAND_CALCULATION" },
    data: {
      isLocked: false,
      lockToken: null,
      previousOwner: currentLock?.lockedBy ?? "UNKNOWN",
      previousRunId: currentLock?.runId ?? null,
      previousLockedAt: currentLock?.lockedAt ?? null,
      unlockReason: reason.trim(),
      unlockedBy: actor,
      unlockedAt: nowUTC(),
      lockedAt: null,
      lockedBy: null,
      lockedByUserId: null,
      runId: null,
    },
  });

  // Audit log entry
  await db.auditLog.create({
    data: {
      actor,
      actorUserId: actorUserId ?? null,
      action: "DEMAND_LOCK_UNLOCKED",
      entity: "DemandCalculationLock",
      entityId: "DEMAND_CALCULATION",
      reason: `Manual unlock: ${reason.trim()} (Previous owner: ${currentLock?.lockedBy ?? "none"})`,
    },
  });

  return {
    success: true,
    message: `Demand calculation lock explicitly released by ${actor}. Reason: ${reason.trim()}`,
  };
}

/**
 * Resolves exactly one active WeightBand for a given carat weight.
 */
function resolveWeightBand(
  weight: number,
  bands: Array<{ id: string; code: string; label: string; minCt: Prisma.Decimal; maxCt: Prisma.Decimal }>
) {
  for (const b of bands) {
    const min = Number(b.minCt);
    const max = Number(b.maxCt);
    if (weight >= min && weight <= max) {
      return b;
    }
  }
  return null;
}

const DEFAULT_ELIGIBLE_WIP_STAGES = [
  "WIP_LASER",
  "WIP_POLISHING",
  "WIP_GRADING",
  "POLISHING",
  "LASER",
  "GRADING",
  "BLOCKING",
  "BRUTING",
];

/**
 * Executes a full, deterministic 90-day Demand & Inventory calculation run.
 */
export async function runDemandCalculation(options: DemandRunOptions = {}): Promise<DemandRunResult> {
  const startTime = Date.now();
  const config = getFantasyConfig();
  const sourcePolicy: DemandSourcePolicy = options.sourcePolicy ?? "CANONICAL_FANTASY";
  await ensureLockRecord();

  // 1. ATOMIC OWNER-SAFE LOCK ACQUISITION
  const lockToken = crypto.randomUUID();
  const lockAcquired = await db.demandCalculationLock.updateMany({
    where: {
      id: "DEMAND_CALCULATION",
      isLocked: false,
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

  // 2. Initialize RUNNING snapshot record
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
      sourceMode: config.sourceMode,
      isSimulated: config.isSimulation,
      lockToken,
      actor: options.actor ?? "SYSTEM",
      actorUserId: options.actorUserId ?? null,
    },
  });

  // Attach runId to lock record
  await db.demandCalculationLock.updateMany({
    where: { id: "DEMAND_CALCULATION", lockToken },
    data: { runId: initialRun.id },
  });

  let lockReleased = false;

  try {
    // 3. Load active mappings, weight bands, and rules
    const [labMappingsList, shapeMappingsList, weightBands, wipRule] = await Promise.all([
      db.labMapping.findMany({ where: { active: true } }),
      db.shapeMapping.findMany({ where: { active: true } }),
      db.weightBand.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
      db.businessRule.findUnique({ where: { ruleId: "BR-WIP-001" } }),
    ]);

    const mappingFingerprint = computeMappingFingerprint(
      labMappingsList,
      shapeMappingsList,
      weightBands,
      wipRule?.version
    );

    const labMappingsMap = new Map<string, string>();
    for (const m of labMappingsList) {
      labMappingsMap.set(m.rawLab.trim().toUpperCase(), m.normalizedLab);
    }

    const shapeMappingsMap = new Map<string, string>();
    for (const m of shapeMappingsList) {
      shapeMappingsMap.set(m.rawShape.trim().toUpperCase(), m.normalizedShape.toUpperCase());
    }

    // Determine eligible WIP stages
    let eligibleWipStages = options.wipEligibleStages ?? DEFAULT_ELIGIBLE_WIP_STAGES;
    if (wipRule?.configuration) {
      try {
        const parsed = JSON.parse(wipRule.configuration);
        if (Array.isArray(parsed.eligibleStages) && parsed.eligibleStages.length > 0) {
          eligibleWipStages = parsed.eligibleStages;
        }
      } catch {
        // Fallback to default stages
      }
    }

    // Source synchronization checkpoint info
    const [checkpointRecord, lastSyncRun] = await Promise.all([
      db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } }),
      db.integrationSyncRun.findFirst({
        where: { source: { in: ["FANTASY", "Fantasy"] }, status: "SUCCESS" },
        orderBy: { finishedAt: "desc" },
      }),
    ]);

    const currentCheckpoint = checkpointRecord?.currentCheckpoint ?? 0;
    const lastBatchId = checkpointRecord?.lastBatchId ?? lastSyncRun?.batchId ?? null;
    const actualSourceCutoff = lastSyncRun?.sourceCutoff ?? null;

    // 4. FETCH SALES EVENTS ACCORDING TO SOURCE POLICY
    interface ConfirmedSaleFact {
      eventKey: string;
      lotId: string;
      sourceRecordId?: string | null;
      docDate: Date;
      shape: string;
      weight: number;
      labRaw?: string | null;
      labNormalized?: string | null;
      saleTotalUsd?: number | null;
      customerName?: string | null;
      quantity: number;
    }

    const confirmedSaleFacts: ConfirmedSaleFact[] = [];
    const seenSaleEventKeys = new Set<string>();

    if (sourcePolicy === "CANONICAL_FANTASY") {
      // Find candidate lotIds with sale events in lookback window
      const candidateLots = await db.lotHistoryRecord.findMany({
        where: {
          docDate: {
            gte: lookbackStart,
            lte: lookbackEnd,
          },
          OR: [
            { status: { in: ["SOLD", "INVOICE"] } },
            { removalReason: "EXPLICIT_SALE" },
          ],
        },
        select: { lotId: true },
        distinct: ["lotId"],
      });

      const lotIds = candidateLots.map((c) => c.lotId);

      const historyRecords = await db.lotHistoryRecord.findMany({
        where: {
          lotId: { in: lotIds },
        },
        orderBy: [
          { lotId: "asc" },
          { version: "asc" },
        ],
      });

      // Lifecycle deduplication per lotId
      const lotSalesState = new Map<string, { inSaleEpisode: boolean; episodeIndex: number }>();

      for (const h of historyRecords) {
        let state = lotSalesState.get(h.lotId);
        if (!state) {
          state = { inSaleEpisode: false, episodeIndex: 1 };
          lotSalesState.set(h.lotId, state);
        }

        const isSaleStatus = h.status === "SOLD" || h.status === "INVOICE" || h.removalReason === "EXPLICIT_SALE";

        if (!isSaleStatus) {
          // Lot returned to non-sale status (e.g. STOCK or MEMO) -> start of potential next episode
          state.inSaleEpisode = false;
          state.episodeIndex++;
          continue;
        }

        // If this record is part of an already-counted active sale episode, avoid double-counting
        if (state.inSaleEpisode) {
          continue;
        }

        state.inSaleEpisode = true;

        // Check if this sale event falls in the 90-day window
        if (h.docDate < lookbackStart || h.docDate > lookbackEnd) {
          continue;
        }

        const eventKey = h.sourceRecordId ? `SRC_${h.sourceRecordId}` : `FANTASY_${h.lotId}_EP${state.episodeIndex}`;

        if (!seenSaleEventKeys.has(eventKey)) {
          seenSaleEventKeys.add(eventKey);
          confirmedSaleFacts.push({
            eventKey,
            lotId: h.lotId,
            sourceRecordId: h.sourceRecordId,
            docDate: h.docDate,
            shape: h.shape,
            weight: Number(h.weight),
            labRaw: h.labRaw,
            labNormalized: h.labNormalized,
            saleTotalUsd: h.saleTotalUsd ? Number(h.saleTotalUsd) : null,
            customerName: h.customerName,
            quantity: Number(h.quantity) > 0 ? Number(h.quantity) : 1,
          });
        }
      }
    } else {
      // LEGACY_SALES source policy
      const legacySales = await db.salesRecord.findMany({
        where: {
          docDate: {
            gte: lookbackStart,
            lte: lookbackEnd,
          },
        },
      });

      for (const s of legacySales) {
        const eventKey = `LEGACY_${s.lotId}_${s.id}`;
        if (!seenSaleEventKeys.has(eventKey)) {
          seenSaleEventKeys.add(eventKey);
          confirmedSaleFacts.push({
            eventKey,
            lotId: s.lotId,
            sourceRecordId: null,
            docDate: s.docDate,
            shape: s.shape,
            weight: Number(s.weight),
            labRaw: s.labRaw,
            labNormalized: s.labNormalized,
            saleTotalUsd: s.saleTotalUsd ? Number(s.saleTotalUsd) : null,
            customerName: null,
            quantity: Number(s.qty) > 0 ? Number(s.qty) : 1,
          });
        }
      }
    }

    // 5. FETCH FINISHED INVENTORY & RECONCILE OPERATIONAL MIRROR
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

    // 7. FETCH APPROVED PLAN COVERAGE
    const approvedPlanOptions = await db.planOption.findMany({
      where: {
        selected: true,
        approvalStatus: "APPROVED",
        version: {
          status: { not: "SUPERSEDED" },
          planningCase: {
            status: { in: ["APPROVED", "PLAN_APPROVED", "RELEASED", "SELECTED"] },
          },
        },
      },
      include: {
        pieces: true,
      },
    });

    // 8. AGGREGATE CATEGORIES & BUILD TRACE
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
          approvedPlanCoverage: 0,
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

function resolveApprovedShape(rawShape: string | null | undefined, shapeMap: Map<string, string>): string {
  if (!rawShape) return "UNKNOWN";
  const key = rawShape.trim().toUpperCase();
  return shapeMap.get(key) || "UNKNOWN";
}

    let salesCount = 0;
    let inventoryCount = 0;
    let wipCount = 0;
    let planCount = 0;
    let excludedCount = 0;

    // Process Confirmed Sales Facts
    for (const rec of confirmedSaleFacts) {
      salesCount++;
      const resolvedLab = rec.labNormalized
        ? { normalized: rec.labNormalized, requiresReview: false }
        : resolveLabNormalization(rec.labRaw, labMappingsMap);

      const normLab = resolvedLab.normalized;
      const normShape = resolveApprovedShape(rec.shape, shapeMappingsMap);
      const band = resolveWeightBand(rec.weight, weightBands);

      if (!band || normShape === "UNKNOWN" || normLab === "UNKNOWN" || resolvedLab.requiresReview) {
        excludedCount++;
        const dqCode = `DQ-UNMAPPED-SALE-${rec.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "SaleEvent",
          recordId: rec.lotId,
          rule: !band ? "UNMAPPED_WEIGHT_BAND" : normShape === "UNKNOWN" ? "UNMAPPED_SHAPE" : "UNMAPPED_LAB",
          message: `Sale record ${rec.lotId} has unapproved mapping (Lab: ${rec.labRaw}, Shape: ${rec.shape}, Wt: ${rec.weight})`,
          severity: "WARNING",
          status: "OPEN",
          affectedField: !band ? "weight" : normShape === "UNKNOWN" ? "shape" : "labRaw",
          rawValue: !band ? String(rec.weight) : normShape === "UNKNOWN" ? rec.shape : String(rec.labRaw),
          normalizedValue: normLab,
          downstreamImpact: "Excluded from automated sales replenishment demand",
        });

        if (band) {
          const fallbackLab = normLab !== "UNKNOWN" ? normLab : "NON_CERTIFIED";
          const fallbackShape = normShape !== "UNKNOWN" ? normShape : "ROUND";
          const trace = getOrCreateCategoryTrace(fallbackLab, fallbackShape, band);
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

    // Process Non-Sale Removals (Exclusion reporting)
    for (const nr of nonSaleRemovalLots) {
      excludedCount++;
      const normLab = nr.labNormalized || resolveLabNormalization(nr.labRaw, labMappingsMap).normalized;
      const normShape = resolveApprovedShape(nr.shape, shapeMappingsMap);
      const band = resolveWeightBand(Number(nr.weight), weightBands);

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
          quantity: Number(nr.quantity) > 0 ? Number(nr.quantity) : 1,
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

    // Process Finished Inventory Records (Stock vs Memo vs Reserved vs Blocked)
    for (const inv of currentInventoryLots) {
      inventoryCount++;
      const resolvedLab = inv.labNormalized
        ? { normalized: inv.labNormalized, requiresReview: false }
        : resolveLabNormalization(inv.labRaw, labMappingsMap);

      const normLab = resolvedLab.normalized;
      const normShape = resolveApprovedShape(inv.shape, shapeMappingsMap);
      const weight = Number(inv.weight);
      const qty = Number(inv.quantity) > 0 ? Number(inv.quantity) : 1;
      const band = resolveWeightBand(weight, weightBands);

      if (!band || normShape === "UNKNOWN" || normLab === "UNKNOWN" || resolvedLab.requiresReview) {
        excludedCount++;
        const dqCode = `DQ-UNMAPPED-INV-${inv.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "PolishedInventory",
          recordId: inv.lotId,
          rule: !band ? "UNMAPPED_WEIGHT_BAND" : normShape === "UNKNOWN" ? "UNMAPPED_SHAPE" : "UNMAPPED_LAB",
          message: `Polished lot ${inv.lotId} has unapproved mapping attributes`,
          severity: "WARNING",
          status: "OPEN",
          affectedField: !band ? "weight" : normShape === "UNKNOWN" ? "shape" : "labRaw",
          rawValue: !band ? String(weight) : normShape === "UNKNOWN" ? inv.shape : String(inv.labRaw),
          downstreamImpact: "Excluded from live finished availability calculation",
        });

        if (band) {
          const fallbackLab = normLab !== "UNKNOWN" ? normLab : "NON_CERTIFIED";
          const fallbackShape = normShape !== "UNKNOWN" ? normShape : "ROUND";
          const trace = getOrCreateCategoryTrace(fallbackLab, fallbackShape, band);
          trace.status = "REVIEW_REQUIRED";
          trace.blockedQty += Math.round(qty);
          trace.excludedLots.push({
            lotId: inv.lotId,
            reason: !band
              ? "Unmapped weight band"
              : normShape === "UNKNOWN"
              ? `Unapproved shape '${inv.shape}'`
              : `Unapproved lab '${inv.labRaw}'`,
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
        }
        continue;
      }

      // Reconcile with operational mirror (PolishedStone)
      const mirror = polishedMirrorMap.get(inv.lotId);

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);

      if (!mirror) {
        // Missing operational mirror -> Flag for review and mark as blockedQty
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
      } else if (inv.currentStatus === "STOCK" && (mirror.planningClass === "PHYSICAL" || mirror.planningClass === "PLANNING_AVAILABLE")) {
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
      } else if (inv.currentStatus === "MEMO" || mirror.planningClass === "MEMO") {
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
      } else if (inv.currentStatus === "RESERVED" || mirror.planningClass === "RESERVED") {
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
          reason: `Stock status ${inv.currentStatus} / class ${mirror.planningClass} — blocked from availability`,
          isIncluded: false,
        });
      }
    }

    // Process Manufacturing WIP Records
    const wipTrackedPieceCodes = new Set<string>();

    for (const wip of currentWipLots) {
      wipCount++;
      const resolvedLab = wip.labNormalized
        ? { normalized: wip.labNormalized, requiresReview: false }
        : resolveLabNormalization(wip.labRaw, labMappingsMap);

      const normLab = resolvedLab.normalized;
      const normShape = resolveApprovedShape(wip.shape, shapeMappingsMap);
      const weight = Number(wip.weight);
      const qty = Number(wip.quantity) > 0 ? Number(wip.quantity) : 1;
      const band = resolveWeightBand(weight, weightBands);
      const stageUpper = (wip.wipStage || wip.currentStatus || "").toUpperCase();
      const isEligibleStage = eligibleWipStages.some((s) => stageUpper.includes(s));

      if (band && normShape !== "UNKNOWN" && normLab !== "UNKNOWN" && !resolvedLab.requiresReview && isEligibleStage) {
        const trace = getOrCreateCategoryTrace(normLab, normShape, band);
        trace.wipCoverage += Math.round(qty);
        trace.eligibleWipLots.push({
          lotId: wip.lotId,
          wipStage: wip.wipStage,
          weight,
          kapan: wip.kapan,
          quantity: qty,
        });
        traceItemsToPersist.push({
          runId: initialRun.id,
          planningCategory: trace.category,
          traceType: "WIP_ELIGIBLE",
          lotId: wip.lotId,
          wipStage: wip.wipStage,
          quantity: qty,
          weight,
          lab: normLab,
          shape: normShape,
          weightBand: band.label,
          isIncluded: true,
        });
      } else {
        excludedCount++;
        const dqCode = `DQ-UNMAPPED-WIP-${wip.lotId}`;
        dqIssuesToCreate.push({
          issueCode: dqCode,
          source: "DEMAND_CALCULATION",
          entity: "ManufacturingWIP",
          recordId: wip.lotId,
          rule: !isEligibleStage ? "INELIGIBLE_WIP_STAGE" : normShape === "UNKNOWN" ? "UNMAPPED_SHAPE" : "UNMAPPED_WIP_ATTRIBUTES",
          message: `WIP record ${wip.lotId} ineligible for shortage coverage (Stage: ${wip.wipStage}, Lab: ${wip.labRaw})`,
          severity: "INFO",
          status: "OPEN",
          affectedField: !isEligibleStage ? "wipStage" : "attributes",
          downstreamImpact: "Tracked as unallocated WIP; does not deduct from shortage",
        });

        if (band) {
          const fallbackLab = normLab !== "UNKNOWN" ? normLab : "NON_CERTIFIED";
          const fallbackShape = normShape !== "UNKNOWN" ? normShape : "ROUND";
          const trace = getOrCreateCategoryTrace(fallbackLab, fallbackShape, band);
          trace.unallocatedWip += Math.round(qty);
          const reason = !isEligibleStage ? `Ineligible WIP stage (${wip.wipStage})` : `Ambiguous WIP attributes`;
          trace.excludedLots.push({ lotId: wip.lotId, reason });
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: trace.category,
            traceType: "WIP_UNALLOCATED",
            lotId: wip.lotId,
            wipStage: wip.wipStage,
            quantity: qty,
            weight,
            lab: fallbackLab,
            shape: fallbackShape,
            weightBand: band.label,
            reason,
            isIncluded: false,
          });
        }
      }
    }

    // Process Approved Plan Coverage (Pieces)
    for (const plan of approvedPlanOptions) {
      for (const p of plan.pieces) {
        planCount++;
        // Check if piece already converted to WIP or polished
        if (p.fulfilled || (p.pieceCode && wipTrackedPieceCodes.has(p.pieceCode)) || p.actualPolishedLotId) {
          continue;
        }

        // Never default missing cert intent to GIA
        if (!p.certificationIntent || !p.certificationIntent.trim()) {
          excludedCount++;
          const dqCode = `DQ-UNRESOLVED-PLAN-CERT-${p.id}`;
          dqIssuesToCreate.push({
            issueCode: dqCode,
            source: "DEMAND_CALCULATION",
            entity: "PlanOptionPiece",
            recordId: p.id,
            rule: "MISSING_CERTIFICATION_INTENT",
            message: `Approved plan piece ${p.pieceCode} has missing certification intent`,
            severity: "WARNING",
            status: "OPEN",
            affectedField: "certificationIntent",
            downstreamImpact: "Excluded from approved plan coverage",
          });
          continue;
        }

        const resolvedLab = resolveLabNormalization(p.certificationIntent, labMappingsMap);
        const normLab = resolvedLab.normalized;
        const normShape = resolveApprovedShape(p.expectedShape, shapeMappingsMap);
        const weight = Number(p.expectedWeight);
        const band = resolveWeightBand(weight, weightBands);

        if (band && normShape !== "UNKNOWN" && normLab !== "UNKNOWN" && !resolvedLab.requiresReview) {
          const trace = getOrCreateCategoryTrace(normLab, normShape, band);
          trace.approvedPlanCoverage += 1;
          traceItemsToPersist.push({
            runId: initialRun.id,
            planningCategory: trace.category,
            traceType: "PLAN_APPROVED",
            lotId: p.pieceCode,
            quantity: 1,
            weight,
            lab: normLab,
            shape: normShape,
            weightBand: band.label,
            isIncluded: true,
          });
        } else {
          excludedCount++;
        }
      }
    }

    // Ensure all registered Planning Categories exist in results
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
    let totalReserved = 0;
    let totalBlocked = 0;
    let totalWipCoverage = 0;
    let totalUnallocatedWip = 0;
    let totalPipelineNeed = 0;
    let totalApprovedPlanCoverage = 0;
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
      totalApprovedPlanCoverage += trace.approvedPlanCoverage;
      totalRemainingUnplanned += remainingUnplanned;

      finalCategories.push(trace);
    }

    finalCategories.sort((a, b) => a.category.localeCompare(b.category));
    const durationMs = Date.now() - startTime;
    const finalRunStatus = anyCategoryReviewRequired ? "REVIEW_REQUIRED" : "COMPLETED";

    // 10. ATOMIC TRANSACTIONAL PERSISTENCE & LOCK RELEASE
    await db.$transaction(async (tx) => {
      // Create DataQualityIssue rows
      if (dqIssuesToCreate.length > 0) {
        await tx.dataQualityIssue.createMany({
          data: dqIssuesToCreate,
          skipDuplicates: true,
        });
      }

      // Create DemandMetric rows
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
        approvedPlanCoverage: c.approvedPlanCoverage,
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

      // Create DemandMetricTraceItem rows
      if (traceItemsToPersist.length > 0) {
        await tx.demandMetricTraceItem.createMany({
          data: traceItemsToPersist,
          skipDuplicates: true,
        });
      }

      // Update DemandRun to COMPLETED/REVIEW_REQUIRED
      await tx.demandRun.update({
        where: { id: initialRun.id },
        data: {
          status: finalRunStatus,
          totalShortage,
          totalExcess,
          mappingVersion: "CONFIG-V1",
          mappingFingerprint,
          checkpoint: currentCheckpoint,
          lastBatchId,
          sourceCutoff: actualSourceCutoff,
          salesCount,
          inventoryCount,
          wipCount,
          planCount,
          excludedCount,
          finishedAt: nowUTC(),
          durationMs,
        },
      });

      // Owner-checked lock release
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
      totalPipelineNeed,
      totalApprovedPlanCoverage,
      totalRemainingUnplanned,
      salesCount,
      inventoryCount,
      wipCount,
      planCount,
      excludedCount,
      checkpoint: currentCheckpoint,
      lastBatchId,
      sourceCutoff: actualSourceCutoff ? actualSourceCutoff.toISOString() : null,
      isSimulated: config.isSimulation,
      durationMs,
      categories: finalCategories,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const safeError = err instanceof Error ? err.message : String(err);

    // Record FAILED run with safe error summary
    try {
      await db.demandRun.update({
        where: { id: initialRun.id },
        data: {
          status: "FAILED",
          errorSummary: safeError,
          finishedAt: nowUTC(),
          durationMs,
        },
      });
    } catch {
      // Ignore secondary update error
    }

    // Owner-safe lock release on failure
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

/**
 * Retrieves the latest successful completed demand run.
 */
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
