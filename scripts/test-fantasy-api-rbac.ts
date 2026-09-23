import { db } from "../src/lib/db";
import { hasPermission, ROLE_PERMISSIONS } from "../src/lib/auth/permissions";
import { viewPermission } from "../src/lib/auth/view-permissions";

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
  assert(hasPermission("ADMIN", "overall.read"), "ADMIN role has overall.read");
  assert(hasPermission("ADMIN", "overall.export"), "ADMIN role has overall.export");
  assert(hasPermission("ADMIN", "fantasy.read"), "ADMIN role has fantasy.read");
  assert(hasPermission("ADMIN", "fantasy.sync.run"), "ADMIN role has fantasy.sync.run");
  assert(hasPermission("ADMIN", "fantasy.sync.unlock"), "ADMIN role has fantasy.sync.unlock");

  assert(hasPermission("PLANNER", "overall.read"), "PLANNER role has overall.read");
  assert(!hasPermission("PLANNER", "overall.export"), "PLANNER role does NOT have overall.export");
  assert(hasPermission("PLANNER", "fantasy.read"), "PLANNER role has fantasy.read");
  assert(!hasPermission("PLANNER", "fantasy.sync.run"), "PLANNER role does NOT have fantasy.sync.run (restricted to Admin/Fantasy Integration)");

  assert(hasPermission("VIEWER", "overall.read"), "VIEWER role has overall.read");
  assert(!hasPermission("VIEWER", "overall.export"), "VIEWER role does NOT have overall.export");
  assert(!hasPermission("VIEWER", "fantasy.sync.run"), "VIEWER role does NOT have fantasy.sync.run");

  // 2. View Permission Registry
  console.log("\n[2/4] Verifying View Permission Registry...");
  assert(viewPermission("overall-data") === "overall.read", "overall-data view maps to overall.read");
  assert(viewPermission("fantasy-sync") === "fantasy.read", "fantasy-sync view maps to fantasy.read");
  assert(viewPermission("fantasy-live") === "fantasy.read", "fantasy-live view maps to fantasy.read");

  // 3. Verify Database Seed Users
  console.log("\n[3/4] Verifying Database Seed Users & Roles...");
  const users = await db.user.findMany({ select: { username: true, role: true } });
  assert(users.length > 0, `Found ${users.length} registered system users: ${users.map((u) => `${u.username}(${u.role})`).join(", ")}`);
  const adminUser = users.find((u) => u.role === "SUPER_ADMIN" || u.role === "ADMIN");
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
