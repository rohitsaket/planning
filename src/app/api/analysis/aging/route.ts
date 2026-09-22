import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";

// Stock Aging — 0-30, 31-60, 61-90, 91-180, 181-365, 365+ days.
// Buckets are aggregated in PostgreSQL over the whole filtered set; the lot list is
// paginated on the server.

const BUCKET_LABELS = ["0-30", "31-60", "61-90", "91-180", "181-365", "365+"] as const;
const SLOW_MIN_DAYS = 91;

const AGE_DAYS_SQL = Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (NOW() - ps."lastUpdated")) / 86400)::int`;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const bucket = qStr(url, "bucket", 20);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const filters: Prisma.Sql[] = [];
  if (country) filters.push(Prisma.sql`ps.country = ${country}`);
  if (branch) filters.push(Prisma.sql`ps.branch = ${branch}`);
  if (lab) filters.push(Prisma.sql`ps."labNormalized" = ${lab}`);
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const bucketCase = Prisma.sql`
    CASE
      WHEN ${AGE_DAYS_SQL} <= 30 THEN '0-30'
      WHEN ${AGE_DAYS_SQL} <= 60 THEN '31-60'
      WHEN ${AGE_DAYS_SQL} <= 90 THEN '61-90'
      WHEN ${AGE_DAYS_SQL} <= 180 THEN '91-180'
      WHEN ${AGE_DAYS_SQL} <= 365 THEN '181-365'
      ELSE '365+'
    END`;

  const where: Prisma.PolishedStoneWhereInput = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;

  const [bucketRows, totalPieces, detailRows, detailCountRows] = await Promise.all([
    db.$queryRaw<Array<{ bucket: string; pieces: number; carats: number }>>(Prisma.sql`
      SELECT ${bucketCase} AS bucket, COUNT(*)::int AS pieces, COALESCE(SUM(ps.weight), 0)::float8 AS carats
      FROM "PolishedStone" ps
      ${whereSql}
      GROUP BY 1
    `),
    db.polishedStone.count({ where }),
    db.$queryRaw<
      Array<{ lot_id: string; age_days: number; country: string; branch: string; shape: string | null; lab: string | null; weight: number; bucket: string }>
    >(Prisma.sql`
      SELECT ps."fantasyLotId" AS lot_id,
             ${AGE_DAYS_SQL} AS age_days,
             ps.country,
             ps.branch,
             COALESCE(ps."shapeNormalized", ps.shape) AS shape,
             ps."labNormalized" AS lab,
             ps.weight::float8 AS weight,
             ${bucketCase} AS bucket
      FROM "PolishedStone" ps
      ${whereSql}
      ${bucket ? Prisma.sql`${filters.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${bucketCase} = ${bucket}` : Prisma.empty}
      ORDER BY age_days DESC, ps."fantasyLotId" ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "PolishedStone" ps
      ${whereSql}
      ${bucket ? Prisma.sql`${filters.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${bucketCase} = ${bucket}` : Prisma.empty}
    `),
  ]);

  const byBucket = new Map(bucketRows.map((r) => [r.bucket, r]));
  const buckets = BUCKET_LABELS.map((label) => ({
    label,
    pieces: byBucket.get(label)?.pieces ?? 0,
    carats: num(byBucket.get(label)?.carats ?? 0),
  }));

  const slowMoving = buckets
    .filter((b) => b.label === "91-180" || b.label === "181-365" || b.label === "365+")
    .reduce((s, b) => s + b.pieces, 0);

  const total = detailCountRows[0]?.total ?? 0;

  return ok({
    buckets,
    totalPieces,
    slowMoving,
    slowMovingPct: totalPieces > 0 ? num((slowMoving / totalPieces) * 100) : 0,
    slowMovingThresholdDays: SLOW_MIN_DAYS,
    rows: detailRows.map((r) => ({
      lotId: r.lot_id,
      ageDays: r.age_days,
      bucket: r.bucket,
      country: r.country,
      branch: r.branch,
      shape: r.shape,
      lab: r.lab,
      weight: num(r.weight),
    })),
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
});
