import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "./harness";
import { call, db, makeCase, makeUser, resetDb } from "./helpers";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as dashboard } from "@/app/api/dashboard/route";

type User = Awaited<ReturnType<typeof makeUser>>;
let root: User;
let indiaOnly: User;
const STAMP = Date.now().toString(36).toUpperCase();

beforeAll(async () => {
  await resetDb();
  root = await makeUser("legacy.root", "SUPER_ADMIN");
  indiaOnly = await makeUser("legacy.india", "ANALYSIS_MANAGER");
  await db.userAccessScope.deleteMany({ where: { userId: indiaOnly.user.id } });
  await db.userAccessScope.create({ data: { userId: indiaOnly.user.id, dimension: "COUNTRY", value: "IN", reason: "test fixture" } });

  await db.requirement.create({
    data: { requirementCode: `REQ-LEGACY-${STAMP}`, type: "STOCK_REPLENISHMENT", groupCode: "G", companyCode: "C", country: "IN", branch: "SRT", labNormalized: "GIA", shape: "ROUND", requirementPriority: "CRITICAL", requiredQty: 10, planningAvailableQty: 2, wipCoverage: 1, status: "FULLY_PLANNED", approvedPlanCoverage: 7, daysOverdue: 5 },
  });
  const customer = await db.customer.create({ data: { customerCode: `CUST-LEGACY-${STAMP}`, name: "Legacy Customer", country: "IN", branch: "SRT" } });
  const order = await db.salesOrder.create({ data: { orderNumber: `SO-LEGACY-${STAMP}`, customerId: customer.id, country: "IN", branch: "SRT", status: "OPEN", orderDate: new Date() } });
  await db.salesOrderLine.create({ data: { orderId: order.id, lineNo: 1, shape: "ROUND", qtyOrdered: 4, qtyOutstanding: 4, backorderQty: 4 } });
  const c = await makeCase({ status: "APPROVED" });
  await db.planOption.update({ where: { id: c.optionIds[0] }, data: { selected: true, approvalStatus: "APPROVED", certificationIntent: "GIA" } });

  await db.polishedStone.createMany({
    data: [
      ...[0, 1].map((i) => ({ fantasyLotId: `LEG-IN-${STAMP}-${i}`, fantasyStatus: "STOCK", shape: "ROUND", weight: 1.05, country: "IN", branch: "SRT", labNormalized: "GIA" })),
      ...[0, 1, 2].map((i) => ({ fantasyLotId: `LEG-HK-${STAMP}-${i}`, fantasyStatus: "STOCK", shape: "ROUND", weight: 1.05, country: "HK", branch: "HKG", labNormalized: "GIA" })),
    ],
  });
});

const get = async (u: User, path: string) => {
  resetRateLimits();
  return call(dashboard, { cookie: u.cookie, path });
};

describe("dashboard: no seeded planning, requirement or order figures", () => {
  test("no plan-coverage, rough, planning-case, requirement, priority or order figure is reported", async () => {
    const res = await get(root, "/api/dashboard");
    expect(res.status).toBe(200);
    for (const key of [
      "approvedPlanCoverage", "remainingUnplanned", "roughAvailable", "roughReserved", "approvedPlanPieces", "planningCases", "pendingApprovals",
      "criticalRequirements", "highRequirements", "overdueRequirements", "openOrders", "backorders",
    ]) {
      expect([key, key in res.json]).toEqual([key, false]);
    }
    expect(Object.keys(res.json).sort()).toEqual(["demandRunDate", "demandRunId", "fantasySyncHealth", "forecastRequirement", "memoExposure", "physicalShortage", "pipelineAdjusted", "polishedStock"]);
  });

  test("the dashboard route reads no requirement, allocation or order table (static)", () => {
    const code = readFileSync("src/app/api/dashboard/route.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(/\b(requirement|requirementAllocation|salesOrder|salesOrderLine)\s*\.|"(Requirement|SalesOrder|SalesOrderLine|RequirementAllocation)"/.test(code)).toBe(false);
  });
});

describe("dashboard: figures are narrowed to the caller's access scope", () => {
  test("a user restricted to one country counts only that country's polished stock, and a filter cannot widen it", async () => {
    const all = await get(root, "/api/dashboard");
    const scoped = await get(indiaOnly, "/api/dashboard");
    expect([all.status, scoped.status]).toEqual([200, 200]);
    expect(all.json.polishedStock).toBe(await db.polishedStone.count());
    expect(scoped.json.polishedStock).toBe(await db.polishedStone.count({ where: { country: "IN" } }));
    expect(scoped.json.polishedStock < all.json.polishedStock).toBe(true);
    const widened = await get(indiaOnly, "/api/dashboard?country=HK");
    expect([widened.status, "polishedStock" in (widened.json ?? {})]).toEqual([403, false]);
    expect((await get(root, "/api/dashboard?country=HK")).json.polishedStock).toBe(await db.polishedStone.count({ where: { country: "HK" } }));
  });
});

describe("the demand path does not read the legacy plan hierarchy (static)", () => {
  test("demand and dashboard sources never query cases, options, pieces, reservations or rough stock", () => {
    const files = [
      "src/lib/demand/demand-service.ts",
      "src/lib/demand/wip-classification.ts",
      "src/app/api/analysis/demand-trace/route.ts",
      "src/app/api/demand/history/route.ts",
      "src/app/api/dashboard/route.ts",
    ];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect([file, /\b(planningCase|planVersion|planOption|planOptionPiece|roughReservation|roughStone|requirementAllocation)\b|approvedPlanCoverage:\s*r\./.test(text)]).toEqual([file, false]);
    }
  });
});
