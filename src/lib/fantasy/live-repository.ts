import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { LIVE_LOT_FIELDS, LIVE_LOT_SORTABLE, type LiveLotFieldKey } from "./live-fields";
import type { MappedLiveLot } from "./live-mapper";

export interface UpsertStats {
  inserted: number;
  updated: number;
  unchanged: number;
}

function toData(m: MappedLiveLot, syncRunId: string, seenAt: Date) {
  const data: Record<string, unknown> = {};
  for (const spec of LIVE_LOT_FIELDS) {
    const v = m.fields[spec.field];
    data[spec.field] = spec.type === "decimal" && typeof v === "string" ? new Prisma.Decimal(v) : v;
  }
  return {
    ...data,
    sourcePayload: m.sourcePayload as Prisma.InputJsonValue,
    contentHash: m.contentHash,
    mappingWarnings: m.warnings,
    sourceActive: true,
    staleSince: null,
    lastSeenAt: seenAt,
    syncRunId,
  };
}

export async function upsertLiveLots(mapped: MappedLiveLot[], syncRunId: string, seenAt: Date, batchSize = 500): Promise<UpsertStats> {
  const stats: UpsertStats = { inserted: 0, updated: 0, unchanged: 0 };
  for (let i = 0; i < mapped.length; i += batchSize) {
    const chunk = mapped.slice(i, i + batchSize);
    const keys = chunk.map((m) => m.sourceRecordKey);
    const existing = await db.fantasyLiveLot.findMany({ where: { sourceRecordKey: { in: keys } }, select: { sourceRecordKey: true, contentHash: true } });
    const byKey = new Map(existing.map((e) => [e.sourceRecordKey, e.contentHash]));
    const toInsert = chunk.filter((m) => !byKey.has(m.sourceRecordKey));
    const toUpdate = chunk.filter((m) => byKey.has(m.sourceRecordKey) && byKey.get(m.sourceRecordKey) !== m.contentHash);
    const unchangedKeys = chunk.filter((m) => byKey.get(m.sourceRecordKey) === m.contentHash).map((m) => m.sourceRecordKey);
    await db.$transaction(async (tx) => {
      if (toInsert.length) {
        await tx.fantasyLiveLot.createMany({
          data: toInsert.map((m) => ({ sourceRecordKey: m.sourceRecordKey, firstSeenAt: seenAt, ...toData(m, syncRunId, seenAt) })) as Prisma.FantasyLiveLotCreateManyInput[],
          skipDuplicates: true,
        });
      }
      for (const m of toUpdate) {
        await tx.fantasyLiveLot.update({ where: { sourceRecordKey: m.sourceRecordKey }, data: toData(m, syncRunId, seenAt) as Prisma.FantasyLiveLotUpdateInput });
      }
      if (unchangedKeys.length) {
        await tx.fantasyLiveLot.updateMany({ where: { sourceRecordKey: { in: unchangedKeys } }, data: { lastSeenAt: seenAt, sourceActive: true, staleSince: null, syncRunId } });
      }
    });
    stats.inserted += toInsert.length;
    stats.updated += toUpdate.length;
    stats.unchanged += unchangedKeys.length;
  }
  return stats;
}

export async function countActiveLiveLots(): Promise<number> {
  return db.fantasyLiveLot.count({ where: { sourceActive: true } });
}

export async function markStaleNotSeenSince(seenAt: Date): Promise<number> {
  const r = await db.fantasyLiveLot.updateMany({ where: { sourceActive: true, lastSeenAt: { lt: seenAt } }, data: { sourceActive: false, staleSince: seenAt } });
  return r.count;
}

export async function loadActivePayloads(): Promise<Record<string, unknown>[]> {
  const rows = await db.fantasyLiveLot.findMany({ where: { sourceActive: true }, select: { sourcePayload: true } });
  return rows.map((r) => r.sourcePayload as Record<string, unknown>);
}

export interface LiveLotQuery {
  page: number;
  pageSize: number;
  q?: string | null;
  lotStatusDb?: string | null;
  processName?: string | null;
  shape?: string | null;
  color?: string | null;
  clarity?: string | null;
  labName?: string | null;
  departmentAccountName?: string | null;
  companyId?: string | null;
  onHold?: boolean | null;
  includeStale?: boolean;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  sortBy?: string | null;
  sortOrder?: "asc" | "desc";
}

const SEARCH_FIELDS: LiveLotFieldKey[] = ["lotId", "lotName", "certificateNo", "docId", "itemName", "metalId"];

export function liveLotWhere(q: LiveLotQuery): Prisma.FantasyLiveLotWhereInput {
  const where: Prisma.FantasyLiveLotWhereInput = {};
  if (!q.includeStale) where.sourceActive = true;
  const eq = (k: keyof LiveLotQuery & LiveLotFieldKey) => { const v = q[k]; if (typeof v === "string" && v) (where as Record<string, unknown>)[k] = v; };
  (["lotStatusDb", "processName", "shape", "color", "clarity", "labName", "departmentAccountName", "companyId"] as const).forEach(eq);
  if (q.onHold === true || q.onHold === false) where.onHold = q.onHold;
  if (q.dateFrom || q.dateTo) where.docDate = { ...(q.dateFrom ? { gte: q.dateFrom } : {}), ...(q.dateTo ? { lte: q.dateTo } : {}) };
  if (q.q) {
    const term = q.q.replace(/[\\%_]/g, "\\$&");
    where.OR = SEARCH_FIELDS.map((f) => ({ [f]: { contains: term, mode: "insensitive" } }));
  }
  return where;
}

export async function listLiveLots(q: LiveLotQuery) {
  const where = liveLotWhere(q);
  const sortBy = q.sortBy && LIVE_LOT_SORTABLE.has(q.sortBy) ? q.sortBy : "lastSeenAt";
  const sortOrder = q.sortOrder === "asc" ? "asc" : "desc";
  const [totalRecords, rows] = await Promise.all([
    db.fantasyLiveLot.count({ where }),
    db.fantasyLiveLot.findMany({ where, orderBy: [{ [sortBy]: sortOrder }, { id: "asc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { rows, totalRecords, totalPages: Math.max(1, Math.ceil(totalRecords / q.pageSize)) };
}

export async function liveLotFacets() {
  const pick = async (field: "lotStatusDb" | "processName" | "shape" | "labName" | "companyId" | "departmentAccountName") => {
    const rows = await db.fantasyLiveLot.findMany({ where: { sourceActive: true, [field]: { not: null } }, distinct: [field], select: { [field]: true }, orderBy: { [field]: "asc" }, take: 200 });
    return rows.map((r) => (r as Record<string, string | null>)[field]).filter((v): v is string => !!v);
  };
  const [lotStatusDb, processName, shape, labName, companyId, departmentAccountName] = await Promise.all([pick("lotStatusDb"), pick("processName"), pick("shape"), pick("labName"), pick("companyId"), pick("departmentAccountName")]);
  return { lotStatusDb, processName, shape, labName, companyId, departmentAccountName };
}
