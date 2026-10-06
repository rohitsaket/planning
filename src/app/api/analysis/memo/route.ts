import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qInt } from "@/lib/api/with-api";
import { describeScope } from "@/lib/auth/access-scope";
import { memoPredicates, memoWhere, readMemoFilters } from "@/lib/analysis/memo";

export const GET = withApi(
  { permission: "sales.read", scoped: true, query: ["country", "branch", "lab", "status", "page", "pageSize"] },
  async (req: Request, _ctx, { scope }) => {
  const url = new URL(req.url);
  const filters = readMemoFilters(url, scope);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const where = memoWhere(filters);
  const predicates = memoPredicates(filters);
  const whereSql = predicates.length ? Prisma.sql`WHERE ${Prisma.join(predicates, " AND ")}` : Prisma.empty;

  const [totals, countryGroups, customerGroups, ageRows, total, rows] = await Promise.all([
    db.memoRecord.aggregate({ where, _count: { _all: true }, _sum: { memoValueUsd: true } }),
    db.memoRecord.groupBy({
      by: ["country"],
      where,
      _count: { _all: true },
      _sum: { memoValueUsd: true },
      _avg: { memoAgeDays: true },
    }),
    db.memoRecord.groupBy({
      by: ["customerId"],
      where,
      _count: { _all: true },
      _sum: { memoValueUsd: true },
      _avg: { memoAgeDays: true },
    }),
    db.$queryRaw<Array<{ bucket: string; pieces: number }>>(Prisma.sql`
      SELECT bucket, COUNT(*)::int AS pieces
      FROM (
        SELECT CASE
          WHEN age_days <= 30 THEN '0-30'
          WHEN age_days <= 60 THEN '31-60'
          WHEN age_days <= 90 THEN '61-90'
          WHEN age_days <= 180 THEN '91-180'
          ELSE '180+'
        END AS bucket
        FROM (
          SELECT COALESCE("memoAgeDays", FLOOR(EXTRACT(EPOCH FROM (NOW() - "memoDate")) / 86400)::int) AS age_days
          FROM "MemoRecord"
          ${whereSql}
        ) aged
      ) bucketed
      GROUP BY bucket
    `),
    db.memoRecord.count({ where }),
    db.memoRecord.findMany({
      where,
      include: { customer: { select: { name: true } } },
      orderBy: [{ memoDate: "desc" }, { lotId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const customerNames = new Map(
    (
      await db.customer.findMany({
        where: { id: { in: customerGroups.map((g) => g.customerId) } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name]),
  );

  const ageBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 } as Record<string, number>;
  for (const r of ageRows) ageBuckets[r.bucket] = r.pieces;

  return ok({
    totalQty: totals._count._all,
    totalValue: num(totals._sum.memoValueUsd),
    byCountry: countryGroups
      .map((g) => ({
        dimension: g.country,
        qty: g._count._all,
        value: num(g._sum.memoValueUsd),
        avgAge: Math.round(g._avg.memoAgeDays ?? 0),
      }))
      .sort((a, b) => b.value - a.value),
    byCustomer: customerGroups
      .map((g) => ({
        dimension: customerNames.get(g.customerId) ?? "Unknown",
        qty: g._count._all,
        value: num(g._sum.memoValueUsd),
        avgAge: Math.round(g._avg.memoAgeDays ?? 0),
      }))
      .sort((a, b) => b.value - a.value),
    ageBuckets,
    rows: rows.map((m) => ({
      id: m.id,
      lotId: m.lotId,
      memoDate: m.memoDate.toISOString(),
      customerName: m.customer.name,
      country: m.country,
      branch: m.branch,
      shape: m.shape,
      weight: num(m.weight),
      lab: m.labNormalized,
      color: m.color,
      clarity: m.clarity,
      treatment: m.treatment,
      memoValueUsd: num(m.memoValueUsd),
      status: m.status,
      memoAgeDays: m.memoAgeDays,
    })),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    accessScope: describeScope(scope),
  });
  },
);
