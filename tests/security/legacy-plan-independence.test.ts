// Legacy plans do not change demand. The retired planning seed wrote fabricated plan coverage
// into requirement rows (a lower stored remaining need and a plan-derived status) and created
// approved plan cases, options and pieces. None of it may reduce a requirement's need, reorder
// the Priority Queue, feed a dashboard figure or appear as planned coverage. Every check goes
// through the real route handler in the isolated planning_sectest database.

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as listRequirements } from "@/app/api/requirements/route";
import { GET as requirementDetail } from "@/app/api/requirements/[id]/route";
import { GET as dashboard } from "@/app/api/dashboard/route";
import { PLAN_COVERAGE } from "@/lib/demand/plan-coverage";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
let seededId = "";
let plainId = "";

// Factual quantities: 10 required, 2 available, 1 in eligible WIP, so 7 are still needed.
const FACTS = { requiredQty: 10, planningAvailableQty: 2, wipCoverage: 1 };
const base = { type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "SRT", labNormalized: "GIA", shape: "ROUND", requirementPriority: "CRITICAL" };

beforeAll(async () => {
  await resetDb();
  await db.requirement.deleteMany({});
  root = await makeUser("legacy.root", "SUPER_ADMIN");
  // A requirement as the legacy seed left it: coverage from an "approved plan" hides the need.
  seededId = (await db.requirement.create({
    data: { ...base, ...FACTS, requirementCode: "REQ-LEGACY-SEEDED", status: "FULLY_PLANNED", approvedPlanCoverage: 7, remainingUnplanned: 0 },
  })).id;
  // The same facts without the fabricated coverage.
  plainId = (await db.requirement.create({ data: { ...base, ...FACTS, requirementCode: "REQ-LEGACY-PLAIN", status: "ACTIVE", remainingUnplanned: 7 } })).id;
  // An approved, selected legacy plan case with pieces, as the seed created.
  const c = await makeCase({ status: "APPROVED" });
  await db.planOption.update({ where: { id: c.optionIds[0] }, data: { selected: true, approvalStatus: "APPROVED", certificationIntent: "GIA" } });
  await db.planOptionPiece.create({ data: { pieceCode: `PC-LEGACY-${Date.now()}`, planOptionId: c.optionIds[0], sequence: 1, expectedShape: "ROUND", expectedWeight: 1.05, certificationIntent: "GIA" } });
});

const get = async (handler: Parameters<typeof call>[0], path: string, params?: Record<string, string>) => {
  resetRateLimits();
  return call(handler, { cookie: root.cookie, path, params });
};

describe("requirements: remaining need comes from facts only", () => {
  test("stored legacy plan coverage does not reduce a requirement's remaining need", async () => {
    const res = await get(listRequirements, "/api/requirements?pageSize=50");
    expect(res.status).toBe(200);
    const rows = res.json.data as Array<{ id: string; status: string; remainingUnplanned: number; approvedPlanCoverage?: unknown }>;
    const seeded = rows.find((r) => r.id === seededId)!;
    const plain = rows.find((r) => r.id === plainId)!;
    expect([seeded.remainingUnplanned, plain.remainingUnplanned]).toEqual([7, 7]);
    expect([seeded.status, "approvedPlanCoverage" in seeded]).toEqual(["ACTIVE", false]);
    expect(res.json.planCoverage).toEqual(PLAN_COVERAGE);
  });

  test("the detail view reports planned coverage as unavailable, never as a number", async () => {
    const res = await get(requirementDetail, `/api/requirements/${seededId}`, { id: seededId });
    expect(res.status).toBe(200);
    expect([res.json.remainingUnplanned, res.json.planCoverage.status, res.json.fourNumbers.planningAdjusted]).toEqual([7, "UNAVAILABLE", null]);
    expect(JSON.stringify(res.json)).not.toMatch(/approvedPlanCoverage|allocations/);
  });

  test("plan-derived statuses cannot be filtered on; ACTIVE includes the rows that held them", async () => {
    for (const status of ["FULLY_PLANNED", "PARTIALLY_COVERED"]) expect([status, (await get(listRequirements, `/api/requirements?status=${status}`)).status]).toEqual([status, 400]);
    const active = (await get(listRequirements, "/api/requirements?status=ACTIVE")).json.data as Array<{ id: string }>;
    expect([active.some((r) => r.id === seededId), active.some((r) => r.id === plainId)]).toEqual([true, true]);
  });

  test("the Priority Queue's source lists both requirements with the same need", async () => {
    const critical = (await get(listRequirements, "/api/requirements?pageSize=500&priority=CRITICAL")).json.data as Array<{ id: string; remainingUnplanned: number }>;
    const need = critical.filter((r) => r.remainingUnplanned > 0).map((r) => [r.id, r.remainingUnplanned]);
    expect(need.sort()).toEqual([[plainId, 7], [seededId, 7]].sort());
  });
});

describe("dashboard: no seeded planning figures", () => {
  test("no plan-coverage, rough or planning-case figure is reported", async () => {
    const res = await get(dashboard, "/api/dashboard");
    expect(res.status).toBe(200);
    for (const key of ["approvedPlanCoverage", "remainingUnplanned", "roughAvailable", "roughReserved", "approvedPlanPieces", "planningCases", "pendingApprovals"]) {
      expect([key, key in res.json]).toEqual([key, false]);
    }
  });

  test("critical requirements count the need the legacy coverage hid", async () => {
    const res = await get(dashboard, "/api/dashboard");
    expect(res.json.criticalRequirements).toBe(2);
  });
});

describe("the demand path does not read the legacy plan hierarchy (static)", () => {
  test("demand, requirement and dashboard sources never query cases, options, pieces, reservations or rough stock", () => {
    const files = [
      "src/lib/demand/demand-service.ts",
      "src/lib/demand/wip-classification.ts",
      "src/app/api/analysis/demand-trace/route.ts",
      "src/app/api/demand/history/route.ts",
      "src/app/api/requirements/route.ts",
      "src/app/api/requirements/[id]/route.ts",
      "src/app/api/dashboard/route.ts",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect([file, /\b(planningCase|planVersion|planOption|planOptionPiece|roughReservation|roughStone|requirementAllocation)\b|approvedPlanCoverage:\s*r\./.test(text)]).toEqual([file, false]);
    }
  });
});
