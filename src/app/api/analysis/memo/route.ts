import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";

// Memo Analysis — memo is a separate decision context and never reduces physical
// shortage (BR-MEMO-001). Aggregates are computed in PostgreSQL over the whole
// filtered set; the detail list is paginated on the server.
export const GET = withApi({ permission: "sales.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const status = qStr(url, "status", 40);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const where: Prisma.MemoRecordWhereInput = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;
  if (status) where.status = status;

  const filters: Prisma.Sql[] = [];
  if (country) filters.push(Prisma.sql`country = ${country}`);
  if (branch) filters.push(Prisma.sql`branch = ${branch}`);
  if (lab) filters.push(Prisma.sql`"labNormalized" = ${lab}`);
  if (status) filters.push(Prisma.sql`status = ${status}`);
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

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
  });
});
