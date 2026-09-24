/**
 * INVENTORY BUCKETS — the single server-side definition of what a stock record is.
 *
 * Every Analysis surface that counts, groups or filters current stock — Inventory,
 * Stock Aging, the Aging Dashboard, Transfer distribution — derives its buckets here and
 * nowhere else. Before this module the bucket CASE lived inside `inventory-position.ts`
 * as a private constant, so a second page that wanted buckets had to either copy the
 * expression or, as Stock Aging did, cast the raw `inventoryClass` column to the derived
 * `InventoryBucket` type. That cast is a category error: `PHYSICAL_AVAILABLE` and
 * `PHYSICAL_AVAILABLE_POLISHED` are different vocabularies, so every filter compared a
 * derived value against a raw column and matched nothing.
 *
 * Three things are defined here, each in a database form and an in-memory form that a
 * test drives against each other so they cannot drift:
 *
 *   1. `inventoryBucketSql` / `deriveInventoryBucket` — the same branch order expressed
 *      for raw SQL and for callers holding a row.
 *   2. `currentStockSql` / `CURRENT_STOCK_WHERE` / `isCurrentStock` — which records
 *      represent stock at all.
 *   3. `confirmedQuantitySql` / `needsReviewSql` — which pieces may enter a total, and
 *      which records have to be looked at first. These exist in SQL so that a page total
 *      can cover the whole filtered result instead of the rows one page happens to show.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { CANONICAL_LIFECYCLES, type CanonicalLifecycle } from "@/lib/fantasy/classification";
import {
  BUCKET_LABELS,
  INVENTORY_BUCKETS,
  SHORTAGE_ELIGIBLE_BUCKET,
  bucketLabel,
  isInventoryBucket,
  type InventoryBucket,
} from "@/lib/analysis/bucket-vocabulary";

if (typeof window !== "undefined") {
  throw new Error("analysis/inventory-buckets is server-only and must not be imported by client code.");
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The bucket names and labels live in `bucket-vocabulary.ts`, which carries no database
 * dependency, so the navigation store and the Analysis views can recognize a bucket key
 * without importing anything server-only. They are re-exported here because this module
 * is where server code looks for everything about buckets.
 */
export {
  BUCKET_LABELS,
  INVENTORY_BUCKETS,
  SHORTAGE_ELIGIBLE_BUCKET,
  bucketLabel,
  isInventoryBucket,
};
export type { InventoryBucket };

// ---------------------------------------------------------------------------
// Current-stock eligibility
// ---------------------------------------------------------------------------

/**
 * Lifecycles that are definitively not inventory, whatever the feed says.
 *
 * `isCurrent` is a source-feed fact: it means the record was present in the last live
 * extract, not that the goods are in stock. The synchronizer does set `isCurrent = false`
 * when it processes a removal event, so on the canonical path the two agree — but a feed
 * that publishes a sold or closed row without a removal event, or a record written by any
 * other path, would otherwise be counted as stock on the strength of that flag alone.
 * These three states are drawn from the confirmed `CANONICAL_LIFECYCLES` vocabulary and
 * are unambiguous; `UNKNOWN` is deliberately NOT here, because unknown is a reason to show
 * the record for review, not a reason to assert it has left.
 */
export const NON_INVENTORY_LIFECYCLES: readonly CanonicalLifecycle[] = ["SOLD", "TRANSFERRED", "CLOSED"];

// Fails the build if one of these names is dropped or renamed in the source vocabulary.
const _lifecyclesExist: readonly CanonicalLifecycle[] = CANONICAL_LIFECYCLES;
void _lifecyclesExist;

/**
 * Raw-SQL predicate for "this record represents inventory today".
 *
 * `canonicalLifecycle` is nullable, and `NOT IN` yields NULL — not TRUE — for a NULL
 * left-hand side, which would silently drop every unclassified record. The null case is
 * therefore stated explicitly and resolves to eligible: a record whose lifecycle is
 * unknown stays visible and is bucketed as review required.
 */
export function currentStockSql(alias = "m"): Prisma.Sql {
  const lifecycle = Prisma.raw(`"${alias}"."canonicalLifecycle"`);
  const isCurrent = Prisma.raw(`"${alias}"."isCurrent"`);
  return Prisma.sql`(
    ${isCurrent} = TRUE
    AND (${lifecycle} IS NULL OR ${lifecycle} NOT IN (${Prisma.join(NON_INVENTORY_LIFECYCLES)}))
  )`;
}

/**
 * The same eligibility rule for Prisma query-builder callers.
 *
 * `notIn` on a nullable column excludes NULL rows in Prisma, so the null case is spelled
 * out here exactly as it is in the SQL above.
 */
export const CURRENT_STOCK_WHERE: Prisma.LotMasterRecordWhereInput = {
  isCurrent: true,
  OR: [
    { canonicalLifecycle: null },
    { canonicalLifecycle: { notIn: [...NON_INVENTORY_LIFECYCLES] } },
  ],
};

/** In-memory form of the same rule, for callers holding a row. */
export function isCurrentStock(record: {
  isCurrent: boolean;
  canonicalLifecycle: string | null;
}): boolean {
  if (!record.isCurrent) return false;
  if (record.canonicalLifecycle === null) return true;
  return !(NON_INVENTORY_LIFECYCLES as readonly string[]).includes(record.canonicalLifecycle);
}

// ---------------------------------------------------------------------------
// Bucket derivation
// ---------------------------------------------------------------------------

/**
 * SQL that files each record into exactly one bucket.
 *
 * The order of the branches is the safety property. Unclassified is tested first so a
 * record with no classification can never fall through into stock; hold is tested next
 * so a held or unknown-hold record is unavailable even if its class says otherwise. Both
 * are restrictive-only: this expression can move a record to a safer bucket, never to a
 * more permissive one than the classifier assigned.
 *
 * `alias` is the SQL table alias of `LotMasterRecord` in the calling query. It is an
 * identifier chosen by this codebase, never by a request.
 */
export function inventoryBucketSql(alias = "m"): Prisma.Sql {
  const state = Prisma.raw(`"${alias}"."classificationState"`);
  const cls = Prisma.raw(`"${alias}"."inventoryClass"`);
  const hold = Prisma.raw(`"${alias}"."holdState"`);
  const form = Prisma.raw(`"${alias}"."roughOrPolished"`);
  return Prisma.sql`
  CASE
    WHEN ${state} IS NULL
      OR ${cls} IS NULL
      OR ${state} <> 'CLASSIFIED'
      THEN 'REVIEW_REQUIRED'
    WHEN ${hold} IS NULL OR ${hold} IN ('HELD', 'UNKNOWN')
      THEN 'HELD_OR_EXCLUDED'
    WHEN ${cls} = 'PHYSICAL_AVAILABLE' AND ${form} = 'ROUGH'
      THEN 'ROUGH_AVAILABLE'
    WHEN ${cls} = 'PHYSICAL_AVAILABLE'
      THEN 'PHYSICAL_AVAILABLE_POLISHED'
    WHEN ${cls} = 'RESERVED'  THEN 'RESERVED_POLISHED'
    WHEN ${cls} = 'MEMO'      THEN 'MEMO_POLISHED'
    WHEN ${cls} = 'WIP'       THEN 'MANUFACTURING_WIP'
    ELSE 'HELD_OR_EXCLUDED'
  END`;
}

/** The columns `deriveInventoryBucket` needs. Use as a Prisma `select` to avoid drift. */
export const BUCKET_SELECT = {
  classificationState: true,
  inventoryClass: true,
  holdState: true,
  roughOrPolished: true,
} as const;

export interface BucketInput {
  readonly classificationState: string | null;
  readonly inventoryClass: string | null;
  readonly holdState: string | null;
  readonly roughOrPolished: string | null;
}

/**
 * In-memory twin of `inventoryBucketSql`, branch for branch and in the same order.
 * `tests/security/inventory-buckets.test.ts` asserts the two never diverge.
 */
export function deriveInventoryBucket(r: BucketInput): InventoryBucket {
  if (r.classificationState === null || r.inventoryClass === null || r.classificationState !== "CLASSIFIED") {
    return "REVIEW_REQUIRED";
  }
  if (r.holdState === null || r.holdState === "HELD" || r.holdState === "UNKNOWN") {
    return "HELD_OR_EXCLUDED";
  }
  if (r.inventoryClass === "PHYSICAL_AVAILABLE") {
    return r.roughOrPolished === "ROUGH" ? "ROUGH_AVAILABLE" : "PHYSICAL_AVAILABLE_POLISHED";
  }
  if (r.inventoryClass === "RESERVED") return "RESERVED_POLISHED";
  if (r.inventoryClass === "MEMO") return "MEMO_POLISHED";
  if (r.inventoryClass === "WIP") return "MANUFACTURING_WIP";
  return "HELD_OR_EXCLUDED";
}

// ---------------------------------------------------------------------------
// Confirmed quantity
// ---------------------------------------------------------------------------

/**
 * SQL that yields the pieces a record contributes to an authoritative total, or NULL.
 *
 * This is `resolveCanonicalQuantity` expressed for the database, and it exists because
 * page totals have to be aggregated over the whole filtered result rather than over the
 * rows one page happens to show. Summing in memory means reading every matching record,
 * which is exactly the unbounded scan the aging summary used to perform.
 *
 * The branch order mirrors the TypeScript decision exactly:
 *
 *   1. A record that recorded its own provenance is trusted over any inference from
 *      columns. Only `EXPLICIT_FIXTURE` and `LIVE_CONFIRMED` are countable.
 *   2. Any other recorded provenance yields NULL — the quantity exists but may not be
 *      summed, and the record is reported for review instead.
 *   3. With no recorded provenance the source profile decides. Only the approved fixture
 *      profile confirms that a quantity means pieces; a live record stays uncounted until
 *      its quantity semantics are confirmed.
 *
 * In every countable branch the value must still be a whole number greater than zero: a
 * fractional quantity is a structure this build cannot interpret, and zero has no
 * confirmed meaning. `tests/security/inventory-buckets.test.ts` drives this expression and
 * `resolveCanonicalQuantity` over the same records and asserts they never disagree.
 */
export function confirmedQuantitySql(alias = "m"): Prisma.Sql {
  const prov = Prisma.raw(`"${alias}"."quantityProvenance"`);
  const qty = Prisma.raw(`"${alias}"."quantity"`);
  const src = Prisma.raw(`"${alias}"."sourceType"`);
  const sim = Prisma.raw(`"${alias}"."isSimulated"`);
  // Whole, positive, present. Anything else is not a piece count.
  const wholePositive = Prisma.sql`(${qty} IS NOT NULL AND ${qty} > 0 AND ${qty} = TRUNC(${qty}))`;
  return Prisma.sql`
  CASE
    WHEN ${prov} IN ('EXPLICIT_FIXTURE', 'LIVE_CONFIRMED')
      THEN CASE WHEN ${wholePositive} THEN ${qty} ELSE NULL END
    WHEN ${prov} IN ('MISSING', 'INVALID', 'UNSUPPORTED', 'LEGACY_DEFAULT_AMBIGUOUS', 'SEMANTICS_NOT_CONFIGURED')
      THEN NULL
    WHEN ${src} = 'FIXTURE' AND ${sim} = TRUE
      THEN CASE WHEN ${wholePositive} THEN ${qty} ELSE NULL END
    ELSE NULL
  END`;
}

/**
 * SQL for "this record has to be looked at before its numbers can be trusted".
 *
 * Two independent reasons, and a record needs only one of them: its quantity could not be
 * confirmed as pieces, or its classification is missing or incomplete. `classificationState`
 * is nullable, so the null case is written out rather than left to `<>`, which would
 * evaluate to NULL and quietly drop the very records this figure is counting.
 *
 * Every surface that shows a "needs review" figure and every surface that flags a row uses
 * this one rule, so a page cannot flag five hundred rows while reporting a total of zero.
 */
export function needsReviewSql(alias = "m"): Prisma.Sql {
  const state = Prisma.raw(`"${alias}"."classificationState"`);
  return Prisma.sql`(
    ${confirmedQuantitySql(alias)} IS NULL
    OR ${state} IS NULL
    OR ${state} <> 'CLASSIFIED'
  )`;
}

/**
 * In-memory twin of `needsReviewSql`. `confirmedPieces` is the outcome of
 * `resolveCanonicalQuantity` for the same record.
 */
export function needsReview(record: {
  confirmedPieces: number | null;
  classificationState: string | null;
}): boolean {
  return record.confirmedPieces === null || record.classificationState !== "CLASSIFIED";
}
