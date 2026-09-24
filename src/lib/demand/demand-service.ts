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
import { recordOperationalFailure, serializePublicFailure } from "@/lib/api/operational-failure";
import {
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
  isPlanPieceCoveredElsewhere,
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
  /** WIP that could not be attributed to any planning category (quarantined, never invented). */
  totalAmbiguousWip: number;
  totalPipelineNeed: number;
  totalApprovedPlanCoverage: number;
  totalRemainingUnplanned: number;
  /** The WIP coverage policy applied by this run. */
  wipPolicy: WipPolicy;
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
}

/**
 * Identity of the WIP coverage policy that was in force for a run. Any change to
 * the rule's status, version or eligible stages changes the run fingerprint.
 */
export function wipPolicyFingerprint(policy: WipPolicy): string {
  return `${policy.status}:${policy.ruleStatus ?? "NONE"}:${policy.ruleVersion ?? "NONE"}:${policy.eligibleStages.join(",")}`;
}

/**
 * Computes a deterministic SHA-256 fingerprint for active mappings, weight bands, and rules.
 */
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

/**
 * Computes current active mapping fingerprint from the database.
 */
export async function computeCurrentMappingFingerprint(): Promise<string> {
  const [mappings, policy] = await Promise.all([loadCategoryMappings(db), loadWipPolicy(db)]);
  return computeMappingFingerprint(mappings, wipPolicyFingerprint(policy));
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
 * Executes a full, deterministic 90-day Demand & Inventory calculation run.
 */
export async function runDemandCalculation(options: DemandRunOptions = {}): Promise<DemandRunResult> {
  const startTime = Date.now();
  // Stamped on the run so a historical result always says what it was calculated from.
  // The value is the centrally derived effective state; `deriveHistoricalSourceState`
  // reads both it and the legacy vocabulary already stored on older runs, so no
  // historical value is rewritten.
  const sourceState = resolveFantasySourceState();
  // One classification authority for the run. Records written by the synchronization
  // service already carry their classification; anything else is classified on read
  // through this same profile rather than by reinterpreting the raw status here.
  const classificationProfile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE);
  // Memoized per record: the chain below consults the classification several times and
  // must not re-derive it each time.
  const classificationCache = new Map<string, ReturnType<typeof resolveEffectiveClassification>>();
  /**
   * The classification to act on for one inventory record. The operational mirror is
   * passed in so a stale or hand-written mirror can only ever make the answer more
   * restrictive, never more permissive.
   */
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

  // 1b. Claim the canonical state, in the same order synchronization uses: operation
  // lock first, then canonical claim. The pair is never acquired in the opposite order,
  // so the two operations cannot deadlock against each other.
  //
  // Until this claim is held, a synchronization may commit a batch at any moment, and
  // every read below would be split across two source states.
  const canonicalClaimResult = await claimCanonicalState("DEMAND", options.actor ?? "SYSTEM");
  if (!canonicalClaimResult.acquired) {
    // The demand lock is released again: holding it while refused would block the next
    // attempt for a full lease with no calculation in progress.
    await db.demandCalculationLock.updateMany({
      where: { id: "DEMAND_CALCULATION", lockToken },
      data: { isLocked: false, lockToken: null, lockedAt: null, lockedBy: null, lockedByUserId: null },
    });
    throw new CanonicalStateBusyError(canonicalClaimResult.heldBy);
  }
  const canonicalClaim = canonicalClaimResult.claim;
  let canonicalClaimReleased = false;

  // 1c. The committed synchronization this calculation reads.
  //
  // Selected while the claim is held, so it cannot advance underneath the run. A sync
  // that failed, or one still in flight, is not a source state: only a run that reached
  // SUCCESS has its canonical writes committed.
  const boundSyncRun = await db.integrationSyncRun.findFirst({
    where: { source: { in: ["FANTASY", "Fantasy"] }, status: "SUCCESS", finishedAt: { not: null } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    select: { id: true, endingCheckpoint: true, batchId: true, finishedAt: true },
  });

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
      sourceMode: sourceState.effectiveState,
      isSimulated: sourceState.isSimulated,
      // The exact committed synchronization this run reads. Null only when no successful
      // sync exists yet, which the run reports rather than inventing an identity for.
      sourceSyncRunId: boundSyncRun?.id ?? null,
      checkpoint: boundSyncRun?.endingCheckpoint ?? 0,
      lastBatchId: boundSyncRun?.batchId ?? null,
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
    // 3. Load active mappings, weight bands, and the WIP coverage policy.
    // Category resolution and WIP classification are shared with every other consumer
    // (WIP Inventory, Demand Trace, country position) so the numbers cannot diverge.
    const mappings = await loadCategoryMappings(db);
    const wipContext = await loadWipClassificationContext(db, { mappings });
    const wipPolicy: WipPolicy = wipContext.policy;

    const labMappingsMap = mappings.labMappings;
    const shapeMappingsMap = mappings.shapeMappings;
    const weightBands = mappings.weightBands;

    const mappingFingerprint = computeMappingFingerprint(mappings, wipPolicyFingerprint(wipPolicy));

    // Source identity comes from the synchronization this run was bound to, not from a
    // second read of `SyncCheckpoint`.
    //
    // That row is mutable and advances with every batch. Reading it separately gave the
    // run two sources for one fact, and the later read won — so a run could report a
    // checkpoint belonging to a synchronization it had not read. The binding taken under
    // the canonical claim is the answer; there is no second opinion.
    const currentCheckpoint = boundSyncRun?.endingCheckpoint ?? 0;
    const lastBatchId = boundSyncRun?.batchId ?? null;
    const boundSyncDetail = boundSyncRun
      ? await db.integrationSyncRun.findUnique({
          where: { id: boundSyncRun.id },
          select: { sourceCutoff: true },
        })
      : null;
    const actualSourceCutoff = boundSyncDetail?.sourceCutoff ?? null;
    // 4. FETCH SALES EVENTS ACCORDING TO SOURCE POLICY
    //
    // Delegated to the shared confirmed-sales service. The window, the SOLD/INVOICE and
    // explicit-sale eligibility, the lifecycle episode deduplication, the deterministic
    // event identity and the quantity provenance all live there, so the demand run and
    // the Analysis pages cannot disagree about what a confirmed sale is.
    // 3b. COMPLETE THE OPERATIONAL PROJECTION BEFORE CONSUMING IT
    //
    // Everything below — the confirmed sale facts and the inventory read alike — uses two
    // things derived from canonical records: the persisted
    // planning-category classification, and the operational mirror. Both can be absent
    // while the canonical record itself is present and unchanged — an ordinary seed that
    // clears `PolishedStone` leaves exactly that state, and the next synchronization
    // rebuilds nothing because nothing in the source changed.
    //
    // So the projection is completed first, from the canonical records, using the same
    // production rules. This repairs; it never invents. A record already classified keeps
    // its decision, so a committed run stays reproducible.
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

    // 6. CLASSIFY CURRENT MANUFACTURING WIP (shared classifier — same result as the WIP page)
    const wipInventory = await classifyCurrentWip(db, { context: wipContext });

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

    let salesCount = 0;
    let inventoryCount = 0;
    let wipCount = 0;
    let planCount = 0;
    let excludedCount = 0;

    // Process Confirmed Sales Facts
    for (const rec of confirmedSaleFacts) {
      salesCount++;
      // The planning category comes from the classification the synchronizer persisted
      // on the canonical record, not from a second reading of the raw columns through
      // whatever the mapping tables hold now. Re-deriving here is what let a committed
      // run change meaning when a mapping row was edited, and what let canonical
      // inventory and the demand result disagree about the same lot's lab.
      const category = persistedCategoryOf(rec);
      const normLab = category.labNormalized;
      const normShape = category.shapeNormalized;
      // The weight gate exists to stop an unconfirmed *live* unit from choosing a
      // planning category. The legacy seeded policy is neither live nor canonical —
      // `assessSnapshot` already refuses its runs as SOURCE_POLICY_NOT_CANONICAL — so it
      // keeps its previous behaviour rather than being silently re-scoped here.
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
          // Null when nothing was approved. Reporting the raw text as the normalized
          // value is how an unapproved lab reached a category key in the first place.
          normalizedValue: normLab,
          downstreamImpact: "Excluded from automated sales replenishment demand",
        });

        // A record whose lab or shape was never approved has no category, so it falls
        // through to the quarantine bucket below. It used to be filed under a category
        // built from the unapproved value itself — `EGL_UNAPPROVED|ROUND|1.00-1.09` —
        // which is precisely the silent conversion of an unknown value into a
        // valid-looking category that the classification refuses to make.
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
          // No weight band means no category to file this under — but a confirmed sale
          // event must never leave the trace empty-handed. Without this row the event is
          // counted in salesCount, raises a data-quality issue, and then cannot be found
          // by anyone asking "which sales did this run see?".
          //
          // The quarantine bucket exists for exactly this: visible and reviewable,
          // without inventing a category to hold it.
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

    // Process Non-Sale Removals (Exclusion reporting)
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
          // Preserved as supplied. An excluded record reports what the source gave,
          // never a substituted 1.
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

    // Process Finished Inventory Records (Stock vs Memo vs Reserved vs Blocked)
    for (const inv of currentInventoryLots) {
      inventoryCount++;
      // Same rule as the sales side: the persisted canonical decision, never a second
      // interpretation of the raw columns.
      const category = persistedCategoryOf(inv);
      const normLab = category.labNormalized;
      const normShape = category.shapeNormalized;

      // Quantity and weight are established once, from the record's own provenance.
      // Neither is assumed: a quantity nobody supplied is not one piece, and a weight
      // whose unit is unconfirmed cannot choose a weight band.
      const quantityDecision = resolveCanonicalQuantity(inv);
      const weightDecision = resolveCanonicalWeight(inv);
      const weight = weightDecision.rawValue ?? Number(inv.weight);
      // Pieces only when the source established them. There is no fallback to 1.
      const qty = quantityDecision.pieces;
      const band = weightDecision.carats === null ? null : resolveWeightBand(weightDecision.carats, weightBands);

      // A record whose quantity cannot be counted stays visible and traceable, but its
      // pieces enter no authoritative total — not availability, and not the blocked or
      // memo buckets either, because a number nobody supplied cannot be bucketed.
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

        // A record whose lab or shape was never approved has no category, so it falls
        // through to the quarantine bucket below. It used to be filed under a category
        // built from the unapproved value itself — `EGL_UNAPPROVED|ROUND|1.00-1.09` —
        // which is precisely the silent conversion of an unknown value into a
        // valid-looking category that the classification refuses to make.
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
          // No category to file this under — but a current stock record must never leave
          // the trace empty-handed. Without this row the lot is counted in
          // `inventoryCount`, raises a data-quality issue, and then cannot be found by
          // anyone asking which records this run actually saw.
          //
          // The quarantine bucket exists for exactly this: visible and reviewable,
          // without inventing a category to hold it.
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

      // Reconcile with operational mirror (PolishedStone)
      const mirror = polishedMirrorMap.get(inv.lotId);
      const effClass = classificationOf(inv, mirror?.planningClass ?? null);

      const trace = getOrCreateCategoryTrace(normLab, normShape, band);

      if (isMirroredInventoryClass(effClass.inventoryClass) && !mirror) {
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
      // Availability comes from the persisted canonical classification, not from a
      // second reading of the raw status. A record the classifier did not classify — a
      // null, from before classification existed — is never treated as available.
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

    // Process Manufacturing WIP Records through the shared classifier.
    // Eligible WIP reduces the pipeline requirement only when BR-WIP-001 is confirmed;
    // ambiguous WIP is quarantined instead of being mapped into a business category.
    const bandByCode = new Map(weightBands.map((b) => [b.code, b]));
    let ambiguousWipPieces = 0;

    for (const wip of wipInventory.results) {
      wipCount++;

      if (wip.outcome === "COMPLETED" || wip.outcome === "ALREADY_POLISHED") {
        // Represented as finished output elsewhere: neither coverage nor open WIP.
        continue;
      }

      const band = wip.weightBandCode ? bandByCode.get(wip.weightBandCode) : undefined;

      // WIP with no established quantity is neither coverage nor unallocated pieces.
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

      // Everything below is real WIP that does not reduce shortage.
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
        // Quarantined: no business category may be invented for it. A record with no
        // established quantity contributes no pieces but is still traced.
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

    // Process Approved Plan Coverage (Pieces)
    for (const plan of approvedPlanOptions) {
      for (const p of plan.pieces) {
        planCount++;
        // Output already tracked as manufacturing WIP or as polished stock is counted
        // there; counting it again here would double-count the same physical piece.
        if (isPlanPieceCoveredElsewhere(p, wipInventory.wipLotIds)) {
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

    // A run that found nothing it was allowed to count must not be reported as a
    // completed authoritative result.
    //
    // Without this, live data entering a pipeline whose quantity semantics are not yet
    // confirmed produces the most dangerous outcome available: every sale excluded for
    // unconfirmed quantity, every target therefore zero, every shortage therefore zero —
    // and a page that says, in good faith, that there is no shortage anywhere. The
    // numbers would be arithmetically correct and completely misleading.
    //
    // The run still happens and its diagnostics are still persisted; it is the *status*
    // that refuses to claim authority. REVIEW_REQUIRED is the existing state for exactly
    // this: a result a human must look at before relying on it.
    // Pieces the run was actually allowed to count, across every category.
    const countedSalePieces = finalCategories.reduce((sum, c) => sum + c.sales90d, 0);
    // Sales arrived but none of them could be counted — the live-contract failure mode.
    const everySaleExcluded = salesCount > 0 && countedSalePieces === 0;
    // Inventory arrived but none of it could be counted either.
    // Inventory arrived but none of it could be counted either. Both conditions require
    // that data actually arrived: a window that genuinely contains no sales is a
    // legitimate completed result ("found nothing"), not a blocked one ("could not
    // read what it found"), and the two must not be conflated.
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
        // ERROR, not BLOCKING: a blocking issue stops every Analysis page, and this
        // concerns one run's inputs. The run's own REVIEW_REQUIRED status is what tells a
        // reader not to rely on it.
        severity: "ERROR",
        status: "OPEN",
        affectedField: "quantity",
        downstreamImpact: "Run marked review required; shortage figures are not presented as authoritative",
      });
    }

    // A run whose inputs are not fully projected is never declared ready. The figures
    // below would be computed over records whose derived state is missing, which is how a
    // whole business once reported zero available stock and called it a result.
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

    // 10. ATOMIC TRANSACTIONAL PERSISTENCE & LOCK RELEASE
    //
    // Fencing: an administrator may have force-released this claim while the calculation
    // was running, which means a synchronization has since been allowed to change
    // canonical records. The figures computed above may already describe a state that no
    // longer exists, so the run is abandoned rather than persisted. Throwing here means
    // no metric, no trace row and no COMPLETED status is written.
    if (!(await isClaimStillHeld(canonicalClaim))) {
      throw new CanonicalStateFencedError();
    }

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
          // Provenance: which WIP coverage policy this run actually applied.
          wipPolicyStatus: wipPolicy.status,
          wipRuleVersion: wipPolicy.ruleVersion,
          wipEligibleStages: wipPolicy.eligibleStages.join(","),
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
    // Released only after the transaction committed. Until then a synchronization could
    // still change the records these metrics describe.
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
      totalApprovedPlanCoverage,
      totalRemainingUnplanned,
      wipPolicy,
      salesCount,
      inventoryCount,
      wipCount,
      planCount,
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
    // The exception is converted once, here. Diagnostics reach the server log under the
    // reference; only the sanitized envelope is persisted, so the column cannot later be
    // read back into a response as exception text.
    const failure = recordOperationalFailure(err, {
      operation: "demand.run",
      entity: "DemandRun",
      entityId: initialRun.id,
      actorUserId: options.actorUserId ?? null,
    });

    // Record FAILED run with the sanitized public failure
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

    // Owner-safe lock release on failure
    if (!canonicalClaimReleased) {
      try {
        // Releases nothing if the claim was already force-released, which is correct: it
        // belongs to whoever holds it now.
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

// ---------------------------------------------------------------------------
// Persisted category classification
// ---------------------------------------------------------------------------

/**
 * What a canonical record carries about its own planning category.
 *
 * Only the approved values. A record whose lab or shape was never approved has nulls
 * here and `approved: false`, so it cannot key a category by accident.
 */
interface ResolvedPersistedCategory {
  readonly approved: boolean;
  readonly labNormalized: string | null;
  readonly shapeNormalized: string | null;
  readonly labApproved: boolean;
  readonly shapeApproved: boolean;
}

/**
 * Reads the classification the synchronizer persisted.
 *
 * A record projected before this classification existed carries nulls in every category
 * column. It is treated as not approved — never as approved by default, which would let
 * unclassified stock into a planning category on the strength of a missing column. The
 * reconciliation service re-projects those records; until it does they stay in review.
 */
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

/** Fixed data-quality rule code for whichever dimension was not approved. */
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

/** The source value that could not be approved — never a normalized or derived one. */
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
