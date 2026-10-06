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

export const SHORTAGE_ELIGIBLE_BUCKET: InventoryBucket = "PHYSICAL_AVAILABLE_POLISHED";

export function isInventoryBucket(value: unknown): value is InventoryBucket {
  return typeof value === "string" && (INVENTORY_BUCKETS as readonly string[]).includes(value);
}

export function bucketLabel(value: unknown): string {
  return isInventoryBucket(value) ? BUCKET_LABELS[value] : BUCKET_LABELS.REVIEW_REQUIRED;
}
