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

export {
  BUCKET_LABELS,
  INVENTORY_BUCKETS,
  SHORTAGE_ELIGIBLE_BUCKET,
  bucketLabel,
  isInventoryBucket,
};
export type { InventoryBucket };

export const NON_INVENTORY_LIFECYCLES: readonly CanonicalLifecycle[] = ["SOLD", "TRANSFERRED", "CLOSED"];

const _lifecyclesExist: readonly CanonicalLifecycle[] = CANONICAL_LIFECYCLES;
void _lifecyclesExist;

export function currentStockSql(alias = "m"): Prisma.Sql {
  const lifecycle = Prisma.raw(`"${alias}"."canonicalLifecycle"`);
  const isCurrent = Prisma.raw(`"${alias}"."isCurrent"`);
  return Prisma.sql`(
    ${isCurrent} = TRUE
    AND (${lifecycle} IS NULL OR ${lifecycle} NOT IN (${Prisma.join(NON_INVENTORY_LIFECYCLES)}))
  )`;
}

export const CURRENT_STOCK_WHERE: Prisma.LotMasterRecordWhereInput = {
  isCurrent: true,
  OR: [
    { canonicalLifecycle: null },
    { canonicalLifecycle: { notIn: [...NON_INVENTORY_LIFECYCLES] } },
  ],
};

export function isCurrentStock(record: {
  isCurrent: boolean;
  canonicalLifecycle: string | null;
}): boolean {
  if (!record.isCurrent) return false;
  if (record.canonicalLifecycle === null) return true;
  return !(NON_INVENTORY_LIFECYCLES as readonly string[]).includes(record.canonicalLifecycle);
}

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

export function confirmedQuantitySql(alias = "m"): Prisma.Sql {
  const prov = Prisma.raw(`"${alias}"."quantityProvenance"`);
  const qty = Prisma.raw(`"${alias}"."quantity"`);
  const src = Prisma.raw(`"${alias}"."sourceType"`);
  const sim = Prisma.raw(`"${alias}"."isSimulated"`);
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

export function needsReviewSql(alias = "m"): Prisma.Sql {
  const state = Prisma.raw(`"${alias}"."classificationState"`);
  return Prisma.sql`(
    ${confirmedQuantitySql(alias)} IS NULL
    OR ${state} IS NULL
    OR ${state} <> 'CLASSIFIED'
  )`;
}

export function needsReview(record: {
  confirmedPieces: number | null;
  classificationState: string | null;
}): boolean {
  return record.confirmedPieces === null || record.classificationState !== "CLASSIFIED";
}
