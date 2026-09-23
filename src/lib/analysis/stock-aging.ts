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
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatIST } from "@/lib/fantasy/time";
import { resolveCanonicalQuantity, resolveCanonicalWeight } from "@/lib/fantasy/quantity-weight";
import { BUCKET_LABELS, type InventoryBucket } from "@/lib/analysis/inventory-position";

if (typeof window !== "undefined") {
  throw new Error("analysis/stock-aging is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const AGING_PAGE_DEFAULT = 50;
export const AGING_PAGE_MAX = 200;

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
}

export const EMPTY_AGING_FILTERS: AgingFilters = {
  bucket: null, lab: null, shape: null,
  country: null, branch: null, department: null, location: null, search: null,
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
  readonly bucket: InventoryBucket | null;
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

const ROW_SELECT = {
  lotId: true, stoneName: true, inventoryClass: true, classificationState: true,
  labNormalized: true, shapeNormalized: true, shape: true,
  quantity: true, quantityProvenance: true, weight: true, sourceType: true, isSimulated: true,
  country: true, branch: true, departmentName: true, locationName: true, lastSeenAt: true,
} as const;

type LotRow = Prisma.LotMasterRecordGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(l: LotRow): AgingLotRow {
  const quantity = resolveCanonicalQuantity(l);
  const weight = resolveCanonicalWeight(l);
  const bucket = (l.inventoryClass as InventoryBucket | null) ?? null;
  return {
    lotId: l.lotId,
    stoneName: l.stoneName,
    bucket,
    bucketLabel: bucket ? (BUCKET_LABELS[bucket] ?? "Unclassified") : "Unclassified",
    // The weight band lives on the demand metric, not on the canonical lot, so the
    // category label here carries lab and shape only rather than inventing a band.
    categoryLabel: [l.labNormalized, l.shapeNormalized ?? l.shape].filter(Boolean).join(" | ") || "Unclassified",
    lab: l.labNormalized,
    shape: l.shapeNormalized ?? l.shape,
    confirmedQuantity: quantity.pieces,
    measuredWeight: weight.carats,
    country: l.country,
    branch: l.branch,
    department: l.departmentName,
    location: l.locationName,
    lastSourceUpdateIst: l.lastSeenAt ? formatIST(l.lastSeenAt, false) : null,
    dataState:
      quantity.pieces === null || l.classificationState !== "CLASSIFIED" ? "REVIEW_REQUIRED" : "CONFIRMED",
  };
}

/** Current stock only. Sold and non-current records are history, not inventory. */
function whereFor(f: AgingFilters): Prisma.LotMasterRecordWhereInput {
  const where: Prisma.LotMasterRecordWhereInput = { isCurrent: true };
  if (f.bucket) where.inventoryClass = f.bucket;
  if (f.lab) where.labNormalized = f.lab;
  if (f.shape) where.shapeNormalized = f.shape;
  if (f.country) where.country = f.country;
  if (f.branch) where.branch = f.branch;
  if (f.department) where.departmentName = f.department;
  if (f.location) where.locationName = f.location;
  if (f.search) {
    const contains = f.search.replace(/[\\%_]/g, "\\$&");
    where.OR = [
      { lotId: { contains, mode: "insensitive" } },
      { stoneName: { contains, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * Current stock, paged on the server.
 *
 * Ordered by lot id rather than by any date: ordering by a date would imply that date
 * means something about age, which is precisely the claim this module refuses to make.
 */
export async function readAgingLots(
  filters: AgingFilters,
  paging: Paging,
  client: DbClient = db,
): Promise<AgingResult> {
  const where = whereFor(filters);
  const availability = resolveAgingAvailability();

  const [total, rows, reviewCount] = await Promise.all([
    client.lotMasterRecord.count({ where }),
    client.lotMasterRecord.findMany({
      where,
      orderBy: [{ lotId: "asc" }],
      skip: (paging.page - 1) * paging.pageSize,
      take: paging.pageSize,
      select: ROW_SELECT,
    }),
    client.lotMasterRecord.count({ where: { ...where, classificationState: { not: "CLASSIFIED" } } }),
  ]);

  const mapped = rows.map(toRow);

  return {
    availability,
    unavailableMessage: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_UNAVAILABLE_MESSAGE : null,
    unavailableDetail: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_UNAVAILABLE_DETAIL : null,
    bucketsMessage: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_BUCKETS_PENDING_MESSAGE : null,
    rows: mapped,
    paging: { page: paging.page, pageSize: paging.pageSize, total, hasMore: paging.page * paging.pageSize < total },
    totals: {
      currentLots: total,
      // Only pieces the source established. A record whose quantity was never supplied
      // contributes none, and is counted as needing review instead.
      confirmedQuantity: mapped.reduce((sum, r) => sum + (r.confirmedQuantity ?? 0), 0),
      lotsNeedingReview: reviewCount,
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
  readonly availability: AgingAvailability;
  readonly unavailableMessage: string | null;
  readonly unavailableDetail: string | null;
  readonly bucketsMessage: string | null;
  readonly currentLots: number;
  /** Grouped by inventory bucket — a factual distribution, never an age band. */
  readonly byBucket: AgingDistributionRow[];
  readonly byLocation: AgingDistributionRow[];
}

/**
 * The management view, over the same records and the same availability decision.
 *
 * Grouped by what is actually known — inventory bucket and location — rather than by an
 * age band that does not exist. It computes no age of its own, which is the whole point
 * of both pages sharing this module.
 */
export async function readAgingSummary(
  filters: AgingFilters,
  client: DbClient = db,
): Promise<AgingSummary> {
  const where = whereFor(filters);
  const availability = resolveAgingAvailability();

  const [currentLots, byBucketRaw, byLocationRaw] = await Promise.all([
    client.lotMasterRecord.count({ where }),
    client.lotMasterRecord.groupBy({
      by: ["inventoryClass"],
      where,
      _count: { _all: true },
    }),
    client.lotMasterRecord.groupBy({
      by: ["country", "branch"],
      where,
      _count: { _all: true },
    }),
  ]);

  // Quantity is summed through the shared provenance decision rather than with a SQL
  // SUM, so an unconfirmed quantity contributes nothing here exactly as it does
  // everywhere else.
  const countable = await client.lotMasterRecord.findMany({
    where,
    select: {
      inventoryClass: true, country: true, branch: true, classificationState: true,
      quantity: true, quantityProvenance: true, sourceType: true, isSimulated: true,
    },
  });

  const bucketQty = new Map<string, { qty: number; review: number }>();
  const locationQty = new Map<string, { qty: number; review: number }>();
  for (const l of countable) {
    const pieces = resolveCanonicalQuantity(l).pieces;
    const needsReview = pieces === null || l.classificationState !== "CLASSIFIED";
    const bKey = l.inventoryClass ?? "UNCLASSIFIED";
    const lKey = `${l.country}\u0001${l.branch}`;
    const b = bucketQty.get(bKey) ?? { qty: 0, review: 0 };
    const loc = locationQty.get(lKey) ?? { qty: 0, review: 0 };
    b.qty += pieces ?? 0;
    loc.qty += pieces ?? 0;
    if (needsReview) { b.review++; loc.review++; }
    bucketQty.set(bKey, b);
    locationQty.set(lKey, loc);
  }

  return {
    availability,
    unavailableMessage: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_UNAVAILABLE_MESSAGE : null,
    unavailableDetail: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_UNAVAILABLE_DETAIL : null,
    bucketsMessage: availability === "ANCHOR_NOT_CONFIRMED" ? AGING_BUCKETS_PENDING_MESSAGE : null,
    currentLots,
    byBucket: byBucketRaw
      .map((g) => {
        const key = g.inventoryClass ?? "UNCLASSIFIED";
        const q = bucketQty.get(key) ?? { qty: 0, review: 0 };
        return {
          key,
          label: g.inventoryClass
            ? (BUCKET_LABELS[g.inventoryClass as InventoryBucket] ?? "Unclassified")
            : "Unclassified",
          lotCount: g._count._all,
          confirmedQuantity: q.qty,
          lotsNeedingReview: q.review,
        };
      })
      .sort((a, b) => b.lotCount - a.lotCount || a.key.localeCompare(b.key)),
    byLocation: byLocationRaw
      .map((g) => {
        const key = `${g.country}\u0001${g.branch}`;
        const q = locationQty.get(key) ?? { qty: 0, review: 0 };
        return {
          key,
          label: `${g.country} / ${g.branch}`,
          lotCount: g._count._all,
          confirmedQuantity: q.qty,
          lotsNeedingReview: q.review,
        };
      })
      .sort((a, b) => b.lotCount - a.lotCount || a.key.localeCompare(b.key)),
  };
}
