/**
 * Import history reads. Every query applies the caller's lab scope inside the
 * database WHERE clause, so an out-of-scope batch is simply not found (404) and every
 * count and total is already narrowed. Every read is bounded and paginated; neither the
 * file bytes nor a batch's full row collection is ever embedded in a response.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { SARIN_MAPPING_LINEAGE_STATUSES, type SarinImportStatus, type SarinSourceRowOutcome, type SarinPacketType } from "@/lib/sarin/domain";
import { SARIN_VALIDATION_PROFILE_VERSION } from "@/lib/sarin/plan-structure";

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
  readonly packetType: string;
  readonly planningDate: string;
  readonly labId: string | null;
  readonly contractVersion: string;
  readonly sourceFile: { readonly fileName: string; readonly byteSize: number; readonly sha256: string; readonly encoding: string };
  readonly counts: SarinRowCounts;
  readonly createdAt: string;
  readonly statusChangedAt: string;
  readonly archivedAt: string | null;
  /** Who uploaded it, by display name; null when that account no longer exists. */
  readonly uploadedBy: string | null;
  /**
   * Stones found by validation. Null until a validation has run: blocks are derived by
   * validation, never by the upload, so nothing is claimed before then.
   */
  readonly stones: { readonly detected: number; readonly identityResolved: number; readonly identityUnresolved: number } | null;
  /** Its last completed validation ran older rules, or a mapping version no longer approved: validate again before output. */
  readonly revalidationRequired: boolean;
  /** The output version derived from its current validation, if one has been generated. */
  readonly currentOutputId: string | null;
  /** Output rows of that version showing a raw, unmapped Sarin shape (design v1.7 §15.10); 0 when none or no output. */
  readonly currentOutputUnmappedRows: number;
}

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: null, lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

const SUMMARY_SELECT = {
  id: true,
  status: true,
  validationAttempt: true,
  packetType: true,
  planningDate: true,
  labScope: true,
  contractVersion: true,
  rowCount: true,
  createdAt: true,
  statusChangedAt: true,
  archivedAt: true,
  uploadedByUserId: true,
  blockCount: true,
  quarantinedBlockCount: true,
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

/** Display names of the given accounts, in one query. Actor ids are stored as plain text. */
export async function displayNamesOf(userIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();
  const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(users.map((u) => [u.id, u.displayName]));
}

/**
 * Batches whose last completed validation ran older validation rules, or used a mapping
 * that was withdrawn: either way they must be processed again for output.
 */
async function outdatedValidation(batchIds: string[]): Promise<Set<string>> {
  if (batchIds.length === 0) return new Set();
  const latest = await db.sarinValidationAttempt.findMany({
    where: { batchId: { in: batchIds }, status: "COMPLETED" },
    orderBy: [{ batchId: "asc" }, { attemptNumber: "desc" }],
    distinct: ["batchId"],
    select: { batchId: true, validationProfileVersion: true, shapeMappingSet: { select: { status: true } } },
  });
  return new Set(latest.filter((a) => a.validationProfileVersion !== SARIN_VALIDATION_PROFILE_VERSION || !SARIN_MAPPING_LINEAGE_STATUSES.includes(a.shapeMappingSet.status)).map((a) => a.batchId));
}

/**
 * The current output version of each batch: its one GENERATED version derived from the
 * batch's current validation attempt (the same rule the output reads use), in one query.
 */
async function currentOutputs(batches: Array<{ id: string; validationAttempt: number }>): Promise<Map<string, { id: string; unmappedRows: number }>> {
  if (batches.length === 0) return new Map();
  const attemptOf = new Map(batches.map((b) => [b.id, b.validationAttempt]));
  const versions = await db.sarinOutputVersion.findMany({
    where: { batchId: { in: batches.map((b) => b.id) }, status: "GENERATED" },
    select: { id: true, batchId: true, validationAttempt: { select: { attemptNumber: true } } },
  });
  const current = versions.filter((v) => v.validationAttempt.attemptNumber === attemptOf.get(v.batchId));
  // One grouped count over the partial pass-through index, for every listed batch at once.
  const unmapped = current.length
    ? await db.sarinPlanPiece.groupBy({ by: ["outputVersionId"], where: { outputVersionId: { in: current.map((v) => v.id) }, shapeResolution: "RAW_PASSTHROUGH" }, _count: { _all: true } })
    : [];
  const rowsOf = new Map(unmapped.map((g) => [g.outputVersionId, (g._count as { _all?: number })?._all ?? 0]));
  return new Map(current.map((v) => [v.batchId, { id: v.id, unmappedRows: rowsOf.get(v.id) ?? 0 }]));
}

function toSummary(b: SummaryRow, counts: SarinRowCounts, names: Map<string, string>, outdated: Set<string>, outputs: Map<string, { id: string; unmappedRows: number }>): SarinImportSummary {
  return {
    id: b.id,
    status: b.status,
    validationAttempts: b.validationAttempt,
    packetType: b.packetType,
    planningDate: b.planningDate.toISOString().slice(0, 10),
    labId: b.labScope,
    contractVersion: b.contractVersion,
    sourceFile: { fileName: b.sourceFile.sanitizedFileName, byteSize: b.sourceFile.byteSize, sha256: b.sourceFile.sha256, encoding: b.sourceFile.detectedEncoding },
    counts,
    createdAt: b.createdAt.toISOString(),
    statusChangedAt: b.statusChangedAt.toISOString(),
    archivedAt: b.archivedAt?.toISOString() ?? null,
    uploadedBy: names.get(b.uploadedByUserId) ?? null,
    revalidationRequired: outdated.has(b.id),
    currentOutputId: outputs.get(b.id)?.id ?? null,
    currentOutputUnmappedRows: outputs.get(b.id)?.unmappedRows ?? 0,
    stones: b.blockCount > 0 ? { detected: b.blockCount, identityResolved: b.blockCount - b.quarantinedBlockCount, identityUnresolved: b.quarantinedBlockCount } : null,
  };
}

/** A batch by id within the caller's scope; null when absent or outside it. */
export async function getSarinImport(scope: EffectiveScope, batchId: string): Promise<SarinImportSummary | null> {
  const b = await db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(scope) }, select: SUMMARY_SELECT });
  if (!b) return null;
  return toSummary(b, (await countsFor([b.id])).get(b.id)!, await displayNamesOf([b.uploadedByUserId]), await outdatedValidation([b.id]), await currentOutputs([b]));
}

/** A batch by id with no scope applied. Only for reading back what the caller just wrote. */
export async function getSarinImportById(batchId: string): Promise<SarinImportSummary | null> {
  const b = await db.sarinImportBatch.findUnique({ where: { id: batchId }, select: SUMMARY_SELECT });
  if (!b) return null;
  return toSummary(b, (await countsFor([b.id])).get(b.id)!, await displayNamesOf([b.uploadedByUserId]), await outdatedValidation([b.id]), await currentOutputs([b]));
}

export interface SarinImportFilters {
  readonly status: SarinImportStatus | null;
  readonly packetType: SarinPacketType | null;
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
        // A deleted (archived) import leaves the default list; it is listed only when asked for by status.
        status: filters.status ? filters.status : { not: "ARCHIVED" },
        ...(filters.packetType ? { packetType: filters.packetType } : {}),
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
  const ids = batches.map((b) => b.id);
  const [counts, names, outdated, outputs] = await Promise.all([countsFor(ids), displayNamesOf(batches.map((b) => b.uploadedByUserId)), outdatedValidation(ids), currentOutputs(batches)]);
  return {
    rows: batches.map((b) => toSummary(b, counts.get(b.id)!, names, outdated, outputs)),
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
