// Database guarantees that protect retained history. The legacy reserve, replan, approve and
// allocate routes whose races these tables once refereed are retired (retired-features.test.ts),
// but the tables and their rows remain, and so must the constraints that keep them consistent.
import { beforeAll, describe, expect, test } from "./harness";
import { db, makeCase, makeRough, resetDb } from "./helpers";

beforeAll(async () => {
  await resetDb();
});

describe("retained history constraints", () => {
  test("the database refuses a second active reservation of one rough stone", async () => {
    const rough = await makeRough();
    await db.roughReservation.create({ data: { roughId: rough.id, status: "RESERVED", reservedBy: "a", activeRoughKey: rough.id } });
    const second = (async () => { await db.roughReservation.create({ data: { roughId: rough.id, status: "RESERVED", reservedBy: "b", activeRoughKey: rough.id } }); })();
    await expect(second).rejects.toThrow();
    expect(await db.roughReservation.count({ where: { roughId: rough.id } })).toBe(1);
  });

  test("the database refuses a duplicate (case, versionNumber)", async () => {
    const c = await makeCase();
    const dup = (async () => { await db.planVersion.create({ data: { planningCaseId: c.caseId, versionNumber: 1, createdBy: "x" } }); })();
    await expect(dup).rejects.toThrow();
    expect(await db.planVersion.count({ where: { planningCaseId: c.caseId } })).toBe(1);
  });

  test("history cannot be removed from under a case: deleting a case with versions is refused", async () => {
    const c = await makeCase();
    const del = (async () => { await db.planningCase.delete({ where: { id: c.caseId } }); })();
    await expect(del).rejects.toThrow();
    expect(await db.planningCase.count({ where: { id: c.caseId } })).toBe(1);
  });
});
