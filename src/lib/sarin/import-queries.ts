/**
 * Import history reads. Every query applies the caller's country and lab scope inside the
 * database WHERE clause, so an out-of-scope batch is simply not found (404) and every
 * count and total is already narrowed. Every read is bounded and paginated; neither the
 * file bytes nor a batch's full row collection is ever embedded in a response.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import type { SarinImportStatus, SarinSourceRowOutcome, SarinStoneType } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/import-queries is server-only and must not be imported by client code.");
}

export const SARIN_IMPORT_PAGE = { default: 25, max: 100 } as const;
export const SARIN_ROW_PAGE = { default: 100, max: 500 } as const;

export interface SarinRowCounts {
  readonly records: number;
  readonly accepted: number;
  readonly quarantined: number;
  readonly rejectedStructure: number;
}

export interface SarinImportSummary {
  readonly id: string;
  /** The batch lifecycle status. A new upload is UPLOADED: stored, not validated. */
  readonly status: string;
  /** How many validation attempts have started. 0 means validation has not run. */
  readonly validationAttempts: number;
  readonly stoneType: string;
  readonly planningDate: string;
  readonly country: string;
  readonly labId: string | null;
  readonly contractVersion: string;
  readonly sourceFile: { readonly fileName: string; readonly byteSize: number; readonly sha256: string; readonly encoding: string };
  readonly counts: SarinRowCounts;
  readonly createdAt: string;
  readonly statusChangedAt: string;
  readonly archivedAt: string | null;
}

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: "country", lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

const SUMMARY_SELECT = {
  id: true,
  status: true,
  validationAttempt: true,
  stoneType: true,
  planningDate: true,
  country: true,
  labScope: true,
  contractVersion: true,
  rowCount: true,
  createdAt: true,
  statusChangedAt: true,
  archivedAt: true,
  sourceFile: { select: { sanitizedFileName: true, byteSize: true, sha256: true, detectedEncoding: true } },
} as const satisfies Prisma.SarinImportBatchSelect;

type SummaryRow = Prisma.SarinImportBatchGetPayload<{ select: typeof SUMMARY_SELECT }>;

/** Row outcome counts for a set of batches, in one grouped query. */
async function countsFor(batchIds: string[]): Promise<Map<string, SarinRowCounts>> {
  const groups = batchIds.length
    ? await db.sarinSourceRow.groupBy({ by: ["batchId", "outcome"], where: { batchId: { in: batchIds } }, _count: { _all: true } })
    : [];
  const out = new Map<string, { accepted: number; quarantined: number; rejectedStructure: number }>();
  for (const id of batchIds) out.set(id, { accepted: 0, quarantined: 0, rejectedStructure: 0 });
  for (const g of groups) {
    const c = out.get(g.batchId)!;
    if (g.outcome === "ACCEPTED") c.accepted = g._count._all;
    else if (g.outcome === "QUARANTINED") c.quarantined = g._count._all;
    else if (g.outcome === "REJECTED_STRUCTURE") c.rejectedStructure = g._count._all;
  }
  return new Map([...out].map(([id, c]) => [id, { records: c.accepted + c.quarantined + c.rejectedStructure, ...c }]));
}

function toSummary(b: SummaryRow, counts: SarinRowCounts): SarinImportSummary {
  return {
    id: b.id,
    status: b.status,
    validationAttempts: b.validationAttempt,
    stoneType: b.stoneType,
    planningDate: b.planningDate.toISOString().slice(0, 10),
    country: b.country,
    labId: b.labScope,
    contractVersion: b.contractVersion,
    sourceFile: { fileName: b.sourceFile.sanitizedFileName, byteSize: b.sourceFile.byteSize, sha256: b.sourceFile.sha256, encoding: b.sourceFile.detectedEncoding },
    counts,
    createdAt: b.createdAt.toISOString(),
    statusChangedAt: b.statusChangedAt.toISOString(),
    archivedAt: b.archivedAt?.toISOString() ?? null,
  };
}

/** A batch by id within the caller's scope; null when absent or outside it. */
export async function getSarinImport(scope: EffectiveScope, batchId: string): Promise<SarinImportSummary | null> {
  const b = await db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(scope) }, select: SUMMARY_SELECT });
  if (!b) return null;
  return toSummary(b, (await countsFor([b.id])).get(b.id)!);
}

/** A batch by id with no scope applied. Only for reading back what the caller just wrote. */
export async function getSarinImportById(batchId: string): Promise<SarinImportSummary | null> {
  const b = await db.sarinImportBatch.findUnique({ where: { id: batchId }, select: SUMMARY_SELECT });
  if (!b) return null;
  return toSummary(b, (await countsFor([b.id])).get(b.id)!);
}

export interface SarinImportFilters {
  readonly status: SarinImportStatus | null;
  readonly stoneType: SarinStoneType | null;
  readonly country: string | null;
  readonly lab: string | null;
  readonly planningDate: string | null;
}

export interface Page {
  readonly page: number;
  readonly pageSize: number;
}

export async function listSarinImports(scope: EffectiveScope, filters: SarinImportFilters, page: Page) {
  // The scope is merged last and ANDed: a filter can only narrow it, never widen it.
  const where: Prisma.SarinImportBatchWhereInput = {
    AND: [
      {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.stoneType ? { stoneType: filters.stoneType } : {}),
        ...(filters.country ? { country: filters.country } : {}),
        ...(filters.lab ? { labScope: filters.lab } : {}),
        ...(filters.planningDate ? { planningDate: new Date(`${filters.planningDate}T00:00:00.000Z`) } : {}),
      },
      scopeOf(scope),
    ],
  };
  const [total, batches] = await Promise.all([
    db.sarinImportBatch.count({ where }),
    db.sarinImportBatch.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
  ]);
  const counts = await countsFor(batches.map((b) => b.id));
  return {
    rows: batches.map((b) => toSummary(b, counts.get(b.id)!)),
    page: page.page,
    pageSize: page.pageSize,
    total,
    hasMore: page.page * page.pageSize < total,
  };
}

export interface SarinSourceRowView {
  readonly sourceRowNumber: number;
  readonly outcome: string;
  readonly fieldCount: number;
  readonly rejectionCodes: string[];
  /** The fields exactly as read, or null when the record's quoting could not be read. */
  readonly fields: string[] | null;
  readonly values: {
    readonly stoneName: string | null;
    readonly roughWeight: string | null;
    readonly shape: string | null;
    readonly estimatedWeight: string | null;
    readonly clarity: string | null;
    readonly color: string | null;
    readonly depthPct: string | null;
    readonly ratio: string | null;
    readonly length: string | null;
    readonly width: string | null;
    readonly depthMm: string | null;
  };
}

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(3));

/** One page of a batch's source rows in file order; null when the batch is out of scope. */
export async function listSarinImportRows(scope: EffectiveScope, batchId: string, outcome: SarinSourceRowOutcome | null, page: Page) {
  const batch = await db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(scope) }, select: { id: true } });
  if (!batch) return null;
  const where: Prisma.SarinSourceRowWhereInput = { batchId: batch.id, ...(outcome ? { outcome } : {}) };
  const [total, rows] = await Promise.all([
    db.sarinSourceRow.count({ where }),
    db.sarinSourceRow.findMany({
      where,
      orderBy: { sourceRowNumber: "asc" },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: {
        sourceRowNumber: true, outcome: true, fieldCount: true, rejectionCodes: true, rawFieldsJson: true,
        stoneNameRaw: true, roughWeight: true, shapeRaw: true, estimatedWeight: true, clarity: true, color: true,
        depthPct: true, ratio: true, length: true, width: true, depthMm: true,
      },
    }),
  ]);
  const view: SarinSourceRowView[] = rows.map((r) => ({
    sourceRowNumber: r.sourceRowNumber,
    outcome: r.outcome,
    fieldCount: r.fieldCount,
    rejectionCodes: r.rejectionCodes ? r.rejectionCodes.split(",") : [],
    fields: r.rawFieldsJson ? (JSON.parse(r.rawFieldsJson) as string[]) : null,
    values: {
      stoneName: r.stoneNameRaw,
      roughWeight: dec(r.roughWeight),
      shape: r.shapeRaw,
      estimatedWeight: dec(r.estimatedWeight),
      clarity: r.clarity,
      color: r.color,
      depthPct: dec(r.depthPct),
      ratio: dec(r.ratio),
      length: dec(r.length),
      width: dec(r.width),
      depthMm: dec(r.depthMm),
    },
  }));
  return { batchId: batch.id, rows: view, page: page.page, pageSize: page.pageSize, total, hasMore: page.page * page.pageSize < total };
}
