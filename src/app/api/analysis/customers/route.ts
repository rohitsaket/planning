import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qEnum, qInt } from "@/lib/api/with-api";
import { describeScope, scopePredicates } from "@/lib/auth/access-scope";

// Customer 360 list — sales, memo exposure and open orders per customer.
//
// Aggregation and ordering happen in PostgreSQL and the page is cut with
// LIMIT/OFFSET, so the browser never receives the whole customer book. Filters are
// applied before paging and the response carries a real total.

const SORTS = ["value", "pieces", "name", "recent"] as const;
type Sort = (typeof SORTS)[number];

const ORDER_BY: Record<Sort, Prisma.Sql> = {
  value: Prisma.sql`total_value DESC, c.name ASC`,
  pieces: Prisma.sql`pieces DESC, c.name ASC`,
  name: Prisma.sql`c.name ASC`,
  recent: Prisma.sql`last_purchase DESC NULLS LAST, c.name ASC`,
};

interface CustomerAggregateRow {
  id: string;
  customer_code: string;
  name: string;
  country: string;
  branch: string;
  account_owner: string | null;
  business_priority: string | null;
  priority_reason: string | null;
  pieces: number;
  carats: number;
  total_value: number;
  open_orders: number;
  memo_exposure: number;
  last_purchase: Date | null;
}

export const GET = withApi(
  { permission: "customers.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const search = qStr(url, "q", 100);
  const sort: Sort = qEnum(url, "sort", SORTS, "value");
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const since = new Date();
  since.setDate(since.getDate() - 365);

  // Customer-level filters (applied before paging).
  // The caller's scope is merged into every filter list below, so a request that carries
  // no country or lab of its own still returns only what this caller may see. A customer
  // record has no lab, so only the country half applies to the customer list itself.
  const customerFilters: Prisma.Sql[] = [...scopePredicates(scope, { country: 'c."country"', lab: null })];
  if (country) customerFilters.push(Prisma.sql`c.country = ${country}`);
  if (branch) customerFilters.push(Prisma.sql`c.branch = ${branch}`);
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    customerFilters.push(Prisma.sql`(c.name ILIKE ${like} OR c."customerCode" ILIKE ${like})`);
  }
  const customerWhere = customerFilters.length ? Prisma.sql`WHERE ${Prisma.join(customerFilters, " AND ")}` : Prisma.empty;

  // Sales scope: invoiced lots in the trailing 365 days, honouring the global filters.
  const salesFilters: Prisma.Sql[] = [
    Prisma.sql`s."lotStatusDb" = 'Invoice'`,
    Prisma.sql`s."docDate" >= ${since}`,
    ...scopePredicates(scope, { country: 's."country"', lab: 's."labNormalized"' }),
  ];
  if (country) salesFilters.push(Prisma.sql`s.country = ${country}`);
  if (branch) salesFilters.push(Prisma.sql`s.branch = ${branch}`);
  if (lab) salesFilters.push(Prisma.sql`s."labNormalized" = ${lab}`);
  const salesWhere = Prisma.join(salesFilters, " AND ");

  const memoFilters: Prisma.Sql[] = [
    Prisma.sql`m.status = 'OPEN'`,
    ...scopePredicates(scope, { country: 'm."country"', lab: 'm."labNormalized"' }),
  ];
  if (country) memoFilters.push(Prisma.sql`m.country = ${country}`);
  if (branch) memoFilters.push(Prisma.sql`m.branch = ${branch}`);
  const memoWhere = Prisma.join(memoFilters, " AND ");

  const orderFilters: Prisma.Sql[] = [
    Prisma.sql`o.status IN ('OPEN', 'PARTIAL')`,
    ...scopePredicates(scope, { country: 'o."country"', lab: null }),
  ];
  if (country) orderFilters.push(Prisma.sql`o.country = ${country}`);
  if (branch) orderFilters.push(Prisma.sql`o.branch = ${branch}`);
  const orderWhere = Prisma.join(orderFilters, " AND ");

  const [countRows, summaryRows, rows] = await Promise.all([
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total FROM "Customer" c ${customerWhere}
    `),
    // Totals across every matching customer, not only the visible page.
    db.$queryRaw<Array<{ pieces: number; carats: number; total_value: number; memo_exposure: number; open_orders: number }>>(Prisma.sql`
      SELECT COALESCE(SUM(sales.pieces), 0)::int AS pieces,
             COALESCE(SUM(sales.carats), 0)::float8 AS carats,
             COALESCE(SUM(sales.total_value), 0)::float8 AS total_value,
             COALESCE(SUM(memo.memo_exposure), 0)::float8 AS memo_exposure,
             COALESCE(SUM(orders.open_orders), 0)::int AS open_orders
      FROM "Customer" c
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS pieces, SUM(s.weight) AS carats, SUM(s."saleTotalUsd") AS total_value
        FROM "SalesRecord" s WHERE s."customerId" = c.id AND ${salesWhere}
      ) sales ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(m."memoValueUsd") AS memo_exposure
        FROM "MemoRecord" m WHERE m."customerId" = c.id AND ${memoWhere}
      ) memo ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS open_orders
        FROM "SalesOrder" o WHERE o."customerId" = c.id AND ${orderWhere}
      ) orders ON TRUE
      ${customerWhere}
    `),
    db.$queryRaw<CustomerAggregateRow[]>(Prisma.sql`
      SELECT c.id,
             c."customerCode" AS customer_code,
             c.name,
             c.country,
             c.branch,
             c."accountOwner" AS account_owner,
             c."businessPriority" AS business_priority,
             c."priorityReason" AS priority_reason,
             COALESCE(sales.pieces, 0)::int AS pieces,
             COALESCE(sales.carats, 0)::float8 AS carats,
             COALESCE(sales.total_value, 0)::float8 AS total_value,
             COALESCE(orders.open_orders, 0)::int AS open_orders,
             COALESCE(memo.memo_exposure, 0)::float8 AS memo_exposure,
             sales.last_purchase AS last_purchase
      FROM "Customer" c
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS pieces,
               SUM(s.weight) AS carats,
               SUM(s."saleTotalUsd") AS total_value,
               MAX(s."docDate") AS last_purchase
        FROM "SalesRecord" s
        WHERE s."customerId" = c.id AND ${salesWhere}
      ) sales ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(m."memoValueUsd") AS memo_exposure
        FROM "MemoRecord" m
        WHERE m."customerId" = c.id AND ${memoWhere}
      ) memo ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS open_orders
        FROM "SalesOrder" o
        WHERE o."customerId" = c.id AND ${orderWhere}
      ) orders ON TRUE
      ${customerWhere}
      ORDER BY ${ORDER_BY[sort]}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
  ]);

  const total = countRows[0]?.total ?? 0;
  const totals = summaryRows[0] ?? { pieces: 0, carats: 0, total_value: 0, memo_exposure: 0, open_orders: 0 };

  return ok({
    summary: {
      customers: total,
      pieces: totals.pieces,
      carats: num(totals.carats),
      totalValue: num(totals.total_value),
      memoExposure: num(totals.memo_exposure),
      openOrders: totals.open_orders,
    },
    rows: rows.map((r) => ({
      id: r.id,
      customerCode: r.customer_code,
      name: r.name,
      country: r.country,
      branch: r.branch,
      accountOwner: r.account_owner,
      businessPriority: r.business_priority,
      priorityReason: r.priority_reason,
      pieces: r.pieces,
      carats: num(r.carats),
      totalValue: num(r.total_value),
      avgPerCt: r.carats > 0 ? num(r.total_value / r.carats) : 0,
      openOrders: r.open_orders,
      memoExposure: num(r.memo_exposure),
      lastPurchase: r.last_purchase ? new Date(r.last_purchase).toISOString() : null,
    })),
    sort,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    accessScope: describeScope(scope),
  });
},
);
