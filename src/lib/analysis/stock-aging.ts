/**
 * STOCK AGING — bounded read service, shared by Stock Aging and the Aging Dashboard.
 *
 * ## Why aging is currently unavailable
 *
 * Inventory age is the number of days a lot has sat in its present business-relevant
 * stock state. Computing it needs one date whose business meaning is confirmed: the
 * moment the stone entered that state. Every candidate this schema offers fails that
 * test, and the evidence is in the code that writes them:
 *
 *   - `lastSeenAt` is written from `sourceUpdatedAt` (`sync-service.ts`). It records when
 *     the source last touched the record — an observation made during synchronization.
 *     A lot that has not moved for a year gets a fresh `lastSeenAt` on every sync, so
 *     using it as age would report the whole warehouse as new after one run. This is the
 *     single most tempting field and the single most wrong one.
 *   - `firstSeenAt` is written from `sourceCreatedAt`: when the source created the
 *     record, which is not when the stone entered current stock.
 *   - `statusEffectiveDate` is the closest candidate, but which status transitions mean
 *     "entered stock" is not confirmed, and a record may carry a status the mapping
 *     profile has never seen.
 *   - `docDate` and `Allocation Date` are both documented in the row contract as having
 *     no confirmed business meaning. `Allocation Date` is preserved as raw text and has
 *     never been parsed into a date at all.
 *   - The previous page used `PolishedStone.lastUpdated` — a row-update timestamp on a
 *     legacy seeded mirror that is not even canonical.
 *
 * So this module computes no age. It reports the records that exist, states plainly that
 * age cannot be derived, and names the decision the client has to make. An age computed
 * from the wrong anchor is worse than no age: it looks authoritative, drives purchasing,
 * and nothing on the screen says it is wrong.
 *
 * ## Why there are no buckets
 *
 * "Fresh", "Aging", "Old" and "Critical" need thresholds, and no approved policy defines
 * them. The previous page hardcoded 0-30 / 31-60 / 61-90 / 91-180 / 181-365 / 365+ and a
 * 91-day "slow" line, none of which anyone confirmed. Until a policy exists there are no
 * buckets — not even a default set.
 *
 * ## What this module does compute, and where
 *
 * Every figure comes from `inventory-buckets.ts`: the same bucket derivation, the same
 * current-stock rule, the same confirmed-quantity rule and the same review rule that the
 * Inventory page uses. Nothing here re-derives any of them.
 *
 * All aggregation happens in the database. The totals describe the complete filtered
 * result, so paging through the table cannot change them, and the summary never reads a
 * row per record into memory.
 *
 * Server-only.
 */

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

/**
 * The most location groups the summary will return in one response.
 *
 * Country and branch are low-cardinality in the canonical model, but "low" is an
 * expectation rather than a constraint the database enforces, so the query asks for one
 * row more than this and the response states plainly when the list is incomplete. The
 * figure that matters — how many distinct locations hold stock — is counted separately
 * and is always exact.
 */
export const AGING_LOCATION_MAX = 200;

/** Whether an authoritative aging anchor is configured. */
export const AGING_AVAILABILITY = ["AVAILABLE", "ANCHOR_NOT_CONFIRMED"] as const;
export type AgingAvailability = (typeof AGING_AVAILABILITY)[number];

/**
 * The single place that decides whether age may be computed.
 *
 * A constant today because no anchor is confirmed. When the client confirms one, this
 * becomes a configuration read and every consumer — the lot page, the dashboard, any
 * future export — changes with it, because they all ask here.
 */
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
  /**
   * The caller's country and lab authorization scope.
   *
   * It rides with the filters because it is applied in the same place they are, but it is
   * not a filter: it comes from the authenticated server session and a request can only
   * ever narrow within it, never widen past it.
   */
  readonly scope: EffectiveScope;
}

export const EMPTY_AGING_FILTERS: AgingFilters = {
  bucket: null, lab: null, shape: null,
  country: null, branch: null, department: null, location: null, search: null,
  scope: UNRESTRICTED_SCOPE,
};

export interface Paging { page: number; pageSize: number }
export interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

/**
 * One current lot.
 *
 * `agingStartDateIst` and `ageDays` are deliberately absent: there is no anchor, so
 * there is no start date and no age. `lastSourceUpdateIst` is present and labelled for
 * what it is — when the source last reported the record — so nobody mistakes it for age.
 */
export interface AgingLotRow {
  readonly lotId: string;
  readonly stoneName: string | null;
  readonly bucket: InventoryBucket;
  readonly bucketLabel: string;
  readonly categoryLabel: string;
  readonly lab: string | null;
  readonly shape: string | null;
  /** Null when the source never established a countable quantity. */
  readonly confirmedQuantity: number | null;
  /** Null when the unit is unconfirmed. Never shown as a quantity. */
  readonly measuredWeight: number | null;
  readonly country: string;
  readonly branch: string;
  readonly department: string | null;
  readonly location: string | null;
  /** When the source last reported this record. Not an age, and labelled as such. */
  readonly lastSourceUpdateIst: string | null;
  readonly dataState: "CONFIRMED" | "REVIEW_REQUIRED";
}

export interface AgingResult {
  /**
   * Where these records came from, aggregated over the filtered set. A page showing any
   * simulated lot is a simulated page: the stricter answer is the honest one.
   */
  readonly sourceDisclosure: SourceDisclosure;
  readonly availability: AgingAvailability;
  readonly unavailableMessage: string | null;
  readonly unavailableDetail: string | null;
  readonly bucketsMessage: string | null;
  readonly rows: AgingLotRow[];
  readonly paging: PagingMeta;
  /**
   * Whole-result figures. Every one of these is aggregated in the database over the
   * complete filtered set, so moving between pages cannot change any of them.
   */
  readonly totals: {
    readonly currentLots: number;
    readonly confirmedQuantity: number;
    readonly lotsNeedingReview: number;
  };
}

// ---------------------------------------------------------------------------
// The filtered current-stock set
// ---------------------------------------------------------------------------

/**
 * Filters, as SQL over the canonical table.
 *
 * `bucket` is compared against the derived bucket expression, never against the raw
 * `inventoryClass` column: they are different vocabularies, and comparing one to the
 * other silently matches nothing.
 */
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
  // Applied unconditionally, so a scoped caller sees their own scope by default rather
  // than the whole business.
  const scope = scopeSql(f.scope, { country: '"m"."country"', lab: '"m"."labNormalized"' });
  if (scope !== Prisma.empty) parts.push(scope);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

/**
 * The filtered set, bucketed and with its quantities already decided.
 *
 * Current stock is `currentStockSql`, not the bare `isCurrent` flag: a sold, transferred
 * or closed record is history even if the feed still publishes it.
 */
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
  // Weight keeps its in-memory provenance decision: it is a per-row display value and is
  // never summed into a headline figure, so there is nothing to aggregate in SQL.
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
    // The weight band lives on the demand metric, not on the canonical lot, so the
    // category label here carries lab and shape only rather than inventing a band.
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
    // The same rule the totals count. A row can never be flagged by one rule and totalled
    // by another, because there is only one rule.
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

/**
 * Current stock, paged on the server, with whole-result totals.
 *
 * Ordered by lot id rather than by any date: ordering by a date would imply that date
 * means something about age, which is precisely the claim this module refuses to make.
 */
export async function readAgingLots(
  filters: AgingFilters,
  paging: Paging,
  client: DbClient = db,
): Promise<AgingResult> {
  const pageSize = Math.min(Math.max(1, paging.pageSize), AGING_PAGE_MAX);
  const offset = (Math.max(1, paging.page) - 1) * pageSize;
  const cte = agingCte(filters);

  const [totalsRows, rows] = await Promise.all([
    // One pass over the filtered set for all three headline figures. A record whose
    // quantity was never confirmed contributes nothing to the total and is counted as
    // needing review instead — it is never assumed to be one piece.
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
  /**
   * Where these records came from, aggregated over the filtered set. A page showing any
   * simulated lot is a simulated page: the stricter answer is the honest one.
   */
  readonly sourceDisclosure: SourceDisclosure;
  readonly availability: AgingAvailability;
  readonly unavailableMessage: string | null;
  readonly unavailableDetail: string | null;
  readonly bucketsMessage: string | null;
  readonly currentLots: number;
  /** Grouped by derived inventory bucket — a factual distribution, never an age band. */
  readonly byBucket: AgingDistributionRow[];
  readonly byLocation: AgingDistributionRow[];
  /**
   * How many distinct country/branch combinations hold stock, and how many of them the
   * list above actually contains. When they differ the list is incomplete and says so
   * rather than presenting a truncated distribution as the whole picture.
   */
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

/**
 * The management view, over the same records and the same availability decision.
 *
 * Grouped by what is actually known — derived inventory bucket and location — rather than
 * by an age band that does not exist. Every group is aggregated by the database; nothing
 * reads the matching records into memory to add them up.
 */
export async function readAgingSummary(
  filters: AgingFilters,
  client: DbClient = db,
): Promise<AgingSummary> {
  const cte = agingCte(filters);

  const [totalsRows, byBucketRaw, byLocationRaw, locationCountRows] = await Promise.all([
    client.$queryRaw<Array<{ lots: bigint; simulated: boolean | null }>>`
      ${cte}
      SELECT COUNT(*) AS lots, BOOL_OR("is_simulated") AS simulated FROM inv`,
    // At most seven groups: the bucket vocabulary is closed, so this needs no limit.
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
    // One row more than the disclosed maximum, so the response can tell the difference
    // between "this is all of it" and "there is more that is not shown".
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
    // The key is the derived bucket, which is exactly what the Stock Aging filter accepts,
    // so a drill-down from this list always lands on the records it came from.
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
