/**
 * ANALYSIS INVENTORY — current canonical stock, by the centralized classification.
 *
 * The authoritative source is `LotMasterRecord` where `isCurrent = true`, bucketed by
 * the classification the classifier already persisted. This module re-derives no status
 * rule: it reads `inventoryClass`, `holdState` and `classificationState` and files each
 * record under exactly one bucket.
 *
 * What is deliberately NOT a source here:
 *
 *   - `PolishedStone` / `RoughStone` / `MemoRecord` — legacy seeded operational mirrors.
 *     They may be compared against canonical stock for reconciliation, and they may
 *     restrict, but they can never promote an excluded canonical record into available
 *     stock.
 *   - `FantasyProjectionCandidate` — shadow projection output, never authoritative.
 *   - Non-current records — a sold, closed or superseded version is history, not stock.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { formatIST } from "@/lib/fantasy/time";
import { resolveQuantityProvenance, type QuantityProvenance } from "@/lib/demand/confirmed-sales";

if (typeof window !== "undefined") {
  throw new Error("analysis/inventory-position is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

export const INVENTORY_PAGE_MAX = 200;
export const INVENTORY_PAGE_DEFAULT = 25;
const GROUP_CEILING = 5_000;

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

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
 * SQL that files each record into exactly one bucket.
 *
 * The order of the branches is the safety property. Unclassified is tested first so a
 * record with no classification can never fall through into stock; hold is tested next
 * so a held or unknown-hold record is unavailable even if its class says otherwise. Both
 * are restrictive-only: this expression can move a record to a safer bucket, never to a
 * more permissive one than the classifier assigned.
 */
const BUCKET_SQL = Prisma.sql`
  CASE
    WHEN "m"."classificationState" IS NULL
      OR "m"."inventoryClass" IS NULL
      OR "m"."classificationState" <> 'CLASSIFIED'
      THEN 'REVIEW_REQUIRED'
    WHEN "m"."holdState" IS NULL OR "m"."holdState" IN ('HELD', 'UNKNOWN')
      THEN 'HELD_OR_EXCLUDED'
    WHEN "m"."inventoryClass" = 'PHYSICAL_AVAILABLE' AND "m"."roughOrPolished" = 'ROUGH'
      THEN 'ROUGH_AVAILABLE'
    WHEN "m"."inventoryClass" = 'PHYSICAL_AVAILABLE'
      THEN 'PHYSICAL_AVAILABLE_POLISHED'
    WHEN "m"."inventoryClass" = 'RESERVED'  THEN 'RESERVED_POLISHED'
    WHEN "m"."inventoryClass" = 'MEMO'      THEN 'MEMO_POLISHED'
    WHEN "m"."inventoryClass" = 'WIP'       THEN 'MANUFACTURING_WIP'
    ELSE 'HELD_OR_EXCLUDED'
  END`;

// ---------------------------------------------------------------------------
// Quantity and weight provenance
// ---------------------------------------------------------------------------

/**
 * A quantity counts as confirmed pieces only when all of these hold.
 *
 * There is no `?? 1` and no `> 0 ? q : 1`: a record whose quantity cannot be confirmed
 * keeps its row, is counted in the review figures, and contributes nothing to the piece
 * total. Its lot is still visible — only the number is withheld.
 */
const CONFIRMED_QUANTITY_SQL = Prisma.sql`
  CASE
    WHEN "m"."sourceType" = 'FIXTURE' AND "m"."isSimulated" = TRUE
         AND "m"."quantity" IS NOT NULL AND "m"."quantity" > 0 AND "m"."quantity" <= 1000
      THEN "m"."quantity"
    ELSE 0
  END`;

/** Weight counts only when measured and positive. No estimated weight exists on this model. */
const MEASURED_WEIGHT_SQL = Prisma.sql`
  CASE WHEN "m"."weight" IS NOT NULL AND "m"."weight" > 0 THEN "m"."weight" ELSE 0 END`;

/** True when the record's quantity could not be confirmed as pieces. */
const UNCONFIRMED_QUANTITY_SQL = Prisma.sql`
  (NOT ("m"."sourceType" = 'FIXTURE' AND "m"."isSimulated" = TRUE
        AND "m"."quantity" IS NOT NULL AND "m"."quantity" > 0 AND "m"."quantity" <= 1000))`;

export type { QuantityProvenance };
export { resolveQuantityProvenance };

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface InventoryFilters {
  readonly country: string | null;
  readonly branch: string | null;
  readonly lab: string | null;
  readonly shape: string | null;
  readonly weightBand: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly bucket: InventoryBucket | null;
  readonly stockType: "POLISHED" | "ROUGH" | "WIP" | null;
  readonly lifecycle: string | null;
  readonly holdState: string | null;
  readonly classificationState: string | null;
  readonly search: string | null;
}

export const EMPTY_INVENTORY_FILTERS: InventoryFilters = {
  country: null, branch: null, lab: null, shape: null, weightBand: null,
  department: null, location: null, bucket: null, stockType: null,
  lifecycle: null, holdState: null, classificationState: null, search: null,
};

function filterSql(f: InventoryFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.country) parts.push(Prisma.sql`AND "m"."country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`AND "m"."branch" = ${f.branch}`);
  if (f.lab) parts.push(Prisma.sql`AND "m"."labNormalized" = ${f.lab}`);
  if (f.shape) parts.push(Prisma.sql`AND COALESCE("m"."shapeNormalized", "m"."shape") = ${f.shape}`);
  if (f.department) parts.push(Prisma.sql`AND "m"."departmentName" = ${f.department}`);
  if (f.location) parts.push(Prisma.sql`AND "m"."locationName" = ${f.location}`);
  if (f.stockType) parts.push(Prisma.sql`AND "m"."roughOrPolished" = ${f.stockType}`);
  if (f.lifecycle) parts.push(Prisma.sql`AND "m"."canonicalLifecycle" = ${f.lifecycle}`);
  if (f.holdState) parts.push(Prisma.sql`AND "m"."holdState" = ${f.holdState}`);
  if (f.classificationState) parts.push(Prisma.sql`AND "m"."classificationState" = ${f.classificationState}`);
  if (f.bucket) parts.push(Prisma.sql`AND ${BUCKET_SQL} = ${f.bucket}`);
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, "\\$&")}%`;
    parts.push(Prisma.sql`AND ("m"."lotId" ILIKE ${like} OR COALESCE("m"."stoneName", '') ILIKE ${like})`);
  }
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

/**
 * The current canonical inventory, already filtered and bucketed.
 *
 * `isCurrent = TRUE` is the line between stock and history: a sold, transferred or
 * superseded version is excluded here and cannot reappear as inventory downstream.
 */
function inventoryCte(f: InventoryFilters): Prisma.Sql {
  return Prisma.sql`
    WITH inv AS (
      SELECT
        "m"."id"                AS record_id,
        "m"."lotId"             AS lot_id,
        "m"."sourceRecordId"    AS source_record_id,
        ${BUCKET_SQL}           AS bucket,
        "m"."roughOrPolished"   AS stock_type,
        "m"."canonicalLifecycle" AS lifecycle,
        "m"."inventoryClass"    AS inventory_class,
        "m"."classificationState" AS classification_state,
        "m"."classificationReasons" AS classification_reasons,
        "m"."classificationPlanningEligible" AS planning_eligible,
        "m"."holdState"         AS hold_state,
        "m"."currentStatus"     AS current_status,
        COALESCE("m"."labNormalized", '')  AS lab,
        COALESCE("m"."shapeNormalized", "m"."shape", '') AS shape,
        COALESCE("b"."label", '')          AS weight_band,
        ${CONFIRMED_QUANTITY_SQL}::float8  AS confirmed_qty,
        ${UNCONFIRMED_QUANTITY_SQL}        AS qty_unconfirmed,
        ${MEASURED_WEIGHT_SQL}::float8     AS measured_weight,
        "m"."country"           AS country,
        "m"."branch"            AS branch,
        "m"."departmentName"    AS department,
        "m"."locationName"      AS location,
        "m"."firstSeenAt"       AS first_seen,
        "m"."lastSeenAt"        AS last_seen,
        "m"."sourceUpdatedAt"   AS source_updated,
        "m"."isSimulated"       AS is_simulated,
        "m"."sourceType"        AS source_type
      FROM "LotMasterRecord" "m"
      LEFT JOIN "WeightBand" "b"
        ON "m"."weight" >= "b"."minCt" AND "m"."weight" <= "b"."maxCt" AND "b"."active" = TRUE
      WHERE "m"."isCurrent" = TRUE
        ${filterSql(f)}
    )
  `;
}

export interface Paging { readonly page: number; readonly pageSize: number }
export interface PagingMeta {
  readonly page: number; readonly pageSize: number; readonly total: number; readonly hasMore: boolean;
}

function pageMeta(p: Paging, total: number): PagingMeta {
  const pageSize = Math.min(Math.max(1, p.pageSize), INVENTORY_PAGE_MAX);
  return { page: p.page, pageSize, total, hasMore: p.page * pageSize < total };
}

// ---------------------------------------------------------------------------
// A. Readiness
// ---------------------------------------------------------------------------

export const READINESS_STATES = [
  "CURRENT", "SIMULATED", "STALE", "INCOMPLETE", "UNKNOWN",
  "UNAVAILABLE", "NOT_CONFIGURED", "BLOCKED_BY_DATA_QUALITY",
] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];

export interface ReadinessRow {
  readonly key: string; readonly label: string; readonly value: string; readonly state: ReadinessState;
}

export interface InventoryReadiness {
  readonly rows: readonly ReadinessRow[];
  readonly isSimulated: boolean;
  readonly sourceLabel: string;
  readonly currentRecordCount: number;
  readonly lastSourceUpdate: string | null;
  /** True when inventory changed after the latest demand run finished. */
  readonly inventoryNewerThanDemandRun: boolean;
  readonly demandRunAtIst: string | null;
}

export async function readInventoryReadiness(client: DbClient = db): Promise<InventoryReadiness> {
  const [counts, lastSync, latestRun, blockingIssues] = await Promise.all([
    client.$queryRaw<Array<{
      total: number; classified: number; review: number; unknown_hold: number;
      unmapped_status: number; missing_category: number; qty_unconfirmed: number;
      weight_missing: number; simulated: number; last_seen: Date | null; source_cutoff: Date | null;
    }>>`
      SELECT
        COUNT(*)::int AS total,
        (COUNT(*) FILTER (WHERE "classificationState" = 'CLASSIFIED'))::int AS classified,
        (COUNT(*) FILTER (WHERE "classificationState" IS NULL OR "classificationState" <> 'CLASSIFIED'))::int AS review,
        (COUNT(*) FILTER (WHERE "holdState" IS NULL OR "holdState" = 'UNKNOWN'))::int AS unknown_hold,
        (COUNT(*) FILTER (WHERE "canonicalLifecycle" IS NULL OR "canonicalLifecycle" = 'UNKNOWN'))::int AS unmapped_status,
        (COUNT(*) FILTER (WHERE "labNormalized" IS NULL OR "shapeNormalized" IS NULL))::int AS missing_category,
        (COUNT(*) FILTER (WHERE NOT ("sourceType" = 'FIXTURE' AND "isSimulated" = TRUE AND "quantity" > 0)))::int AS qty_unconfirmed,
        (COUNT(*) FILTER (WHERE "weight" IS NULL OR "weight" <= 0))::int AS weight_missing,
        (COUNT(*) FILTER (WHERE "isSimulated" = TRUE))::int AS simulated,
        MAX("lastSeenAt") AS last_seen,
        MAX("sourceUpdatedAt") AS source_cutoff
      FROM "LotMasterRecord" WHERE "isCurrent" = TRUE`,
    client.integrationSyncRun.findFirst({
      where: { source: { in: ["FANTASY", "Fantasy"] }, status: "SUCCESS" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true, sourceCutoff: true },
    }),
    client.demandRun.findFirst({
      where: { status: { in: ["COMPLETED", "REVIEW_REQUIRED"] }, finishedAt: { not: null } },
      orderBy: { runDate: "desc" },
      select: { finishedAt: true, runDate: true },
    }),
    client.dataQualityIssue.count({ where: { severity: "BLOCKING", status: { in: ["OPEN", "IN_REVIEW"] } } }),
  ]);

  const c = counts[0];
  const total = c?.total ?? 0;
  const simulated = total > 0 && (c?.simulated ?? 0) === total;
  const lastSourceUpdate = c?.last_seen ?? null;
  const runFinishedAt = latestRun?.finishedAt ?? latestRun?.runDate ?? null;

  // Reported, never acted on: this module does not recompute a stored demand result.
  const inventoryNewerThanDemandRun =
    lastSourceUpdate !== null && runFinishedAt !== null && lastSourceUpdate.getTime() > runFinishedAt.getTime();

  const unavailableWhenEmpty = (v: number): ReadinessState =>
    total === 0 ? "UNAVAILABLE" : v > 0 ? "INCOMPLETE" : "CURRENT";

  const rows: ReadinessRow[] = [
    { key: "sourceMode", label: "Effective source mode", value: total === 0 ? "No canonical records" : simulated ? "FIXTURE_SIMULATION" : "LIVE_FANTASY", state: total === 0 ? "UNAVAILABLE" : simulated ? "SIMULATED" : "CURRENT" },
    { key: "sourceKind", label: "Data origin", value: total === 0 ? "Unavailable" : simulated ? "Fixture Simulation" : "Live Fantasy", state: total === 0 ? "UNAVAILABLE" : simulated ? "SIMULATED" : "CURRENT" },
    { key: "lastSync", label: "Last successful Fantasy sync", value: lastSync?.finishedAt ? formatIST(lastSync.finishedAt, false) : "Never", state: lastSync?.finishedAt ? (simulated ? "SIMULATED" : "CURRENT") : "UNAVAILABLE" },
    { key: "sourceCutoff", label: "Source cutoff", value: lastSync?.sourceCutoff ? formatIST(lastSync.sourceCutoff, false) : "Not reported", state: lastSync?.sourceCutoff ? "CURRENT" : "UNKNOWN" },
    { key: "records", label: "Current canonical records", value: String(total), state: total > 0 ? "CURRENT" : "UNAVAILABLE" },
    { key: "classified", label: "Classified records", value: total === 0 ? "Unavailable" : String(c.classified), state: total === 0 ? "UNAVAILABLE" : c.classified === total ? "CURRENT" : "INCOMPLETE" },
    { key: "review", label: "Review-required records", value: total === 0 ? "Unavailable" : String(c.review), state: unavailableWhenEmpty(c?.review ?? 0) },
    { key: "unknownHold", label: "Unknown or missing hold", value: total === 0 ? "Unavailable" : String(c.unknown_hold), state: unavailableWhenEmpty(c?.unknown_hold ?? 0) },
    { key: "unmappedStatus", label: "Unmapped lifecycle", value: total === 0 ? "Unavailable" : String(c.unmapped_status), state: unavailableWhenEmpty(c?.unmapped_status ?? 0) },
    { key: "missingCategory", label: "Missing category dimension", value: total === 0 ? "Unavailable" : String(c.missing_category), state: unavailableWhenEmpty(c?.missing_category ?? 0) },
    { key: "quantityProvenance", label: "Quantity provenance", value: total === 0 ? "Unavailable" : c.qty_unconfirmed > 0 ? `${c.qty_unconfirmed} unconfirmed` : "All confirmed", state: unavailableWhenEmpty(c?.qty_unconfirmed ?? 0) },
    { key: "weightProvenance", label: "Measured weight provenance", value: total === 0 ? "Unavailable" : c.weight_missing > 0 ? `${c.weight_missing} missing` : "All measured", state: unavailableWhenEmpty(c?.weight_missing ?? 0) },
    { key: "freshness", label: "Inventory freshness", value: lastSourceUpdate ? formatIST(lastSourceUpdate, false) : "Unknown", state: lastSourceUpdate ? (simulated ? "SIMULATED" : "CURRENT") : "UNKNOWN" },
    { key: "vsDemand", label: "Inventory vs latest demand run", value: !runFinishedAt ? "No demand run" : inventoryNewerThanDemandRun ? "Inventory has changed since the latest demand calculation." : "Demand run is at least as recent", state: !runFinishedAt ? "NOT_CONFIGURED" : inventoryNewerThanDemandRun ? "STALE" : "CURRENT" },
    { key: "blocking", label: "Blocking data-quality issues", value: String(blockingIssues), state: blockingIssues > 0 ? "BLOCKED_BY_DATA_QUALITY" : "CURRENT" },
  ];

  return {
    rows,
    isSimulated: simulated,
    sourceLabel: simulated ? "Source: Fixture Simulation" : total === 0 ? "No canonical inventory" : "Source: Live Fantasy",
    currentRecordCount: total,
    lastSourceUpdate: lastSourceUpdate ? lastSourceUpdate.toISOString() : null,
    inventoryNewerThanDemandRun,
    demandRunAtIst: runFinishedAt ? formatIST(runFinishedAt, false) : null,
  };
}

// ---------------------------------------------------------------------------
// B. Inventory position
// ---------------------------------------------------------------------------

export const POSITION_GROUPINGS = ["bucket", "country", "branch", "lab", "shape", "weightBand"] as const;
export type PositionGrouping = (typeof POSITION_GROUPINGS)[number];

const GROUP_COLUMN: Record<PositionGrouping, Prisma.Sql> = {
  bucket: Prisma.sql`bucket`,
  country: Prisma.sql`country`,
  branch: Prisma.sql`branch`,
  lab: Prisma.sql`lab`,
  shape: Prisma.sql`shape`,
  weightBand: Prisma.sql`weight_band`,
};

export interface PositionRow {
  readonly groupKey: string;
  readonly bucket: InventoryBucket | null;
  readonly confirmedQuantity: number;
  readonly measuredWeight: number;
  readonly lotRecordCount: number;
  readonly reviewRequiredCount: number;
  readonly unconfirmedQuantityCount: number;
  readonly lastSourceUpdateIst: string | null;
  readonly shortageEligible: boolean;
}

export interface PositionResult {
  readonly grouping: PositionGrouping;
  readonly rows: readonly PositionRow[];
  readonly totals: {
    readonly confirmedQuantity: number; readonly measuredWeight: number;
    readonly lotRecordCount: number; readonly reviewRequiredCount: number;
  };
}

/**
 * The bucket summary, aggregated in the database.
 *
 * Piece quantity, carat weight and lot-record count are three separate columns
 * throughout — they answer three different questions and are never interchanged.
 */
export async function readInventoryPosition(
  filters: InventoryFilters,
  grouping: PositionGrouping,
  client: DbClient = db,
): Promise<PositionResult> {
  const col = GROUP_COLUMN[grouping];
  const rows = await client.$queryRaw<Array<{
    group_key: string | null; bucket: string | null; qty: number | null; wt: number | null;
    records: number; review: number; qty_unconfirmed: number; last_update: Date | null;
  }>>`
    ${inventoryCte(filters)}
    SELECT
      ${col}::text AS group_key,
      ${grouping === "bucket" ? Prisma.sql`bucket` : Prisma.sql`NULL::text`} AS bucket,
      SUM(confirmed_qty)::float8   AS qty,
      SUM(measured_weight)::float8 AS wt,
      COUNT(*)::int                AS records,
      (COUNT(*) FILTER (WHERE bucket = 'REVIEW_REQUIRED'))::int AS review,
      (COUNT(*) FILTER (WHERE qty_unconfirmed))::int            AS qty_unconfirmed,
      MAX(last_seen)               AS last_update
    FROM inv
    GROUP BY ${col}${grouping === "bucket" ? Prisma.empty : Prisma.empty}
    ORDER BY 1 ASC
    LIMIT ${GROUP_CEILING}`;

  const mapped: PositionRow[] = rows.map((r) => {
    const key = r.group_key ?? "(unspecified)";
    const bucket = grouping === "bucket" ? (key as InventoryBucket) : null;
    return {
      groupKey: key,
      bucket,
      confirmedQuantity: num(r.qty),
      measuredWeight: Math.round(num(r.wt) * 1e6) / 1e6,
      lotRecordCount: r.records,
      reviewRequiredCount: r.review,
      unconfirmedQuantityCount: r.qty_unconfirmed,
      lastSourceUpdateIst: r.last_update ? formatIST(r.last_update, false) : null,
      // Only one bucket may reduce finished-stock shortage; every row says which it is.
      shortageEligible: bucket === SHORTAGE_ELIGIBLE_BUCKET,
    };
  });

  const totals = mapped.reduce(
    (a, r) => ({
      confirmedQuantity: a.confirmedQuantity + r.confirmedQuantity,
      measuredWeight: a.measuredWeight + r.measuredWeight,
      lotRecordCount: a.lotRecordCount + r.lotRecordCount,
      reviewRequiredCount: a.reviewRequiredCount + r.reviewRequiredCount,
    }),
    { confirmedQuantity: 0, measuredWeight: 0, lotRecordCount: 0, reviewRequiredCount: 0 },
  );
  totals.measuredWeight = Math.round(totals.measuredWeight * 1e6) / 1e6;

  return { grouping, rows: mapped, totals };
}

// ---------------------------------------------------------------------------
// C. Category inventory
// ---------------------------------------------------------------------------

export interface CategoryInventoryRow {
  readonly categoryId: string;
  readonly lab: string;
  readonly shape: string;
  readonly weightBand: string;
  readonly physicalAvailable: number;
  readonly reserved: number;
  readonly memo: number;
  readonly wip: number;
  readonly roughCount: number;
  readonly roughQuantity: number;
  readonly heldOrExcluded: number;
  readonly reviewRequired: number;
  readonly measuredWeight: number;
  readonly lotRecordCount: number;
  readonly lastSourceUpdateIst: string | null;
}

export interface CategoryInventoryResult {
  readonly rows: readonly CategoryInventoryRow[];
  readonly paging: PagingMeta;
}

/**
 * Inventory per canonical category.
 *
 * Deliberately reports no target, shortage, excess, reorder or priority: those are the
 * demand engine's outputs and belong on the pages that own them.
 */
export async function readCategoryInventory(
  filters: InventoryFilters,
  paging: Paging,
  client: DbClient = db,
): Promise<CategoryInventoryResult> {
  const pageSize = Math.min(Math.max(1, paging.pageSize), INVENTORY_PAGE_MAX);
  const offset = (paging.page - 1) * pageSize;

  const [rows, totalRows] = await Promise.all([
    client.$queryRaw<Array<{
      category_id: string; lab: string; shape: string; weight_band: string;
      physical: number | null; reserved: number | null; memo: number | null; wip: number | null;
      rough_count: number; rough_qty: number | null; held: number; review: number;
      wt: number | null; records: number; last_update: Date | null;
    }>>`
      ${inventoryCte(filters)}
      SELECT
        (lab || '|' || shape || '|' || weight_band) AS category_id,
        lab, shape, weight_band,
        (SUM(confirmed_qty) FILTER (WHERE bucket = 'PHYSICAL_AVAILABLE_POLISHED'))::float8 AS physical,
        (SUM(confirmed_qty) FILTER (WHERE bucket = 'RESERVED_POLISHED'))::float8           AS reserved,
        (SUM(confirmed_qty) FILTER (WHERE bucket = 'MEMO_POLISHED'))::float8               AS memo,
        (SUM(confirmed_qty) FILTER (WHERE bucket = 'MANUFACTURING_WIP'))::float8           AS wip,
        (COUNT(*) FILTER (WHERE bucket = 'ROUGH_AVAILABLE'))::int                          AS rough_count,
        (SUM(confirmed_qty) FILTER (WHERE bucket = 'ROUGH_AVAILABLE'))::float8             AS rough_qty,
        (COUNT(*) FILTER (WHERE bucket = 'HELD_OR_EXCLUDED'))::int                         AS held,
        (COUNT(*) FILTER (WHERE bucket = 'REVIEW_REQUIRED'))::int                          AS review,
        SUM(measured_weight)::float8 AS wt,
        COUNT(*)::int                AS records,
        MAX(last_seen)               AS last_update
      FROM inv
      GROUP BY lab, shape, weight_band
      ORDER BY (SUM(confirmed_qty) FILTER (WHERE bucket = 'PHYSICAL_AVAILABLE_POLISHED')) DESC NULLS LAST,
               lab ASC, shape ASC, weight_band ASC
      LIMIT ${pageSize} OFFSET ${offset}`,
    client.$queryRaw<Array<{ total: number }>>`
      ${inventoryCte(filters)}
      SELECT COUNT(*)::int AS total FROM (SELECT 1 FROM inv GROUP BY lab, shape, weight_band) g`,
  ]);

  return {
    rows: rows.map((r) => ({
      categoryId: r.category_id,
      lab: r.lab,
      shape: r.shape,
      weightBand: r.weight_band,
      physicalAvailable: num(r.physical),
      reserved: num(r.reserved),
      memo: num(r.memo),
      wip: num(r.wip),
      // Rough is reported as its own count and quantity, never folded into a polished figure.
      roughCount: r.rough_count,
      roughQuantity: num(r.rough_qty),
      heldOrExcluded: r.held,
      reviewRequired: r.review,
      measuredWeight: Math.round(num(r.wt) * 1e6) / 1e6,
      lotRecordCount: r.records,
      lastSourceUpdateIst: r.last_update ? formatIST(r.last_update, false) : null,
    })),
    paging: pageMeta(paging, totalRows[0]?.total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// D. Lot-level inventory
// ---------------------------------------------------------------------------

export interface LotInventoryRow {
  readonly lotId: string;
  readonly sourceRecordId: string | null;
  readonly stockType: string;
  readonly lifecycle: string | null;
  readonly bucket: InventoryBucket;
  readonly classificationState: string | null;
  readonly holdState: string | null;
  readonly planningEligible: boolean | null;
  readonly lab: string;
  readonly shape: string;
  readonly weightBand: string;
  /** Null when the quantity could not be confirmed as pieces — never silently 1. */
  readonly confirmedQuantity: number | null;
  readonly measuredWeight: number | null;
  readonly country: string;
  readonly branch: string;
  readonly department: string | null;
  readonly location: string | null;
  readonly firstSeenIst: string | null;
  readonly lastSeenIst: string | null;
  readonly sourceUpdatedIst: string | null;
  readonly isSimulated: boolean;
  readonly reviewCodes: readonly string[];
}

export interface LotInventoryResult {
  readonly rows: readonly LotInventoryRow[];
  readonly paging: PagingMeta;
}

export const LOT_SORTS = ["lastSeen", "lotId", "measuredWeight", "bucket"] as const;
export type LotSort = (typeof LOT_SORTS)[number];

/**
 * The lot drill-down.
 *
 * An explicit allowlist: no raw payload, no remark, no internal database error and no
 * column whose business meaning is unconfirmed reaches this projection.
 */
export async function readLotInventory(
  filters: InventoryFilters,
  paging: Paging,
  sort: LotSort,
  canSeeSourceRecordId: boolean,
  client: DbClient = db,
): Promise<LotInventoryResult> {
  const pageSize = Math.min(Math.max(1, paging.pageSize), INVENTORY_PAGE_MAX);
  const offset = (paging.page - 1) * pageSize;
  const order: Prisma.Sql =
    sort === "lotId" ? Prisma.sql`lot_id ASC`
    : sort === "measuredWeight" ? Prisma.sql`measured_weight DESC, lot_id ASC`
    : sort === "bucket" ? Prisma.sql`bucket ASC, lot_id ASC`
    : Prisma.sql`last_seen DESC NULLS LAST, lot_id ASC`;

  const [rows, totalRows] = await Promise.all([
    client.$queryRaw<Array<Record<string, unknown>>>`
      ${inventoryCte(filters)}
      SELECT lot_id, source_record_id, stock_type, lifecycle, bucket, classification_state,
             classification_reasons, planning_eligible, hold_state, lab, shape, weight_band,
             confirmed_qty, qty_unconfirmed, measured_weight, country, branch, department,
             location, first_seen, last_seen, source_updated, is_simulated
      FROM inv ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`,
    client.$queryRaw<Array<{ total: number }>>`
      ${inventoryCte(filters)} SELECT COUNT(*)::int AS total FROM inv`,
  ]);

  return {
    rows: rows.map((r) => {
      const reasons = typeof r.classification_reasons === "string" && r.classification_reasons.length > 0
        ? r.classification_reasons.split(",")
        : [];
      const unconfirmed = r.qty_unconfirmed === true;
      return {
        lotId: String(r.lot_id),
        // Withheld without the permission that authorizes source-record detail.
        sourceRecordId: canSeeSourceRecordId ? ((r.source_record_id as string | null) ?? null) : null,
        stockType: String(r.stock_type),
        lifecycle: (r.lifecycle as string | null) ?? null,
        bucket: r.bucket as InventoryBucket,
        classificationState: (r.classification_state as string | null) ?? null,
        holdState: (r.hold_state as string | null) ?? null,
        // A factual classification output, not a planning instruction.
        planningEligible: (r.planning_eligible as boolean | null) ?? null,
        lab: String(r.lab),
        shape: String(r.shape),
        weightBand: String(r.weight_band),
        confirmedQuantity: unconfirmed ? null : num(r.confirmed_qty as number),
        measuredWeight: num(r.measured_weight as number) > 0 ? num(r.measured_weight as number) : null,
        country: String(r.country),
        branch: String(r.branch),
        department: (r.department as string | null) ?? null,
        location: (r.location as string | null) ?? null,
        firstSeenIst: r.first_seen ? formatIST(r.first_seen as Date, false) : null,
        lastSeenIst: r.last_seen ? formatIST(r.last_seen as Date, false) : null,
        sourceUpdatedIst: r.source_updated ? formatIST(r.source_updated as Date, false) : null,
        isSimulated: r.is_simulated === true,
        reviewCodes: unconfirmed ? [...reasons, "QUANTITY_PROVENANCE_UNCONFIRMED"] : reasons,
      };
    }),
    paging: pageMeta(paging, totalRows[0]?.total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Mirror reconciliation
// ---------------------------------------------------------------------------

export interface MirrorReconciliation {
  readonly canonicalCurrent: number;
  readonly polishedMirrorRows: number;
  readonly roughMirrorRows: number;
  readonly memoMirrorRows: number;
  /** Mirror rows whose lot exists in current canonical storage. */
  readonly presentInBoth: number;
  /** Canonical records with no operational mirror row. */
  readonly canonicalOnly: number;
  /** Mirror rows with no current canonical record — legacy seed by definition. */
  readonly mirrorOnlyLegacySeed: number;
  /** Lots where the mirror's planning class disagrees with the canonical classification. */
  readonly classificationDisagreements: number;
  readonly shadowProjectionCandidates: number;
}

/**
 * Canonical stock against the operational mirrors.
 *
 * Reporting only. Nothing here merges a mirror row into canonical inventory or promotes
 * an excluded canonical record because a mirror says it is available — a mirror may
 * corroborate or restrict, never promote.
 */
export async function reconcileWithMirrors(client: DbClient = db): Promise<MirrorReconciliation> {
  const [agg, shadow] = await Promise.all([
    client.$queryRaw<Array<{
      canonical: number; polished: number; rough: number; memo: number;
      both: number; canonical_only: number; mirror_only: number; disagree: number;
    }>>`
      SELECT
        (SELECT COUNT(*)::int FROM "LotMasterRecord" WHERE "isCurrent" = TRUE) AS canonical,
        (SELECT COUNT(*)::int FROM "PolishedStone") AS polished,
        (SELECT COUNT(*)::int FROM "RoughStone")    AS rough,
        (SELECT COUNT(*)::int FROM "MemoRecord")    AS memo,
        (SELECT COUNT(*)::int FROM "PolishedStone" p
           JOIN "LotMasterRecord" m ON m."lotId" = p."fantasyLotId" AND m."isCurrent" = TRUE) AS both,
        (SELECT COUNT(*)::int FROM "LotMasterRecord" m
          WHERE m."isCurrent" = TRUE
            AND NOT EXISTS (SELECT 1 FROM "PolishedStone" p WHERE p."fantasyLotId" = m."lotId")) AS canonical_only,
        (SELECT COUNT(*)::int FROM "PolishedStone" p
          WHERE NOT EXISTS (SELECT 1 FROM "LotMasterRecord" m WHERE m."lotId" = p."fantasyLotId" AND m."isCurrent" = TRUE)) AS mirror_only,
        (SELECT COUNT(*)::int FROM "PolishedStone" p
           JOIN "LotMasterRecord" m ON m."lotId" = p."fantasyLotId" AND m."isCurrent" = TRUE
          WHERE (m."inventoryClass" = 'PHYSICAL_AVAILABLE') <> (p."planningClass" IN ('PHYSICAL', 'PLANNING_AVAILABLE'))) AS disagree`,
    client.fantasyProjectionCandidate.count(),
  ]);

  const a = agg[0];
  return {
    canonicalCurrent: a?.canonical ?? 0,
    polishedMirrorRows: a?.polished ?? 0,
    roughMirrorRows: a?.rough ?? 0,
    memoMirrorRows: a?.memo ?? 0,
    presentInBoth: a?.both ?? 0,
    canonicalOnly: a?.canonical_only ?? 0,
    mirrorOnlyLegacySeed: a?.mirror_only ?? 0,
    classificationDisagreements: a?.disagree ?? 0,
    // Reported so its absence from every figure above is visible, not merely asserted.
    shadowProjectionCandidates: shadow,
  };
}
