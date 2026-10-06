import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { formatIST } from "@/lib/fantasy/time";
import { resolveCanonicalWeight } from "@/lib/fantasy/quantity-weight";
import {
  bucketLabel,
  confirmedQuantitySql,
  currentStockSql,
  inventoryBucketSql,
  isInventoryBucket,
  needsReviewSql,
  type InventoryBucket,
} from "@/lib/analysis/inventory-buckets";
import { scopeSql, UNRESTRICTED_SCOPE, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveSourceDisclosure, type SourceDisclosure } from "@/lib/analysis/source-disclosure";

if (typeof window !== "undefined") {
  throw new Error("analysis/stock-aging is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const AGING_PAGE_DEFAULT = 50;
export const AGING_PAGE_MAX = 200;

export const AGING_LOCATION_MAX = 200;

export const AGING_AVAILABILITY = ["AVAILABLE", "ANCHOR_NOT_CONFIRMED"] as const;
export type AgingAvailability = (typeof AGING_AVAILABILITY)[number];

export function resolveAgingAvailability(): AgingAvailability {
  return "ANCHOR_NOT_CONFIRMED";
}

export const AGING_UNAVAILABLE_MESSAGE =
  "Inventory age cannot be calculated until the authoritative aging date is confirmed.";

export const AGING_UNAVAILABLE_DETAIL =
  "The source supplies several dates, but none of them has a confirmed business meaning for how long a " +
  "stone has been in stock. Confirm which event starts the clock — entry into stock, allocation, or last " +
  "physical movement — and inventory age becomes available on this page and the Aging Dashboard together.";

export const AGING_BUCKETS_PENDING_MESSAGE =
  "Age bands are not configured. Once the aging date is confirmed, the bands used to group stock need to be approved as well.";

export interface AgingFilters {
  bucket: InventoryBucket | null;
  lab: string | null;
  shape: string | null;
  country: string | null;
  branch: string | null;
  department: string | null;
  location: string | null;
  search: string | null;
  readonly scope: EffectiveScope;
}

export const EMPTY_AGING_FILTERS: AgingFilters = {
  bucket: null, lab: null, shape: null,
  country: null, branch: null, department: null, location: null, search: null,
  scope: UNRESTRICTED_SCOPE,
};

export interface Paging { page: number; pageSize: number }
export interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

export interface AgingLotRow {
  readonly lotId: string;
  readonly stoneName: string | null;
  readonly bucket: InventoryBucket;
  readonly bucketLabel: string;
  readonly categoryLabel: string;
  readonly lab: string | null;
  readonly shape: string | null;
  readonly confirmedQuantity: number | null;
  readonly measuredWeight: number | null;
  readonly country: string;
  readonly branch: string;
  readonly department: string | null;
  readonly location: string | null;
  readonly lastSourceUpdateIst: string | null;
  readonly dataState: "CONFIRMED" | "REVIEW_REQUIRED";
}

export interface AgingResult {
  readonly sourceDisclosure: SourceDisclosure;
  readonly availability: AgingAvailability;
  readonly unavailableMessage: string | null;
  readonly unavailableDetail: string | null;
  readonly bucketsMessage: string | null;
  readonly rows: AgingLotRow[];
  readonly paging: PagingMeta;
  readonly totals: {
    readonly currentLots: number;
    readonly confirmedQuantity: number;
    readonly lotsNeedingReview: number;
  };
}

function filterSql(f: AgingFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.bucket) parts.push(Prisma.sql`AND ${inventoryBucketSql("m")} = ${f.bucket}`);
  if (f.lab) parts.push(Prisma.sql`AND "m"."labNormalized" = ${f.lab}`);
  if (f.shape) parts.push(Prisma.sql`AND "m"."shapeNormalized" = ${f.shape}`);
  if (f.country) parts.push(Prisma.sql`AND "m"."country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`AND "m"."branch" = ${f.branch}`);
  if (f.department) parts.push(Prisma.sql`AND "m"."departmentName" = ${f.department}`);
  if (f.location) parts.push(Prisma.sql`AND "m"."locationName" = ${f.location}`);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`;
    parts.push(Prisma.sql`AND ("m"."lotId" ILIKE ${like} OR COALESCE("m"."stoneName", '') ILIKE ${like})`);
  }
  const scope = scopeSql(f.scope, { country: '"m"."country"', lab: '"m"."labNormalized"' });
  if (scope !== Prisma.empty) parts.push(scope);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

function agingCte(f: AgingFilters): Prisma.Sql {
  return Prisma.sql`
    WITH inv AS (
      SELECT
        "m"."lotId"               AS lot_id,
        "m"."stoneName"           AS stone_name,
        ${inventoryBucketSql("m")} AS bucket,
        "m"."labNormalized"       AS lab,
        COALESCE("m"."shapeNormalized", "m"."shape") AS shape,
        ${confirmedQuantitySql("m")}::float8 AS confirmed_qty,
        ${needsReviewSql("m")}    AS needs_review,
        "m"."quantity"            AS raw_quantity,
        "m"."quantityProvenance"  AS quantity_provenance,
        "m"."weight"              AS weight,
        "m"."sourceType"          AS source_type,
        "m"."isSimulated"         AS is_simulated,
        "m"."country"             AS country,
        "m"."branch"              AS branch,
        "m"."departmentName"      AS department,
        "m"."locationName"        AS location,
        "m"."lastSeenAt"          AS last_seen
      FROM "LotMasterRecord" "m"
      WHERE ${currentStockSql("m")}
        ${filterSql(f)}
    )
  `;
}

interface RawLotRow {
  lot_id: string;
  stone_name: string | null;
  bucket: string;
  lab: string | null;
  shape: string | null;
  confirmed_qty: number | null;
  needs_review: boolean;
  weight: Prisma.Decimal | null;
  source_type: string | null;
  is_simulated: boolean | null;
  country: string;
  branch: string;
  department: string | null;
  location: string | null;
  last_seen: Date | null;
}

function toRow(r: RawLotRow): AgingLotRow {
  const bucket: InventoryBucket = isInventoryBucket(r.bucket) ? r.bucket : "REVIEW_REQUIRED";
  const weight = resolveCanonicalWeight({
    weight: r.weight,
    sourceType: r.source_type,
    isSimulated: r.is_simulated ?? false,
  });
  return {
    lotId: r.lot_id,
    stoneName: r.stone_name,
    bucket,
    bucketLabel: bucketLabel(bucket),
    categoryLabel: [r.lab, r.shape].filter(Boolean).join(" | ") || "Unclassified",
    lab: r.lab,
    shape: r.shape,
    confirmedQuantity: r.confirmed_qty === null ? null : num(r.confirmed_qty),
    measuredWeight: weight.carats,
    country: r.country,
    branch: r.branch,
    department: r.department,
    location: r.location,
    lastSourceUpdateIst: r.last_seen ? formatIST(r.last_seen, false) : null,
    dataState: r.needs_review ? "REVIEW_REQUIRED" : "CONFIRMED",
  };
}

function availabilityFields() {
  const availability = resolveAgingAvailability();
  const pending = availability === "ANCHOR_NOT_CONFIRMED";
  return {
    availability,
    unavailableMessage: pending ? AGING_UNAVAILABLE_MESSAGE : null,
    unavailableDetail: pending ? AGING_UNAVAILABLE_DETAIL : null,
    bucketsMessage: pending ? AGING_BUCKETS_PENDING_MESSAGE : null,
  };
}

export async function readAgingLots(
  filters: AgingFilters,
  paging: Paging,
  client: DbClient = db,
): Promise<AgingResult> {
  const pageSize = Math.min(Math.max(1, paging.pageSize), AGING_PAGE_MAX);
  const offset = (Math.max(1, paging.page) - 1) * pageSize;
  const cte = agingCte(filters);

  const [totalsRows, rows] = await Promise.all([
    client.$queryRaw<Array<{ lots: bigint; qty: number | null; review: bigint; simulated: boolean | null }>>`
      ${cte}
      SELECT
        COUNT(*)                                            AS lots,
        COALESCE(SUM("confirmed_qty"), 0)::float8           AS qty,
        COUNT(*) FILTER (WHERE "needs_review")              AS review,
        BOOL_OR("is_simulated")                             AS simulated
      FROM inv`,
    client.$queryRaw<RawLotRow[]>`
      ${cte}
      SELECT * FROM inv
      ORDER BY "lot_id" ASC
      LIMIT ${pageSize} OFFSET ${offset}`,
  ]);

  const t = totalsRows[0];
  const total = Number(t?.lots ?? 0);

  return {
    ...availabilityFields(),
    sourceDisclosure: resolveSourceDisclosure({
      isSimulated: t?.simulated ?? null,
      hasData: total > 0,
    }),
    rows: rows.map(toRow),
    paging: { page: paging.page, pageSize, total, hasMore: paging.page * pageSize < total },
    totals: {
      currentLots: total,
      confirmedQuantity: num(t?.qty ?? 0),
      lotsNeedingReview: Number(t?.review ?? 0),
    },
  };
}

export interface AgingDistributionRow {
  readonly key: string;
  readonly label: string;
  readonly lotCount: number;
  readonly confirmedQuantity: number;
  readonly lotsNeedingReview: number;
}

export interface AgingSummary {
  readonly sourceDisclosure: SourceDisclosure;
  readonly availability: AgingAvailability;
  readonly unavailableMessage: string | null;
  readonly unavailableDetail: string | null;
  readonly bucketsMessage: string | null;
  readonly currentLots: number;
  readonly byBucket: AgingDistributionRow[];
  readonly byLocation: AgingDistributionRow[];
  readonly locations: {
    readonly total: number;
    readonly shown: number;
    readonly limit: number;
    readonly truncated: boolean;
  };
}

interface RawGroup {
  group_key: string;
  lots: bigint;
  qty: number | null;
  review: bigint;
}

export async function readAgingSummary(
  filters: AgingFilters,
  client: DbClient = db,
): Promise<AgingSummary> {
  const cte = agingCte(filters);

  const [totalsRows, byBucketRaw, byLocationRaw, locationCountRows] = await Promise.all([
    client.$queryRaw<Array<{ lots: bigint; simulated: boolean | null }>>`
      ${cte}
      SELECT COUNT(*) AS lots, BOOL_OR("is_simulated") AS simulated FROM inv`,
    client.$queryRaw<RawGroup[]>`
      ${cte}
      SELECT
        "bucket"                                   AS group_key,
        COUNT(*)                                   AS lots,
        COALESCE(SUM("confirmed_qty"), 0)::float8  AS qty,
        COUNT(*) FILTER (WHERE "needs_review")     AS review
      FROM inv
      GROUP BY "bucket"
      ORDER BY COUNT(*) DESC, "bucket" ASC`,
    client.$queryRaw<RawGroup[]>`
      ${cte}
      SELECT
        ("country" || ' / ' || "branch")           AS group_key,
        COUNT(*)                                   AS lots,
        COALESCE(SUM("confirmed_qty"), 0)::float8  AS qty,
        COUNT(*) FILTER (WHERE "needs_review")     AS review
      FROM inv
      GROUP BY 1
      ORDER BY COUNT(*) DESC, 1 ASC
      LIMIT ${AGING_LOCATION_MAX + 1}`,
    client.$queryRaw<Array<{ n: bigint }>>`
      ${cte}
      SELECT COUNT(*) AS n FROM (SELECT DISTINCT "country", "branch" FROM inv) d`,
  ]);

  const toDistribution = (g: RawGroup, label: string): AgingDistributionRow => ({
    key: g.group_key,
    label,
    lotCount: Number(g.lots),
    confirmedQuantity: num(g.qty ?? 0),
    lotsNeedingReview: Number(g.review),
  });

  const locationTotal = Number(locationCountRows[0]?.n ?? 0);
  const shownLocations = byLocationRaw.slice(0, AGING_LOCATION_MAX);

  const summaryLots = Number(totalsRows[0]?.lots ?? 0);

  return {
    ...availabilityFields(),
    sourceDisclosure: resolveSourceDisclosure({
      isSimulated: totalsRows[0]?.simulated ?? null,
      hasData: summaryLots > 0,
    }),
    currentLots: summaryLots,
    byBucket: byBucketRaw.map((g) => toDistribution(g, bucketLabel(g.group_key))),
    byLocation: shownLocations.map((g) => toDistribution(g, g.group_key)),
    locations: {
      total: locationTotal,
      shown: shownLocations.length,
      limit: AGING_LOCATION_MAX,
      truncated: locationTotal > shownLocations.length,
    },
  };
}
