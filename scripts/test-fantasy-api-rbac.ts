import { testHasPermission } from "../tests/security/fixture-roles";
import { viewPermissions } from "../src/lib/auth/view-permissions";
import { resolveViewAlias } from "../src/stores/nav-store";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  console.log("===============================================================================");
  console.log("🔒 RBAC, PERMISSIONS & VIEW MAPPING AUTOMATED TEST SUITE");
  console.log("===============================================================================");

  console.log("\n[1/2] Verifying Permission Matrices...");
  assert(testHasPermission("ADMIN", "overall.read"), "ADMIN role has overall.read");
  assert(testHasPermission("ADMIN", "overall.export"), "ADMIN role has overall.export");
  assert(testHasPermission("ADMIN", "fantasy.read"), "ADMIN role has fantasy.read");
  assert(!testHasPermission("ADMIN", "fantasy.sync.run"), "ADMIN role does NOT automatically have fantasy.sync.run");
  assert(!testHasPermission("ADMIN", "fantasy.sync.unlock"), "ADMIN role does NOT automatically have fantasy.sync.unlock");
  assert(testHasPermission("FANTASY_INTEGRATION", "fantasy.sync.run"), "FANTASY_INTEGRATION role has fantasy.sync.run");

  assert(testHasPermission("PLANNER", "overall.read"), "PLANNER role has overall.read");
  assert(!testHasPermission("PLANNER", "overall.export"), "PLANNER role does NOT have overall.export");
  assert(testHasPermission("PLANNER", "fantasy.read"), "PLANNER role has fantasy.read");
  assert(!testHasPermission("PLANNER", "fantasy.sync.run"), "PLANNER role does NOT have fantasy.sync.run (restricted to Fantasy Integration)");

  assert(testHasPermission("VIEWER", "overall.read"), "VIEWER role has overall.read");
  assert(!testHasPermission("VIEWER", "overall.export"), "VIEWER role does NOT have overall.export");
  assert(!testHasPermission("VIEWER", "fantasy.sync.run"), "VIEWER role does NOT have fantasy.sync.run");

  console.log("\n[2/2] Verifying View Permission Registry...");
  assert(JSON.stringify([...viewPermissions("fantasy-data")].sort()) === JSON.stringify(["fantasy.read", "overall.read"]), "Fantasy Data is admitted by fantasy.read or overall.read; rough stock is retired");
  for (const [legacy, legacyTab, tab] of [["fantasy-live", "polished", "current"], ["fantasy-polished", null, "current"], ["fantasy-sync", null, "integration"], ["overall-data", null, "history"]] as const) {
    const r = resolveViewAlias(legacy, legacyTab);
    assert(r.view === "fantasy-data" && r.tab === tab, `${legacy} opens Fantasy Data → ${tab}`);
  }

  console.log("\n===============================================================================");
  console.log("🎉 ALL RBAC & REPOSITORY INTEGRITY CHECKS PASSED!");
  console.log("===============================================================================");
}

main().catch((e) => {
  console.error("FATAL RBAC TEST FAILURE:", e);
  process.exit(1);
});
