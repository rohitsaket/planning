/**
 * Incremental Synchronization Engine for Fantasy ERP.
 * 
 * Handles:
 * - Distributed lock & monotonic checkpoints
 * - Canonical validation and normalization
 * - Transactional current-state & immutable historical updates
 * - Sold record vs unknown disappearance classification (Critical Sold-Record Rule)
 * - Data Quality issue generation
 * - Mathematical reconciliation
 * - Controlled failure rollback and safe idempotent retry
 */

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  CanonicalRecord,
  CanonicalRemovalEvent,
  normalizeShape,
  normalizeLab,
  validateCanonicalRecord,
} from "./canonical";
import { getFantasyProvider, FantasyBatchPayload } from "./provider";
import { getFantasyConfig } from "./config";
import { nowUTC } from "./time";

export interface SyncRunOptions {
  batchIndex?: number;
  actor?: string;
  actorUserId?: string;
  simulateFailure?: boolean;
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
  errorSummary?: string;
}

/**
 * Executes an incremental synchronization run.
 */
export async function runSynchronization(options: SyncRunOptions = {}): Promise<SyncRunResult> {
  const startTime = Date.now();
  const config = getFantasyConfig();
  const provider = getFantasyProvider(config.sourceMode);

  // 1. Get or create checkpoint record
  let checkpointRecord = await db.syncCheckpoint.findUnique({
    where: { source: "FANTASY" },
  });

  if (!checkpointRecord) {
    checkpointRecord = await db.syncCheckpoint.create({
      data: {
        source: "FANTASY",
        mode: config.sourceMode,
        currentCheckpoint: 0,
        isLocked: false,
      },
    });
  }

  // 2. Lock check & acquisition
  if (checkpointRecord.isLocked) {
    const lockAge = checkpointRecord.lockedAt ? Date.now() - checkpointRecord.lockedAt.getTime() : 0;
    // Auto-expire stale locks older than 5 minutes
    if (lockAge < 5 * 60 * 1000) {
      throw new Error("Synchronization is currently in progress by another worker. Please wait.");
    }
  }

  // Acquire lock
  await db.syncCheckpoint.update({
    where: { source: "FANTASY" },
    data: {
      isLocked: true,
      lockedAt: nowUTC(),
      lockedBy: options.actor ?? "SYSTEM",
    },
  });

  const checkpointToFetch = options.batchIndex !== undefined ? options.batchIndex : checkpointRecord.currentCheckpoint;

  // 3. Create initial RUNNING sync run record
  const syncRun = await db.integrationSyncRun.create({
    data: {
      source: "Fantasy",
      entity: "ALL",
      status: "RUNNING",
      sourceMode: config.sourceMode,
      isSimulated: config.isSimulation,
      startingCheckpoint: checkpointRecord.currentCheckpoint,
      endingCheckpoint: checkpointRecord.currentCheckpoint,
      triggeredBy: options.actor ?? "SYSTEM",
      triggeredByUserId: options.actorUserId ?? null,
      startedAt: nowUTC(),
    },
  });

  try {
    // 4. Request batch from provider
    const batch = await provider.getBatch(checkpointToFetch);

    if (!batch) {
      // No more batches available
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
        data: { isLocked: false },
      });

      return {
        success: true,
        runId: syncRun.id,
        batchId: "NO_NEW_BATCH",
        startingCheckpoint: checkpointRecord.currentCheckpoint,
        endingCheckpoint: checkpointRecord.currentCheckpoint,
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

    // 5. Execute batch processing inside a single database transaction
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

      // Intentional failure test check (Batch 5 rollback test)
      if (options.simulateFailure || batch.simulateFailure) {
        throw new Error("Controlled simulation failure triggered for transaction rollback verification.");
      }

      // Process incoming records
      for (const rec of batch.records) {
        // A. Check intra-batch duplicates
        if (seenLotsInBatch.has(rec.lotId)) {
          recordsRejected++;
          dqIssuesCreated++;
          await tx.dataQualityIssue.create({
            data: {
              issueCode: `DQ-DUP-BATCH-${rec.lotId}-${Date.now()}`,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId,
              rule: "DUPLICATE_LOT_IN_BATCH",
              message: `Duplicate record for Lot ${rec.lotId} received within synchronization batch ${batch.batchId}.`,
              severity: "WARNING",
              status: "OPEN",
            },
          });
          continue;
        }
        seenLotsInBatch.add(rec.lotId);

        // B. Basic record validation
        const val = validateCanonicalRecord(rec);
        if (!val.valid) {
          recordsRejected++;
          dqIssuesCreated++;
          await tx.dataQualityIssue.create({
            data: {
              issueCode: `DQ-VAL-${rec.lotId || "UNKNOWN"}-${Date.now()}`,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId ?? null,
              rule: "INVALID_CANONICAL_RECORD",
              message: `Validation failure for Lot ${rec.lotId}: ${val.errors.join("; ")}`,
              severity: "ERROR",
              status: "OPEN",
            },
          });
          continue;
        }

        // C. Normalization & warning checks
        const normalizedShape = normalizeShape(rec.shape);
        const normalizedLab = normalizeLab(rec.labRaw);

        if (val.warnings.length > 0) {
          dqIssuesCreated++;
          await tx.dataQualityIssue.create({
            data: {
              issueCode: `DQ-WARN-${rec.lotId}-${Date.now()}`,
              source: "FANTASY",
              entity: "LOT",
              recordId: rec.lotId,
              rule: "DATA_QUALITY_WARNING",
              message: val.warnings.join("; "),
              severity: "WARNING",
              status: "OPEN",
            },
          });
        }

        // D. Check existing record
        const existing = await tx.lotMasterRecord.findUnique({
          where: { lotId: rec.lotId },
        });

        const statusEffectiveDate = new Date(rec.statusEffectiveDate);
        const docDate = new Date(rec.docDate);
        const sourceCreatedAt = rec.sourceCreatedAt ? new Date(rec.sourceCreatedAt) : nowUTC();
        const sourceUpdatedAt = rec.sourceUpdatedAt ? new Date(rec.sourceUpdatedAt) : nowUTC();

        if (!existing) {
          // INSERT NEW RECORD
          const newMaster = await tx.lotMasterRecord.create({
            data: {
              lotId: rec.lotId,
              sourceType: rec.sourceType,
              entityType: rec.entityType,
              currentStatus: rec.currentStatus,
              previousStatus: rec.previousStatus ?? null,
              statusEffectiveDate,
              docDate,
              quantity: new Prisma.Decimal(rec.quantity),
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

          // Create Version 1 in immutable history
          await tx.lotHistoryRecord.create({
            data: {
              lotId: newMaster.lotId,
              version: 1,
              status: rec.currentStatus,
              docDate,
              statusEffectiveDate,
              shape: rec.shape,
              weight: new Prisma.Decimal(rec.weight),
              color: rec.color ?? null,
              clarity: rec.clarity ?? null,
              labNormalized: normalizedLab,
              saleTotalUsd: rec.saleTotalUsd ? new Prisma.Decimal(rec.saleTotalUsd) : null,
              customerName: rec.customerName ?? null,
              departmentName: rec.departmentName ?? null,
              locationName: rec.locationName ?? null,
              country: rec.country,
              branch: rec.branch,
              wipStage: rec.wipStage ?? null,
              isCurrent: rec.isCurrent,
              removalReason: rec.removalReason ?? null,
              changeReason: "INITIAL_CREATION",
              syncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              isSimulated: batch.isSimulated,
            },
          });

          // Sync into operational PolishedStone mirror if polished
          if (rec.roughOrPolished === "POLISHED" && rec.isCurrent && (rec.currentStatus === "STOCK" || rec.currentStatus === "MEMO")) {
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
                planningClass: rec.currentStatus === "STOCK" ? "PHYSICAL" : "MEMO",
                lastUpdated: sourceUpdatedAt,
              },
              update: {
                fantasyDepartmentId: rec.departmentId ?? null,
                fantasyLocationId: rec.locationId ?? null,
                country: rec.country,
                branch: rec.branch,
                fantasyStatus: rec.currentStatus,
                labNormalized: normalizedLab,
                shape: rec.shape,
                shapeNormalized: normalizedShape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color ?? null,
                clarity: rec.clarity ?? null,
                planningClass: rec.currentStatus === "STOCK" ? "PHYSICAL" : "MEMO",
                lastUpdated: sourceUpdatedAt,
              },
            });
          }

          recordsCreated++;
          historyVersionsCreated++;
        } else {
          // CHECK OUT-OF-ORDER EVENT
          if (existing.sourceUpdatedAt && sourceUpdatedAt < existing.sourceUpdatedAt) {
            recordsSkipped++;
            dqIssuesCreated++;
            await tx.dataQualityIssue.create({
              data: {
                issueCode: `DQ-OUT-OF-ORDER-${rec.lotId}-${Date.now()}`,
                source: "FANTASY",
                entity: "LOT",
                recordId: rec.lotId,
                rule: "OUT_OF_ORDER_UPDATE",
                message: `Out-of-order update received for Lot ${rec.lotId}. Incoming source timestamp (${sourceUpdatedAt.toISOString()}) is older than existing state (${existing.sourceUpdatedAt.toISOString()}).`,
                severity: "WARNING",
                status: "OPEN",
              },
            });
            continue;
          }

          // DETECT MEANINGFUL CHANGES
          const isStatusChanged = existing.currentStatus !== rec.currentStatus;
          const isLocationChanged = existing.locationName !== (rec.locationName ?? null) || existing.departmentName !== (rec.departmentName ?? null);
          const isWeightChanged = Number(existing.weight) !== rec.weight;
          const isWipStageChanged = existing.wipStage !== (rec.wipStage ?? null);
          const isCurrentStateChanged = existing.isCurrent !== rec.isCurrent;

          const isMeaningfulChange = isStatusChanged || isLocationChanged || isWeightChanged || isWipStageChanged || isCurrentStateChanged;

          if (isMeaningfulChange) {
            const nextVersion = existing.currentVersion + 1;

            await tx.lotMasterRecord.update({
              where: { lotId: rec.lotId },
              data: {
                currentStatus: rec.currentStatus,
                previousStatus: existing.currentStatus,
                statusEffectiveDate,
                docDate,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color ?? existing.color,
                clarity: rec.clarity ?? existing.clarity,
                labNormalized: normalizedLab ?? existing.labNormalized,
                saleTotalUsd: rec.saleTotalUsd !== undefined && rec.saleTotalUsd !== null ? new Prisma.Decimal(rec.saleTotalUsd) : existing.saleTotalUsd,
                customerCode: rec.customerCode ?? existing.customerCode,
                customerName: rec.customerName ?? existing.customerName,
                departmentId: rec.departmentId ?? existing.departmentId,
                departmentName: rec.departmentName ?? existing.departmentName,
                locationId: rec.locationId ?? existing.locationId,
                locationName: rec.locationName ?? existing.locationName,
                country: rec.country,
                branch: rec.branch,
                wipStage: rec.wipStage ?? null,
                isCurrent: rec.isCurrent,
                removalReason: rec.removalReason ?? existing.removalReason,
                removedFromLiveAt: rec.removedFromLiveAt ? new Date(rec.removedFromLiveAt) : existing.removedFromLiveAt,
                lastSeenAt: sourceUpdatedAt,
                sourceUpdatedAt,
                currentVersion: nextVersion,
                lastSyncBatchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
              },
            });

            await tx.lotHistoryRecord.create({
              data: {
                lotId: rec.lotId,
                version: nextVersion,
                status: rec.currentStatus,
                docDate,
                statusEffectiveDate,
                shape: rec.shape,
                weight: new Prisma.Decimal(rec.weight),
                color: rec.color ?? existing.color,
                clarity: rec.clarity ?? existing.clarity,
                labNormalized: normalizedLab ?? existing.labNormalized,
                saleTotalUsd: rec.saleTotalUsd ? new Prisma.Decimal(rec.saleTotalUsd) : existing.saleTotalUsd,
                customerName: rec.customerName ?? existing.customerName,
                departmentName: rec.departmentName ?? existing.departmentName,
                locationName: rec.locationName ?? existing.locationName,
                country: rec.country,
                branch: rec.branch,
                wipStage: rec.wipStage ?? null,
                isCurrent: rec.isCurrent,
                removalReason: rec.removalReason ?? null,
                changeReason: isStatusChanged ? `STATUS_CHANGED_TO_${rec.currentStatus}` : "ATTRIBUTE_UPDATE",
                syncBatchId: batch.batchId,
                checkpoint: batch.endingCheckpoint,
                isSimulated: batch.isSimulated,
              },
            });

            // Update or remove from operational PolishedStone mirror
            if (rec.isCurrent && (rec.currentStatus === "STOCK" || rec.currentStatus === "MEMO")) {
              await tx.polishedStone.upsert({
                where: { fantasyLotId: rec.lotId },
                create: {
                  fantasyLotId: rec.lotId,
                  country: rec.country,
                  branch: rec.branch,
                  fantasyStatus: rec.currentStatus,
                  shape: rec.shape,
                  weight: new Prisma.Decimal(rec.weight),
                  planningClass: rec.currentStatus === "STOCK" ? "PHYSICAL" : "MEMO",
                  lastUpdated: sourceUpdatedAt,
                },
                update: {
                  fantasyDepartmentId: rec.departmentId ?? null,
                  fantasyLocationId: rec.locationId ?? null,
                  fantasyStatus: rec.currentStatus,
                  planningClass: rec.currentStatus === "STOCK" ? "PHYSICAL" : "MEMO",
                  lastUpdated: sourceUpdatedAt,
                },
              });
            } else if (!rec.isCurrent) {
              // Removed or sold: remove from current live polished table
              await tx.polishedStone.deleteMany({
                where: { fantasyLotId: rec.lotId },
              });
            }

            recordsUpdated++;
            historyVersionsCreated++;
          } else {
            // NO-OP UPDATE: Identical attributes, update lastSeenAt only without duplicating history
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

      // Process Removals & Disappearances (Critical Sold-Record Rule)
      for (const rem of batch.removals) {
        const existing = await tx.lotMasterRecord.findUnique({
          where: { lotId: rem.lotId },
        });

        if (!existing) {
          recordsSkipped++;
          continue;
        }

        const removedDate = new Date(rem.removedFromLiveAt);
        const nextVersion = existing.currentVersion + 1;

        if (rem.removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN") {
          // LOT DISAPPEARED WITHOUT EXPLICIT INVOICE EVENT:
          // Rule: Remove from live availability, preserve complete history, mark removal reason as SOURCE_DISAPPEARANCE_UNKNOWN,
          // create Data Quality warning, do NOT record in Invoice sales history.
          await tx.lotMasterRecord.update({
            where: { lotId: rem.lotId },
            data: {
              isCurrent: false,
              removalReason: "SOURCE_DISAPPEARANCE_UNKNOWN",
              removedFromLiveAt: removedDate,
              lastSeenAt: removedDate,
              currentVersion: nextVersion,
              lastSyncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
            },
          });

          await tx.lotHistoryRecord.create({
            data: {
              lotId: rem.lotId,
              version: nextVersion,
              status: "REMOVED_UNKNOWN",
              docDate: existing.docDate,
              statusEffectiveDate: removedDate,
              shape: existing.shape,
              weight: existing.weight,
              color: existing.color,
              clarity: existing.clarity,
              labNormalized: existing.labNormalized,
              departmentName: existing.departmentName,
              locationName: existing.locationName,
              country: existing.country,
              branch: existing.branch,
              isCurrent: false,
              removalReason: "SOURCE_DISAPPEARANCE_UNKNOWN",
              changeReason: "REMOVED_FROM_FEED_WITHOUT_SALE_EVENT",
              syncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              isSimulated: batch.isSimulated,
            },
          });

          // Delete from active live polished stone table
          await tx.polishedStone.deleteMany({
            where: { fantasyLotId: rem.lotId },
          });

          // Raise Data Quality Issue
          dqIssuesCreated++;
          await tx.dataQualityIssue.create({
            data: {
              issueCode: `DQ-DISAPPEARED-${rem.lotId}-${Date.now()}`,
              source: "FANTASY",
              entity: "LOT",
              recordId: rem.lotId,
              rule: "SOURCE_DISAPPEARANCE_WITHOUT_INVOICE",
              message: `Lot ${rem.lotId} disappeared from Fantasy feed without an explicit invoice/sale event. Retained in historical Overall Data.`,
              severity: "WARNING",
              status: "OPEN",
            },
          });

          recordsRemoved++;
          historyVersionsCreated++;
        } else {
          // Other explicit removal reasons (e.g. COMPLETED, ARCHIVED)
          await tx.lotMasterRecord.update({
            where: { lotId: rem.lotId },
            data: {
              isCurrent: false,
              removalReason: rem.removalReason,
              removedFromLiveAt: removedDate,
              lastSeenAt: removedDate,
              currentVersion: nextVersion,
              lastSyncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
            },
          });

          await tx.lotHistoryRecord.create({
            data: {
              lotId: rem.lotId,
              version: nextVersion,
              status: rem.removalReason === "COMPLETED" ? "WIP_COMPLETED" : "ARCHIVED",
              docDate: existing.docDate,
              statusEffectiveDate: removedDate,
              shape: existing.shape,
              weight: existing.weight,
              color: existing.color,
              clarity: existing.clarity,
              labNormalized: existing.labNormalized,
              country: existing.country,
              branch: existing.branch,
              isCurrent: false,
              removalReason: rem.removalReason,
              changeReason: `REMOVAL_${rem.removalReason}`,
              syncBatchId: batch.batchId,
              checkpoint: batch.endingCheckpoint,
              isSimulated: batch.isSimulated,
            },
          });

          await tx.polishedStone.deleteMany({
            where: { fantasyLotId: rem.lotId },
          });

          recordsRemoved++;
          historyVersionsCreated++;
        }
      }

      // Checkpoint Monotonic Advancement
      await tx.syncCheckpoint.update({
        where: { source: "FANTASY" },
        data: {
          currentCheckpoint: batch.endingCheckpoint,
          lastBatchId: batch.batchId,
          lastSyncAt: nowUTC(),
          isLocked: false,
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

    const durationMs = Date.now() - startTime;

    // 6. Complete Sync Run Record with reconciliation metrics
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
    const errorSummary = err instanceof Error ? err.message : String(err);

    // Rollback is automatic in $transaction. Mark run as FAILED and release lock.
    await db.integrationSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        errorSummary,
        durationMs,
        finishedAt: nowUTC(),
      },
    });

    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: { isLocked: false },
    });

    return {
      success: false,
      runId: syncRun.id,
      batchId: `FAILED_AT_CHECKPOINT_${checkpointRecord.currentCheckpoint}`,
      startingCheckpoint: checkpointRecord.currentCheckpoint,
      endingCheckpoint: checkpointRecord.currentCheckpoint,
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
      errorSummary,
    };
  }
}

/**
 * Resets or retries a synchronization checkpoint for testing / authorized retry.
 */
export async function retrySynchronization(targetCheckpoint?: number, actor?: string): Promise<SyncRunResult> {
  if (targetCheckpoint !== undefined && targetCheckpoint >= 0) {
    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: {
        currentCheckpoint: targetCheckpoint,
        isLocked: false,
      },
    });
  } else {
    await db.syncCheckpoint.update({
      where: { source: "FANTASY" },
      data: { isLocked: false },
    });
  }

  return runSynchronization({ actor, batchIndex: targetCheckpoint });
}
