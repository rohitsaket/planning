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

export const RECONCILIATION_BATCH_SIZE = 500;

export const RECONCILIATION_MAX_BATCHES = 400;

export interface ProjectionReconciliationResult {
  readonly scanned: number;
  readonly classificationsWritten: number;
  readonly historyClassificationsWritten: number;
  readonly mirrorsCreated: number;
  readonly mirrorsUpdated: number;
  readonly ineligibleSkipped: number;
  readonly complete: boolean;
  readonly outstandingMissingMirrors: number;
  readonly outstandingUnclassified: number;
  readonly truncated: boolean;
}

export interface ProjectionInvariant {
  readonly satisfied: boolean;
  readonly missingMirrors: number;
  readonly unclassified: number;
  readonly message: string | null;
}

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

    if (!requiresOperationalMirror(r)) {
      ineligible++;
      continue;
    }

    const existing = await tx.polishedStone.findUnique({
      where: { fantasyLotId: r.lotId },
      select: { id: true },
    });

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

  let cursor: string | null = null;
  for (let batch = 0; batch < RECONCILIATION_MAX_BATCHES; batch++) {
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
