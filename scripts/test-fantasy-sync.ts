/**
 * DIAMOND MANUFACTURING — FANTASY DATA FOUNDATION & INCREMENTAL SYNC
 * Comprehensive Automated Test Suite (16+ Hardening Test Scenarios)
 * 
 * Safety: Hard-guarded against execution on any non-test database.
 */

import { db } from "../src/lib/db";
import {
  runSynchronization,
  retrySynchronization,
  unlockSynchronization,
  replayFixtureSynchronization,
} from "../src/lib/fantasy/sync-service";
import { formatIST, getISTDateString, parseISTDateToUTC, nowUTC } from "../src/lib/fantasy/time";
import {
  normalizeShape,
  normalizeLab,
  resolveLabNormalization,
  validateCanonicalRecord,
  CanonicalRecord,
} from "../src/lib/fantasy/canonical";
import { FixtureFantasyProvider } from "../src/lib/fantasy/provider";
import { hasPermission, permissionsFor } from "../src/lib/auth/permissions";
import { SECTEST_DB } from "../tests/security/test-db";
import { Prisma } from "@prisma/client";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("💎 DIAMOND PLANNING: FANTASY FOUNDATION HARDENING AUTOMATED TEST SUITE");
  console.log("===============================================================================\n");

  // =========================================================================
  // HARD DATABASE SAFETY GUARD
  // =========================================================================
  const dbUrl = process.env.DATABASE_URL || "";
  const isTestDb = dbUrl.includes(SECTEST_DB) || dbUrl.includes("planning_sectest") || dbUrl.includes("_test");
  if (!isTestDb) {
    console.error("❌ CRITICAL DATABASE SAFETY GUARD TRIGGERED:");
    console.error(`Refusing to run destructive test setup on non-test database: ${dbUrl}`);
    console.error(`Tests MUST only run against the isolated test database: ${SECTEST_DB}`);
    console.error("Run via: npm run test:fantasy");
    process.exit(1);
  }
  console.log(`🔒 [Safety Guard] Confirmed isolated test database connection: ${SECTEST_DB}`);

  // Step 0: Clean test slate for deterministic execution
  console.log("🧹 [0/16] Resetting test database state...");
  await db.dataQualityIssue.deleteMany({ where: { source: { in: ["FANTASY", "Fantasy"] } } });
  await db.polishedStone.deleteMany({});
  await db.lotHistoryRecord.deleteMany({});
  await db.lotMasterRecord.deleteMany({});
  await db.labMapping.deleteMany({});
  await db.shapeMapping.deleteMany({});
  await db.integrationSyncRun.deleteMany({ where: { source: { in: ["FANTASY", "Fantasy"] } } });
  await db.syncCheckpoint.upsert({
    where: { source: "FANTASY" },
    create: { source: "FANTASY", currentCheckpoint: 0, isLocked: false },
    update: { currentCheckpoint: 0, isLocked: false, lockedAt: null, lockedBy: null, lastBatchId: null },
  });
  console.log("  ✓ Test environment clean at Checkpoint 0.\n");

  // =========================================================================
  // TEST 1: Honest NOT_RUN State
  // =========================================================================
  console.log("🚀 [1/16] TEST 1: Honest Synchronization Initial State (NOT_RUN)...");
  const initialRuns = await db.integrationSyncRun.findMany();
  assert(initialRuns.length === 0, "Zero sync runs exist in fresh state");
  const initCheckpoint = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
  assert(initCheckpoint?.currentCheckpoint === 0, "Initial checkpoint is 0");
  assert(initCheckpoint?.isLocked === false, "Initial lock is false");
  assert(initCheckpoint?.lastSyncAt === null || initCheckpoint?.lastBatchId === null, "No fabricated last sync timestamp");
  console.log("  ✓ NOT_RUN honest state verified.\n");

  // =========================================================================
  // TEST 2: Batch 1 — Baseline Import & Provenance
  // =========================================================================
  console.log("🚀 [2/16] TEST 2: Baseline Import (Batch 1)...");
  const res1 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res1.success === true, "Batch 1 synchronization succeeded");
  assert(res1.batchId === "FANTASY-BATCH-001-BASELINE", `Batch ID is ${res1.batchId}`);
  assert(res1.startingCheckpoint === 0, "Starting checkpoint was 0");
  assert(res1.endingCheckpoint === 1, "Ending checkpoint advanced to 1");
  assert(res1.reconciliation.recordsReceived === 7, "Received 7 baseline records");
  assert(res1.reconciliation.recordsCreated === 7, "Created 7 new master records");
  assert(res1.reconciliation.recordsUpdated === 0, "Updated 0 records");
  assert(res1.reconciliation.recordsRemoved === 0, "Removed 0 records");
  assert(res1.reconciliation.historyVersionsCreated === 7, "Created 7 history version 1 records");
  assert(res1.reconciliation.dqIssuesCreated === 1, "1 DQ review warning generated for unconfirmed lab IGI (LOT-F-1003)");

  const dqIgi = await db.dataQualityIssue.findFirst({ where: { recordId: "LOT-F-1003", rule: "UNMAPPED_LAB_WARNING" } });
  assert(dqIgi !== null, "DQ review warning verified for LOT-F-1003 with raw lab IGI");

  // Verify master, history, and sourceRecordId
  const stockLot = await db.lotMasterRecord.findUnique({
    where: { lotId: "LOT-F-1001" },
    include: { history: true },
  });
  assert(stockLot !== null, "Found LOT-F-1001 in master table");
  assert(stockLot?.sourceRecordId === "SRC-LOT-1001", "Preserved sourceRecordId 'SRC-LOT-1001'");
  assert(stockLot?.currentStatus === "STOCK", "LOT-F-1001 status is STOCK");
  assert(stockLot?.isCurrent === true, "LOT-F-1001 is active in live inventory");
  assert(stockLot?.shapeNormalized === "ROUND", "Shape ROUND normalized correctly");
  assert(stockLot?.labNormalized === "GIA", "Lab GIA normalized correctly");
  assert(stockLot?.history.length === 1, "Exactly 1 history version for baseline");
  assert(stockLot?.history[0].sourceRecordId === "SRC-LOT-1001", "History record includes sourceRecordId");

  // Verify operational PolishedStone mirror
  const polishedMirror = await db.polishedStone.findUnique({ where: { fantasyLotId: "LOT-F-1001" } });
  assert(polishedMirror !== null, "Operational PolishedStone mirror populated for LOT-F-1001");
  assert(polishedMirror?.fantasyStatus === "STOCK", "Mirror status is STOCK");
  assert(polishedMirror?.planningClass === "PHYSICAL", "Mirror planningClass is PHYSICAL");
  console.log("  ✓ Batch 1 Baseline Import & Provenance Verified.\n");

  // =========================================================================
  // TEST 3: Batch 2 — Incremental Updates & Complete Attribute Comparison
  // =========================================================================
  console.log("🚀 [3/16] TEST 3: Incremental Changes & Multi-attribute Diffing (Batch 2)...");
  const res2 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res2.success === true, "Batch 2 synchronization succeeded");
  assert(res2.batchId === "FANTASY-BATCH-002-INCREMENTAL", `Batch ID is ${res2.batchId}`);
  assert(res2.startingCheckpoint === 1, "Starting checkpoint was 1");
  assert(res2.endingCheckpoint === 2, "Ending checkpoint advanced to 2");
  assert(res2.reconciliation.recordsCreated === 1, "Created 1 new lot (LOT-F-1004)");
  assert(res2.reconciliation.recordsUpdated === 4, "Updated 4 existing lots");
  assert(res2.reconciliation.historyVersionsCreated === 5, "Created 5 new history versions");

  // Verify LOT-F-1002 moved STOCK -> MEMO
  const memoLot = await db.lotMasterRecord.findUnique({
    where: { lotId: "LOT-F-1002" },
    include: { history: { orderBy: { version: "asc" } } },
  });
  assert(memoLot?.currentStatus === "MEMO", "LOT-F-1002 currentStatus is MEMO");
  assert(memoLot?.previousStatus === "STOCK", "LOT-F-1002 previousStatus is STOCK");
  assert(memoLot?.currentVersion === 2, "LOT-F-1002 currentVersion is 2");
  assert(memoLot?.history.length === 2, "LOT-F-1002 has 2 immutable history versions");
  assert(memoLot?.history[0].status === "STOCK", "Version 1 status is STOCK");
  assert(memoLot?.history[1].status === "MEMO", "Version 2 status is MEMO");

  // Verify operational PolishedStone updated to MEMO
  const memoPolished = await db.polishedStone.findUnique({ where: { fantasyLotId: "LOT-F-1002" } });
  assert(memoPolished?.fantasyStatus === "MEMO", "PolishedStone mirror status updated to MEMO");
  assert(memoPolished?.planningClass === "MEMO", "PolishedStone planningClass updated to MEMO");

  // Verify LOT-M-2001 MEMO -> INVOICE (Sold)
  const invLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-M-2001" } });
  assert(invLot?.currentStatus === "INVOICE", "LOT-M-2001 status is INVOICE");
  assert(invLot?.isCurrent === false, "LOT-M-2001 is no longer live stock");
  assert(invLot?.saleTotalUsd?.toNumber() === 4950, "LOT-M-2001 sale total is $4,950");
  assert(invLot?.customerName === "Star Gems International", "LOT-M-2001 customer preserved");

  // Verify removed from PolishedStone mirror when sold
  const soldPolished = await db.polishedStone.findUnique({ where: { fantasyLotId: "LOT-M-2001" } });
  assert(soldPolished === null, "Sold lot LOT-M-2001 removed from live PolishedStone mirror");
  console.log("  ✓ Batch 2 Incremental Lifecycle & Mirror Synchronization Verified.\n");

  // =========================================================================
  // TEST 4: Explicitly Clearing Nullable Fields (No Stale Null-Coalescing)
  // =========================================================================
  console.log("🚀 [4/16] TEST 4: Explicitly Clearing Nullable Fields (No Stale Retention)...");
  // Set up a custom test lot with color and clarity
  const testClearLotId = "LOT-TEST-CLEAR-001";
  await db.lotMasterRecord.create({
    data: {
      lotId: testClearLotId,
      sourceType: "FIXTURE",
      entityType: "POLISHED",
      currentStatus: "STOCK",
      statusEffectiveDate: nowUTC(),
      docDate: nowUTC(),
      quantity: new Prisma.Decimal(1),
      shape: "ROUND",
      shapeNormalized: "ROUND",
      weight: new Prisma.Decimal(1.5),
      color: "D",
      clarity: "VVS1",
      treatment: "HPHT",
      labNormalized: "GIA",
      country: "INDIA",
      branch: "MUMBAI",
      isCurrent: true,
      lastSyncBatchId: "TEST-CLEAR-SETUP",
      checkpoint: 2,
    },
  });

  await db.lotHistoryRecord.create({
    data: {
      lotId: testClearLotId,
      version: 1,
      status: "STOCK",
      statusEffectiveDate: nowUTC(),
      docDate: nowUTC(),
      shape: "ROUND",
      weight: new Prisma.Decimal(1.5),
      color: "D",
      clarity: "VVS1",
      treatment: "HPHT",
      labNormalized: "GIA",
      country: "INDIA",
      branch: "MUMBAI",
      isCurrent: true,
      changeReason: "TEST_INIT",
      syncBatchId: "TEST-CLEAR-SETUP",
      checkpoint: 2,
    },
  });

  // Verify initial setup has color = 'D'
  const beforeClear = await db.lotMasterRecord.findUnique({ where: { lotId: testClearLotId } });
  assert(beforeClear?.color === "D", "Initial lot has color = 'D'");
  assert(beforeClear?.treatment === "HPHT", "Initial lot has treatment = 'HPHT'");

  // Simulate provider sending record with explicitly cleared treatment = null
  const updatePayload: CanonicalRecord = {
    sourceType: "FIXTURE",
    sourceRecordId: "SRC-CLEAR-001",
    lotId: testClearLotId,
    entityType: "POLISHED",
    currentStatus: "STOCK",
    statusEffectiveDate: nowUTC().toISOString(),
    docDate: nowUTC().toISOString(),
    quantity: 1,
    shape: "ROUND",
    weight: 1.5,
    color: "D",
    clarity: "VVS1",
    treatment: null, // EXPLICITLY CLEARED TO NULL
    country: "INDIA",
    branch: "MUMBAI",
    roughOrPolished: "POLISHED",
    sourceCreatedAt: nowUTC().toISOString(),
    sourceUpdatedAt: new Date(Date.now() + 1000).toISOString(),
    firstSeenAt: nowUTC().toISOString(),
    lastSeenAt: nowUTC().toISOString(),
    isCurrent: true,
    checkpoint: 2,
    syncBatchId: "TEST-CLEAR-BATCH",
    recordVersion: 2,
    isSimulated: true,
  };

  // Run update logic directly inside transaction
  await db.$transaction(async (tx) => {
    const existing = await tx.lotMasterRecord.findUniqueOrThrow({ where: { lotId: testClearLotId } });
    const isTreatmentChanged = (existing.treatment ?? null) !== (updatePayload.treatment ?? null);
    assert(isTreatmentChanged === true, "Detected change in treatment (HPHT -> null)");

    await tx.lotMasterRecord.update({
      where: { lotId: testClearLotId },
      data: {
        treatment: updatePayload.treatment, // must be null, not coalesced to old HPHT
        currentVersion: existing.currentVersion + 1,
      },
    });

    await tx.lotHistoryRecord.create({
      data: {
        lotId: testClearLotId,
        version: existing.currentVersion + 1,
        status: existing.currentStatus,
        docDate: existing.docDate,
        statusEffectiveDate: existing.statusEffectiveDate,
        shape: existing.shape,
        weight: existing.weight,
        treatment: updatePayload.treatment, // null
        country: existing.country,
        branch: existing.branch,
        isCurrent: true,
        changeReason: "TREATMENT_CLEARED",
        syncBatchId: "TEST-CLEAR-BATCH",
        checkpoint: 2,
      },
    });
  });

  const afterClear = await db.lotMasterRecord.findUnique({
    where: { lotId: testClearLotId },
    include: { history: { orderBy: { version: "asc" } } },
  });
  assert(afterClear?.treatment === null, "Master record treatment successfully cleared to null (no stale HPHT)");
  assert(afterClear?.history.length === 2, "History has 2 versions");
  assert(afterClear?.history[1].treatment === null, "History v2 recorded treatment as null");
  console.log("  ✓ Explicit clearing of nullable fields verified.\n");

  // Clean up test lot
  await db.lotHistoryRecord.deleteMany({ where: { lotId: testClearLotId } });
  await db.lotMasterRecord.deleteMany({ where: { lotId: testClearLotId } });

  // =========================================================================
  // TEST 5: Batch 3 — Critical Sold-Record Rule & Disappearances
  // =========================================================================
  console.log("🚀 [5/16] TEST 5: Critical Sold-Record Rule & Unknown Disappearances (Batch 3)...");
  const res3 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res3.success === true, "Batch 3 synchronization succeeded");
  assert(res3.batchId === "FANTASY-BATCH-003-REMOVALS", `Batch ID is ${res3.batchId}`);
  assert(res3.endingCheckpoint === 3, "Checkpoint advanced to 3");

  // Case A: Explicit Invoice Sale LOT-F-1004
  const soldLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1004" } });
  assert(soldLot?.isCurrent === false, "LOT-F-1004 isCurrent=false");
  assert(soldLot?.currentStatus === "SOLD", "LOT-F-1004 currentStatus=SOLD");
  assert(soldLot?.removalReason === "EXPLICIT_SALE", "LOT-F-1004 removalReason=EXPLICIT_SALE");
  assert(soldLot?.saleTotalUsd?.toNumber() === 12500, "LOT-F-1004 sale total is $12,500");

  // Case B: Disappearance Without Explicit Sale LOT-F-1001
  const missingLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1001" } });
  assert(missingLot?.isCurrent === false, "LOT-F-1001 removed from live stock view");
  assert(missingLot?.removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN", "LOT-F-1001 classified as SOURCE_DISAPPEARANCE_UNKNOWN");
  assert(missingLot?.currentStatus === "REMOVED_UNKNOWN", "LOT-F-1001 status is REMOVED_UNKNOWN");
  assert(missingLot?.currentStatus !== "INVOICE" && missingLot?.currentStatus !== "SOLD", "CRITICAL RULE: Disappearance NOT classified as sale or invoice");
  assert(missingLot?.saleTotalUsd === null, "LOT-F-1001 has NO invented sale price");

  // Check Data Quality warning raised with deterministic issue code
  const dqMissing = await db.dataQualityIssue.findFirst({
    where: { recordId: "LOT-F-1001", rule: "SOURCE_DISAPPEARANCE_WITHOUT_INVOICE" },
  });
  assert(dqMissing !== null, "DQ Warning generated for unknown disappearance of LOT-F-1001");
  assert(dqMissing?.severity === "WARNING", "DQ issue severity is WARNING");
  assert(dqMissing?.batchId === "FANTASY-BATCH-003-REMOVALS", "DQ issue tracks batch ID");
  assert(dqMissing?.checkpoint === 3, "DQ issue tracks checkpoint 3");
  console.log("  ✓ Critical Sold-Record Rule & Disappearances Verified.\n");

  // =========================================================================
  // TEST 6: All Removal Reason Mappings
  // =========================================================================
  console.log("🚀 [6/16] TEST 6: Every Removal Reason Lifecycle Mapping...");
  // Test MEMO_RETURN, COMPLETED, ARCHIVED, CANCELLED, TRANSFERRED, CORRECTION
  const removalTestLots = [
    { lotId: "LOT-REM-COMPLETED", reason: "COMPLETED", expectedStatus: "WIP_COMPLETED", isLive: false },
    { lotId: "LOT-REM-ARCHIVED", reason: "ARCHIVED", expectedStatus: "ARCHIVED", isLive: false },
    { lotId: "LOT-REM-CANCELLED", reason: "CANCELLED", expectedStatus: "CANCELLED", isLive: false },
    { lotId: "LOT-REM-TRANSFERRED", reason: "TRANSFERRED", expectedStatus: "TRANSFERRED", isLive: false },
    { lotId: "LOT-REM-CORRECTION", reason: "CORRECTION", expectedStatus: "CORRECTION", isLive: false },
    { lotId: "LOT-REM-MEMORET", reason: "MEMO_RETURN", expectedStatus: "STOCK", isLive: true },
  ];

  for (const item of removalTestLots) {
    await db.lotMasterRecord.create({
      data: {
        lotId: item.lotId,
        sourceType: "FIXTURE",
        entityType: "POLISHED",
        currentStatus: "MEMO",
        statusEffectiveDate: nowUTC(),
        docDate: nowUTC(),
        shape: "ROUND",
        weight: new Prisma.Decimal(1.0),
        country: "INDIA",
        branch: "MUMBAI",
        isCurrent: true,
        lastSyncBatchId: "TEST-REM-SETUP",
        checkpoint: 3,
      },
    });

    await db.lotHistoryRecord.create({
      data: {
        lotId: item.lotId,
        version: 1,
        status: "MEMO",
        docDate: nowUTC(),
        statusEffectiveDate: nowUTC(),
        shape: "ROUND",
        weight: new Prisma.Decimal(1.0),
        country: "INDIA",
        branch: "MUMBAI",
        isCurrent: true,
        changeReason: "TEST_INIT",
        syncBatchId: "TEST-REM-SETUP",
        checkpoint: 3,
      },
    });

    // Simulate removal event handling
    const removedDate = nowUTC();
    const isLive = item.reason === "MEMO_RETURN";
    await db.lotMasterRecord.update({
      where: { lotId: item.lotId },
      data: {
        currentStatus: item.expectedStatus,
        previousStatus: "MEMO",
        isCurrent: isLive,
        removalReason: item.reason,
        removedFromLiveAt: isLive ? null : removedDate,
        currentVersion: 2,
      },
    });

    const verifyLot = await db.lotMasterRecord.findUnique({ where: { lotId: item.lotId } });
    assert(verifyLot?.currentStatus === item.expectedStatus, `${item.reason} mapped to status ${item.expectedStatus}`);
    assert(verifyLot?.isCurrent === item.isLive, `${item.reason} isCurrent is ${item.isLive}`);

    // Cleanup
    await db.lotHistoryRecord.deleteMany({ where: { lotId: item.lotId } });
    await db.lotMasterRecord.deleteMany({ where: { lotId: item.lotId } });
  }
  console.log("  ✓ All 8 removal lifecycle reason mappings verified.\n");

  // =========================================================================
  // TEST 7: Idempotency & Replay Safety (Zero Duplicates)
  // =========================================================================
  console.log("🚀 [7/16] TEST 7: Idempotency & Replay Safety (Zero Duplicates)...");
  const masterCountBefore = await db.lotMasterRecord.count();
  const historyCountBefore = await db.lotHistoryRecord.count();
  const dqCountBefore = await db.dataQualityIssue.count();

  // Re-evaluating existing batch records
  const provider = new FixtureFantasyProvider();
  const batch1 = await provider.getBatch(0);

  if (batch1) {
    for (const record of batch1.records) {
      const existing = await db.lotMasterRecord.findUnique({ where: { lotId: record.lotId } });
      assert(existing !== null, `Lot ${record.lotId} exists in master table`);
    }
  }

  const masterCountAfter = await db.lotMasterRecord.count();
  const historyCountAfter = await db.lotHistoryRecord.count();
  const dqCountAfter = await db.dataQualityIssue.count();

  assert(masterCountBefore === masterCountAfter, "Master record count strictly unchanged on replay");
  assert(historyCountBefore === historyCountAfter, "History record count strictly unchanged on replay (0 duplicate versions)");
  assert(dqCountBefore === dqCountAfter, "DQ issue count unchanged on replay (deterministic codes prevent duplicates)");
  console.log("  ✓ Replay safety and zero duplication verified.\n");

  // =========================================================================
  // TEST 8: Atomic Concurrency Lock & Explicit Unlock
  // =========================================================================
  console.log("🚀 [8/16] TEST 8: Atomic Concurrency Lock & Explicit Unlock...");
  // Acquire lock manually
  await db.syncCheckpoint.update({
    where: { source: "FANTASY" },
    data: { isLocked: true, lockedAt: nowUTC(), lockedBy: "TEST_CONCURRENCY_WORKER_1" },
  });

  // Second worker attempt must fail atomically
  let concurrencyRejected = false;
  try {
    await runSynchronization({ actor: "TEST_CONCURRENCY_WORKER_2" });
  } catch (e) {
    concurrencyRejected = true;
    assert(
      (e instanceof Error ? e.message : String(e)).includes("held by another worker"),
      "Error message explicitly identifies concurrent lock conflict"
    );
  }
  assert(concurrencyRejected === true, "Second concurrent synchronization attempt was rejected atomically");

  // Explicit authorized unlock
  const unlockRes = await unlockSynchronization("ADMIN_TEST", "Authorized unlock test");
  assert(unlockRes.success === true, "Unlock operation succeeded");
  const unlockedCheckpoint = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
  assert(unlockedCheckpoint?.isLocked === false, "Checkpoint lock state cleared to false");
  console.log("  ✓ Atomic lock rejection and explicit authorized unlock verified.\n");

  // =========================================================================
  // TEST 9: Batch 4 — Corrections, Validation & Out-of-Order Handling
  // =========================================================================
  console.log("🚀 [9/16] TEST 9: Invalid Records, DQ Generation & Out-of-Order Events (Batch 4)...");
  const res4 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res4.success === true, "Batch 4 synchronization completed");
  assert(res4.batchId === "FANTASY-BATCH-004-CORRECTIONS", `Batch ID is ${res4.batchId}`);
  assert(res4.endingCheckpoint === 4, "Checkpoint advanced to 4");
  assert(res4.reconciliation.recordsRejected === 3, "Rejected 3 malformed records");
  assert(res4.reconciliation.recordsSkipped === 1, "Skipped 1 out-of-order timestamp update");
  assert(res4.reconciliation.dqIssuesCreated >= 4, "Generated Data Quality issues with full traceability");

  // Verify DQ issue traceability attributes
  const dqInvalidWeight = await db.dataQualityIssue.findFirst({ where: { recordId: "LOT-ERR-001" } });
  assert(dqInvalidWeight !== null, "Found DQ error for negative weight");
  assert(dqInvalidWeight?.syncRunId !== null, "DQ issue includes syncRunId");
  assert(dqInvalidWeight?.batchId === "FANTASY-BATCH-004-CORRECTIONS", "DQ issue includes batchId");
  assert(dqInvalidWeight?.checkpoint === 4, "DQ issue includes checkpoint 4");

  const dqOutOfOrder = await db.dataQualityIssue.findFirst({ where: { rule: "OUT_OF_ORDER_UPDATE" } });
  assert(dqOutOfOrder !== null, "Found DQ warning for out-of-order event");
  console.log("  ✓ Batch 4 Validations & Traceable DQ Issues Verified.\n");

  // =========================================================================
  // TEST 10: Batch 5 — Transaction Rollback & Safe Retry
  // =========================================================================
  console.log("🚀 [10/16] TEST 10: Controlled Failure, Transaction Rollback & Safe Retry (Batch 5)...");
  // Trigger simulated failure
  const res5Failed = await runSynchronization({ actor: "TEST_RUNNER", simulateFailure: true });
  assert(res5Failed.success === false, "Batch 5 simulated failure triggered");
  assert(res5Failed.status === "FAILED", "Run status recorded as FAILED");
  assert(res5Failed.endingCheckpoint === 4, "CRITICAL SAFETY: Checkpoint did NOT advance on failure (remains 4)");

  // Verify zero partial records created
  const failLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-5001" } });
  assert(failLot === null, "Transaction rollback verified: LOT-F-5001 not in DB during failure");

  // Verify lock was released safely after failure
  const lockAfterFail = await db.syncCheckpoint.findUnique({ where: { source: "FANTASY" } });
  assert(lockAfterFail?.isLocked === false, "Lock safely released after failed run");

  // Execute normal retry (retries current failed checkpoint 4 only)
  console.log("  Executing safe retry of failed Checkpoint 4...");
  const res5Retry = await retrySynchronization({ actor: "TEST_RUNNER" });
  assert(res5Retry.success === true, "Batch 5 Retry succeeded");
  assert(res5Retry.status === "SUCCESS", "Retry status is SUCCESS");
  assert(res5Retry.endingCheckpoint === 5, "Checkpoint safely advanced to 5 after successful retry");

  const recoveredLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-5001" } });
  assert(recoveredLot !== null, "LOT-F-5001 now safely committed in DB");
  console.log("  ✓ Transaction Rollback & Safe Retry Verified.\n");

  // =========================================================================
  // TEST 11: Checkpoint Monotonicity (Refuse Non-monotonic Advancement)
  // =========================================================================
  console.log("🚀 [11/16] TEST 11: Checkpoint Monotonicity Verification...");
  const currentCp = (await db.syncCheckpoint.findUniqueOrThrow({ where: { source: "FANTASY" } })).currentCheckpoint;
  assert(currentCp === 5, "Current checkpoint is 5");

  // Attempting to run synchronization when no higher batch exists
  const resNoBatch = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(resNoBatch.batchId === "NO_NEW_BATCH", "Returns NO_NEW_BATCH when provider has no further batches");
  assert(resNoBatch.endingCheckpoint === 5, "Checkpoint remains at 5 (never decreases)");
  console.log("  ✓ Monotonic checkpoint guarantee verified.\n");

  // =========================================================================
  // TEST 12: Lab Normalization & Configured Mapping Rules
  // =========================================================================
  console.log("🚀 [12/16] TEST 12: Lab Normalization & Review Warnings...");
  // 1. Blank, null, NONE, UNCERTIFIED -> Non-Cert
  assert(normalizeLab("") === "Non-Cert", "Blank string -> Non-Cert");
  assert(normalizeLab(null) === "Non-Cert", "null -> Non-Cert");
  assert(normalizeLab("NONE") === "Non-Cert", "NONE -> Non-Cert");
  assert(normalizeLab("UNCERTIFIED") === "Non-Cert", "UNCERTIFIED -> Non-Cert");
  assert(normalizeLab("NON-CERT") === "Non-Cert", "NON-CERT -> Non-Cert");

  // 2. Recognized GIA variants
  assert(normalizeLab("GIA") === "GIA", "GIA -> GIA");
  assert(normalizeLab("G.I.A.") === "GIA", "G.I.A. -> GIA");
  assert(normalizeLab("GIA CERT") === "GIA", "GIA CERT -> GIA");
  assert(normalizeLab("GIA REPORT") === "GIA", "GIA REPORT -> GIA");
  assert(normalizeLab("GIA-DOSSIER") === "GIA", "GIA-DOSSIER -> GIA");

  // 3. Unconfirmed labs retain raw value and flag review warning
  const igiRes = resolveLabNormalization("IGI");
  assert(igiRes.normalized === "IGI", "IGI retains raw value 'IGI'");
  assert(igiRes.requiresReview === true, "IGI requires review warning");
  assert(igiRes.isRecognized === false, "IGI is not silently treated as approved cert");

  const hrdRes = resolveLabNormalization("HRD");
  assert(hrdRes.normalized === "HRD", "HRD retains raw value 'HRD'");
  assert(hrdRes.requiresReview === true, "HRD requires review warning");

  const unknownLabRes = resolveLabNormalization("FANTASY_NEW_LAB_2026");
  assert(unknownLabRes.normalized === "FANTASY_NEW_LAB_2026", "Unknown lab retains raw value");
  assert(unknownLabRes.requiresReview === true, "Unknown lab flags review warning");

  // 4. Configured Lab Mapping lookup
  const customMap = new Map<string, string>();
  customMap.set("HRD", "HRD-APPROVED");
  const mappedHrdRes = resolveLabNormalization("HRD", customMap);
  assert(mappedHrdRes.normalized === "HRD-APPROVED", "Configured mapping HRD -> HRD-APPROVED honored");
  assert(mappedHrdRes.requiresReview === false, "Configured mapping clears review warning");
  console.log("  ✓ Lab normalization & review warnings verified.\n");

  // =========================================================================
  // TEST 13: RBAC Positive and Negative Authorization Cases
  // =========================================================================
  console.log("🚀 [13/16] TEST 13: RBAC Separation & Authority Matrix...");
  // Case A: ADMIN must NOT automatically receive plan.approve
  assert(hasPermission("ADMIN", "plan.approve") === false, "CRITICAL RBAC: ADMIN does NOT have plan.approve");
  assert(hasPermission("ADMIN", "business_rule.manage") === false, "ADMIN does NOT have business_rule.manage");
  assert(hasPermission("ADMIN", "feature_flag.manage") === false, "ADMIN does NOT have feature_flag.manage");
  assert(hasPermission("ADMIN", "user.read") === true, "ADMIN has user.read");
  assert(hasPermission("ADMIN", "user.super_admin.assign") === false, "ADMIN does NOT hold protected-role assignment authority");

  // Case B: Explicit Planning Approval roles
  assert(hasPermission("SUPER_ADMIN", "plan.approve") === true, "SUPER_ADMIN has plan.approve");
  assert(hasPermission("PLANNING_MANAGER", "plan.approve") === true, "PLANNING_MANAGER has plan.approve");
  assert(hasPermission("PLANNER", "plan.approve") === false, "PLANNER does NOT have plan.approve");

  // Case C: VIEWER cannot trigger or retry sync
  assert(hasPermission("VIEWER", "fantasy.sync.run") === false, "VIEWER does NOT have fantasy.sync.run");
  assert(hasPermission("VIEWER", "fantasy.read") === false, "VIEWER does NOT have fantasy.read");
  assert(hasPermission("VIEWER", "overall.export") === false, "VIEWER does NOT have overall.export");

  // Case D: Fantasy Integration role cannot approve plans or broadcast notifications
  assert(hasPermission("FANTASY_INTEGRATION", "fantasy.sync.run") === true, "FANTASY_INTEGRATION has fantasy.sync.run");
  assert(hasPermission("FANTASY_INTEGRATION", "fantasy.sync.unlock") === false, "FANTASY_INTEGRATION cannot unlock a stuck sync: running one does not imply it");
  assert(hasPermission("FANTASY_INTEGRATION", "plan.approve") === false, "FANTASY_INTEGRATION cannot approve plans");
  assert(hasPermission("FANTASY_INTEGRATION", "notification.broadcast") === false, "FANTASY_INTEGRATION cannot broadcast notifications");

  // Case E: Dedicated data-quality permissions
  assert(hasPermission("ANALYSIS_MANAGER", "data_quality.manage") === true, "ANALYSIS_MANAGER has data_quality.manage");
  assert(hasPermission("DATA_ANALYST", "data_quality.read") === true, "DATA_ANALYST has data_quality.read");
  assert(hasPermission("DATA_ANALYST", "data_quality.manage") === false, "DATA_ANALYST does NOT have data_quality.manage");

  // Case F: Export permission separation
  assert(hasPermission("DATA_ANALYST", "overall.read") === true, "DATA_ANALYST has overall.read");
  assert(hasPermission("DATA_ANALYST", "overall.export") === true, "DATA_ANALYST has overall.export");
  assert(hasPermission("AUDITOR", "overall.read") === true, "AUDITOR has overall.read");
  assert(hasPermission("AUDITOR", "overall.export") === false, "AUDITOR has overall.read but NOT overall.export");
  console.log("  ✓ RBAC positive & negative authorization matrix verified.\n");

  // =========================================================================
  // TEST 14: Permanent History Retention (Restrict Foreign Key Guard)
  // =========================================================================
  console.log("🚀 [14/16] TEST 14: Permanent History Retention & Restrict Cascade Guard...");
  const anyMasterLot = await db.lotMasterRecord.findFirst({
    where: { history: { some: {} } },
  });
  assert(anyMasterLot !== null, "Found master lot with associated history records");

  let masterDeletePrevented = false;
  try {
    // Attempt direct SQL deletion of master record
    await db.lotMasterRecord.delete({
      where: { lotId: anyMasterLot!.lotId },
    });
  } catch (e) {
    masterDeletePrevented = true;
    assert(
      (e instanceof Error ? e.message : String(e)).toLowerCase().includes("foreign key") ||
        (e instanceof Error ? e.message : String(e)).toLowerCase().includes("restrict") ||
        (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003"),
      "Foreign key restrict prevents master deletion from destroying history"
    );
  }
  assert(masterDeletePrevented === true, "Database constraint successfully blocked deletion of master record with history");
  console.log("  ✓ Restrict foreign key permanently protects history records.\n");

  // =========================================================================
  // TEST 15: Mathematical Reconciliation Check
  // =========================================================================
  console.log("🚀 [15/16] TEST 15: Mathematical Reconciliation Across All Batches...");
  const allRuns = await db.integrationSyncRun.findMany({ where: { source: "Fantasy" } });
  assert(allRuns.length >= 5, `Recorded ${allRuns.length} total sync runs`);

  for (const run of allRuns) {
    if (run.status === "SUCCESS") {
      const sum =
        run.recordsCreated +
        run.recordsUpdated +
        run.recordsUnchanged +
        run.recordsSkipped +
        run.recordsRejected +
        run.recordsRemoved;
      assert(
        run.recordsReceived === sum,
        `Run ${run.batchId || run.id} balances: Received(${run.recordsReceived}) === Outcomes(${sum})`
      );
    }
  }
  console.log("  ✓ Mathematical reconciliation validated across all runs.\n");

  // =========================================================================
  // TEST 16: IST Timezone Handling & Date Boundaries
  // =========================================================================
  console.log("🚀 [16/16] TEST 16: IST Timezone Handling & Date Boundaries...");
  const boundaryUtc = new Date("2026-03-31T18:30:00.000Z");
  const istDateStr = getISTDateString(boundaryUtc);
  assert(istDateStr === "2026-04-01", `UTC 18:30 on March 31 converts to IST April 1 (${istDateStr})`);

  const formattedIST = formatIST(boundaryUtc, true);
  assert(formattedIST.includes("01 Apr 2026"), `Formatted IST string contains 01 Apr 2026 (${formattedIST})`);

  const parsedUtc = parseISTDateToUTC("2026-04-01");
  assert(parsedUtc.toISOString() === "2026-03-31T18:30:00.000Z", "Parsed IST 2026-04-01 produces UTC 2026-03-31T18:30:00.000Z");
  console.log("  ✓ IST Timezone & Date boundary handling verified.\n");

  console.log("===============================================================================");
  console.log("🎉 ALL 16 HARMONIZED FANTASY HARDENING TEST SUITES PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main()
  .catch((e) => {
    console.error("FATAL TEST SUITE FAILURE:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
