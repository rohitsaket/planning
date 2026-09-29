// Sarin readiness: what the Workbook Import page's APIs return when the database is behind
// the code (pending migrations), and on a freshly migrated, empty database — the upload
// settings, an empty import list, the baseline shape mappings in effect, and the permission
// boundaries around them.
//
// Runs against the isolated planning_sectest database only. The "pending migration" state
// is simulated by renaming a table or column inside the test database for one request and
// restoring it in `finally`; no other database is touched.

import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { permissionsFor } from "@/lib/auth/permissions";
import { GET as listImports } from "@/app/api/planning/sarin/imports/route";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User, admin: User, planner: User, reader: User;
const BASELINE = "sarin_shape_set_baseline_v1";
const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];

const get = (handler: any, u: User | undefined, query = "", params: Record<string, string> = {}) => {
  resetRateLimits();
  return call(handler, { cookie: u?.cookie, path: `/api/x${query}`, params });
};
const SAFE = (json: unknown) => !/Sarin[A-Z][A-Za-z]+"|relation|column|does not exist|SELECT|prisma|at .*\.ts|node_modules|\bP20\d\d\b/i.test(JSON.stringify(json));

/** Runs `fn` with one database object renamed, restoring it whatever happens. */
async function withRenamed(rename: string, restore: string, fn: () => Promise<void>) {
  const [{ d }] = await db.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== "planning_sectest") throw new Error(`refusing to alter ${d}`);
  await db.$executeRawUnsafe(rename);
  try {
    await fn();
  } finally {
    await db.$executeRawUnsafe(restore);
  }
}

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  root = await makeUser("ready.root", "SUPER_ADMIN");
  admin = await makeUser("ready.admin", "ADMIN");
  planner = await makeUser("ready.planner", "PLANNER");
  reader = await makeUser("ready.reader", "PLANNING_VIEWER");
});
beforeEach(() => resetRateLimits());

// =========================================================================================
describe("sarin readiness: database behind the code", () => {
  test("a missing Sarin table is a safe 503 naming no table, query or path", async () => {
    await withRenamed(`ALTER TABLE "SarinImportBatch" RENAME TO "SarinImportBatch_pending"`, `ALTER TABLE "SarinImportBatch_pending" RENAME TO "SarinImportBatch"`, async () => {
      const r = await get(listImports, planner);
      expect([r.status, r.json.error.code, SAFE(r.json)]).toEqual([503, "DATABASE_NOT_READY", true]);
      expect(r.json.error.message).toMatch(/apply the pending database migrations/);
      expect(typeof r.json.error.requestId).toBe("string");
    });
    await withRenamed(`ALTER TABLE "SarinShapeMappingSet" RENAME TO "SarinShapeMappingSet_pending"`, `ALTER TABLE "SarinShapeMappingSet_pending" RENAME TO "SarinShapeMappingSet"`, async () => {
      const r = await get(readCatalog, root);
      expect([r.status, r.json.error.code, SAFE(r.json)]).toEqual([503, "DATABASE_NOT_READY", true]);
    });
    // Restored: the same requests succeed again.
    expect((await get(listImports, planner)).status).toBe(200);
  });

  test("a missing column is the same safe 503", async () => {
    await withRenamed(`ALTER TABLE "SarinShapeMappingRule" RENAME COLUMN "note" TO "note_pending"`, `ALTER TABLE "SarinShapeMappingRule" RENAME COLUMN "note_pending" TO "note"`, async () => {
      const r = await get(readCatalog, root);
      expect([r.status, r.json.error.code, SAFE(r.json)]).toEqual([503, "DATABASE_NOT_READY", true]);
    });
    expect((await get(readCatalog, root)).status).toBe(200);
  });
});

// =========================================================================================
describe("sarin readiness: freshly migrated, empty database", () => {
  test("the import list is a successful empty state; uploaders get the upload settings, readers do not", async () => {
    const asPlanner = await get(listImports, planner);
    expect([asPlanner.status, asPlanner.json.rows, asPlanner.json.total, asPlanner.json.hasMore]).toEqual([200, [], 0, false]);
    expect(asPlanner.json.upload).toMatchObject({ acceptedExtension: ".csv", maxFileBytes: 8 * 1024 * 1024, maxRecords: 150_000 });
    expect([Array.isArray(asPlanner.json.upload.labs), "countries" in asPlanner.json.upload]).toEqual([true, false]);
    const asReader = await get(listImports, reader);
    expect([asReader.status, asReader.json.rows, asReader.json.upload]).toEqual([200, [], null]);
    expect((await get(listImports, undefined)).status).toBe(401);
  });

  test("the migration made the 32 confirmed rules the initial effective catalog, approved by nobody", async () => {
    const stored = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: BASELINE } });
    // Effective at migration, or already replaced by a snapshot another suite saved.
    expect([["EFFECTIVE", "SUPERSEDED"].includes(stored.status), stored.origin, stored.version, stored.effectiveAt !== null]).toEqual([true, "MIGRATION_BASELINE", 1, true]);
    expect([stored.approvedByUserId, stored.approvedAt, stored.createdByUserId, stored.lastModifiedByUserId]).toEqual([null, null, null, null]);
    const rules = await db.sarinShapeMappingRule.findMany({ where: { mappingSetId: BASELINE }, select: { rawShapeKey: true, note: true } });
    expect([rules.length, rules.some((x) => x.rawShapeKey === "EMERALD 4STEP"), rules.filter((x) => x.note).length]).toEqual([32, false, 0]);
    // Exactly one catalog is in effect, and Workbook Import knows mappings are configured.
    expect(await db.sarinShapeMappingSet.count({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" } })).toBe(1);
    expect((await get(listImports, planner)).json.mappingsConfigured).toBe(true);
  });

  test("page access follows the read permissions; mapping approval no longer exists", async () => {
    for (const [role, expected] of [["SUPER_ADMIN", true], ["PLANNER", true], ["PLANNING_VIEWER", true], ["ADMIN", true], ["VIEWER", false]] as const) {
      expect([role, isViewAuthorized(permissionsFor(role), "planning-workbook-import")]).toEqual([role, expected]);
    }
    expect(permissionsFor("SUPER_ADMIN").filter((p) => p.startsWith("sarin.mapping")).sort()).toEqual(["sarin.mapping.manage", "sarin.mapping.read"]);
    expect(permissionsFor("ADMIN").some((p) => p.startsWith("sarin.mapping"))).toBe(false);
    expect((await get(readCatalog, admin)).status).toBe(403);
    // The withdrawn permission cannot be granted again, and no role holds it.
    resetRateLimits();
    const refused = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code: `READY_APPROVER_${Date.now().toString(36).toUpperCase()}`, name: "Approver", permissions: ["sarin.mapping.read", "sarin.mapping.approve"] } });
    expect(refused.status).toBe(400);
    expect(await db.rolePermission.count({ where: { permissionCode: "sarin.mapping.approve" } })).toBe(0);
  });

  test("the confirmed baseline is never edited in place: a change is a new snapshot", async () => {
    const before = await db.sarinShapeMappingRule.findMany({ where: { mappingSetId: BASELINE }, orderBy: { id: "asc" } });
    resetRateLimits();
    const saved = await call(saveMapping, { method: "POST", cookie: root.cookie, body: { sarinShape: `OLD STEP ${Date.now().toString(36).toUpperCase()}`, fantasyShape: "Emerald", applyTo: "ALL_RATIOS" } });
    expect(saved.status).toBe(200);
    expect(await db.sarinShapeMappingRule.findMany({ where: { mappingSetId: BASELINE }, orderBy: { id: "asc" } })).toEqual(before);
    const stored = await db.sarinShapeMappingSet.findUniqueOrThrow({ where: { id: BASELINE } });
    expect([stored.status, stored.lastModifiedByUserId]).toEqual(["SUPERSEDED", null]);
    await expect(db.sarinShapeMappingRule.update({ where: { id: before[0].id }, data: { normalizedShape: "Oval" } })).rejects.toThrow(/Rules of a SUPERSEDED/);
  });
});
