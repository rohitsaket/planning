import "../tests/security/setup";
import { SECTEST_DB } from "../tests/security/test-db";
import { proveDisposableDatabase } from "../src/lib/fantasy/database-environment";
import { beginModule, registeredTestCount, runRegisteredSuites } from "../tests/security/harness";

const url = process.env.DATABASE_URL ?? "";
if (!proveDisposableDatabase(url).proven) {
  console.error(`REFUSING TO RUN: DATABASE_URL must point at the isolated ${SECTEST_DB} database.`);
  process.exit(1);
}

const MODULES = [
  "../tests/security/csv-config.test",
  "../tests/security/auth.test",
  "../tests/security/route-sweep.test",
  "../tests/security/concurrency.test",
  "../tests/security/validation-upload.test",
  "../tests/security/sales-db-aggregation.test",
  "../tests/security/sales-analysis.test",
  "../tests/security/executive-analysis.test",
  "../tests/security/fantasy-analysis-pipeline.test",
  "../tests/security/customers-orders.test",
  "../tests/security/customers-orders-rbac.test",
  "../tests/security/inventory-position.test",
  "../tests/security/failure-exposure.test",
  "../tests/security/metadata-exposure.test",
  "../tests/security/stockout.test",
  "../tests/security/quantity-weight-provenance.test",
  "../tests/security/canonical-state-claim.test",
  "../tests/security/excess-analysis.test",
  "../tests/security/inventory-buckets.test",
  "../tests/security/stock-aging.test",
  "../tests/security/export-limits.test",
  "../tests/security/geography.test",
  "../tests/security/access-scope.test",
  "../tests/security/memo-scope.test",
  "../tests/security/customer-360.test",
  "../tests/security/source-disclosure.test",
  "../tests/security/category-classification.test",
  "../tests/security/projection-integrity.test",
  "../tests/security/sarin-baseline-catalog.test",
  "../tests/security/sarin-foundation.test",
  "../tests/security/sarin-ingestion.test",
  "../tests/security/sarin-validation.test",
  "../tests/security/sarin-output.test",
  "../tests/security/sarin-pink.test",
  "../tests/security/sarin-workflow.test",
  "../tests/security/sarin-readiness.test",
  "../tests/security/sarin-xlsx.test",
  "../tests/security/sarin-processing.test",
  "../tests/security/sarin-mapping-catalog.test",
  "../tests/security/sarin-import-lifecycle.test",
  "../tests/security/sarin-shape-passthrough.test",
  "../tests/security/sarin-import-ux.test",
  "../tests/security/sarin-yield-rank.test",
  "../tests/security/identity-approval.test",
  "../tests/security/single-system-role.test",
  "../tests/security/users-access-redesign.test",
  "../tests/security/navigation-consolidation.test",
  "../tests/security/compact-density.test",
  "../tests/security/retired-features.test",
  "../tests/security/legacy-plan-independence.test",
  "../tests/security/database-safety.test",
  "../tests/security/process-launch.test",
  "../tests/security/password-change.test",
  "../tests/security/data-table-layout.test",
  "../tests/security/scroll-layout.test",
  "../tests/security/ui-content.test",
] as const;

async function main() {
  console.log("===============================================================================");
  console.log(`SECURITY SUITE — isolated database ${SECTEST_DB}`);
  console.log("===============================================================================");

  for (const m of MODULES) {
    beginModule();
    await import(m);
  }
  const registered = registeredTestCount();
  if (registered === 0) {
    console.error("REFUSING TO PASS: no tests were registered — the suite did not load.");
    process.exit(1);
  }
  console.log(`Loaded ${MODULES.length} modules, ${registered} tests.`);

  const filter = process.argv[2];
  const summary = await runRegisteredSuites(filter);

  console.log("\n===============================================================================");
  console.log(`RESULT: ${summary.passed} passed, ${summary.failed} failed`);
  if (summary.failed > 0) {
    console.log("Failures:");
    for (const f of summary.failures) console.log(`  - ${f}`);
  }
  console.log("===============================================================================");
  if (summary.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
