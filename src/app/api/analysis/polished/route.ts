import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qEnum, qInt } from "@/lib/api/with-api";
import { loadValuationPolicy, valueStone } from "@/lib/analytics/valuation";

// Polished Stock Analysis — pieces and carats by planning class, lab, shape, weight
// band or country, plus stock aging.
//
// Monetary value is shown only when an approved valuation model (BR-VALUATION-001)
// is configured; otherwise valuation is reported as NOT_CONFIGURED and no estimate
// is invented. Aggregation happens in PostgreSQL, and the detail list is paginated
// on the server.

const DIMENSIONS = [
  "planningClass",
  "lab",
  "shape",
  "weightBand",
  "country",
  "branch",
  "treatment",
  "fantasyStatus",
] as const;
type Dimension = (typeof DIMENSIONS)[number];

const AGE_BUCKETS = [
  { label: "0-30", min: 0, max: 30 },
  { label: "31-60", min: 31, max: 60 },
  { label: "61-90", min: 61, max: 90 },
  { label: "91-180", min: 91, max: 180 },
  { label: "181-365", min: 181, max: 365 },
  { label: "365+", min: 366, max: 3650000 },
] as const;

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const dimension: Dimension = qEnum(url, "dimension", DIMENSIONS, "planningClass");
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const lab = qStr(url, "lab");
  const planningClass = qStr(url, "planningClass", 40);
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const where: Prisma.PolishedStoneWhereInput = {};
  if (country) where.country = country;
  if (branch) where.branch = branch;
  if (lab) where.labNormalized = lab;
  if (planningClass) where.planningClass = planningClass;

  const [valuation, bands, groups, total] = await Promise.all([
    loadValuationPolicy(db),
    db.weightBand.findMany({ orderBy: { sortOrder: "asc" } }),
    // One database-side aggregation drives every dimension roll-up and the valuation.
    db.polishedStone.groupBy({
      by: [
        "planningClass",
        "country",
        "branch",
        "labNormalized",
        "shapeNormalized",
        "shape",
        "weightBandId",
        "treatment",
        "fantasyStatus",
      ],
      where,
      _count: { _all: true },
      _sum: { weight: true },
    }),
    db.polishedStone.count({ where }),
  ]);

  const bandById = new Map(bands.map((b) => [b.id, b]));

  interface Bucket {
    pieces: number;
    carats: number;
    value: number;
    valuedPieces: number;
    unvaluedPieces: number;
  }
  const agg = new Map<string, Bucket>();
  const empty = (): Bucket => ({ pieces: 0, carats: 0, value: 0, valuedPieces: 0, unvaluedPieces: 0 });

  let valuedPieces = 0;
  let unvaluedPieces = 0;
  let totalValue = 0;
  let totalCarats = 0;

  for (const g of groups) {
    const pieces = g._count._all;
    const carats = num(g._sum.weight);
    const band = g.weightBandId ? bandById.get(g.weightBandId) : undefined;

    let key: string;
    switch (dimension) {
      case "lab":
        key = g.labNormalized || "Unmapped";
        break;
      case "shape":
        key = g.shapeNormalized || g.shape || "Unmapped";
        break;
      case "weightBand":
        key = band?.label || "Unbanded";
        break;
      case "country":
        key = g.country;
        break;
      case "branch":
        key = `${g.country} / ${g.branch}`;
        break;
      case "treatment":
        key = g.treatment || "None";
        break;
      case "fantasyStatus":
        key = g.fantasyStatus;
        break;
      default:
        key = g.planningClass;
    }

    // Value the group as a whole: every stone in it shares lab, shape and weight band.
    const priced = valueStone(
      { lab: g.labNormalized, shape: g.shapeNormalized || g.shape, weightBandCode: band?.code ?? null, weight: carats },
      valuation,
    );

    const cur = agg.get(key) ?? empty();
    cur.pieces += pieces;
    cur.carats += carats;
    if (priced.valued && priced.value !== null) {
      cur.value += priced.value;
      cur.valuedPieces += pieces;
      valuedPieces += pieces;
      totalValue += priced.value;
    } else {
      cur.unvaluedPieces += pieces;
      unvaluedPieces += pieces;
    }
    agg.set(key, cur);
    totalCarats += carats;
  }

  const valuationAvailable = valuation.status === "CONFIGURED";

  const rows = Array.from(agg.entries())
    .map(([key, v]) => ({
      dimension: key,
      pieces: v.pieces,
      carats: num(v.carats),
      // Null — not zero — when no approved model can value the stones.
      estimatedValue: valuationAvailable && v.valuedPieces > 0 ? num(v.value) : null,
      valuedPieces: v.valuedPieces,
      unvaluedPieces: v.unvaluedPieces,
    }))
    .sort((a, b) => b.pieces - a.pieces || a.dimension.localeCompare(b.dimension));

  // Stock aging, bucketed in the database against the same filters.
  const filters: Prisma.Sql[] = [];
  if (country) filters.push(Prisma.sql`country = ${country}`);
  if (branch) filters.push(Prisma.sql`branch = ${branch}`);
  if (lab) filters.push(Prisma.sql`"labNormalized" = ${lab}`);
  if (planningClass) filters.push(Prisma.sql`"planningClass" = ${planningClass}`);
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const agingRaw = await db.$queryRaw<Array<{ bucket: string; pieces: number; carats: number }>>(Prisma.sql`
    SELECT bucket, COUNT(*)::int AS pieces, COALESCE(SUM(weight), 0)::float8 AS carats
    FROM (
      SELECT weight,
        CASE
          WHEN age_days <= 30 THEN '0-30'
          WHEN age_days <= 60 THEN '31-60'
          WHEN age_days <= 90 THEN '61-90'
          WHEN age_days <= 180 THEN '91-180'
          WHEN age_days <= 365 THEN '181-365'
          ELSE '365+'
        END AS bucket
      FROM (
        SELECT weight, FLOOR(EXTRACT(EPOCH FROM (NOW() - "lastUpdated")) / 86400)::int AS age_days
        FROM "PolishedStone"
        ${whereSql}
      ) aged
    ) bucketed
    GROUP BY bucket
  `);

  const agingByBucket = new Map(agingRaw.map((r) => [r.bucket, r]));
  const aging = AGE_BUCKETS.map((b) => ({
    label: b.label,
    pieces: agingByBucket.get(b.label)?.pieces ?? 0,
    carats: num(agingByBucket.get(b.label)?.carats ?? 0),
  }));
  const slowMoving = aging.filter((b) => b.label !== "0-30" && b.label !== "31-60" && b.label !== "61-90").reduce((s, b) => s + b.pieces, 0);

  // Paginated detail list — deterministic order, filters applied before paging.
  const stones = await db.polishedStone.findMany({
    where,
    include: { weightBand: true },
    orderBy: [{ lastUpdated: "desc" }, { fantasyLotId: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const detail = stones.map((s) => {
    const priced = valueStone(
      {
        lab: s.labNormalized,
        shape: s.shapeNormalized || s.shape,
        weightBandCode: s.weightBand?.code ?? null,
        color: s.color,
        clarity: s.clarity,
        weight: num(s.weight),
      },
      valuation,
    );
    return {
      id: s.id,
      fantasyLotId: s.fantasyLotId,
      planningClass: s.planningClass,
      fantasyStatus: s.fantasyStatus,
      lab: s.labNormalized,
      shape: s.shapeNormalized || s.shape,
      weightBand: s.weightBand?.label ?? null,
      weight: num(s.weight),
      color: s.color,
      clarity: s.clarity,
      country: s.country,
      branch: s.branch,
      lastUpdated: s.lastUpdated.toISOString(),
      estimatedValue: priced.value,
      valuationReason: priced.reason,
    };
  });

  return ok({
    dimension,
    rows,
    aging,
    slowMoving,
    slowMovingPct: total > 0 ? num((slowMoving / total) * 100) : 0,
    summary: {
      pieces: total,
      carats: num(totalCarats),
      estimatedValue: valuationAvailable && valuedPieces > 0 ? num(totalValue) : null,
      valuedPieces,
      unvaluedPieces,
    },
    valuation: {
      status: valuation.status,
      reason: valuation.reason,
      message: valuation.message,
      modelVersion: valuation.modelVersion,
      effectiveDate: valuation.effectiveDate,
      currency: valuation.currency,
      priceSource: valuation.priceSource,
      isEstimate: valuation.isEstimate,
    },
    detail,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  });
});
