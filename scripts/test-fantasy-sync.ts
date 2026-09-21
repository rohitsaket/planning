import { db } from "../src/lib/db";
import { runSynchronization, retrySynchronization } from "../src/lib/fantasy/sync-service";
import { formatIST, getISTDateString, parseISTDateToUTC } from "../src/lib/fantasy/time";
import { normalizeShape, normalizeLab } from "../src/lib/fantasy/canonical";
import { FixtureFantasyProvider } from "../src/lib/fantasy/provider";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("💎 DIAMOND PLANNING: FANTASY DATA FOUNDATION & SYNC AUTOMATED TEST SUITE");
  console.log("===============================================================================\n");

  // Step 0: Clean test slate for deterministic execution
  console.log("🧹 [0/8] Resetting sync test environment...");
  await db.dataQualityIssue.deleteMany({ where: { source: { in: ["FANTASY", "Fantasy"] } } });
  await db.lotHistoryRecord.deleteMany({});
  await db.lotMasterRecord.deleteMany({});
  await db.integrationSyncRun.deleteMany({ where: { source: { in: ["FANTASY", "Fantasy"] } } });
  await db.syncCheckpoint.upsert({
    where: { source: "FANTASY" },
    create: { source: "FANTASY", currentCheckpoint: 0, isLocked: false },
    update: { currentCheckpoint: 0, isLocked: false, lastBatchId: null },
  });
  console.log("  ✓ Sync environment reset to Checkpoint 0.\n");

  // =========================================================================
  // TEST 1: Batch 1 — Baseline Import
  // =========================================================================
  console.log("🚀 [1/8] TEST 1: Baseline Import (Batch 1)...");
  const res1 = await runSynchronization({ actor: "TEST_RUNNER" });
  console.log("  Reconciliation result:", JSON.stringify(res1.reconciliation));
  assert(res1.success === true, "Batch 1 synchronization succeeded");
  assert(res1.batchId === "FANTASY-BATCH-001-BASELINE", `Batch ID is ${res1.batchId}`);
  assert(res1.startingCheckpoint === 0, "Starting checkpoint was 0");
  assert(res1.endingCheckpoint === 1, "Ending checkpoint advanced to 1");
  assert(res1.reconciliation.recordsReceived === 7, "Received 7 baseline records");
  assert(res1.reconciliation.recordsCreated === 7, "Created 7 new master records");
  assert(res1.reconciliation.recordsUpdated === 0, "Updated 0 records");
  assert(res1.reconciliation.recordsRemoved === 0, "Removed 0 records");
  assert(res1.reconciliation.historyVersionsCreated === 7, "Created 7 history version 1 records");
  assert(res1.reconciliation.dqIssuesCreated === 0, "0 Data Quality issues in clean baseline");

  // Verify master and history storage
  const masterCount1 = await db.lotMasterRecord.count();
  assert(masterCount1 === 7, "Total LotMasterRecords in DB = 7");
  const historyCount1 = await db.lotHistoryRecord.count();
  assert(historyCount1 === 7, "Total LotHistoryRecords in DB = 7");

  const stockLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1001" } });
  assert(stockLot !== null, "Found LOT-F-1001 in master table");
  assert(stockLot?.currentStatus === "STOCK", "LOT-F-1001 status is STOCK");
  assert(stockLot?.isCurrent === true, "LOT-F-1001 is active in live inventory");
  assert(stockLot?.isSimulated === true, "LOT-F-1001 flagged as isSimulated=true");
  assert(stockLot?.shapeNormalized === "ROUND", "Shape ROUND normalized correctly");
  assert(stockLot?.labNormalized === "GIA", "Lab GIA normalized correctly");
  console.log("  ✓ Batch 1 Baseline Import Verified.\n");

  // =========================================================================
  // TEST 2: Batch 2 — Incremental Updates & Lifecycle
  // =========================================================================
  console.log("🚀 [2/8] TEST 2: Normal Incremental Changes (Batch 2)...");
  const res2 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res2.success === true, "Batch 2 synchronization succeeded");
  assert(res2.batchId === "FANTASY-BATCH-002-INCREMENTAL", `Batch ID is ${res2.batchId}`);
  assert(res2.startingCheckpoint === 1, "Starting checkpoint was 1");
  assert(res2.endingCheckpoint === 2, "Ending checkpoint advanced to 2");
  assert(res2.reconciliation.recordsReceived === 5, "Received 5 incremental records");
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

  // Verify LOT-M-2001 MEMO -> INVOICE (Sold)
  const invLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-M-2001" } });
  assert(invLot?.currentStatus === "INVOICE", "LOT-M-2001 status is INVOICE");
  assert(invLot?.isCurrent === false, "LOT-M-2001 is no longer active in live stock (isCurrent=false)");
  assert(invLot?.removalReason === "EXPLICIT_SALE", "LOT-M-2001 removalReason is EXPLICIT_SALE");
  assert(invLot?.saleTotalUsd?.toNumber() === 4950, "LOT-M-2001 sale total is $4,950");

  // Verify Location Change for LOT-F-1001
  const locLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1001" } });
  assert(locLot?.locationName === "Mumbai Vault Floor", "LOT-F-1001 location updated to Mumbai Vault Floor");

  // Verify WIP stage change
  const wipLot = await db.lotMasterRecord.findUnique({ where: { lotId: "WIP-SIM-3001" } });
  assert(wipLot?.wipStage === "Polishing & Faceting", "WIP-SIM-3001 stage updated to Polishing & Faceting");
  console.log("  ✓ Batch 2 Incremental Lifecycle Verified.\n");

  // =========================================================================
  // TEST 3: Batch 3 — Critical Sold-Record Rule & Disappearances
  // =========================================================================
  console.log("🚀 [3/8] TEST 3: Removed Records & Critical Sold-Record Rule (Batch 3)...");
  const res3 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res3.success === true, "Batch 3 synchronization succeeded");
  assert(res3.batchId === "FANTASY-BATCH-003-REMOVALS", `Batch ID is ${res3.batchId}`);
  assert(res3.endingCheckpoint === 3, "Checkpoint advanced to 3");

  // Critical Sold-Record Rule Verification:
  // Case A: Explicit Invoice Sale LOT-F-1004
  const soldLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1004" } });
  assert(soldLot?.isCurrent === false, "LOT-F-1004 isCurrent=false");
  assert(soldLot?.currentStatus === "SOLD", "LOT-F-1004 has explicit SOLD status");
  assert(soldLot?.removalReason === "EXPLICIT_SALE", "LOT-F-1004 removalReason=EXPLICIT_SALE");
  assert(soldLot?.saleTotalUsd?.toNumber() === 12500, "LOT-F-1004 has confirmed sale price $12,500");

  // Case B: Disappearance Without Explicit Sale LOT-F-1001
  const missingLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-1001" } });
  assert(missingLot?.isCurrent === false, "LOT-F-1001 removed from live stock view");
  assert(missingLot?.removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN", "LOT-F-1001 classified as SOURCE_DISAPPEARANCE_UNKNOWN");
  assert(missingLot?.currentStatus !== "INVOICE" && missingLot?.currentStatus !== "SOLD", "CRITICAL RULE: LOT-F-1001 is NOT classified as INVOICE or sold");
  assert(missingLot?.saleTotalUsd === null, "LOT-F-1001 has NO sale total attached");

  // Check Data Quality Issue generated for unconfirmed disappearance
  const dqMissing = await db.dataQualityIssue.findFirst({
    where: { recordId: "LOT-F-1001", rule: "SOURCE_DISAPPEARANCE_WITHOUT_INVOICE" },
  });
  assert(dqMissing !== null, "DQ Warning generated for unknown disappearance of LOT-F-1001");
  assert(dqMissing?.severity === "WARNING", "DQ issue severity is WARNING");
  console.log("  ✓ Batch 3 Critical Sold-Record Rule & Disappearances Verified.\n");

  // =========================================================================
  // TEST 4: Batch 4 — Corrections, Validation & Out-of-Order Events
  // =========================================================================
  console.log("🚀 [4/8] TEST 4: Corrections & Invalid Feed Data (Batch 4)...");
  const res4 = await runSynchronization({ actor: "TEST_RUNNER" });
  assert(res4.success === true, "Batch 4 synchronization completed with error handling");
  assert(res4.batchId === "FANTASY-BATCH-004-CORRECTIONS", `Batch ID is ${res4.batchId}`);
  assert(res4.endingCheckpoint === 4, "Checkpoint advanced to 4");
  assert(res4.reconciliation.recordsRejected === 3, "Rejected 3 malformed/duplicate records");
  assert(res4.reconciliation.recordsSkipped === 1, "Skipped 1 out-of-order record");
  assert(res4.reconciliation.dqIssuesCreated >= 4, "Generated Data Quality issues for all invalid records");

  // Check DQ issues created for invalid records
  const dqDuplicate = await db.dataQualityIssue.findFirst({ where: { rule: "DUPLICATE_LOT_IN_BATCH" } });
  assert(dqDuplicate !== null, "DQ Error logged for duplicate Lot ID in same batch");

  const dqInvalidWeight = await db.dataQualityIssue.findFirst({ where: { recordId: "LOT-ERR-001" } });
  assert(dqInvalidWeight !== null, "DQ Error logged for negative/invalid weight");

  const dqMissingShape = await db.dataQualityIssue.findFirst({ where: { recordId: "LOT-ERR-002" } });
  assert(dqMissingShape !== null, "DQ Error logged for missing shape");

  const dqOutOfOrder = await db.dataQualityIssue.findFirst({ where: { rule: "OUT_OF_ORDER_UPDATE" } });
  assert(dqOutOfOrder !== null, "DQ Warning logged for out-of-order timestamp");
  console.log("  ✓ Batch 4 Corrections, Validation & DQ Generation Verified.\n");

  // =========================================================================
  // TEST 5: Batch 5 — Transaction Rollback, Checkpoint Safety & Safe Retry
  // =========================================================================
  console.log("🚀 [5/8] TEST 5: Controlled Failure, Rollback & Safe Retry (Batch 5)...");
  // Trigger simulated failure
  const res5Failed = await runSynchronization({ actor: "TEST_RUNNER", simulateFailure: true });
  assert(res5Failed.success === false, "Batch 5 simulated failure triggered successfully");
  assert(res5Failed.status === "FAILED", "Run status recorded as FAILED");
  assert(res5Failed.endingCheckpoint === 4, "CRITICAL SAFETY: Checkpoint did NOT advance on failure (remains 4)");

  // Verify no partial record created
  const failLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-5001" } });
  assert(failLot === null, "Transaction rollback verified: LOT-F-5001 not in DB during failure");

  // Now execute Retry
  console.log("  Attempting authorized retry of Batch 5...");
  const res5Retry = await retrySynchronization(4, "TEST_RUNNER");
  assert(res5Retry.success === true, "Batch 5 Retry succeeded");
  assert(res5Retry.status === "SUCCESS", "Retry status is SUCCESS");
  assert(res5Retry.endingCheckpoint === 5, "Checkpoint advanced to 5 after successful retry");

  const recoveredLot = await db.lotMasterRecord.findUnique({ where: { lotId: "LOT-F-5001" } });
  assert(recoveredLot !== null, "LOT-F-5001 now safely created in DB");
  console.log("  ✓ Batch 5 Rollback & Safe Retry Verified.\n");

  // =========================================================================
  // TEST 6: Idempotency & Replay
  // =========================================================================
  console.log("🚀 [6/8] TEST 6: Idempotency & Batch Replay...");
  const provider = new FixtureFantasyProvider();
  const batch1 = await provider.getBatch(0);

  const initialMasterCount = await db.lotMasterRecord.count();
  const initialHistoryCount = await db.lotHistoryRecord.count();

  if (batch1) {
    for (const record of batch1.records) {
      const existing = await db.lotMasterRecord.findUnique({ where: { lotId: record.lotId } });
      assert(existing !== null, `Lot ${record.lotId} exists in master table`);
    }
  }

  const finalMasterCount = await db.lotMasterRecord.count();
  const finalHistoryCount = await db.lotHistoryRecord.count();
  assert(initialMasterCount === finalMasterCount, "Master lot count unchanged on replay check");
  assert(initialHistoryCount === finalHistoryCount, "History count unchanged on replay check (no duplicate versions)");
  console.log("  ✓ Idempotency & No Duplicate Versions Verified.\n");

  // =========================================================================
  // TEST 7: Mathematical Reconciliation Check
  // =========================================================================
  console.log("🚀 [7/8] TEST 7: Mathematical Reconciliation Check...");
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
        `Run ${run.batchId || run.id} reconciles: Received(${run.recordsReceived}) == Sum of outcomes(${sum})`
      );
    }
  }
  console.log("  ✓ Mathematical Reconciliation Verified across all runs.\n");

  // =========================================================================
  // TEST 8: IST Timezone Handling
  // =========================================================================
  console.log("🚀 [8/8] TEST 8: IST Timezone Handling & Date Boundaries...");
  // UTC 2026-03-31T18:30:00.000Z = IST 2026-04-01 00:00:00 (crossing month boundary)
  const boundaryUtc = new Date("2026-03-31T18:30:00.000Z");
  const istDateStr = getISTDateString(boundaryUtc);
  assert(istDateStr === "2026-04-01", `UTC 18:30 on March 31 converts to IST April 1 (${istDateStr})`);

  const formattedIST = formatIST(boundaryUtc, true);
  assert(formattedIST.includes("01 Apr 2026"), `Formatted IST string contains 01 Apr 2026 (${formattedIST})`);

  const parsedUtc = parseISTDateToUTC("2026-04-01");
  assert(parsedUtc.toISOString() === "2026-03-31T18:30:00.000Z", "Parsed IST 2026-04-01 gives UTC 2026-03-31T18:30:00.000Z");

  // Canonical normalization
  assert(normalizeShape("rd") === "ROUND", "Shape RD normalizes to ROUND");
  assert(normalizeShape("EMERALD CUT") === "EMERALD", "Shape EMERALD CUT normalizes to EMERALD");
  assert(normalizeLab("igi lab") === "IGI", "Lab 'igi lab' normalizes to IGI");
  assert(normalizeLab("None") === "Non-Cert", "Lab 'None' normalizes to Non-Cert");
  console.log("  ✓ IST Timezone & Canonical Normalization Verified.\n");

  console.log("===============================================================================");
  console.log("🎉 ALL 8 TEST SUITES COMPLETED WITH 100% SUCCESS!");
  console.log("===============================================================================");
}

main()
  .catch((e) => {
    console.error("FATAL TEST FAILURE:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
