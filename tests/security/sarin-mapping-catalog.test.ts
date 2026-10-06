import { beforeAll, beforeEach, describe, expect, test } from "./harness";
import { call, db, ensureLabRegistry, makeUser, resetDb } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { effectiveSnapshotId, applyCatalog, type CatalogRule } from "./sarin-catalog";
import type { ComponentType } from "react";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { TEST_ROLES, testPermissionsFor } from "./fixture-roles";
import { NAV } from "@/components/layout/app-shell";
import { GET as readCatalog, POST as saveMapping } from "@/app/api/planning/sarin/shape-mappings/route";
import { DELETE as removeMapping } from "@/app/api/planning/sarin/shape-mappings/[ruleId]/route";
import { POST as uploadImport } from "@/app/api/planning/sarin/imports/route";
import { POST as validateImport } from "@/app/api/planning/sarin/imports/[batchId]/validate/route";
import { POST as rolesPost } from "@/app/api/admin/roles/route";
import { POST as usersPost } from "@/app/api/admin/users/route";
import { SarinShapeMappingsView } from "@/components/diamond/views/sarin/sarin-shape-mappings-view";
import { MappingsView } from "@/components/diamond/views/consolidated/mappings-view";
import { LEGACY_VIEW_ALIASES } from "@/stores/nav-store";

type User = Awaited<ReturnType<typeof makeUser>>;
const SARIN_DATA = ["SarinPlanPiece", "SarinPlanOption", "SarinOutputVersion", "SarinRowInterpretation", "SarinValidationAttempt", "SarinIssueOverride", "SarinValidationIssue", "SarinStoneBlock", "SarinSourceRow", "SarinImportBatch", "SarinSourceFileContent", "SarinSourceFile"];
const BASE_RULES: CatalogRule[] = [
  { rawShape: "ROUND", normalizedShape: "Round" },
  { rawShape: "PEAR", normalizedShape: "Pear" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Asscher", conditionKind: "RATIO_RANGE", ratioMin: "1.000", ratioMax: "1.030" },
  { rawShape: "EMERALD 5STEP", normalizedShape: "Emerald", conditionKind: "RATIO_RANGE", ratioMin: "1.400", ratioMax: null },
];

let root: User, admin: User, planner: User, reader: User, manager: User, managerB: User, scoped: User;

const get = (u: User | undefined) => {
  resetRateLimits();
  return call(readCatalog, { cookie: u?.cookie, path: "/api/planning/sarin/shape-mappings" });
};
const save = (u: User | undefined, body: Record<string, unknown>) => {
  resetRateLimits();
  return call(saveMapping, { method: "POST", cookie: u?.cookie, body: { applyTo: "ALL_RATIOS", ...body } });
};
const remove = (u: User | undefined, ruleId: string) => {
  resetRateLimits();
  return call(removeMapping, { method: "DELETE", cookie: u?.cookie, params: { ruleId } });
};
const catalog = async (u: User = manager) => (await get(u)).json;
const mappingOf = async (sarinShape: string, u: User = manager) => (await catalog(u)).mappings.find((m: any) => m.sarinShape === sarinShape);
const snapshots = () => db.sarinShapeMappingSet.count({ where: { sourceSystem: "SARIN" } });
const render = async <P extends object>(view: ComponentType<P>, props: P, u: User) => renderPage(view, props, await sessionUser(u.cookie), u.cookie);

async function userWith(name: string, permissions: string[]) {
  const u = await makeUser(name, "VIEWER");
  const code = `SMC_${name.toUpperCase().replace(/[^A-Z]/g, "_")}_${Date.now().toString(36).toUpperCase()}`;
  resetRateLimits();
  if ((await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code, name: `SMC ${name}`, permissions } })).status !== 200) throw new Error("role create failed");
  resetRateLimits();
  if ((await call(usersPost, { method: "POST", cookie: root.cookie, body: { op: "setRoles", id: u.user.id, roles: [code] } })).status !== 200) throw new Error("role assign failed");
  return u;
}

let nonce = 0;
const kapan = () => `5${String(++nonce).padStart(3, "0")}C`;
interface Rec { name: string; shape?: string; ratio?: string }
const csv = (recs: Rec[]) => recs.map((r) => [r.name, "3.000", r.shape ?? "ROUND", "1.500", "VS1", "G", "61.6", r.ratio ?? "1.000", "7.62", "7.62", "4.69"].join(",")).join("\n") + "\n";
async function upload(recs: Rec[], labId: string | null = null, packetType = "BLUE") {
  resetRateLimits();
  const fd = new FormData();
  fd.append("file", new File([new TextEncoder().encode(csv(recs)) as BlobPart], "sarin.csv", { type: "text/csv" }));
  for (const [k, v] of Object.entries({ packetType, planningDate: "2026-09-28", ...(labId ? { labId } : {}) })) fd.append(k, v);
  const encoded = new Response(fd);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const res = await uploadImport(
    new Request("http://localhost:3000/api/planning/sarin/imports", { method: "POST", headers: { cookie: planner.cookie, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.length) }, body }),
    { params: Promise.resolve({}) } as never,
  );
  if (res.status !== 201) throw new Error(`upload failed ${res.status}`);
  return ((await res.json()) as any).batch.id as string;
}
const validate = async (batchId: string) => {
  resetRateLimits();
  return (await call(validateImport, { method: "POST", cookie: planner.cookie, body: {}, params: { batchId } })).json.batch?.status as string;
};
const stone = (shape: string, ratio = "1.000") => {
  const name = `${kapan()}-001 DC`;
  return Array.from({ length: 17 }, () => ({ name, shape, ratio }));
};

async function withAuditFailure(action: string, fn: () => Promise<void>) {
  const [{ d }] = await db.$queryRaw<{ d: string }[]>`SELECT current_database() AS d`;
  if (d !== "planning_sectest") throw new Error(`refusing to alter ${d}`);
  await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION sectest_fail_mapping_audit() RETURNS trigger AS $$ BEGIN IF NEW."action" = '${action}' THEN RAISE EXCEPTION 'sectest forced failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await db.$executeRawUnsafe(`CREATE TRIGGER sectest_fail_mapping_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sectest_fail_mapping_audit()`);
  try {
    await fn();
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sectest_fail_mapping_audit ON "AuditLog"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sectest_fail_mapping_audit()`);
  }
}

beforeAll(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`TRUNCATE ${SARIN_DATA.map((t) => `"${t}"`).join(", ")}`);
  await db.userAccessScope.deleteMany({});
  await ensureLabRegistry(["GIA", "IGI"]);
  root = await makeUser("smc.root", "SUPER_ADMIN");
  admin = await makeUser("smc.admin", "ADMIN");
  planner = await makeUser("smc.planner", "PLANNER");
  reader = await userWith("reader", ["sarin.mapping.read"]);
  manager = await userWith("manager", ["sarin.mapping.read", "sarin.mapping.manage"]);
  managerB = await userWith("managerb", ["sarin.mapping.read", "sarin.mapping.manage"]);
  scoped = await userWith("scoped", ["sarin.mapping.read"]);
  await db.userAccessScope.create({ data: { userId: scoped.user.id, dimension: "LAB", value: "GIA" } });
});
beforeEach(async () => {
  resetRateLimits();
  await applyCatalog(manager.cookie, BASE_RULES);
});

describe("sarin mapping catalog: saving", () => {
  test("Add Mapping is effective at once as a new snapshot; nobody approves it", async () => {
    const before = await effectiveSnapshotId();
    const r = await save(manager, { sarinShape: "Oval Brilliant", fantasyShape: "Oval", note: "From the client sheet" });
    expect([r.status, r.json]).toEqual([200, { changed: true, message: "Mapping saved" }]);
    const now = await db.sarinShapeMappingSet.findFirstOrThrow({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" } });
    expect([now.id === before, now.copiedFromSetId, now.approvedByUserId, now.approvedAt, now.effectiveAt !== null, now.contentHash !== null]).toEqual([false, before, null, null, true, true]);
    const m = await mappingOf("Oval Brilliant");
    expect([m.fantasyShape, m.applyTo, m.minimumRatio, m.maximumRatio, m.note, m.updatedBy]).toEqual(["Oval", "ALL_RATIOS", null, null, "From the client sheet", "manager"]);
    const batchId = await upload(stone("OVAL BRILLIANT"));
    expect(await validate(batchId)).toBe("VALIDATED");
  });

  test("every refused save names the problem and changes nothing", async () => {
    const before = [await effectiveSnapshotId(), await snapshots()];
    const cases: Array<[Record<string, unknown>, number, string, string | null]> = [
      [{ sarinShape: "HEXA", fantasyShape: "" }, 400, "Choose a valid Fantasy shape", "fantasyShape"],
      [{ sarinShape: "HEXA", fantasyShape: "Hexagon" }, 400, "Choose a valid Fantasy shape", "fantasyShape"],
      [{ sarinShape: "HEXA", fantasyShape: "round" }, 400, "Choose a valid Fantasy shape", "fantasyShape"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE", minimumRatio: "abc" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE", minimumRatio: "1.2345" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE", minimumRatio: "-1" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE", minimumRatio: "1000" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE", minimumRatio: "1.500", maximumRatio: "1.200" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "RATIO_RANGE" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", minimumRatio: "1.000" }, 400, "Enter a valid ratio range", "ratio"],
      [{ sarinShape: "round", fantasyShape: "Oval" }, 409, "This shape is already mapped", "sarinShape"],
      [{ sarinShape: " Round ", fantasyShape: "Old European Brilliant" }, 409, "This shape is already mapped", "sarinShape"],
      [{ sarinShape: "EMERALD 5STEP", fantasyShape: "Emerald", applyTo: "RATIO_RANGE", minimumRatio: "1.020", maximumRatio: "1.100" }, 409, "This ratio overlaps another mapping", "ratio"],
      [{ sarinShape: "EMERALD 5STEP", fantasyShape: "Emerald", applyTo: "RATIO_RANGE", minimumRatio: "1.500" }, 409, "This ratio overlaps another mapping", "ratio"],
      [{ sarinShape: "EMERALD 5STEP", fantasyShape: "Emerald" }, 409, "This shape is already mapped", "sarinShape"],
      [{ sarinShape: "HEXA‮", fantasyShape: "Kite" }, 400, "Remove invisible or special characters", null],
      [{ sarinShape: "HEXA", fantasyShape: "Kite", note: "bad\u0000note" }, 400, "Remove invisible or special characters", null],
      [{ sarinShape: "   ", fantasyShape: "Kite" }, 400, "Enter a Sarin shape", "sarinShape"],
    ];
    for (const [body, status, message, field] of cases) {
      const r = await save(manager, body);
      expect([JSON.stringify(body), r.status, r.json.error.message, r.json.error.details?.field ?? null]).toEqual([JSON.stringify(body), status, message, field]);
      expect(/SELECT|prisma|at .*\.ts|23P01|23505/i.test(JSON.stringify(r.json))).toBe(false);
    }
    for (const body of [{ sarinShape: "HEXA", fantasyShape: "Kite", status: "EFFECTIVE" }, { sarinShape: "HEXA", fantasyShape: "Kite", mappingSetId: "x" }, { sarinShape: "H".repeat(257), fantasyShape: "Kite" }, { sarinShape: "HEXA", fantasyShape: "Kite", applyTo: "SOMETIMES" }]) {
      expect([JSON.stringify(body).slice(0, 60), (await save(manager, body)).status]).toEqual([JSON.stringify(body).slice(0, 60), 400]);
    }
    expect([await effectiveSnapshotId(), await snapshots()]).toEqual(before);
  });

  test("an adjacent ratio range and an open-ended range are accepted", async () => {
    expect((await save(manager, { sarinShape: "EMERALD 5STEP", fantasyShape: "Emerald", applyTo: "RATIO_RANGE", minimumRatio: "1.031", maximumRatio: "1.399" })).status).toBe(200);
    const ranges = (await catalog()).mappings.filter((m: any) => m.sarinShape === "EMERALD 5STEP").map((m: any) => [m.minimumRatio, m.maximumRatio]);
    expect(ranges).toEqual([["1.000", "1.030"], ["1.031", "1.399"], ["1.400", null]]);
  });

  test("saving a mapping exactly as it is changes nothing and writes no audit", async () => {
    const before = [await effectiveSnapshotId(), await snapshots(), await db.auditLog.count({ where: { action: "SARIN_MAPPING_SAVED" } })];
    const same = await save(manager, { sarinShape: "ROUND", fantasyShape: "Round" });
    const round = await mappingOf("ROUND");
    const sameEdit = await save(manager, { ruleId: round.id, sarinShape: "ROUND", fantasyShape: "Round" });
    expect([same.status, same.json.changed, sameEdit.status, sameEdit.json.changed]).toEqual([200, false, 200, false]);
    expect([await effectiveSnapshotId(), await snapshots(), await db.auditLog.count({ where: { action: "SARIN_MAPPING_SAVED" } })]).toEqual(before);
  });

  test("Edit replaces one mapping; its ratio range can change without overlapping itself", async () => {
    const asscher = (await catalog()).mappings.find((m: any) => m.fantasyShape === "Asscher");
    const r = await save(managerB, { ruleId: asscher.id, sarinShape: "EMERALD 5STEP", fantasyShape: "Asscher", applyTo: "RATIO_RANGE", minimumRatio: "0.990", maximumRatio: "1.050" });
    expect(r.status).toBe(200);
    const now = (await catalog()).mappings.filter((m: any) => m.sarinShape === "EMERALD 5STEP");
    expect(now.map((m: any) => [m.fantasyShape, m.minimumRatio, m.maximumRatio])).toEqual([["Asscher", "0.990", "1.050"], ["Emerald", "1.400", null]]);
    expect(now.map((m: any) => m.updatedBy === "managerb")).toEqual([true, false]);
    const moved = (await catalog()).mappings.find((m: any) => m.fantasyShape === "Asscher");
    expect((await save(manager, { ruleId: moved.id, sarinShape: "EMERALD 5STEP", fantasyShape: "Asscher", applyTo: "RATIO_RANGE", minimumRatio: "1.000", maximumRatio: "1.500" })).json.error.message).toBe("This ratio overlaps another mapping");
  });

  test("an edit that names a mapping from an earlier snapshot still reaches it; a removed one is reported", async () => {
    const stale = await mappingOf("PEAR");
    expect((await save(manager, { sarinShape: "HEART SHAPE", fantasyShape: "Heart" })).status).toBe(200);
    expect((await save(manager, { ruleId: stale.id, sarinShape: "PEAR", fantasyShape: "Pear", note: "checked" })).status).toBe(200);
    expect((await mappingOf("PEAR")).note).toBe("checked");
    const gone = await mappingOf("PEAR");
    expect((await remove(manager, gone.id)).status).toBe(200);
    const r = await save(manager, { ruleId: gone.id, sarinShape: "PEAR", fantasyShape: "Pear" });
    expect([r.status, r.json.error.message]).toEqual([404, "This mapping no longer exists. Reload the page."]);
  });
});

describe("sarin mapping catalog: removal", () => {
  test("Remove takes the mapping out as a new snapshot, audited; the replaced snapshot keeps it", async () => {
    const before = (await effectiveSnapshotId())!;
    const pear = await mappingOf("PEAR");
    const r = await remove(manager, pear.id);
    expect([r.status, r.json]).toEqual([200, { removed: true, message: "Mapping removed" }]);
    expect(await mappingOf("PEAR")).toBe(undefined);
    const after = (await effectiveSnapshotId())!;
    expect(await db.sarinShapeMappingRule.count({ where: { mappingSetId: before, rawShapeKey: "PEAR" } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "SARIN_MAPPING_REMOVED", entityId: after } });
    expect([audit.actorUserId, JSON.parse(audit.before!).sarinShape]).toEqual([manager.user.id, "PEAR"]);
    const pearFile = await upload(stone("PEAR"));
    expect(await validate(pearFile)).toBe("VALIDATED");
    expect(await db.sarinValidationIssue.count({ where: { batchId: pearFile, code: "SHAPE_NOT_MAPPED", blocking: false } })).toBe(17);
    expect((await remove(manager, pear.id)).status).toBe(404);
    expect(await effectiveSnapshotId()).toBe(after);
  });

  test("two concurrent removals of the same mapping remove it once", async () => {
    const pear = await mappingOf("PEAR");
    const before = await snapshots();
    resetRateLimits();
    const results = await Promise.all([manager, managerB].map((u) => call(removeMapping, { method: "DELETE", cookie: u.cookie, params: { ruleId: pear.id } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await snapshots()).toBe(before + 1);
  });
});

describe("sarin mapping catalog: concurrency, rollback and history", () => {
  test("concurrent saves of different shapes both apply, one after the other", async () => {
    const before = await snapshots();
    resetRateLimits();
    const results = await Promise.all([
      call(saveMapping, { method: "POST", cookie: manager.cookie, body: { sarinShape: "MARQ", fantasyShape: "Marquise", applyTo: "ALL_RATIOS" } }),
      call(saveMapping, { method: "POST", cookie: managerB.cookie, body: { sarinShape: "PRINCESS CUT", fantasyShape: "Princess", applyTo: "ALL_RATIOS" } }),
      call(saveMapping, { method: "POST", cookie: manager.cookie, body: { sarinShape: "KITE CUT", fantasyShape: "Kite", applyTo: "ALL_RATIOS" } }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const shapes = (await catalog()).mappings.map((m: any) => m.sarinShape);
    expect(["MARQ", "PRINCESS CUT", "KITE CUT", "ROUND", "PEAR"].every((s) => shapes.includes(s))).toBe(true);
    expect([await snapshots(), await db.sarinShapeMappingSet.count({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" } })]).toEqual([before + 3, 1]);
    const chain = await db.sarinShapeMappingSet.findMany({ where: { sourceSystem: "SARIN" }, orderBy: { version: "desc" }, take: 4, select: { id: true, copiedFromSetId: true, supersededBySetId: true } });
    for (let i = 0; i < 3; i++) expect([chain[i].copiedFromSetId, chain[i + 1].supersededBySetId]).toEqual([chain[i + 1].id, chain[i].id]);
  });

  test("identical saves at the same moment apply once", async () => {
    const before = await snapshots();
    resetRateLimits();
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => call(saveMapping, { method: "POST", cookie: (i % 2 ? managerB : manager).cookie, body: { sarinShape: "CUSHION MOD", fantasyShape: "Cushion Modified", applyTo: "ALL_RATIOS" } })));
    expect(results.map((r) => [r.status, r.json.message])).toEqual(Array(4).fill([200, "Mapping saved"]));
    expect(results.filter((r) => r.json.changed).length).toBe(1);
    expect(await snapshots()).toBe(before + 1);
  });

  test("a failure inside the save leaves the effective catalog, its rules and the audit trail unchanged", async () => {
    const before = [await effectiveSnapshotId(), await snapshots(), await db.sarinShapeMappingRule.count(), await db.auditLog.count({ where: { action: "SARIN_MAPPING_SAVED" } })];
    await withAuditFailure("SARIN_MAPPING_SAVED", async () => {
      const r = await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" });
      expect([r.status, /sectest|SELECT|prisma/i.test(JSON.stringify(r.json))]).toEqual([500, false]);
    });
    expect([await effectiveSnapshotId(), await snapshots(), await db.sarinShapeMappingRule.count(), await db.auditLog.count({ where: { action: "SARIN_MAPPING_SAVED" } })]).toEqual(before);
    expect(await mappingOf("HEXA")).toBe(undefined);
    expect((await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" })).status).toBe(200);
  });

  test("a removal that fails part-way leaves the mapping in effect", async () => {
    const pear = await mappingOf("PEAR");
    const before = await effectiveSnapshotId();
    await withAuditFailure("SARIN_MAPPING_REMOVED", async () => {
      expect((await remove(manager, pear.id)).status).toBe(500);
    });
    expect([await effectiveSnapshotId(), !!(await mappingOf("PEAR"))]).toEqual([before, true]);
  });

  test("snapshots are permanent history: frozen, never deleted, only ever replaced by their successor", async () => {
    const first = (await effectiveSnapshotId())!;
    expect((await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" })).status).toBe(200);
    const rule = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: first } });
    await expect(db.sarinShapeMappingRule.update({ where: { id: rule.id }, data: { normalizedShape: "Oval" } })).rejects.toThrow(/Rules of a SUPERSEDED/);
    await expect(db.sarinShapeMappingRule.delete({ where: { id: rule.id } })).rejects.toThrow();
    await expect(db.sarinShapeMappingSet.delete({ where: { id: first } })).rejects.toThrow(/permanent history/);
    await expect(db.sarinShapeMappingSet.update({ where: { id: first }, data: { status: "EFFECTIVE" } })).rejects.toThrow(/cannot move from SUPERSEDED to EFFECTIVE/);
  });

  test("a file checked before a change keeps its snapshot; Process Again uses the new one", async () => {
    const batchId = await upload(stone("HEXA"));
    expect(await validate(batchId)).toBe("VALIDATED");
    const firstSet = (await effectiveSnapshotId())!;
    expect((await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" })).status).toBe(200);
    expect(await validate(batchId)).toBe("VALIDATED");
    const attempts = await db.sarinValidationAttempt.findMany({ where: { batchId }, orderBy: { attemptNumber: "asc" }, select: { shapeMappingSetId: true } });
    expect(attempts.map((a) => a.shapeMappingSetId)).toEqual([firstSet, await effectiveSnapshotId()]);
    const interps = await db.sarinRowInterpretation.findMany({ where: { batchId }, select: { validationAttempt: true, normalizedShape: true }, distinct: ["validationAttempt"], orderBy: { validationAttempt: "asc" } });
    expect(interps.map((i) => [i.validationAttempt, i.normalizedShape])).toEqual([[1, null], [2, "Kite"]]);
  });
});

describe("sarin mapping catalog: authority", () => {
  test("read needs sarin.mapping.read; add, edit and remove need sarin.mapping.manage", async () => {
    expect((await get(undefined)).status).toBe(401);
    expect((await save(undefined, { sarinShape: "HEXA", fantasyShape: "Kite" })).status).toBe(401);
    for (const u of [admin, planner]) expect([u.user.username, (await get(u)).status]).toEqual([u.user.username, 403]);
    for (const u of [admin, planner, reader, scoped]) {
      expect([u.user.username, (await save(u, { sarinShape: "HEXA", fantasyShape: "Kite" })).status]).toEqual([u.user.username, 403]);
    }
    const pear = await mappingOf("PEAR");
    for (const u of [admin, planner, reader]) expect([u.user.username, (await remove(u, pear.id)).status]).toEqual([u.user.username, 403]);
    expect([(await get(reader)).status, (await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" })).status]).toEqual([200, 200]);
    expect([(await get(root)).status, (await save(root, { sarinShape: "HEXA 2", fantasyShape: "Kite" })).status]).toEqual([200, 200]);
  });

  test("mapping approval is withdrawn: not a permission, not grantable, held by no role", async () => {
    expect((PERMISSIONS as readonly string[]).includes("sarin.mapping.approve")).toBe(false);
    for (const role of TEST_ROLES) expect([role, testPermissionsFor(role).includes("sarin.mapping.approve" as never)]).toEqual([role, false]);
    resetRateLimits();
    const r = await call(rolesPost, { method: "POST", cookie: root.cookie, body: { op: "createRole", code: `SMC_APPROVE_${Date.now().toString(36).toUpperCase()}`, name: "Approver", permissions: ["sarin.mapping.approve"] } });
    expect(r.status).toBe(400);
    expect(await db.rolePermission.count({ where: { permissionCode: "sarin.mapping.approve" } })).toBe(0);
  });

  test("identity comes from the session: a body naming another user is refused", async () => {
    const r = await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite", changedByUserId: root.user.id });
    expect(r.status).toBe(400);
    expect((await save(manager, { sarinShape: "HEXA", fantasyShape: "Kite" })).status).toBe(200);
    const saved = await db.sarinShapeMappingRule.findFirstOrThrow({ where: { mappingSetId: (await effectiveSnapshotId())!, rawShapeKey: "HEXA" } });
    expect(saved.changedByUserId).toBe(manager.user.id);
  });

  test("Needs Mapping counts only files in the reader's scope", async () => {
    await upload(stone("SCOPE GIA"), "GIA");
    await upload(stone("SCOPE IGI"), "IGI");
    const all = (await catalog(reader)).needsMapping.map((s: any) => s.sarinShape);
    const giaOnly = (await catalog(scoped)).needsMapping.map((s: any) => s.sarinShape);
    expect([all.includes("SCOPE GIA"), all.includes("SCOPE IGI"), giaOnly.includes("SCOPE GIA"), giaOnly.includes("SCOPE IGI")]).toEqual([true, true, true, false]);
    const row = (await catalog(reader)).needsMapping.find((s: any) => s.sarinShape === "SCOPE GIA");
    expect([row.packetTypes, row.records, row.observedRatio]).toEqual([["BLUE"], 17, { lowest: "1.000", highest: "1.000" }]);
  });
});

describe("sarin mapping catalog: Pink stays blocked", () => {
  test("EMERALD 4STEP, RAD MODIFIED and NP-1235-6-KITE are listed to map, with no suggestion; the catalog holds none of them", async () => {
    await upload([{ name: `${kapan()}-001 DC`, shape: "EMERALD 4STEP" }, ...Array.from({ length: 16 }, () => ({ name: `${kapan()}-001 DC`, shape: "RAD MODIFIED" }))]);
    const page = await catalog(reader);
    const needing = page.needsMapping.map((s: any) => s.sarinShape);
    expect(["EMERALD 4STEP", "RAD MODIFIED"].every((s) => needing.includes(s))).toBe(true);
    expect(JSON.stringify(page.needsMapping).match(/suggest|Asscher|Emerald"|Radiant/i)).toBe(null);
    const inEffect = await db.sarinShapeMappingRule.count({ where: { mappingSetId: (await effectiveSnapshotId())!, rawShapeKey: { in: ["EMERALD 4STEP", "RAD MODIFIED", "NP-1235-6-KITE"] } } });
    expect(inEffect).toBe(0);
  });
});

describe("sarin mapping catalog: the page and navigation", () => {
  test("Administration shows one Mappings item; old links land on it", () => {
    const admin = NAV.flatMap((g: any) => g.items ?? []).filter((i: any) => /mapping|business rules/i.test(i.label));
    expect(admin.map((i: any) => [i.id, i.label])).toEqual([["admin-mappings", "Mappings"]]);
    expect([LEGACY_VIEW_ALIASES["admin-rules-mappings"], LEGACY_VIEW_ALIASES["admin-business-rules"], LEGACY_VIEW_ALIASES["admin-sarin-shape-mappings"]]).toEqual([
      { view: "admin-mappings", tab: null },
      { view: "admin-mappings", tab: null },
      { view: "admin-mappings", tab: "sarin-shape-mapping" },
    ]);
    for (const role of TEST_ROLES) {
      const perms = testPermissionsFor(role);
      expect([role, isViewAuthorized(perms, "admin-mappings")]).toEqual([role, perms.includes("config.read") || perms.includes("sarin.mapping.read")]);
    }
  });

  test("the Mappings page has exactly its five tabs and no Business Rules", async () => {
    const page = await render(MappingsView, {}, root);
    for (const tab of ["Weight Bands", "Lab Mapping", "Shape Mapping", "Status Mapping", "Sarin Shape Mapping"]) expect([tab, page.text.includes(tab)]).toEqual([tab, true]);
    expect(/Business Rules|Business Rule\b/.test(page.text)).toBe(false);
    const onlySarin = await render(MappingsView, {}, reader);
    expect([onlySarin.text.includes("Current mappings"), (onlySarin.html.match(/role="tab"/g) ?? []).length, onlySarin.text.includes("Weight Bands")]).toEqual([true, 0, false]);
  });

  test("the Sarin Shape Mapping page offers editing to managers only, with no workflow vocabulary", async () => {
    await upload(stone("MYSTERY CUT"));
    const asManager = await render(SarinShapeMappingsView, {}, manager);
    const asReader = await render(SarinShapeMappingsView, {}, reader);
    for (const page of [asManager.text, asReader.text]) {
      for (const label of ["Sarin Shape Mapping", "All", "Needs Mapping", "These shapes do not have a mapping yet.", "Current mappings", "Sarin shape", "Fantasy shape", "Applies to", "Updated", "MYSTERY CUT", "Observed ratio"]) {
        expect([label, page.includes(label)]).toEqual([label, true]);
      }
    }
    expect(asManager.html.includes('aria-label="Show"')).toBe(true);
    expect([asManager.text.includes("Add Mapping"), asManager.html.includes('aria-label="Map MYSTERY CUT"'), asManager.html.includes('aria-label="Edit mapping for ROUND, All ratios"')]).toEqual([true, true, true]);
    expect([asReader.text.includes("Add Mapping"), asReader.html.includes('aria-label="Map '), asReader.html.includes("Edit mapping for")]).toEqual([false, false, false]);
    expect(/version|draft|approv|review|coverage|dry run|clone|lifecycle|retire|effective|snapshot|rule id|\{"/i.test(asManager.text + asReader.text)).toBe(false);
  });
});
