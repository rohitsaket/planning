/**
 * INVENTORY BUCKET VOCABULARY — the bucket names and their labels, and nothing else.
 *
 * This module is deliberately free of Prisma, of the database and of any server-only
 * guard, because the navigation store and the Analysis views need to recognize a bucket
 * key in order to carry a drill-down and to render a label. Only the names travel: the
 * rule that decides which records belong to which bucket lives in `inventory-buckets.ts`
 * and stays on the server.
 *
 * The labels are already on screen wherever stock is grouped, so nothing here tells a
 * browser anything it was not already shown.
 */

/**
 * The seven top-level buckets. Every current canonical record lands in exactly one.
 *
 * Only `PHYSICAL_AVAILABLE_POLISHED` may reduce finished-stock shortage. The other six
 * exist so that stock which cannot is still visible, rather than being hidden or quietly
 * folded into the figure that drives procurement.
 */
export const INVENTORY_BUCKETS = [
  "PHYSICAL_AVAILABLE_POLISHED",
  "RESERVED_POLISHED",
  "MEMO_POLISHED",
  "MANUFACTURING_WIP",
  "ROUGH_AVAILABLE",
  "HELD_OR_EXCLUDED",
  "REVIEW_REQUIRED",
] as const;
export type InventoryBucket = (typeof INVENTORY_BUCKETS)[number];

export const BUCKET_LABELS: Record<InventoryBucket, string> = {
  PHYSICAL_AVAILABLE_POLISHED: "Physical available polished",
  RESERVED_POLISHED: "Reserved / allocated polished",
  MEMO_POLISHED: "Memo / consignment polished",
  MANUFACTURING_WIP: "Manufacturing WIP",
  ROUGH_AVAILABLE: "Available rough",
  HELD_OR_EXCLUDED: "Held, unknown or excluded",
  REVIEW_REQUIRED: "Review required / unclassified",
};

/** The one bucket that may reduce finished-stock shortage. */
export const SHORTAGE_ELIGIBLE_BUCKET: InventoryBucket = "PHYSICAL_AVAILABLE_POLISHED";

/**
 * The only way a value becomes an `InventoryBucket`.
 *
 * A raw `inventoryClass` — `PHYSICAL_AVAILABLE`, `MEMO`, `RESERVED`, `WIP`, `EXCLUDED` —
 * is a different vocabulary and fails this check, which is the point: casting one to the
 * other produces a filter that quietly matches nothing.
 */
export function isInventoryBucket(value: unknown): value is InventoryBucket {
  return typeof value === "string" && (INVENTORY_BUCKETS as readonly string[]).includes(value);
}

/** A label for a value that may not be a bucket at all — never cast, always resolve. */
export function bucketLabel(value: unknown): string {
  return isInventoryBucket(value) ? BUCKET_LABELS[value] : BUCKET_LABELS.REVIEW_REQUIRED;
}
