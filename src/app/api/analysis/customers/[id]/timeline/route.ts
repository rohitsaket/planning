import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { notFound } from "@/lib/api/errors";
import { withApi, qInt, idSchema } from "@/lib/api/with-api";
import { describeScope, scopePredicates, scopeWhere } from "@/lib/auth/access-scope";

// Customer 360 — monthly purchase timeline (last 12 months), preference breakdown
// and a paginated transaction list.
//
// Monthly buckets and preferences are aggregated in PostgreSQL; the transaction
// list is cut with skip/take and reports a real total.
export const GET = withApi(
  { permission: "customers.read", scoped: true },
  async (req: Request, { params }: { params: Promise<{ id: string }> }, { scope }) => {
    const id = idSchema.parse((await params).id);
    const url = new URL(req.url);
    const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
    const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

    const customer = await db.customer.findUnique({ where: { id } });
    if (!customer) throw notFound("Customer");

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 365);

    const where: Prisma.SalesRecordWhereInput = {
      customerId: id,
      lotStatusDb: "Invoice",
      docDate: { gte: since },
      // One customer's history is still location data: a scoped reader sees only the part
      // of it that falls inside their own countries and labs.
      ...scopeWhere(scope, { country: "country", lab: "labNormalized" }),
    };
    // The monthly roll-up below is raw SQL over the same records, so it takes the same
    // restriction as predicates rather than a second, divergent rule.
    const scopeParts = scopePredicates(scope, { country: '"country"', lab: '"labNormalized"' });
    const scopeWhereSql = scopeParts.length
      ? Prisma.sql` AND ${Prisma.join(scopeParts, " AND ")}`
      : Prisma.empty;

    const [monthlyRows, shapeGroups, labGroups, colorGroups, clarityGroups, bandGroups, total, records, bands] =
      await Promise.all([
        db.$queryRaw<Array<{ month: string; pieces: number; carats: number; value: number }>>(Prisma.sql`
          SELECT TO_CHAR(DATE_TRUNC('month', "docDate"), 'YYYY-MM') AS month,
                 COUNT(*)::int AS pieces,
                 COALESCE(SUM(weight), 0)::float8 AS carats,
                 COALESCE(SUM("saleTotalUsd"), 0)::float8 AS value
          FROM "SalesRecord"
          WHERE "customerId" = ${id} AND "lotStatusDb" = 'Invoice' AND "docDate" >= ${since}${scopeWhereSql}
          GROUP BY 1
        `),
        db.salesRecord.groupBy({ by: ["shape"], where, _count: { _all: true } }),
        db.salesRecord.groupBy({ by: ["labNormalized"], where, _count: { _all: true } }),
        db.salesRecord.groupBy({ by: ["color"], where, _count: { _all: true } }),
        db.salesRecord.groupBy({ by: ["clarity"], where, _count: { _all: true } }),
        db.salesRecord.groupBy({ by: ["weightBandId"], where, _count: { _all: true } }),
        db.salesRecord.count({ where }),
        db.salesRecord.findMany({
          where,
          include: { weightBand: true },
          orderBy: [{ docDate: "desc" }, { lotId: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.weightBand.findMany({ select: { id: true, label: true } }),
      ]);

    const bandLabel = new Map(bands.map((b) => [b.id, b.label]));

    // 12-month skeleton so gaps render as zero rather than disappearing.
    const monthlyByKey = new Map(monthlyRows.map((r) => [r.month, r]));
    const monthly: Array<{ month: string; pieces: number; carats: number; value: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const found = monthlyByKey.get(key);
      monthly.push({
        month: key,
        pieces: found?.pieces ?? 0,
        carats: num(found?.carats ?? 0),
        value: num(found?.value ?? 0),
      });
    }

    const top = (
      groups: Array<{ _count: { _all: number } } & Record<string, unknown>>,
      field: string,
      n: number,
      resolve?: (v: unknown) => string,
    ) =>
      groups
        .map((g) => ({
          name: resolve ? resolve(g[field]) : (g[field] as string | null)?.trim() || "Unknown",
          count: g._count._all,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);

    return ok({
      customerId: id,
      customerName: customer.name,
      customerCode: customer.customerCode,
      totalRecords: total,
      monthly,
      preferences: {
        shapes: top(shapeGroups, "shape", 8),
        weightBands: top(bandGroups, "weightBandId", 8, (v) => (typeof v === "string" && bandLabel.get(v)) || "Unmapped"),
        labs: top(labGroups, "labNormalized", 5),
        colors: top(colorGroups, "color", 8),
        clarities: top(clarityGroups, "clarity", 8),
      },
      rows: records.map((r) => ({
        id: r.id,
        lotId: r.lotId,
        docDate: r.docDate.toISOString(),
        shape: r.shape,
        weight: num(r.weight),
        weightBand: r.weightBand?.label ?? null,
        lab: r.labNormalized,
        color: r.color,
        clarity: r.clarity,
        saleTotalUsd: num(r.saleTotalUsd),
        country: r.country,
        branch: r.branch,
      })),
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
      accessScope: describeScope(scope),
    });
  },
);
