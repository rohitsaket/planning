import { readFileSync } from "node:fs";
import type { ComponentType } from "react";
import { afterAll, beforeAll, describe, expect, test } from "./harness";
import { call, db, makeUser } from "./helpers";
import { renderPage, sessionUser } from "./ui-render";
import { resetRateLimits } from "@/lib/api/rate-limit";
import { GET as customers } from "@/app/api/analysis/customers/route";
import { GET as timeline } from "@/app/api/analysis/customers/[id]/timeline/route";
import { CustomersView } from "@/components/diamond/views/customers-view";

type User = Awaited<ReturnType<typeof makeUser>>;
const STAMP = Date.now().toString(36).toUpperCase();
const [HOME, AWAY] = ["QC", "QD"];
let reader: User, homeOnly: User, noCustomers: User;
const ids: Record<string, string> = {};

const get = async (u: User | null, path: string, params?: Record<string, string>) => {
  resetRateLimits();
  return call(path.includes("/timeline") ? timeline : customers, { path, ...(u ? { cookie: u.cookie } : {}), ...(params ? { params } : {}) });
};
const orderCounts = async () => [await db.salesOrder.count(), await db.salesOrderLine.count()];

beforeAll(async () => {
  reader = await makeUser(`c360.reader.${STAMP}`, "DATA_ANALYST");
  homeOnly = await makeUser(`c360.home.${STAMP}`, "DATA_ANALYST");
  noCustomers = await makeUser(`c360.planner.${STAMP}`, "PLANNER");
  await db.userAccessScope.deleteMany({ where: { userId: homeOnly.user.id } });
  await db.userAccessScope.create({ data: { userId: homeOnly.user.id, dimension: "COUNTRY", value: HOME, reason: "test fixture" } });
  for (const country of [HOME, AWAY]) {
    const c = await db.customer.create({ data: { customerCode: `C360-${country}-${STAMP}`, name: `C360 Customer ${country}`, country, branch: `${country}-1` } });
    ids[country] = c.id;
    const order = await db.salesOrder.create({ data: { orderNumber: `SO-C360-${country}-${STAMP}`, customerId: c.id, country, branch: `${country}-1`, status: "OPEN", orderDate: new Date() } });
    await db.salesOrderLine.create({ data: { orderId: order.id, lineNo: 1, shape: "ROUND", qtyOrdered: 3, qtyOutstanding: 3, backorderQty: 1 } });
  }
});

describe("Customer 360: no order figure", () => {
  test("the API returns no open-order field in its rows or summary, and reads no order row doing so", async () => {
    const before = await orderCounts();
    const res = await get(reader, `/api/analysis/customers?country=${HOME}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.summary).sort()).toEqual(["carats", "customers", "memoExposure", "pieces", "totalValue"]);
    const row = (res.json.rows as Array<Record<string, unknown>>).find((r) => r.id === ids[HOME])!;
    expect(Object.keys(row).sort()).toEqual(["accountOwner", "avgPerCt", "branch", "businessPriority", "carats", "country", "customerCode", "id", "lastPurchase", "memoExposure", "name", "pieces", "priorityReason", "totalValue"]);
    expect(/order/i.test(JSON.stringify(res.json))).toBe(false);
    expect(await orderCounts()).toEqual(before);
    expect(await db.salesOrder.count({ where: { orderNumber: { startsWith: "SO-C360-" }, customerId: { in: Object.values(ids) } } })).toBe(2);
  });

  test("the route and page source no longer query or present seeded orders (static)", () => {
    const route = readFileSync("src/app/api/analysis/customers/route.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(/SalesOrder|salesOrder|open_orders|openOrders/.test(route)).toBe(false);
    const view = readFileSync("src/components/diamond/views/customers-view.tsx", "utf8");
    expect(/openOrders|Open Orders|open orders/i.test(view)).toBe(false);
  });

  test("the rendered page, its table columns and so its CSV and Excel exports carry no Open Orders", async () => {
    const page = await renderPage(CustomersView as ComponentType<object>, {}, await sessionUser(reader.cookie), reader.cookie);
    expect(page.requested.every((u) => u.startsWith("/api/analysis/customers?"))).toBe(true);
    expect([page.text.includes("Customer 360"), page.text.includes("Memo Exposure")]).toEqual([true, true]);
    expect(/Open Orders|open orders|Backorder/i.test(page.text)).toBe(false);
  });
});

describe("Customer 360: access and scope are unchanged", () => {
  test("anonymous is 401 and a role without customers.read is 403", async () => {
    expect((await get(null, "/api/analysis/customers")).status).toBe(401);
    expect((await get(noCustomers, "/api/analysis/customers")).status).toBe(403);
    expect((await get(noCustomers, `/api/analysis/customers/${ids[HOME]}/timeline`, { id: ids[HOME] })).status).toBe(403);
  });

  test("a country-restricted reader lists only their country's customers and cannot filter to another", async () => {
    const res = await get(homeOnly, "/api/analysis/customers?pageSize=500");
    const countries = new Set((res.json.rows as Array<{ country: string }>).map((r) => r.country));
    expect([res.status, [...countries]]).toEqual([200, [HOME]]);
    expect(res.json.summary.customers).toBe(await db.customer.count({ where: { country: HOME } }));
    expect((await get(homeOnly, `/api/analysis/customers?country=${AWAY}`)).status).toBe(403);
    expect((await get(homeOnly, "/api/analysis/customers?orders=1")).status).toBe(400);
  });

  test("a customer outside the caller's countries is answered exactly as a missing one; their own is readable", async () => {
    const own = await get(homeOnly, `/api/analysis/customers/${ids[HOME]}/timeline`, { id: ids[HOME] });
    expect([own.status, own.json.customerCode]).toEqual([200, `C360-${HOME}-${STAMP}`]);
    const other = await get(homeOnly, `/api/analysis/customers/${ids[AWAY]}/timeline`, { id: ids[AWAY] });
    const missing = await get(homeOnly, "/api/analysis/customers/nonexistent-customer/timeline", { id: "nonexistent-customer" });
    expect([other.status, missing.status]).toEqual([404, 404]);
    expect([other.json.error.code, other.json.error.message]).toEqual([missing.json.error.code, missing.json.error.message]);
    expect(JSON.stringify(other.json).includes("C360")).toBe(false);
    expect((await get(reader, `/api/analysis/customers/${ids[AWAY]}/timeline`, { id: ids[AWAY] })).status).toBe(200);
  });

  afterAll(async () => {
    const orders = await db.salesOrder.findMany({ where: { customerId: { in: Object.values(ids) } }, select: { id: true } });
    await db.salesOrderLine.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await db.salesOrder.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    await db.customer.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });
});
