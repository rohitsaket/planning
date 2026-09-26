/**
 * Runs the security suite against the isolated security-test database.
 *
 * Replaces the `bun test` entry point the suite was written for. Bun is not installed,
 * so `npm run test:security` previously prepared a database and then executed nothing.
 * This runner loads the same test modules — which exercise real route handlers against
 * a real database — and reports a genuine pass/fail.
 *
 * Refuses to run anywhere except `planning_sectest`.
 *
 * Usage: npx tsx scripts/with-sectest-db.ts npx tsx scripts/run-security-tests.ts [filter]
 */

import "../tests/security/setup";
import { SECTEST_DB } from "../tests/security/test-db";
import { beginModule, registeredTestCount, runRegisteredSuites } from "../tests/security/harness";

const url = process.env.DATABASE_URL ?? "";
if (!url || !new URL(url).pathname.startsWith(`/${SECTEST_DB}`)) {
  console.error(`REFUSING TO RUN: DATABASE_URL must point at the isolated ${SECTEST_DB} database.`);
  process.exit(1);
}

// Registration order matters: each import registers its suites with the harness.
const MODULES = [
  "../tests/security/csv-config.test",
  "../tests/security/auth.test",
  "../tests/security/route-sweep.test",
  "../tests/security/identity-approval.test",
  "../tests/security/notifications.test",
  "../tests/security/concurrency.test",
  "../tests/security/validation-upload.test",
  "../tests/security/sales-db-aggregation.test",
  "../tests/security/sales-analysis.test",
  "../tests/security/projection-api.test",
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
  // Registered last: these suites write hundreds of canonical lots, so any suite that
  // counts records globally must have run already.
  "../tests/security/inventory-buckets.test",
  "../tests/security/stock-aging.test",
  "../tests/security/export-limits.test",
  "../tests/security/geography.test",
  "../tests/security/access-scope.test",
  "../tests/security/source-disclosure.test",
  "../tests/security/category-classification.test",
  "../tests/security/projection-integrity.test",
  "../tests/security/sarin-foundation.test",
  "../tests/security/sarin-ingestion.test",
  "../tests/security/sarin-validation.test",
  "../tests/security/sarin-output.test",
  "../tests/security/sarin-pink.test",
] as const;

async function main() {
  console.log("===============================================================================");
  console.log(`SECURITY SUITE — isolated database ${SECTEST_DB}`);
  console.log("===============================================================================");

  for (const m of MODULES) {
    // Each module gets its own hook scope, matching Bun's file-scoped semantics.
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
