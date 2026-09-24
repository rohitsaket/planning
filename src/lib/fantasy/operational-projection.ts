/**
 * OPERATIONAL PROJECTION RECONCILIATION.
 *
 * Two things are derived from a canonical current record and stored beside it:
 *
 *   1. its planning-category classification, written onto the record itself;
 *   2. its `PolishedStone` operational mirror, when the classifier places it in a
 *      mirrored inventory class.
 *
 * Both are written by the synchronizer as it projects each record. Neither is written
 * when the synchronizer decides a record is unchanged — and that is how a database ends
 * up with 523 current, classified, physically-available lots and no mirrors at all:
 * an ordinary seed deleted the `PolishedStone` table, the canonical lots survived because
 * seeding does not touch them, and the next synchronization saw every record unchanged
 * and rebuilt nothing. Demand then blocked all 523 lots for a missing mirror, reported
 * zero available stock in every category, and the page said "review required" for the
 * whole business.
 *
 * So projection completeness is checked and repaired independently of whether the source
 * record changed. A record being unchanged says nothing about whether the things derived
 * from it still exist.
 *
 * ## What this never does
 *
 * It never invents a mirror for a record that should not have one — blocked, unknown,
 * rough, WIP, reserved, sold, transferred, closed or non-current. The eligibility gate is
 * the production one (`isMirroredInventoryClass` on a current polished record), read from
 * the same classifier, so reconciliation cannot promote a record the synchronizer would
 * have excluded.
 *
 * It never writes a demand total, a dashboard figure or any analysis output. It rebuilds
 * derived projections from canonical records and nothing else.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/api/log";
import { isMirroredInventoryClass, toLegacyPlanningClass, type InventoryClass } from "./classification";
import {
  categoryClassificationColumns,
  classifyCanonicalCategory,
  loadCategoryClassificationContext,
  type CategoryClassificationContext,
} from "./category-classification";
import { loadLabMappings } from "./sync-service";

if (typeof window !== "undefined") {
  throw new Error("fantasy/operational-projection is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

/** Rows per pass. Reconciliation never reads the whole table into memory. */
export const RECONCILIATION_BATCH_SIZE = 500;

/** A ceiling so one invocation cannot run unbounded against a large table. */
export const RECONCILIATION_MAX_BATCHES = 400;

export interface ProjectionReconciliationResult {
  readonly scanned: number;
  readonly classificationsWritten: number;
  /** Immutable history versions whose classification had never been written. */
  readonly historyClassificationsWritten: number;
  readonly mirrorsCreated: number;
  readonly mirrorsUpdated: number;
  readonly ineligibleSkipped: number;
  /** True when the invariant held after this run. */
  readonly complete: boolean;
  readonly outstandingMissingMirrors: number;
  readonly outstandingUnclassified: number;
  readonly truncated: boolean;
}

export interface ProjectionInvariant {
  readonly satisfied: boolean;
  /** Current, eligible, mirrored-class lots with no operational mirror. */
  readonly missingMirrors: number;
  /** Current lots the classifier has never categorised. */
  readonly unclassified: number;
  /** Safe for a user: counts and a reason, never a lot list or a payload. */
  readonly message: string | null;
}

/**
 * Whether every eligible current lot has the projections it is supposed to have.
 *
 * Two database aggregates, no row-level read. This is the invariant a demand run checks
 * before it may call itself ready.
 */
export async function checkProjectionInvariant(client: DbClient = db): Promise<ProjectionInvariant> {
  const [missingRows, unclassifiedRows] = await Promise.all([
    client.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM "LotMasterRecord" m
      WHERE m."isCurrent" = TRUE
        AND m."roughOrPolished" = 'POLISHED'
        AND m."inventoryClass" IN ('PHYSICAL_AVAILABLE', 'MEMO')
        AND NOT EXISTS (SELECT 1 FROM "PolishedStone" p WHERE p."fantasyLotId" = m."lotId")`,
    client.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*) AS n
      FROM "LotMasterRecord" m
      WHERE m."isCurrent" = TRUE AND m."categoryState" IS NULL`,
  ]);

  const missingMirrors = Number(missingRows[0]?.n ?? 0);
  const unclassified = Number(unclassifiedRows[0]?.n ?? 0);
  const satisfied = missingMirrors === 0 && unclassified === 0;

  return {
    satisfied,
    missingMirrors,
    unclassified,
    message: satisfied
      ? null
      : `Operational projection is incomplete: ${missingMirrors} current stock record(s) have no ` +
        `operational mirror and ${unclassified} have no planning-category classification. ` +
        "Run projection reconciliation before relying on these figures.",
  };
}

/** The columns reconciliation needs to rebuild a projection. */
const RECONCILE_SELECT = {
  lotId: true,
  isCurrent: true,
  roughOrPolished: true,
  inventoryClass: true,
  categoryState: true,
  labRaw: true,
  shape: true,
  weight: true,
  country: true,
  branch: true,
  currentStatus: true,
  departmentId: true,
  locationId: true,
  color: true,
  clarity: true,
  certificate: true,
  treatment: true,
  sourceUpdatedAt: true,
} as const;

type ReconcileRow = Prisma.LotMasterRecordGetPayload<{ select: typeof RECONCILE_SELECT }>;

/** The production eligibility gate, in one place so it cannot drift from the synchronizer. */
export function requiresOperationalMirror(r: {
  isCurrent: boolean;
  roughOrPolished: string | null;
  inventoryClass: string | null;
}): boolean {
  if (!r.isCurrent) return false;
  if (r.roughOrPolished !== "POLISHED") return false;
  if (r.inventoryClass === null) return false;
  return isMirroredInventoryClass(r.inventoryClass as InventoryClass);
}

async function reconcileBatch(
  tx: Prisma.TransactionClient,
  rows: ReconcileRow[],
  ctx: CategoryClassificationContext,
): Promise<{ classifications: number; created: number; updated: number; ineligible: number }> {
  let classifications = 0;
  let created = 0;
  let updated = 0;
  let ineligible = 0;

  for (const r of rows) {
    // --- 1. Classification, only when it has never been written ------------
    //
    // A record that already carries a decision keeps it. Recomputing would make a
    // committed demand run re-categorisable by editing a mapping row afterwards, which
    // is exactly what persisting the decision was meant to prevent.
    if (r.categoryState === null) {
      const classification = classifyCanonicalCategory(
        { labRaw: r.labRaw, shapeRaw: r.shape, weightCt: Number(r.weight) },
        ctx,
      );
      await tx.lotMasterRecord.update({
        where: { lotId: r.lotId },
        data: categoryClassificationColumns(classification),
      });
      classifications++;
    }

    // --- 2. Operational mirror --------------------------------------------
    if (!requiresOperationalMirror(r)) {
      ineligible++;
      continue;
    }

    const existing = await tx.polishedStone.findUnique({
      where: { fantasyLotId: r.lotId },
      select: { id: true },
    });

    // Rebuilt from the canonical record with the same projection the synchronizer uses,
    // so a repaired mirror is indistinguishable from one written during a normal sync.
    const projection = {
      fantasyDepartmentId: r.departmentId ?? null,
      fantasyLocationId: r.locationId ?? null,
      country: r.country,
      branch: r.branch,
      fantasyStatus: r.currentStatus,
      labRaw: r.labRaw ?? null,
      labNormalized: null as string | null,
      shape: r.shape,
      shapeNormalized: null as string | null,
      weight: new Prisma.Decimal(r.weight),
      color: r.color ?? null,
      clarity: r.clarity ?? null,
      certificate: r.certificate ?? null,
      treatment: r.treatment ?? null,
      planningClass: toLegacyPlanningClass(r.inventoryClass as InventoryClass),
      lastUpdated: r.sourceUpdatedAt ?? new Date(),
    };

    // The mirror carries the approved normalized values only — never a raw passthrough.
    const classification = classifyCanonicalCategory(
      { labRaw: r.labRaw, shapeRaw: r.shape, weightCt: Number(r.weight) },
      ctx,
    );
    projection.labNormalized = classification.labNormalized;
    projection.shapeNormalized = classification.shapeNormalized;

    await tx.polishedStone.upsert({
      where: { fantasyLotId: r.lotId },
      create: { fantasyLotId: r.lotId, ...projection },
      update: projection,
    });
    if (existing) updated++;
    else created++;
  }

  return { classifications, created, updated, ineligible };
}

/**
 * Rebuilds every missing derived projection for current canonical records.
 *
 * Idempotent: a second run finds nothing to do and reports zeros. Batched and
 * transactional per batch, so a failure part-way leaves committed batches intact and
 * repeats safely rather than half-writing one.
 */
export async function reconcileOperationalProjection(options: {
  client?: DbClient;
  batchSize?: number;
  actor?: string;
} = {}): Promise<ProjectionReconciliationResult> {
  const client = options.client ?? db;
  const batchSize = Math.min(Math.max(1, options.batchSize ?? RECONCILIATION_BATCH_SIZE), 2_000);

  const labMappings = await loadLabMappings(client);
  const ctx = await loadCategoryClassificationContext(client, labMappings);

  let scanned = 0;
  let classificationsWritten = 0;
  let mirrorsCreated = 0;
  let mirrorsUpdated = 0;
  let ineligibleSkipped = 0;
  let truncated = false;

  // Keyset pagination on the unique lot id: stable under concurrent writes and never
  // reads the whole table.
  let cursor: string | null = null;
  for (let batch = 0; batch < RECONCILIATION_MAX_BATCHES; batch++) {
    // Only the records that actually need work: never classified, or eligible for a
    // mirror and missing one. Selecting every eligible lot instead would re-upsert the
    // whole table on every pass and make "scanned" meaningless.
    const pending = await client.$queryRaw<Array<{ lot_id: string }>>`
      SELECT m."lotId" AS lot_id
      FROM "LotMasterRecord" m
      WHERE m."isCurrent" = TRUE
        AND (${cursor === null ? Prisma.sql`TRUE` : Prisma.sql`m."lotId" > ${cursor}`})
        AND (
          m."categoryState" IS NULL
          OR (
            m."roughOrPolished" = 'POLISHED'
            AND m."inventoryClass" IN ('PHYSICAL_AVAILABLE', 'MEMO')
            AND NOT EXISTS (SELECT 1 FROM "PolishedStone" p WHERE p."fantasyLotId" = m."lotId")
          )
        )
      ORDER BY m."lotId" ASC
      LIMIT ${batchSize}`;

    if (pending.length === 0) break;

    const rows: ReconcileRow[] = await client.lotMasterRecord.findMany({
      where: { lotId: { in: pending.map((r) => r.lot_id) } },
      orderBy: { lotId: "asc" },
      select: RECONCILE_SELECT,
    });

    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].lotId;
    scanned += rows.length;

    const result = await client.$transaction((tx) => reconcileBatch(tx, rows, ctx));
    classificationsWritten += result.classifications;
    mirrorsCreated += result.created;
    mirrorsUpdated += result.updated;
    ineligibleSkipped += result.ineligible;

    if (batch === RECONCILIATION_MAX_BATCHES - 1 && pending.length === batchSize) truncated = true;
  }

  // Sale facts are read from the immutable history, so a version with no classification
  // has no category and its sale cannot be counted. Filling a column that was never
  // written completes the projection; it never overwrites a decision already recorded,
  // so nothing about a committed version changes meaning.
  let historyClassificationsWritten = 0;
  let historyCursor: string | null = null;
  for (let batch = 0; batch < RECONCILIATION_MAX_BATCHES; batch++) {
    const pending = await client.$queryRaw<Array<{ id: string; lab_raw: string | null; shape: string; weight: Prisma.Decimal }>>`
      SELECT h."id", h."labRaw" AS lab_raw, h."shape", h."weight"
      FROM "LotHistoryRecord" h
      WHERE h."categoryState" IS NULL
        AND (${historyCursor === null ? Prisma.sql`TRUE` : Prisma.sql`h."id" > ${historyCursor}`})
      ORDER BY h."id" ASC
      LIMIT ${batchSize}`;
    if (pending.length === 0) break;
    historyCursor = pending[pending.length - 1].id;

    await client.$transaction(async (tx) => {
      for (const h of pending) {
        const classification = classifyCanonicalCategory(
          { labRaw: h.lab_raw, shapeRaw: h.shape, weightCt: Number(h.weight) },
          ctx,
        );
        await tx.lotHistoryRecord.update({
          where: { id: h.id },
          data: categoryClassificationColumns(classification),
        });
        historyClassificationsWritten++;
      }
    });
  }

  const invariant = await checkProjectionInvariant(client);

  // Counts and an actor. No lot ids, no customer data, no record payloads.
  log("info", "operational_projection_reconciled", {
    actor: options.actor ?? "unknown",
    scanned,
    classificationsWritten,
    historyClassificationsWritten,
    mirrorsCreated,
    mirrorsUpdated,
    ineligibleSkipped,
    complete: invariant.satisfied,
    outstandingMissingMirrors: invariant.missingMirrors,
    outstandingUnclassified: invariant.unclassified,
    truncated,
  });

  return {
    scanned,
    classificationsWritten,
    historyClassificationsWritten,
    mirrorsCreated,
    mirrorsUpdated,
    ineligibleSkipped,
    complete: invariant.satisfied,
    outstandingMissingMirrors: invariant.missingMirrors,
    outstandingUnclassified: invariant.unclassified,
    truncated,
  };
}
