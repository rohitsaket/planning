import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";
import { describeScope, describeScopeApplication, scopePredicates, scopeWhere } from "@/lib/auth/access-scope";

// Order Analysis — sales orders with line aggregates.
// Honors global filter params: country, branch (SalesOrder has no lab dimension).
// Filters are applied before paging; the response carries a real total.
export const GET = withApi(
  { permission: "orders.read", scoped: true },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 100, min: 1, max: 500 });
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const status = qStr(url, "status", 40);
  const search = qStr(url, "q", 100);

  // An order carries a country but no lab, so only the country half of the scope can
  // be applied; `scopeApplication` on the response says so rather than implying more.
  const where: Prisma.SalesOrderWhereInput = { ...scopeWhere(scope, { country: "country", lab: null }) };
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (status) where.status = status;
  if (search) {
    const contains = search.replace(/[\\%_]/g, "\\$&");
    where.OR = [
      { orderNumber: { contains, mode: "insensitive" } },
      { customer: { name: { contains, mode: "insensitive" } } },
    ];
  }

  // Totals for the KPI row: computed over every matching order, not just this page.
  const filters: Prisma.Sql[] = [...scopePredicates(scope, { country: 'o."country"', lab: null })];
  if (country) filters.push(Prisma.sql`o.country = ${country}`);
  if (branch) filters.push(Prisma.sql`o.branch = ${branch}`);
  if (status) filters.push(Prisma.sql`o.status = ${status}`);
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    filters.push(Prisma.sql`(o."orderNumber" ILIKE ${like} OR EXISTS (SELECT 1 FROM "Customer" c WHERE c.id = o."customerId" AND c.name ILIKE ${like}))`);
  }
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const [total, orders, summaryRows] = await Promise.all([
    db.salesOrder.count({ where }),
    db.salesOrder.findMany({
      where,
      include: { customer: { select: { name: true } }, lines: true },
      orderBy: [{ orderDate: "desc" }, { orderNumber: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.$queryRaw<Array<{ orders: number; qty_ordered: number; qty_outstanding: number; backorder: number; overdue: number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT o.id)::int AS orders,
             COALESCE(SUM(l."qtyOrdered"), 0)::int AS qty_ordered,
             COALESCE(SUM(l."qtyOutstanding"), 0)::int AS qty_outstanding,
             COALESCE(SUM(l."backorderQty"), 0)::int AS backorder,
             COUNT(DISTINCT o.id) FILTER (
               WHERE o."requiredDate" IS NOT NULL AND o."requiredDate" < NOW() AND l."qtyOutstanding" > 0
             )::int AS overdue
      FROM "SalesOrder" o
      LEFT JOIN "SalesOrderLine" l ON l."orderId" = o.id
      ${whereSql}
    `),
  ]);

  const rows = orders.map((o) => {
    const lines = o.lines.length;
    const qtyOrdered = o.lines.reduce((s, l) => s + l.qtyOrdered, 0);
    const qtyOutstanding = o.lines.reduce((s, l) => s + l.qtyOutstanding, 0);
    const backorder = o.lines.reduce((s, l) => s + l.backorderQty, 0);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customer.name,
      orderDate: o.orderDate.toISOString(),
      requiredDate: o.requiredDate?.toISOString() ?? null,
      promisedDate: o.promisedDate?.toISOString() ?? null,
      status: o.status,
      priority: o.priority,
      priorityReason: o.priorityReason,
      lines,
      qtyOrdered,
      qtyOutstanding,
      backorderQty: backorder,
      country: o.country,
      branch: o.branch,
    };
  });

  const totals = summaryRows[0] ?? { orders: 0, qty_ordered: 0, qty_outstanding: 0, backorder: 0, overdue: 0 };

  return ok({
    rows,
    summary: {
      orders: totals.orders,
      qtyOrdered: totals.qty_ordered,
      qtyOutstanding: totals.qty_outstanding,
      backorderQty: totals.backorder,
      overdueOrders: totals.overdue,
    },
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    accessScope: describeScope(scope),
    scopeApplication: describeScopeApplication(scope, ["COUNTRY"]),
  });
  },
);
