import { db } from "../src/lib/db";
// Roles other than SUPER_ADMIN are test fixture custom roles (tests/security/fixture-roles.ts).
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

  // 1. Check permissions definition
  console.log("\n[1/4] Verifying Permission Matrices...");
  assert(testHasPermission("ADMIN", "overall.read"), "ADMIN role has overall.read");
  assert(testHasPermission("ADMIN", "overall.export"), "ADMIN role has overall.export");
  assert(testHasPermission("ADMIN", "fantasy.read"), "ADMIN role has fantasy.read");
  // Reading Fantasy data is administrative; running a synchronization is operational —
  // it pulls real source data and advances the checkpoint — so it is assigned rather
  // than inherited. FANTASY_INTEGRATION is the role that holds it.
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

  // 2. View Permission Registry
  console.log("\n[2/4] Verifying View Permission Registry...");
  // Current Data, Integration Status and Historical Data are tabs of Fantasy Data; each
  // tab keeps its own permission and the page opens for any of them.
  assert(JSON.stringify([...viewPermissions("fantasy-data")].sort()) === JSON.stringify(["fantasy.read", "overall.read"]), "Fantasy Data is admitted by fantasy.read or overall.read; rough stock is retired");
  for (const [legacy, legacyTab, tab] of [["fantasy-live", "polished", "current"], ["fantasy-polished", null, "current"], ["fantasy-sync", null, "integration"], ["overall-data", null, "history"]] as const) {
    const r = resolveViewAlias(legacy, legacyTab);
    assert(r.view === "fantasy-data" && r.tab === tab, `${legacy} opens Fantasy Data → ${tab}`);
  }

  // 3. Verify Database Seed Users
  console.log("\n[3/4] Verifying Database Seed Users & Roles...");
  const users = await db.user.findMany({ select: { username: true, role: true } });
  assert(users.length > 0, `Found ${users.length} registered system users: ${users.map((u) => `${u.username}(${u.role})`).join(", ")}`);
  const adminUser = users.find((u) => u.role === "SUPER_ADMIN");
  assert(adminUser !== undefined, `Found Administrator user: ${adminUser?.username} (${adminUser?.role})`);

  // 4. Verify Overall Data Records in Database
  console.log("\n[4/4] Verifying Overall Data Archive Content...");
  const totalMaster = await db.lotMasterRecord.count();
  const activeMaster = await db.lotMasterRecord.count({ where: { isCurrent: true } });
  const historicalMaster = await db.lotMasterRecord.count({ where: { isCurrent: false } });
  const totalHistoryVersions = await db.lotHistoryRecord.count();

  assert(totalMaster > 0, `Total master lot records: ${totalMaster}`);
  assert(activeMaster > 0, `Active live lot records: ${activeMaster}`);
  assert(historicalMaster > 0, `Historical/sold lot records: ${historicalMaster}`);
  assert(totalHistoryVersions >= totalMaster, `Historical immutable versions count (${totalHistoryVersions}) >= master count (${totalMaster})`);

  console.log("\n===============================================================================");
  console.log("🎉 ALL RBAC & REPOSITORY INTEGRITY CHECKS PASSED!");
  console.log("===============================================================================");
}

main()
  .catch((e) => {
    console.error("FATAL RBAC TEST FAILURE:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
