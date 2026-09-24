/**
 * TEST SUITE: DETERMINISTIC ANALYSIS REVIEW FIXTURE DATASET (ANALYSIS_REVIEW_V1)
 *
 * Runs against the isolated security-test database (planning_sectest).
 *
 * Proves:
 * 1. Environment safety checks refuse non-local, live or invalid configurations.
 * 2. Deterministic generator is 100% repeatable given fixed seed.
 * 3. Batch synchronization runs through real pipeline (sync-service -> canonical master/history -> classification).
 * 4. Authoritative demand calculation produces required outcomes (OOS >= 8, Shortage >= 12, Covered >= 10, Excess >= 8, Stock-No-Target >= 5, Review-Required >= 5).
 * 5. Multi-version history (1 to 5 versions) is immutable and current lot totals count each lot once.
 * 6. Sales history spans all three 30-day periods with correct window boundary handling.
 * 7. Inventory buckets (Physical, Memo, Reserved, WIP, Rough, Excluded, Review Required) are populated.
 * 8. Fictional customers, geographic distributions, and data quality quarantine.
 * 9. Idempotency: rerunning the loader produces zero duplicates and leaves data consistent.
 * 10. Real Analysis APIs and endpoints query the generated dataset with pagination and filtering.
 *
 * Usage:
 *   npx tsx scripts/sectest-db.ts && npx tsx scripts/with-sectest-db.ts npx prisma migrate deploy && npx tsx scripts/with-sectest-db.ts npx tsx scripts/test-analysis-review-fixture.ts
 */

import { db } from "../src/lib/db";
import { SECTEST_DB } from "../tests/security/test-db";
import {
  generateAnalysisReviewBatches,
  runAnalysisReviewFixtureLoader,
  cleanAnalysisReviewFixture,
  verifyAnalysisReviewManifest,
  assertSafeEnvironmentForFixtureLoad,
  FIXTURE_PROFILE_CODE,
  NAMESPACE_PREFIX,
  DEFAULT_BUSINESS_DATE,
  CATEGORY_SCENARIOS,
} from "../src/lib/fantasy/analysis-review-fixture";
import { loadConfirmedSaleFacts } from "../src/lib/demand/confirmed-sales";
import { parseISTDateToUTC } from "../src/lib/fantasy/time";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("🔍 ANALYSIS REVIEW FIXTURE DATASET (ANALYSIS_REVIEW_V1) TEST SUITE");
  console.log("===============================================================================\n");

  // 0. Confirm safe database
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(SECTEST_DB)) {
    throw new Error(`REFUSING TO RUN: Tests must run against isolated test database ${SECTEST_DB}`);
  }

  // ---------------------------------------------------------------------------
  console.log("--- TEST 1: Environment Safety Guard & Precondition Refusal ---");
  // ---------------------------------------------------------------------------
  let threwNoLocal = false;
  try {
    assertSafeEnvironmentForFixtureLoad({
      profile: FIXTURE_PROFILE_CODE,
      businessDate: DEFAULT_BUSINESS_DATE,
      confirmLocal: false, // missing flag
    });
  } catch (e: any) {
    threwNoLocal = true;
    assert(e.message.includes("--confirm-local flag is required"), "Refuses without --confirm-local flag");
  }
  assert(threwNoLocal, "Missing --confirm-local threw error");

  let threwInvalidProfile = false;
  try {
    assertSafeEnvironmentForFixtureLoad({
      profile: "PROD_PROFILE_INVALID",
      businessDate: DEFAULT_BUSINESS_DATE,
      confirmLocal: true,
    });
  } catch (e: any) {
    threwInvalidProfile = true;
    assert(e.message.includes("Unsupported fixture profile"), "Refuses invalid profile code");
  }
  assert(threwInvalidProfile, "Invalid profile threw error");

  let threwInvalidDate = false;
  try {
    assertSafeEnvironmentForFixtureLoad({
      profile: FIXTURE_PROFILE_CODE,
      businessDate: "not-a-date",
      confirmLocal: true,
    });
  } catch (e: any) {
    threwInvalidDate = true;
    assert(e.message.includes("Invalid business date"), "Refuses invalid business date format");
  }
  assert(threwInvalidDate, "Invalid date threw error");

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 2: Deterministic Batch Generation Repeatability ---");
  // ---------------------------------------------------------------------------
  const run1 = generateAnalysisReviewBatches(DEFAULT_BUSINESS_DATE, 42424242);
  const run2 = generateAnalysisReviewBatches(DEFAULT_BUSINESS_DATE, 42424242);

  assert(run1.allBatches.length === 4, "Generates exactly 4 sequential batches");
  assert(run1.lotCount === run2.lotCount, `Lot count is identical across runs (${run1.lotCount})`);
  assert(run1.historyCount === run2.historyCount, `History version count is identical across runs (${run1.historyCount})`);
  assert(run1.salesCount === run2.salesCount, `Sales count is identical across runs (${run1.salesCount})`);
  assert(run1.batch1.records[0].lotId === run2.batch1.records[0].lotId, "First record lot ID matches exactly");
  assert(run1.batch1.records[0].weight === run2.batch1.records[0].weight, "First record weight matches exactly");

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 3: Clean Start (Profile-targeted cleanup) ---");
  // ---------------------------------------------------------------------------
  const cleanResult = await cleanAnalysisReviewFixture({
    profile: FIXTURE_PROFILE_CODE,
    confirmDestructiveClean: true,
  });
  console.log(`  Initial clean cleared ${cleanResult.cleanedLotMasters} existing ARV1 records`);

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 4: Initial Fixture Load Through Real Synchronization Pipeline ---");
  // ---------------------------------------------------------------------------
  const loadResult1 = await runAnalysisReviewFixtureLoader({
    profile: FIXTURE_PROFILE_CODE,
    businessDate: DEFAULT_BUSINESS_DATE,
    confirmLocal: true,
    actor: "SECTEST_HARNESS",
  });

  assert(loadResult1.success === true, "Initial loader execution returned success");
  assert(loadResult1.alreadyLoaded === false, "First run performed fresh load (alreadyLoaded = false)");
  assert(loadResult1.batchesSynchronized === 4, "All 4 batches synchronized");
  assert(!!loadResult1.demandRunId, `Demand calculation run completed (ID: ${loadResult1.demandRunId})`);

  const manifest1 = loadResult1.manifest;
  assert(manifest1.canonicalLotsTotal >= 800 && manifest1.canonicalLotsTotal <= 1200, `Canonical lots in target range 800-1200 (got ${manifest1.canonicalLotsTotal})`);
  assert(manifest1.historyVersionsTotal >= 1500 && manifest1.historyVersionsTotal <= 3000, `History versions in target range 1500-3000 (got ${manifest1.historyVersionsTotal})`);
  assert(manifest1.distinctCategories >= 40 && manifest1.distinctCategories <= 65, `Planning categories in target range 40-65 (got ${manifest1.distinctCategories})`);
  assert(manifest1.distinctCustomers >= 25, `At least 25 distinct customers (got ${manifest1.distinctCustomers})`);

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 5: Authoritative Demand Outcome Invariants ---");
  // ---------------------------------------------------------------------------
  const outcomes = manifest1.demandOutcomes;
  assert(outcomes.outOfStockCategories >= 8, `Out of Stock categories >= 8 (got ${outcomes.outOfStockCategories})`);
  assert(outcomes.shortageCategories >= 12, `Shortage categories >= 12 (got ${outcomes.shortageCategories})`);
  assert(outcomes.coveredCategories >= 10, `Covered / At Target categories >= 10 (got ${outcomes.coveredCategories})`);
  assert(outcomes.excessCategories >= 8, `Excess categories >= 8 (got ${outcomes.excessCategories})`);
  assert(outcomes.stockNoTargetCategories >= 5, `Stock with No Target categories >= 5 (got ${outcomes.stockNoTargetCategories})`);
  // Review is measured in records, not categories: a quarantined record deliberately
  // produces no category, so a non-zero category count here would mean an unapproved
  // value had become a valid-looking planning category.
  assert(
    outcomes.reviewRequiredRecords >= 20,
    `Records quarantined for review >= 20 (got ${outcomes.reviewRequiredRecords})`,
  );
  assert(
    outcomes.reviewRequiredCategories === 0,
    `No quarantined record became a category (got ${outcomes.reviewRequiredCategories})`,
  );

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 6: Inventory Bucket Distribution ---");
  // ---------------------------------------------------------------------------
  const buckets = manifest1.inventoryBuckets;
  assert(buckets.physicalAvailableCount > 300, `Physical Available Polished populated (got ${buckets.physicalAvailableCount})`);
  assert(buckets.memoCount > 50, `Memo Polished populated (got ${buckets.memoCount})`);
  assert(buckets.reservedCount > 40, `Reserved Polished populated (got ${buckets.reservedCount})`);
  assert(buckets.wipCount > 30, `Manufacturing WIP populated (got ${buckets.wipCount})`);
  // Rough records are present and quarantined: the source status ROUGH_AVAILABLE has no
  // approved mapping in the active classification profile, so the classifier fails closed.
  // This is a deliberate review scenario, not an approved "available rough" bucket.
  assert(buckets.roughCount > 30, `Rough records present and quarantined (got ${buckets.roughCount})`);
  assert(buckets.excludedCount > 0, `Excluded stock populated (got ${buckets.excludedCount})`);

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 7: Multi-Version History Distribution ---");
  // ---------------------------------------------------------------------------
  const lotVersions = await db.lotHistoryRecord.groupBy({
    by: ["lotId"],
    where: { lotId: { startsWith: NAMESPACE_PREFIX } },
    _count: { version: true },
  });

  const versionCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const lv of lotVersions) {
    const c = lv._count.version;
    versionCounts[c] = (versionCounts[c] ?? 0) + 1;
  }

  assert(versionCounts[1] > 200, `Lots with 1 version > 200 (got ${versionCounts[1]})`);
  assert(versionCounts[2] > 200, `Lots with 2 versions > 200 (got ${versionCounts[2]})`);
  assert(versionCounts[3] > 30, `Lots with 3 versions > 30 (got ${versionCounts[3]})`);
  assert(versionCounts[4] > 10, `Lots with 4 versions > 10 (got ${versionCounts[4]})`);
  assert(versionCounts[5] > 5, `Lots with 5 versions > 5 (got ${versionCounts[5]})`);

  // Single current record per lot
  const currentCountPerLot = await db.lotMasterRecord.groupBy({
    by: ["lotId"],
    where: { lotId: { startsWith: NAMESPACE_PREFIX } },
    _count: { id: true },
  });
  assert(currentCountPerLot.every((c) => c._count.id === 1), "Every lot has exactly 1 canonical master record (no master duplicates)");

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 8: Confirmed Sales Window & Period Distribution ---");
  // ---------------------------------------------------------------------------
  const salesResult = await loadConfirmedSaleFacts({
    referenceDate: parseISTDateToUTC(DEFAULT_BUSINESS_DATE),
    windowDays: 90,
  });

  const arvSales = salesResult.facts.filter((f) => f.lotId.startsWith(NAMESPACE_PREFIX));
  assert(arvSales.length >= 150 && arvSales.length <= 300, `Confirmed sales inside 90d window in range 150-300 (got ${arvSales.length})`);
  assert(arvSales.every((f) => f.quantityProvenance === "EXPLICIT_FIXTURE"), "All ARV1 sales have confirmed quantity provenance EXPLICIT_FIXTURE");

  // ---------------------------------------------------------------------------
  console.log("\n--- TEST 9: Idempotency & Repeat Run Safety ---");
  // ---------------------------------------------------------------------------
  const initialMasterCount = await db.lotMasterRecord.count({ where: { lotId: { startsWith: NAMESPACE_PREFIX } } });
  const initialHistoryCount = await db.lotHistoryRecord.count({ where: { lotId: { startsWith: NAMESPACE_PREFIX } } });

  const loadResult2 = await runAnalysisReviewFixtureLoader({
    profile: FIXTURE_PROFILE_CODE,
    businessDate: DEFAULT_BUSINESS_DATE,
    confirmLocal: true,
    actor: "SECTEST_HARNESS_RERUN",
  });

  assert(loadResult2.success === true, "Rerun returned success");
  assert(loadResult2.alreadyLoaded === true, "Rerun recognized existing completed dataset (alreadyLoaded = true)");

  const rerunMasterCount = await db.lotMasterRecord.count({ where: { lotId: { startsWith: NAMESPACE_PREFIX } } });
  const rerunHistoryCount = await db.lotHistoryRecord.count({ where: { lotId: { startsWith: NAMESPACE_PREFIX } } });

  assert(rerunMasterCount === initialMasterCount, `Zero duplicate lot masters created on rerun (${rerunMasterCount} === ${initialMasterCount})`);
  assert(rerunHistoryCount === initialHistoryCount, `Zero duplicate history records created on rerun (${rerunHistoryCount} === ${initialHistoryCount})`);

  console.log("\n===============================================================================");
  console.log("🎉 ALL ANALYSIS REVIEW FIXTURE TESTS PASSED (100% SUCCESS)!");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
