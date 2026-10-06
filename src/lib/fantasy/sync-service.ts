import crypto from "crypto";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  CanonicalRecord,
  CanonicalRemovalEvent,
  normalizeShape,
  resolveLabNormalization,
  validateCanonicalRecord,
} from "./canonical";
import { getFantasyProvider, FantasyBatchPayload, FantasyDataProvider } from "./provider";
import { recordOperationalFailure, serializePublicFailure, type PublicFailure } from "@/lib/api/operational-failure";
import { resolveCanonicalQuantity } from "./quantity-weight";
import {
  CanonicalStateBusyError,
  CanonicalStateFencedError,
  claimCanonicalState,
  isClaimStillHeld,
  releaseCanonicalState,
  type CanonicalClaim,
} from "./canonical-state-claim";
import { getFantasySourceConfiguration, resolveFantasySourceState } from "./config";
import {
  classifyFantasyRecord,
  isMirroredInventoryClass,
  legacyFixtureClassificationInput,
  toLegacyPlanningClass,
  type ClassificationProfile,
} from "./classification";
import { LEGACY_FIXTURE_PROFILE, loadClassificationProfile } from "./classification-profile";
import { nowUTC } from "./time";
import { resolveNumericEnv } from "@/lib/config/numeric-env";
import { categoryClassificationColumns, classifyCanonicalCategory, loadCategoryClassificationContext } from "@/lib/fantasy/category-classification";

export interface SyncRunOptions {
  actor?: string;
  actorUserId?: string;
  simulateFailure?: boolean;
  provider?: FantasyDataProvider;
}

export interface SyncRunResult {
  success: boolean;
  runId: string;
  batchId: string;
  startingCheckpoint: number;
  endingCheckpoint: number;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  reconciliation: {
    recordsReceived: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsUnchanged: number;
    recordsSkipped: number;
    recordsRejected: number;
    recordsRemoved: number;
    historyVersionsCreated: number;
    dqIssuesCreated: number;
  };
  failure?: PublicFailure;
}

export const SYNC_LOCK_LEASE_MS = resolveNumericEnv(
  "FANTASY_SYNC_LOCK_LEASE_MS",
  { fallback: 15 * 60_000, max: 24 * 60 * 60_000 },
).value;

export async function releaseSyncLock(ownerToken: string): Promise<boolean> {
  const released = await db.syncCheckpoint.updateMany({
    where: { source: "FANTASY", lockToken: ownerToken },
    data: { isLocked: false, lockedAt: null, lockedBy: null, lockToken: null, lockExpiresAt: null },
  });
  return released.count > 0;
}

export async function unlockSynchronization(
  actor: string,
  reason?: string,
  options: { ownerToken?: string | null } = {},
): Promise<{ success: boolean; message: string; forcedActiveLease?: boolean }> {
  const checkpoint = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
  if (!checkpoint || !checkpoint.isLocked) {
    return { success: true, message: "Synchronization is not currently locked." };
  }

  const now = nowUTC();
  const ownsLock = Boolean(options.ownerToken) && options.ownerToken === checkpoint.lockToken;
  const leaseExpired = checkpoint.lockExpiresAt !== null && checkpoint.lockExpiresAt < now;
  const legacyClaim = checkpoint.lockToken === null;

  const forcedActiveLease = !ownsLock && !leaseExpired && !legacyClaim;

  await db.syncCheckpoint.update({
    where: { source: "FANTASY" },
    data: {
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockToken: null,
      lockExpiresAt: null,
    },
  });

  return {
    success: true,
    forcedActiveLease,
    message: forcedActiveLease
      ? `Synchronization lock force-cleared by ${actor} while a run still held an active lease. Reason: ${reason ?? "Manual administrative unlock"}`
      : `Synchronization lock successfully cleared by ${actor}. Reason: ${reason ?? "Manual administrative unlock"}`,
  };
}

export async function loadLabMappings(tx?: Prisma.TransactionClient): Promise<Map<string, string>> {
  const client = tx ?? db;
  const mappings = await client.labMapping.findMany({ where: { active: true } });
  const map = new Map<string, string>();
  for (const m of mappings) {
    map.set(m.rawLab.trim(), m.normalizedLab);
    map.set(m.rawLab.trim().toUpperCase(), m.normalizedLab);
  }
  return map;
}

function quantityProvenanceColumns(rec: { quantity?: number | null; sourceType: string; isSimulated?: boolean }) {
  const decision = resolveCanonicalQuantity({
    quantity: rec.quantity,
    sourceType: rec.sourceType,
    isSimulated: rec.isSimulated ?? false,
  });
  return { quantityProvenance: decision.provenance, confirmedPieces: decision.pieces };
}

export async function runSynchronization(options: SyncRunOptions = {}): Promise<SyncRunResult> {
  const startTime = Date.now();
  const config = getFantasySourceConfiguration();
  if (config.canonicalSourceMode === null || resolveFantasySourceState().effectiveState === "NOT_CONFIGURED") {
    throw new Error("Synchronization is unavailable: no supported Fantasy data source is configured.");
  }
  const canonicalSourceMode = config.canonicalSourceMode;
  const isSimulatedSource = canonicalSourceMode === "FIXTURE";
  const provider = options.provider ?? getFantasyProvider(canonicalSourceMode);

  const classificationProfile = await loadClassificationProfile(LEGACY_FIXTURE_PROFILE);
  if (classificationProfile === null) {
    throw new Error(
      "Synchronization is unavailable: the classification profile is not configured. Run `prisma migrate deploy`.",
    );
  }

  const classifyRecord = (currentStatus: string, departmentName?: string | null, previousDepartment?: string | null) =>
    classifyFantasyRecord(
      legacyFixtureClassificationInput({
        currentStatus,
        currentDepartment: departmentName ?? null,
        previousDepartment: previousDepartment ?? null,
      }),
      classificationProfile satisfies ClassificationProfile,
    );

  const classificationColumns = (c: ReturnType<typeof classifyRecord>) => ({
    holdState: c.holdState,
    canonicalLifecycle: c.lifecycle,
    inventoryClass: c.inventoryClass,
    classificationAvailable: c.available,
    classificationPlanningEligible: c.planningEligible,
    classificationReviewRequired: c.reviewRequired,
    classificationTerminal: c.terminal,
    classificationReasons: c.exclusionReasons.length ? c.exclusionReasons.join(",") : null,
    classificationProfile: c.profileCode,
    classificationProfileVersion: c.profileVersion,
    classificationState: c.state,
  });

  let checkpointRecord = await db.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });

  if (!checkpointRecord) {
    try {
      checkpointRecord = await db.syncCheckpoint.create({
        data: {
          source: "FANTASY",
          mode: canonicalSourceMode,
          currentCheckpoint: 0,
          isLocked: false,
        },
      });
    } catch {
      checkpointRecord = await db.syncCheckpoint.findUnique({
        where: { source: "FANTASY" },
      });
    }
  }

  const lockToken = crypto.randomUUID();
  const lockClaimedAt = nowUTC();
  const lockExpiresAt = new Date(lockClaimedAt.getTime() + SYNC_LOCK_LEASE_MS);

  const lockResult = await db.syncCheckpoint.updateMany({
    where: {
      source: "FANTASY",
      OR: [{ isLocked: false }, { lockExpiresAt: { lt: lockClaimedAt } }],
    },
    data: {
      isLocked: true,
      lockedAt: lockClaimedAt,
      lockedBy: options.actor ?? "SYSTEM",
      lockToken,
      lockExpiresAt,
    },
  });

  if (lockResult.count === 0) {
    throw new Error("Synchronization lock is currently held by another worker. Concurrent synchronization requests are rejected.");
  }

  let canonicalClaim: CanonicalClaim;
  const canonicalClaimResult = await claimCanonicalState("SYNC", options.actor ?? "SYSTEM");
  if (!canonicalClaimResult.acquired) {
    await releaseSyncLock(lockToken);
    throw new CanonicalStateBusyError(canonicalClaimResult.heldBy);
  }
  canonicalClaim = canonicalClaimResult.claim;
  let canonicalClaimReleased = false;

  const lockedCheckpoint = await db.syncCheckpoint.findUniqueOrThrow({
    where: { source: "FANTASY" },
  });

  const currentCheckpoint = lockedCheckpoint.currentCheckpoint;

  const syncRun = await db.integrationSyncRun.create({
    data: {
      source: "Fantasy",
      entity: "ALL",
      status: "RUNNING",
      sourceMode: canonicalSourceMode,
      isSimulated: isSimulatedSource,
      startingCheckpoint: currentCheckpoint,
      endingCheckpoint: currentCheckpoint,
      triggeredBy: options.actor ?? "SYSTEM",
      triggeredByUserId: options.actorUserId ?? null,
      startedAt: nowUTC(),
    },
  });

  let lockReleasedInTx = false;

  try {
    const batch = await provider.getBatch(currentCheckpoint);

    if (!batch) {
      const durationMs = Date.now() - startTime;
      await db.integrationSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "SUCCESS",
          durationMs,
          finishedAt: nowUTC(),
        },
      });

      await db.syncCheckpoint.update({
        where: { source: "FANTASY" },
        data: { isLocked: false, lockedAt: null, lockedBy: null, lockToken: null, lockExpiresAt: null },
      });
      lockReleasedInTx = true;
      await releaseCanonicalState(canonicalClaim);
      canonicalClaimReleased = true;

      return {
        success: true,
        runId: syncRun.id,
        batchId: "NO_NEW_BATCH",
        startingCheckpoint: currentCheckpoint,
        endingCheckpoint: currentCheckpoint,
        status: "SUCCESS",
        durationMs,
        reconciliation: {
          recordsReceived: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsUnchanged: 0,
          recordsSkipped: 0,
          recordsRejected: 0,
          recordsRemoved: 0,
          historyVersionsCreated: 0,
          dqIssuesCreated: 0,
        },
      };
    }

    if (batch.startingCheckpoint !== currentCheckpoint) {
      throw new Error(`Batch starting checkpoint (${batch.startingCheckpoint}) does not match current system checkpoint (${currentCheckpoint}).`);
    }

    if (batch.endingCheckpoint <= batch.startingCheckpoint) {
      throw new Error(`Batch ending checkpoint (${batch.endingCheckpoint}) must be strictly greater than starting checkpoint (${batch.startingCheckpoint}). Monotonic advancement violation.`);
    }

    if (canonicalSourceMode === "FANTASY_API" && batch.isSimulated) {
      throw new Error("Fixture batch rejected while source mode is configured as live FANTASY_API.");
    }
    if (canonicalSourceMode === "FIXTURE" && !batch.isSimulated) {
      throw new Error("Live batch rejected while source mode is configured as simulation FIXTURE.");
    }

    const existingSuccessfulBatch = await db.integrationSyncRun.findFirst({
      where: {
        batchId: batch.batchId,
        status: "SUCCESS",
      },
    });

    if (existingSuccessfulBatch) {
      throw new Error(`Batch ${batch.batchId} has already been successfully processed in run ${existingSuccessfulBatch.id}. Re-execution refused.`);
    }

    const result = await db.$transaction(async (tx) => {
      let recordsCreated = 0;
      let recordsUpdated = 0;
      let recordsUnchanged = 0;
      let recordsSkipped = 0;
      let recordsRejected = 0;
      let recordsRemoved = 0;
      let historyVersionsCreated = 0;
      let dqIssuesCreated = 0;

      const seenLotsInBatch = new Set<string>();
      const totalReceived = batch.records.length + batch.removals.length;
      const labMappings = await loadLabMappings(tx);
      const categoryContext = await loadCategoryClassificationContext(tx, labMappings);

      if (options.simulateFailure || batch.simulateFailure) {
        throw new Error("Controlled simulation failure triggered for transaction rollback verification.");
      }

      for (const rec of batch.records) {
        if (seenLotsInBatch.has(rec.lotId)) {
          recordsRejected++;
          dqIssuesCreated++;
          const issueCode = `DQ-FANTASY-DUPLICATE_LOT_IN_BATCH-${batch.batchId}-${rec.lotId}`;
          await tx.dataQualityIssue.upsert({
            where: { issueCode },
            create: {
              issueCode,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId,
              rule: "DUPLICATE_LOT_IN_BATCH",
              message: `Duplicate record for Lot ${rec.lotId} received within synchronization batch ${batch.batchId}.`,
              severity: "WARNING",
              status: "OPEN",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              affectedField: "lotId",
              rawValue: rec.lotId,
              downstreamImpact: "Second occurrence rejected to prevent race condition.",
            },
            update: {
              message: `Duplicate record for Lot ${rec.lotId} received within synchronization batch ${batch.batchId}.`,
              severity: "WARNING",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
            },
          });
          continue;
        }
        seenLotsInBatch.add(rec.lotId);

        const val = validateCanonicalRecord(rec, labMappings);
        if (!val.valid) {
          recordsRejected++;
          dqIssuesCreated++;
          const issueCode = `DQ-FANTASY-INVALID_RECORD-${batch.batchId}-${rec.lotId || "UNKNOWN"}`;
          await tx.dataQualityIssue.upsert({
            where: { issueCode },
            create: {
              issueCode,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId ?? null,
              rule: "INVALID_CANONICAL_RECORD",
              message: `Validation failure for Lot ${rec.lotId}: ${val.errors.join("; ")}`,
              severity: "ERROR",
              status: "OPEN",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              downstreamImpact: "Record rejected from master ingestion.",
            },
            update: {
              message: `Validation failure for Lot ${rec.lotId}: ${val.errors.join("; ")}`,
              severity: "ERROR",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
            },
          });
          continue;
        }

        const labRes = resolveLabNormalization(rec.labRaw, labMappings);
        const category = classifyCanonicalCategory(
          { labRaw: rec.labRaw, shapeRaw: rec.shape, weightCt: Number(rec.weight) },
          categoryContext,
        );
        const categoryColumns = categoryClassificationColumns(category);
        const normalizedShape = category.shapeNormalized ?? normalizeShape(rec.shape);
        const normalizedLab = category.labNormalized ?? labRes.normalized;

        if (labRes.requiresReview && labRes.warning) {
          dqIssuesCreated++;
          const issueCode = `DQ-FANTASY-UNMAPPED_LAB-${batch.batchId}-${rec.lotId}`;
          await tx.dataQualityIssue.upsert({
            where: { issueCode },
            create: {
              issueCode,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId,
              rule: "UNMAPPED_LAB_WARNING",
              message: labRes.warning,
              severity: "WARNING",
              status: "OPEN",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              affectedField: "labRaw",
              rawValue: rec.labRaw ?? null,
              normalizedValue: normalizedLab,
              downstreamImpact: "Retained raw lab value without approving certification classification.",
            },
            update: {
              message: labRes.warning,
              severity: "WARNING",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              rawValue: rec.labRaw ?? null,
              normalizedValue: normalizedLab,
            },
          });
        }

        const existing = await tx.lotMasterRecord.findUnique({
          where: { lotId: rec.lotId },
        });

        const statusEffectiveDate = new Date(rec.statusEffectiveDate);
        const docDate = new Date(rec.docDate);
        const sourceCreatedAt = rec.sourceCreatedAt ? new Date(rec.sourceCreatedAt) : nowUTC();
        const sourceUpdatedAt = rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : nowUTC();

        if (!existing) {
          const insertClassification = classifyRecord(rec.currentStatus, rec.departmentName, null);
          const newMaster = await tx.lotMasterRecord.create({
            data: {
              ...classificationColumns(insertClassification),
              lotId: rec.lotId,
              sourceRecordId: rec.sourceRecordId ?? null,
              sourceType: rec.sourceType,
              entityType: rec.entityType,
              currentStatus: rec.currentStatus,
              previousStatus: rec.previousStatus ?? null,
              statusEffectiveDate,
              docDate,
              quantity: new Prisma.Decimal(rec.quantity ?? 1),
              ...quantityProvenanceColumns(rec),
              ...categoryColumns,
              shape: rec.shape,
              shapeNormalized: normalizedShape,
              weight: new Prisma.Decimal(rec.weight),
              color: rec.color ?? null,
              clarity: rec.clarity ?? null,
              labRaw: rec.labRaw ?? null,
              labNormalized: normalizedLab,
              certificate: rec.certificate ?? null,
              treatment: rec.treatment ?? null,
              saleTotalUsd: rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? new Prisma.Decimal(rec.saleTotalUsd) : null,
              customerId: rec.customerId ?? null,
              customerCode: rec.customerCode ?? null,
              customerName: rec.customerName ?? null,
              departmentId: rec.departmentId ?? null,
              departmentName: rec.departmentName ?? null,
              locationId: rec.locationId ?? null,
              locationName: rec.locationName ?? null,
              country: rec.country,
              branch: rec.branch,
              roughOrPolished: rec.roughOrPolished,
              wipStage: rec.wipStage ?? null,
              parentRoughId: rec.parentRoughId ?? null,
              kapan: rec.kapan ?? null,
              stoneName: rec.stoneName ?? null,
              isCurrent: rec.isCurrent,
              removalReason: rec.removalReason ?? null,
              removedFromLiveAt: rec.removedFromLiveAt ? new Date(rec.removedFromLiveAt) : null,
              firstSeenAt: sourceCreatedAt,
              lastSeenAt: sourceUpdatedAt,
              sourceCreatedAt,
              sourceUpdatedAt,
              currentVersion: 1,
              lastSyncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              isSimulated: batch.isSimulated,
              metadataJson: rec.metadata ? JSON.stringify(rec.metadata) : null,
            },
          });

          await tx.lotHistoryRecord.create({
            data: {
              ...classificationColumns(insertClassification),
              lotId: newMaster.lotId,
              sourceRecordId: rec.sourceRecordId ?? null,
              version: 1,
              status: rec.currentStatus,
              previousStatus: rec.previousStatus ?? null,
              docDate,
              statusEffectiveDate,
              quantity: new Prisma.Decimal(rec.quantity ?? 1),
              ...quantityProvenanceColumns(rec),
              ...categoryColumns,
              shape: rec.shape,
              shapeNormalized: normalizedShape,
              weight: new Prisma.Decimal(rec.weight),
              color: rec.color ?? null,
              clarity: rec.clarity ?? null,
              labRaw: rec.labRaw ?? null,
              labNormalized: normalizedLab,
              certificate: rec.certificate ?? null,
              treatment: rec.treatment ?? null,
              saleTotalUsd: rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? new Prisma.Decimal(rec.saleTotalUsd) : null,
              customerId: rec.customerId ?? null,
              customerCode: rec.customerCode ?? null,
              customerName: rec.customerName ?? null,
              departmentId: rec.departmentId ?? null,
              departmentName: rec.departmentName ?? null,
              locationId: rec.locationId ?? null,
              locationName: rec.locationName ?? null,
              country: rec.country,
              branch: rec.branch,
              roughOrPolished: rec.roughOrPolished,
              wipStage: rec.wipStage ?? null,
              parentRoughId: rec.parentRoughId ?? null,
              kapan: rec.kapan ?? null,
              stoneName: rec.stoneName ?? null,
              isCurrent: rec.isCurrent,
              removalReason: rec.removalReason ?? null,
              changeReason: "INITIAL_CREATION",
              syncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              isSimulated: batch.isSimulated,
            },
          });

          const mirrorClassification = classifyRecord(rec.currentStatus, rec.departmentName, null);
          if (rec.roughOrPolished === "POLISHED" && rec.isCurrent && isMirroredInventoryClass(mirrorClassification.inventoryClass)) {
            await tx.polishedStone.upsert({
              where: { fantasyLotId: rec.lotId },
              create: {
                fantasyLotId: rec.lotId,
                fantasyDepartmentId: rec.departmentId ?? null,
                fantasyLocationId: rec.locationId ?? null,
                country: rec.country,
                branch: rec.branch,
                fantasyStatus: rec.currentStatus,
                labRaw: rec.labRaw ?? null,
                labNormalized: normalizedLab,
                shape: rec.shape,
                shapeNormalized: normalizedShape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color ?? null,
                clarity: rec.clarity ?? null,
                certificate: rec.certificate ?? null,
                treatment: rec.treatment ?? null,
                planningClass: toLegacyPlanningClass(mirrorClassification.inventoryClass),
                lastUpdated: sourceUpdatedAt,
              },
              update: {
                fantasyDepartmentId: rec.departmentId ?? null,
                fantasyLocationId: rec.locationId ?? null,
                country: rec.country,
                branch: rec.branch,
                fantasyStatus: rec.currentStatus,
                labRaw: rec.labRaw ?? null,
                labNormalized: normalizedLab,
                shape: rec.shape,
                shapeNormalized: normalizedShape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color ?? null,
                clarity: rec.clarity ?? null,
                certificate: rec.certificate ?? null,
                treatment: rec.treatment ?? null,
                planningClass: toLegacyPlanningClass(mirrorClassification.inventoryClass),
                lastUpdated: sourceUpdatedAt,
              },
            });
          }

          recordsCreated++;
          historyVersionsCreated++;
        } else {
          if (existing.sourceUpdatedAt && sourceUpdatedAt < existing.sourceUpdatedAt) {
            recordsSkipped++;
            dqIssuesCreated++;
            const issueCode = `DQ-FANTASY-OUT_OF_ORDER-${batch.batchId}-${rec.lotId}`;
            await tx.dataQualityIssue.upsert({
              where: { issueCode },
              create: {
                issueCode,
                source: "FANTASY",
                entity: "LOT",
                recordId: rec.lotId,
                rule: "OUT_OF_ORDER_UPDATE",
                message: `Out-of-order update for Lot ${rec.lotId}. Incoming source timestamp (${sourceUpdatedAt.toISOString()}) is older than existing state (${existing.sourceUpdatedAt.toISOString()}).`,
                severity: "WARNING",
                status: "OPEN",
                syncRunId: syncRun.id,
                batchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
                affectedField: "sourceUpdatedAt",
                rawValue: sourceUpdatedAt.toISOString(),
                downstreamImpact: "Skipped updating master attributes to prevent reverting newer source data.",
              },
              update: {
                message: `Out-of-order update for Lot ${rec.lotId}. Incoming source timestamp (${sourceUpdatedAt.toISOString()}) is older than existing state (${existing.sourceUpdatedAt.toISOString()}).`,
                severity: "WARNING",
                syncRunId: syncRun.id,
                batchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
              },
            });
            continue;
          }

          const diffs: string[] = [];

          if (existing.currentStatus !== rec.currentStatus) diffs.push("currentStatus");
          if (existing.isCurrent !== rec.isCurrent) diffs.push("isCurrent");
          if (Number(existing.weight) !== rec.weight) diffs.push("weight");
          if (Number(existing.quantity) !== (rec.quantity ?? 1)) diffs.push("quantity");
          if (existing.shape !== rec.shape) diffs.push("shape");
          if ((existing.shapeNormalized ?? null) !== (normalizedShape ?? null)) diffs.push("shapeNormalized");
          if ((existing.color ?? null) !== (rec.color ?? null)) diffs.push("color");
          if ((existing.clarity ?? null) !== (rec.clarity ?? null)) diffs.push("clarity");
          if ((existing.labRaw ?? null) !== (rec.labRaw ?? null)) diffs.push("labRaw");
          if ((existing.labNormalized ?? null) !== (normalizedLab ?? null)) diffs.push("labNormalized");
          if ((existing.certificate ?? null) !== (rec.certificate ?? null)) diffs.push("certificate");
          if ((existing.treatment ?? null) !== (rec.treatment ?? null)) diffs.push("treatment");
          if ((existing.saleTotalUsd ? Number(existing.saleTotalUsd) : null) !== (rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? rec.saleTotalUsd : null)) diffs.push("saleTotalUsd");
          if ((existing.customerId ?? null) !== (rec.customerId ?? null)) diffs.push("customerId");
          if ((existing.customerCode ?? null) !== (rec.customerCode ?? null)) diffs.push("customerCode");
          if ((existing.customerName ?? null) !== (rec.customerName ?? null)) diffs.push("customerName");
          if ((existing.departmentId ?? null) !== (rec.departmentId ?? null)) diffs.push("departmentId");
          if ((existing.departmentName ?? null) !== (rec.departmentName ?? null)) diffs.push("departmentName");
          if ((existing.locationId ?? null) !== (rec.locationId ?? null)) diffs.push("locationId");
          if ((existing.locationName ?? null) !== (rec.locationName ?? null)) diffs.push("locationName");
          if (existing.country !== rec.country) diffs.push("country");
          if (existing.branch !== rec.branch) diffs.push("branch");
          if (existing.roughOrPolished !== rec.roughOrPolished) diffs.push("roughOrPolished");
          if ((existing.wipStage ?? null) !== (rec.wipStage ?? null)) diffs.push("wipStage");
          if ((existing.parentRoughId ?? null) !== (rec.parentRoughId ?? null)) diffs.push("parentRoughId");
          if ((existing.kapan ?? null) !== (rec.kapan ?? null)) diffs.push("kapan");
          if ((existing.stoneName ?? null) !== (rec.stoneName ?? null)) diffs.push("stoneName");
          if ((existing.sourceRecordId ?? null) !== (rec.sourceRecordId ?? null)) diffs.push("sourceRecordId");
          if ((existing.removalReason ?? null) !== (rec.removalReason ?? null)) diffs.push("removalReason");
          if (existing.docDate.getTime() !== docDate.getTime()) diffs.push("docDate");
          if (existing.statusEffectiveDate.getTime() !== statusEffectiveDate.getTime()) diffs.push("statusEffectiveDate");

          const isMeaningfulChange = diffs.length > 0;

          if (isMeaningfulChange) {
            const nextVersion = existing.currentVersion + 1;
            const changeReason = diffs.includes("currentStatus")
              ? `STATUS_CHANGED_TO_${rec.currentStatus}`
              : `ATTRIBUTE_UPDATE_${diffs.slice(0, 3).join("_").toUpperCase()}`;

            const changeClassification = classifyRecord(rec.currentStatus, rec.departmentName, existing.currentStatus);
            await tx.lotMasterRecord.update({
              where: { lotId: rec.lotId },
              data: {
                ...classificationColumns(changeClassification),
                sourceRecordId: rec.sourceRecordId ?? null,
                currentStatus: rec.currentStatus,
                previousStatus: existing.currentStatus,
                statusEffectiveDate,
                docDate,
                quantity: new Prisma.Decimal(rec.quantity ?? 1),
                ...quantityProvenanceColumns(rec),
                ...categoryColumns,
              ...quantityProvenanceColumns(rec),
                shape: rec.shape,
                shapeNormalized: normalizedShape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color !== undefined ? rec.color : null,
                clarity: rec.clarity !== undefined ? rec.clarity : null,
                labRaw: rec.labRaw !== undefined ? rec.labRaw : null,
                labNormalized: normalizedLab,
                certificate: rec.certificate !== undefined ? rec.certificate : null,
                treatment: rec.treatment !== undefined ? rec.treatment : null,
                saleTotalUsd: rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? new Prisma.Decimal(rec.saleTotalUsd) : null,
                customerId: rec.customerId !== undefined ? rec.customerId : null,
                customerCode: rec.customerCode !== undefined ? rec.customerCode : null,
                customerName: rec.customerName !== undefined ? rec.customerName : null,
                departmentId: rec.departmentId !== undefined ? rec.departmentId : null,
                departmentName: rec.departmentName !== undefined ? rec.departmentName : null,
                locationId: rec.locationId !== undefined ? rec.locationId : null,
                locationName: rec.locationName !== undefined ? rec.locationName : null,
                country: rec.country,
                branch: rec.branch,
                roughOrPolished: rec.roughOrPolished,
                wipStage: rec.wipStage !== undefined ? rec.wipStage : null,
                parentRoughId: rec.parentRoughId !== undefined ? rec.parentRoughId : null,
                kapan: rec.kapan !== undefined ? rec.kapan : null,
                stoneName: rec.stoneName !== undefined ? rec.stoneName : null,
                isCurrent: rec.isCurrent,
                removalReason: rec.removalReason !== undefined ? rec.removalReason : null,
                removedFromLiveAt: rec.removedFromLiveAt ? new Date(rec.removedFromLiveAt) : null,
                lastSeenAt: sourceUpdatedAt,
                sourceUpdatedAt,
                currentVersion: nextVersion,
                lastSyncBatchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
              },
            });

            await tx.lotHistoryRecord.create({
              data: {
                ...classificationColumns(changeClassification),
                lotId: rec.lotId,
                sourceRecordId: rec.sourceRecordId ?? null,
                version: nextVersion,
                status: rec.currentStatus,
                previousStatus: existing.currentStatus,
                docDate,
                statusEffectiveDate,
                quantity: new Prisma.Decimal(rec.quantity ?? 1),
                ...quantityProvenanceColumns(rec),
                ...categoryColumns,
              ...quantityProvenanceColumns(rec),
                shape: rec.shape,
                shapeNormalized: normalizedShape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color !== undefined ? rec.color : null,
                clarity: rec.clarity !== undefined ? rec.clarity : null,
                labRaw: rec.labRaw !== undefined ? rec.labRaw : null,
                labNormalized: normalizedLab,
                certificate: rec.certificate !== undefined ? rec.certificate : null,
                treatment: rec.treatment !== undefined ? rec.treatment : null,
                saleTotalUsd: rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? new Prisma.Decimal(rec.saleTotalUsd) : null,
                customerId: rec.customerId !== undefined ? rec.customerId : null,
                customerCode: rec.customerCode !== undefined ? rec.customerCode : null,
                customerName: rec.customerName !== undefined ? rec.customerName : null,
                departmentId: rec.departmentId !== undefined ? rec.departmentId : null,
                departmentName: rec.departmentName !== undefined ? rec.departmentName : null,
                locationId: rec.locationId !== undefined ? rec.locationId : null,
                locationName: rec.locationName !== undefined ? rec.locationName : null,
                country: rec.country,
                branch: rec.branch,
                roughOrPolished: rec.roughOrPolished,
                wipStage: rec.wipStage !== undefined ? rec.wipStage : null,
                parentRoughId: rec.parentRoughId !== undefined ? rec.parentRoughId : null,
                kapan: rec.kapan !== undefined ? rec.kapan : null,
                stoneName: rec.stoneName !== undefined ? rec.stoneName : null,
                isCurrent: rec.isCurrent,
                removalReason: rec.removalReason !== undefined ? rec.removalReason : null,
                changeReason,
                syncBatchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
                isSimulated: batch.isSimulated,
              },
            });

            const updateClassification = classifyRecord(rec.currentStatus, rec.departmentName, null);
            if (rec.roughOrPolished === "POLISHED" && rec.isCurrent && isMirroredInventoryClass(updateClassification.inventoryClass)) {
              await tx.polishedStone.upsert({
                where: { fantasyLotId: rec.lotId },
                create: {
                  fantasyLotId: rec.lotId,
                  fantasyDepartmentId: rec.departmentId ?? null,
                  fantasyLocationId: rec.locationId ?? null,
                  country: rec.country,
                  branch: rec.branch,
                  fantasyStatus: rec.currentStatus,
                  labRaw: rec.labRaw ?? null,
                  labNormalized: normalizedLab,
                  shape: rec.shape,
                  shapeNormalized: normalizedShape,
                  weight: new Prisma.Decimal(rec.weight),
                  color: rec.color ?? null,
                  clarity: rec.clarity ?? null,
                  certificate: rec.certificate ?? null,
                  treatment: rec.treatment ?? null,
                  planningClass: toLegacyPlanningClass(updateClassification.inventoryClass),
                  lastUpdated: sourceUpdatedAt,
                },
                update: {
                  fantasyDepartmentId: rec.departmentId ?? null,
                  fantasyLocationId: rec.locationId ?? null,
                  country: rec.country,
                  branch: rec.branch,
                  fantasyStatus: rec.currentStatus,
                  labRaw: rec.labRaw ?? null,
                  labNormalized: normalizedLab,
                  shape: rec.shape,
                  shapeNormalized: normalizedShape,
                  weight: new Prisma.Decimal(rec.weight),
                  color: rec.color ?? null,
                  clarity: rec.clarity ?? null,
                  certificate: rec.certificate ?? null,
                  treatment: rec.treatment ?? null,
                  planningClass: toLegacyPlanningClass(updateClassification.inventoryClass),
                  lastUpdated: sourceUpdatedAt,
                },
              });
            } else {
              await tx.polishedStone.deleteMany({
                where: { fantasyLotId: rec.lotId },
              });
            }

            recordsUpdated++;
            historyVersionsCreated++;
          } else {
            await tx.lotMasterRecord.update({
              where: { lotId: rec.lotId },
              data: {
                lastSeenAt: sourceUpdatedAt,
                sourceUpdatedAt,
              },
            });
            recordsUnchanged++;
          }
        }
      }

      for (const rem of batch.removals) {
        const existing = await tx.lotMasterRecord.findUnique({
          where: { lotId: rem.lotId },
        });

        if (!existing) {
          recordsSkipped++;
          continue;
        }

        if (!existing.isCurrent && existing.removalReason === rem.removalReason) {
          recordsUnchanged++;
          continue;
        }

        const removedDate = new Date(rem.removedFromLiveAt);
        const nextVersion = existing.currentVersion + 1;

        let newStatus = existing.currentStatus;
        let changeReason = `REMOVAL_${rem.removalReason}`;
        let saleTotalToRecord: Prisma.Decimal | null = null;
        let customerNameToRecord = existing.customerName;

        switch (rem.removalReason) {
          case "EXPLICIT_SALE":
            newStatus = "SOLD";
            changeReason = "EXPLICIT_SALE_INVOICE";
            saleTotalToRecord = rem.saleTotalUsd !== undefined && rem.saleTotalUsd !== null ? new Prisma.Decimal(rem.saleTotalUsd) : existing.saleTotalUsd;
            customerNameToRecord = rem.customerName ?? existing.customerName;
            break;
          case "COMPLETED":
            newStatus = "WIP_COMPLETED";
            changeReason = "WIP_COMPLETED";
            break;
          case "ARCHIVED":
            newStatus = "ARCHIVED";
            changeReason = "RECORD_ARCHIVED";
            break;
          case "CANCELLED":
            newStatus = "CANCELLED";
            changeReason = "ORDER_LOT_CANCELLED";
            break;
          case "TRANSFERRED":
            newStatus = "TRANSFERRED";
            changeReason = "TRANSFERRED_LOCATION";
            break;
          case "MEMO_RETURN":
            newStatus = "STOCK";
            changeReason = "RETURNED_FROM_MEMO";
            break;
          case "CORRECTION":
            newStatus = "CORRECTION";
            changeReason = "SOURCE_RECORD_CORRECTION";
            break;
          case "SOURCE_DISAPPEARANCE_UNKNOWN":
          default:
            newStatus = "REMOVED_UNKNOWN";
            changeReason = "REMOVED_FROM_FEED_WITHOUT_SALE_EVENT";
            saleTotalToRecord = null;
            break;
        }

        const isStillLive = rem.removalReason === "MEMO_RETURN";

        const removalClassification = classifyRecord(newStatus, existing.departmentName, existing.currentStatus);
        await tx.lotMasterRecord.update({
          where: { lotId: rem.lotId },
          data: {
            ...classificationColumns(removalClassification),
            currentStatus: newStatus,
            previousStatus: existing.currentStatus,
            isCurrent: isStillLive,
            removalReason: rem.removalReason,
            removedFromLiveAt: isStillLive ? null : removedDate,
            lastSeenAt: removedDate,
            currentVersion: nextVersion,
            lastSyncBatchId: batch.batchId,
            checkpoint: batch.endingCheckpoint,
            saleTotalUsd: saleTotalToRecord,
            customerName: customerNameToRecord,
          },
        });

        await tx.lotHistoryRecord.create({
          data: {
            ...classificationColumns(removalClassification),
            lotId: rem.lotId,
            sourceRecordId: existing.sourceRecordId,
            version: nextVersion,
            status: newStatus,
            previousStatus: existing.currentStatus,
            docDate: existing.docDate,
            statusEffectiveDate: removedDate,
            quantity: existing.quantity,
            shape: existing.shape,
            shapeNormalized: existing.shapeNormalized,
            weight: existing.weight,
            color: existing.color,
            clarity: existing.clarity,
            labRaw: existing.labRaw,
            labNormalized: existing.labNormalized,
            certificate: existing.certificate,
            treatment: existing.treatment,
            saleTotalUsd: saleTotalToRecord,
            customerId: existing.customerId,
            customerCode: existing.customerCode,
            customerName: customerNameToRecord,
            departmentId: existing.departmentId,
            departmentName: existing.departmentName,
            locationId: existing.locationId,
            locationName: existing.locationName,
            country: existing.country,
            branch: existing.branch,
            roughOrPolished: existing.roughOrPolished,
            wipStage: existing.wipStage,
            parentRoughId: existing.parentRoughId,
            kapan: existing.kapan,
            stoneName: existing.stoneName,
            isCurrent: isStillLive,
            removalReason: rem.removalReason,
            changeReason,
            syncBatchId: batch.batchId,
            checkpoint: batch.endingCheckpoint,
            isSimulated: batch.isSimulated,
          },
        });

        if (isStillLive) {
          const reinstated = classifyRecord(newStatus, existing.departmentName, existing.currentStatus);
          await tx.polishedStone.upsert({
            where: { fantasyLotId: rem.lotId },
            create: {
              fantasyLotId: rem.lotId,
              fantasyDepartmentId: existing.departmentId,
              fantasyLocationId: existing.locationId,
              country: existing.country,
              branch: existing.branch,
              fantasyStatus: newStatus,
              labRaw: existing.labRaw,
              labNormalized: existing.labNormalized,
              shape: existing.shape,
              shapeNormalized: existing.shapeNormalized,
              weight: existing.weight,
              color: existing.color,
              clarity: existing.clarity,
              certificate: existing.certificate,
              treatment: existing.treatment,
              planningClass: toLegacyPlanningClass(reinstated.inventoryClass),
              lastUpdated: removedDate,
            },
            update: {
              fantasyStatus: newStatus,
              planningClass: toLegacyPlanningClass(reinstated.inventoryClass),
              lastUpdated: removedDate,
            },
          });
        } else {
          await tx.polishedStone.deleteMany({
            where: { fantasyLotId: rem.lotId },
          });
        }

        if (rem.removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN") {
          dqIssuesCreated++;
          const issueCode = `DQ-FANTASY-DISAPPEARED-${batch.batchId}-${rem.lotId}`;
          await tx.dataQualityIssue.upsert({
            where: { issueCode },
            create: {
              issueCode,
              source: "FANTASY",
              entity: "LOT",
              recordId: rem.lotId,
              rule: "SOURCE_DISAPPEARANCE_WITHOUT_INVOICE",
              message: `Lot ${rem.lotId} disappeared from Fantasy feed without an explicit invoice/sale event. Retained in historical Overall Data.`,
              severity: "WARNING",
              status: "OPEN",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              affectedField: "currentStatus",
              rawValue: "DISAPPEARED",
              normalizedValue: "REMOVED_UNKNOWN",
              downstreamImpact: "Removed from live stock, preserved in history without inventing sales revenue.",
            },
            update: {
              message: `Lot ${rem.lotId} disappeared from Fantasy feed without an explicit invoice/sale event. Retained in historical Overall Data.`,
              severity: "WARNING",
              syncRunId: syncRun.id,
              batchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
            },
          });
        }

        recordsRemoved++;
        historyVersionsCreated++;
      }

      if (!(await isClaimStillHeld(canonicalClaim, tx as unknown as typeof db))) {
        throw new CanonicalStateFencedError();
      }

      await tx.syncCheckpoint.update({
        where: { source: "FANTASY" },
        data: {
          currentCheckpoint: batch.endingCheckpoint,
          lastBatchId: batch.batchId,
          lastSyncAt: nowUTC(),
          isLocked: false,
          lockedAt: null,
          lockedBy: null,
          lockToken: null,
          lockExpiresAt: null,
        },
      });

      return {
        batchId: batch.batchId,
        startingCheckpoint: batch.startingCheckpoint,
        endingCheckpoint: batch.endingCheckpoint,
        recordsReceived: totalReceived,
        recordsCreated,
        recordsUpdated,
        recordsUnchanged,
        recordsSkipped,
        recordsRejected,
        recordsRemoved,
        historyVersionsCreated,
        dqIssuesCreated,
      };
    });

    lockReleasedInTx = true;
    await releaseCanonicalState(canonicalClaim);
    canonicalClaimReleased = true;
    const durationMs = Date.now() - startTime;

    await db.integrationSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "SUCCESS",
        batchId: result.batchId,
        startingCheckpoint: result.startingCheckpoint,
        endingCheckpoint: result.endingCheckpoint,
        recordsReceived: result.recordsReceived,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        recordsUnchanged: result.recordsUnchanged,
        recordsSkipped: result.recordsSkipped,
        recordsRejected: result.recordsRejected,
        recordsRemoved: result.recordsRemoved,
        historyVersionsCreated: result.historyVersionsCreated,
        dqIssuesCreated: result.dqIssuesCreated,
        recordsFetched: result.recordsReceived,
        durationMs,
        finishedAt: nowUTC(),
      },
    });

    return {
      success: true,
      runId: syncRun.id,
      batchId: result.batchId,
      startingCheckpoint: result.startingCheckpoint,
      endingCheckpoint: result.endingCheckpoint,
      status: "SUCCESS",
      durationMs,
      reconciliation: {
        recordsReceived: result.recordsReceived,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        recordsUnchanged: result.recordsUnchanged,
        recordsSkipped: result.recordsSkipped,
        recordsRejected: result.recordsRejected,
        recordsRemoved: result.recordsRemoved,
        historyVersionsCreated: result.historyVersionsCreated,
        dqIssuesCreated: result.dqIssuesCreated,
      },
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const failure = recordOperationalFailure(err, {
      operation: "fantasy.sync",
      entity: "IntegrationSyncRun",
      entityId: syncRun.id,
      actorUserId: options.actorUserId ?? null,
    });

    try {
      await db.integrationSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          errorSummary: serializePublicFailure(failure),
          durationMs,
          finishedAt: nowUTC(),
        },
      });
    } catch {
      // Ignore secondary update error
    }

    if (!lockReleasedInTx) {
      try {
        await releaseSyncLock(lockToken);
      } catch {
        // Ignore secondary unlock error
      }
    }
    if (!canonicalClaimReleased) {
      try {
        await releaseCanonicalState(canonicalClaim);
      } catch {
        // Ignore secondary release error
      }
    }

    return {
      success: false,
      runId: syncRun.id,
      batchId: `FAILED_AT_CHECKPOINT_${currentCheckpoint}`,
      startingCheckpoint: currentCheckpoint,
      endingCheckpoint: currentCheckpoint,
      status: "FAILED",
      durationMs,
      reconciliation: {
        recordsReceived: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsUnchanged: 0,
        recordsSkipped: 0,
        recordsRejected: 0,
        recordsRemoved: 0,
        historyVersionsCreated: 0,
        dqIssuesCreated: 0,
      },
      failure,
    };
  }
}

export async function retrySynchronization(options: { actor?: string; actorUserId?: string } = {}): Promise<SyncRunResult> {
  const checkpoint = await db.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });

  if (checkpoint && checkpoint.isLocked) {
    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: { isLocked: false, lockedAt: null, lockedBy: null },
    });
  }

  return runSynchronization({
    actor: options.actor ?? "SYSTEM_RETRY",
    actorUserId: options.actorUserId,
  });
}

export async function replayFixtureSynchronization(targetCheckpoint: number, actor = "DEV_REPLAY"): Promise<SyncRunResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Replaying arbitrary synchronization checkpoints is strictly prohibited in production.");
  }

  await db.syncCheckpoint.upsert({
    where: { source: "FANTASY" },
    create: {
      source: "FANTASY",
      mode: "FIXTURE",
      currentCheckpoint: targetCheckpoint,
      isLocked: false,
    },
    update: {
      currentCheckpoint: targetCheckpoint,
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
    },
  });

  return runSynchronization({ actor });
}
