/**
 * ANALYSIS REVIEW FIXTURE DATASET LOADER CLI
 *
 * Usage:
 *   npm run fixture:analysis-review -- --profile=ANALYSIS_REVIEW_V1 --business-date=2026-09-24 --confirm-local
 *
 * Repair an existing dataset in place (rebuilds missing derived projections):
 *   npm run fixture:analysis-review -- --repair
 *
 * Cleanup (profile-targeted, isolated review databases only):
 *   npm run fixture:analysis-review -- --clean-profile=ANALYSIS_REVIEW_V1 --confirm-destructive-clean
 *
 * The exit code is non-zero whenever the dataset is not ready. The success banner is
 * earned by the manifest, never printed unconditionally.
 */

import {
  runAnalysisReviewFixtureLoader,
  cleanAnalysisReviewFixture,
  FIXTURE_PROFILE_CODE,
  DEFAULT_BUSINESS_DATE,
} from "../src/lib/fantasy/analysis-review-fixture";
import { reconcileOperationalProjection, checkProjectionInvariant } from "../src/lib/fantasy/operational-projection";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";

function parseArgs(args: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  // ---------------------------------------------------------------- cleanup
  if (flags["clean-profile"]) {
    const profile = String(flags["clean-profile"]);
    const confirmDestructiveClean = flags["confirm-destructive-clean"] === true;

    console.log("===============================================================================");
    console.log(`ANALYSIS REVIEW FIXTURE CLEANUP (profile: ${profile})`);
    console.log("===============================================================================\n");

    const result = await cleanAnalysisReviewFixture({ profile, confirmDestructiveClean });

    console.log(`Cleaned lot master records:    ${result.cleanedLotMasters}`);
    console.log(`Cleaned lot history records:   ${result.cleanedLotHistories}`);
    console.log(`Cleaned polished mirrors:      ${result.cleanedPolishedMirrors}`);
    console.log(`Cleaned sync runs:             ${result.cleanedSyncRuns}`);
    console.log(`Cleaned data-quality issues:   ${result.cleanedDataQualityIssues}`);
    console.log(`Cleaned demand runs:           ${result.cleanedDemandRuns}`);
    console.log("\nCleanup completed successfully.");
    return;
  }

  // ---------------------------------------------------------------- repair
  //
  // Rebuilds the derived projections of an existing dataset without re-synchronizing.
  // This is the path for a database where an ordinary seed deleted the operational
  // mirrors and left the canonical records behind: nothing in the source changed, so a
  // re-synchronization would report every record unchanged and rebuild nothing.
  if (flags["repair"] === true) {
    const proof = proveDisposableDatabase(process.env.DATABASE_URL);
    if (!proof.proven) {
      console.error(`Repair refused. ${proof.message}`);
      process.exitCode = 1;
      return;
    }

    console.log("===============================================================================");
    console.log(`ANALYSIS REVIEW FIXTURE REPAIR (${proof.host}:${proof.port}/${proof.databaseName})`);
    console.log("===============================================================================\n");

    const before = await checkProjectionInvariant();
    console.log(`Before: ${before.missingMirrors} missing mirror(s), ${before.unclassified} unclassified record(s).`);

    const result = await reconcileOperationalProjection({ actor: "ANALYSIS_REVIEW_REPAIR_CLI" });

    console.log(`Records examined:              ${result.scanned}`);
    console.log(`Classifications written:       ${result.classificationsWritten}`);
    console.log(`History classifications:       ${result.historyClassificationsWritten}`);
    console.log(`Operational mirrors created:   ${result.mirrorsCreated}`);
    console.log(`Operational mirrors updated:   ${result.mirrorsUpdated}`);
    console.log(`Ineligible records skipped:    ${result.ineligibleSkipped}`);

    if (!result.complete) {
      console.error(
        `\nRepair incomplete: ${result.outstandingMissingMirrors} record(s) still have no ` +
          `operational mirror and ${result.outstandingUnclassified} remain unclassified.`,
      );
      process.exitCode = 1;
      return;
    }

    console.log("\nOperational projection is complete. Recalculate demand to refresh the Analysis pages.");
    return;
  }

  // ---------------------------------------------------------------- load
  const profile = (flags["profile"] as string) || FIXTURE_PROFILE_CODE;
  const businessDate = (flags["business-date"] as string) || DEFAULT_BUSINESS_DATE;
  const confirmLocal = flags["confirm-local"] === true;

  console.log("===============================================================================");
  console.log(`ANALYSIS REVIEW FIXTURE LOADER (profile: ${profile})`);
  console.log(`IST business date: ${businessDate}`);
  console.log("===============================================================================\n");

  const result = await runAnalysisReviewFixtureLoader({
    profile,
    businessDate,
    confirmLocal,
    actor: "ANALYSIS_REVIEW_LOADER_CLI",
  });

  const m = result.manifest;
  console.log("--- SYNCHRONIZATION & DATASET SUMMARY ---");
  console.log(`Status:                     ${result.alreadyLoaded ? "ALREADY LOADED (verified)" : "LOADED"}`);
  console.log(`Batches synchronized:       ${result.batchesSynchronized}`);
  console.log(`Canonical lots total:       ${m.canonicalLotsTotal}`);
  console.log(`Active current lots:        ${m.activeCurrentLots}`);
  console.log(`History versions total:     ${m.historyVersionsTotal}`);
  console.log(`Confirmed sales (90d):      ${m.confirmedSalesInsideWindow} pieces`);
  console.log(`Distinct customers:         ${m.distinctCustomers}`);
  console.log(`Distinct categories:        ${m.distinctCategories}`);
  console.log(`Demand run id:              ${m.demandRunId}`);

  console.log("\n--- DEMAND OUTCOMES ---");
  console.log(`Out of stock categories:    ${m.demandOutcomes.outOfStockCategories}`);
  console.log(`Shortage categories:        ${m.demandOutcomes.shortageCategories}`);
  console.log(`Covered / at target:        ${m.demandOutcomes.coveredCategories}`);
  console.log(`Excess categories:          ${m.demandOutcomes.excessCategories}`);
  console.log(`Stock with no target:       ${m.demandOutcomes.stockNoTargetCategories}`);
  console.log(`Quarantined for review:     ${m.demandOutcomes.reviewRequiredRecords} record(s)`);
  console.log(`Review-required categories: ${m.demandOutcomes.reviewRequiredCategories} (must be 0)`);

  console.log("\n--- INVENTORY BUCKETS ---");
  console.log(`Physical available polished: ${m.inventoryBuckets.physicalAvailableCount}`);
  console.log(`Memo stock:                 ${m.inventoryBuckets.memoCount}`);
  console.log(`Reserved stock:             ${m.inventoryBuckets.reservedCount}`);
  console.log(`Manufacturing WIP:          ${m.inventoryBuckets.wipCount}`);
  console.log(`Rough stock (quarantined):  ${m.inventoryBuckets.roughCount}`);
  console.log(`Excluded stock:             ${m.inventoryBuckets.excludedCount}`);

  console.log("\n--- OPERATIONAL PROJECTION ---");
  console.log(`Projection complete:        ${m.projectionComplete ? "yes" : "NO"}`);
  console.log(`Missing mirrors:            ${m.missingMirrors}`);
  console.log(`Unclassified records:       ${m.unclassifiedRecords}`);

  console.log("\n--- INVARIANT VERIFICATION MANIFEST ---");
  for (const line of m.invariantsReport) {
    console.log(`  ${line}`);
  }

  // The banner is earned, not printed unconditionally. The previous CLI announced
  // "READY FOR EVALUATION" even on the already-loaded path where the manifest had just
  // printed six failed invariants, and it exited zero either way.
  if (!result.success || !m.passedAllInvariants) {
    const failures = m.invariantsReport.filter((line) => !line.startsWith("✓"));
    console.error("\n===============================================================================");
    console.error("ANALYSIS REVIEW FIXTURE DATASET IS NOT READY");
    console.error("===============================================================================");
    console.error(`${failures.length} invariant(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("\nThe dataset must not be used to evaluate the Analysis section in this state.");
    process.exitCode = 1;
    return;
  }

  console.log("\n===============================================================================");
  console.log("ANALYSIS REVIEW FIXTURE DATASET READY FOR LOCAL/TEST EVALUATION");
  console.log("===============================================================================");
}

main().catch((err) => {
  console.error("\nLoader execution failed:");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
