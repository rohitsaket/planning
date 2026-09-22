import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";
import { loadValuationPolicy, valueStone } from "@/lib/analytics/valuation";

// Inventory Aging Dashboard — stock aging with slow-moving and aged detection.
// Buckets: 0-30, 31-60, 61-90, 91-180, 181-365, 365+ days.
// Slow-moving = 91+ days, Aged = 365+ days.
//
// Monetary value appears only when an approved valuation model (BR-VALUATION-001)
// is configured; otherwise value is null and the valuation state says why. Counting
// and bucketing are done in PostgreSQL; the slow-moving list is paginated.

const BUCKET_LABELS = ["0-30", "31-60", "61-90", "91-180", "181-365", "365+"] as const;
const SLOW_MIN_DAYS = 91;
const AGED_MIN_DAYS = 365;

const AGE_DAYS_SQL = Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (NOW() - ps."lastUpdated")) / 86400)::int`;
const BUCKET_SQL = Prisma.sql`
  CASE
    WHEN ${AGE_DAYS_SQL} <= 30 THEN '0-30'
    WHEN ${AGE_DAYS_SQL} <= 60 THEN '31-60'
    WHEN ${AGE_DAYS_SQL} <= 90 THEN '61-90'
    WHEN ${AGE_DAYS_SQL} <= 180 THEN '91-180'
    WHEN ${AGE_DAYS_SQL} <= 365 THEN '181-365'
    ELSE '365+'
  END`;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 25, min: 1, max: 200 });

  const filters: Prisma.Sql[] = [];
  if (country) filters.push(Prisma.sql`ps.country = ${country}`);
  if (branch) filters.push(Prisma.sql`ps.branch = ${branch}`);
  if (lab) filters.push(Prisma.sql`ps."labNormalized" = ${lab}`);
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const where: Prisma.PolishedStoneWhereInput = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;

  const [valuation, summaryRows, bucketRows, dimensionRows, slowCountRows, slowLots, bands] = await Promise.all([
    loadValuationPolicy(db),
    db.$queryRaw<Array<{ pieces: number; carats: number; avg_age: number; slow: number; aged: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS pieces,
             COALESCE(SUM(ps.weight), 0)::float8 AS carats,
             COALESCE(AVG(${AGE_DAYS_SQL}), 0)::float8 AS avg_age,
             COUNT(*) FILTER (WHERE ${AGE_DAYS_SQL} >= ${SLOW_MIN_DAYS})::int AS slow,
             COUNT(*) FILTER (WHERE ${AGE_DAYS_SQL} >= ${AGED_MIN_DAYS})::int AS aged
      FROM "PolishedStone" ps
      ${whereSql}
    `),
    db.$queryRaw<
      Array<{ bucket: string; lab: string | null; shape: string | null; band_id: string | null; pieces: number; carats: number }>
    >(Prisma.sql`
      SELECT ${BUCKET_SQL} AS bucket,
             ps."labNormalized" AS lab,
             COALESCE(ps."shapeNormalized", ps.shape) AS shape,
             ps."weightBandId" AS band_id,
             COUNT(*)::int AS pieces,
             COALESCE(SUM(ps.weight), 0)::float8 AS carats
      FROM "PolishedStone" ps
      ${whereSql}
      GROUP BY 1, 2, 3, 4
    `),
    db.$queryRaw<
      Array<{ country: string; lab: string | null; shape: string | null; pieces: number; slow: number; aged: number }>
    >(Prisma.sql`
      SELECT ps.country AS country,
             ps."labNormalized" AS lab,
             COALESCE(ps."shapeNormalized", ps.shape) AS shape,
             COUNT(*)::int AS pieces,
             COUNT(*) FILTER (WHERE ${AGE_DAYS_SQL} >= ${SLOW_MIN_DAYS})::int AS slow,
             COUNT(*) FILTER (WHERE ${AGE_DAYS_SQL} >= ${AGED_MIN_DAYS})::int AS aged
      FROM "PolishedStone" ps
      ${whereSql}
      GROUP BY 1, 2, 3
    `),
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS total
      FROM "PolishedStone" ps
      ${whereSql}
      ${filters.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${AGE_DAYS_SQL} >= ${SLOW_MIN_DAYS}
    `),
    db.$queryRaw<
      Array<{
        id: string;
        lot_id: string;
        age_days: number;
        country: string;
        branch: string;
        lab: string | null;
        shape: string | null;
        band_id: string | null;
        weight: number;
        color: string | null;
        clarity: string | null;
      }>
    >(Prisma.sql`
      SELECT ps.id,
             ps."fantasyLotId" AS lot_id,
             ${AGE_DAYS_SQL} AS age_days,
             ps.country,
             ps.branch,
             ps."labNormalized" AS lab,
             COALESCE(ps."shapeNormalized", ps.shape) AS shape,
             ps."weightBandId" AS band_id,
             ps.weight::float8 AS weight,
             ps.color,
             ps.clarity
      FROM "PolishedStone" ps
      ${whereSql}
      ${filters.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${AGE_DAYS_SQL} >= ${SLOW_MIN_DAYS}
      ORDER BY age_days DESC, ps."fantasyLotId" ASC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `),
    db.weightBand.findMany({ select: { id: true, code: true } }),
  ]);

  const bandCode = new Map(bands.map((b) => [b.id, b.code]));
  const summary = summaryRows[0] ?? { pieces: 0, carats: 0, avg_age: 0, slow: 0, aged: 0 };
  const valuationAvailable = valuation.status === "CONFIGURED";

  // Value each (bucket, lab, shape, band) group with the configured model.
  const bucketTotals = new Map<string, { pieces: number; carats: number; value: number; valued: number }>();
  let totalValue = 0;
  let valuedPieces = 0;

  for (const r of bucketRows) {
    const cur = bucketTotals.get(r.bucket) ?? { pieces: 0, carats: 0, value: 0, valued: 0 };
    cur.pieces += r.pieces;
    cur.carats += r.carats;
    const priced = valueStone(
      { lab: r.lab, shape: r.shape, weightBandCode: r.band_id ? bandCode.get(r.band_id) ?? null : null, weight: r.carats },
      valuation,
    );
    if (priced.valued && priced.value !== null) {
      cur.value += priced.value;
      cur.valued += r.pieces;
      totalValue += priced.value;
      valuedPieces += r.pieces;
    }
    bucketTotals.set(r.bucket, cur);
  }

  const totalPieces = summary.pieces;
  const buckets = BUCKET_LABELS.map((label) => {
    const b = bucketTotals.get(label) ?? { pieces: 0, carats: 0, value: 0, valued: 0 };
    return {
      label,
      pieces: b.pieces,
      carats: num(b.carats),
      value: valuationAvailable && b.valued > 0 ? num(b.value) : null,
      valuedPieces: b.valued,
      pct: totalPieces > 0 ? num((b.pieces / totalPieces) * 100) : 0,
    };
  });

  const rollup = <K extends string>(key: (r: (typeof dimensionRows)[number]) => string, field: K) => {
    const map = new Map<string, { totalPieces: number; slowMoving: number; aged: number }>();
    for (const r of dimensionRows) {
      const k = key(r);
      const cur = map.get(k) ?? { totalPieces: 0, slowMoving: 0, aged: 0 };
      cur.totalPieces += r.pieces;
      cur.slowMoving += r.slow;
      cur.aged += r.aged;
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([k, v]) => ({ [field]: k, ...v }))
      .sort((a, b) => b.totalPieces - a.totalPieces);
  };

  const slowTotal = slowCountRows[0]?.total ?? 0;

  return ok({
    summary: {
      totalPieces,
      totalCarats: num(summary.carats),
      totalValue: valuationAvailable && valuedPieces > 0 ? num(totalValue) : null,
      valuedPieces,
      unvaluedPieces: totalPieces - valuedPieces,
      slowMovingPieces: summary.slow,
      slowMovingPct: totalPieces > 0 ? num((summary.slow / totalPieces) * 100) : 0,
      agedPieces: summary.aged,
      agedPct: totalPieces > 0 ? num((summary.aged / totalPieces) * 100) : 0,
      avgAgeDays: Math.round(summary.avg_age),
    },
    valuation: {
      status: valuation.status,
      reason: valuation.reason,
      message: valuation.message,
      modelVersion: valuation.modelVersion,
      currency: valuation.currency,
      priceSource: valuation.priceSource,
      isEstimate: valuation.isEstimate,
    },
    buckets,
    byCountry: rollup((r) => r.country || "Unknown", "country"),
    byLab: rollup((r) => r.lab || "Non-Cert", "lab"),
    byShape: rollup((r) => r.shape || "Unknown", "shape"),
    slowMovingAlerts: slowLots.map((s) => {
      const priced = valueStone(
        {
          lab: s.lab,
          shape: s.shape,
          weightBandCode: s.band_id ? bandCode.get(s.band_id) ?? null : null,
          color: s.color,
          clarity: s.clarity,
          weight: s.weight,
        },
        valuation,
      );
      return {
        lotId: s.lot_id,
        ageDays: s.age_days,
        country: s.country,
        branch: s.branch,
        shape: s.shape ?? "Unknown",
        weight: num(s.weight),
        value: priced.value,
      };
    }),
    page,
    pageSize,
    total: slowTotal,
    hasMore: page * pageSize < slowTotal,
  });
});
