import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, paging, paged } from "@/lib/api/with-api";
import { overallLotWhere, parseOverallLotFilters } from "@/lib/fantasy/overall-filters";
import { resolveFantasySourceStateWithHistory } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";

export const GET = withApi({ permission: "overall.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);
  const sourceState = await resolveFantasySourceStateWithHistory(db);

  // One parser for the list and its export, so a filtered export can never return rows
  // the filtered list would have excluded.
  const where = overallLotWhere(parseOverallLotFilters(url));

  const [totalCount, activeCount, historicalCount, soldCount, removedUnknownCount] = await Promise.all([
    db.lotMasterRecord.count(),
    db.lotMasterRecord.count({ where: { isCurrent: true } }),
    db.lotMasterRecord.count({ where: { isCurrent: false } }),
    db.lotMasterRecord.count({ where: { currentStatus: "SOLD" } }),
    db.lotMasterRecord.count({ where: { removalReason: "SOURCE_DISAPPEARANCE_UNKNOWN" } }),
  ]);

  const rawLots = await db.lotMasterRecord.findMany({
    skip: p.skip,
    take: p.take,
    where,
    orderBy: { lastSeenAt: "desc" },
    include: {
      _count: {
        select: { history: true },
      },
    },
  });

  const pg = paged(rawLots, p);

  return ok({
    sourceMode: sourceState.effectiveState,
    isSimulated: sourceState.isSimulated,
    summary: {
      total: totalCount,
      active: activeCount,
      historical: historicalCount,
      sold: soldCount,
      removedUnknown: removedUnknownCount,
    },
    page: pg.page,
    pageSize: pg.pageSize,
    hasMore: pg.hasMore,
    rows: pg.rows.map((r) => ({
      id: r.id,
      lotId: r.lotId,
      sourceRecordId: r.sourceRecordId,
      sourceType: r.sourceType,
      entityType: r.entityType,
      currentStatus: r.currentStatus,
      previousStatus: r.previousStatus,
      statusEffectiveDate: r.statusEffectiveDate.toISOString(),
      statusEffectiveDateIST: formatIST(r.statusEffectiveDate),
      docDate: r.docDate.toISOString(),
      docDateIST: formatIST(r.docDate, false),
      quantity: num(r.quantity),
      shape: r.shape,
      shapeNormalized: r.shapeNormalized,
      weight: num(r.weight),
      color: r.color,
      clarity: r.clarity,
      labRaw: r.labRaw,
      labNormalized: r.labNormalized,
      certificate: r.certificate,
      treatment: r.treatment,
      saleTotalUsd: r.saleTotalUsd ? num(r.saleTotalUsd) : null,
      customerCode: r.customerCode,
      customerName: r.customerName,
      departmentId: r.departmentId,
      departmentName: r.departmentName,
      locationId: r.locationId,
      locationName: r.locationName,
      country: r.country,
      branch: r.branch,
      roughOrPolished: r.roughOrPolished,
      wipStage: r.wipStage,
      parentRoughId: r.parentRoughId,
      kapan: r.kapan,
      stoneName: r.stoneName,
      isCurrent: r.isCurrent,
      removalReason: r.removalReason,
      removedFromLiveAt: r.removedFromLiveAt?.toISOString() ?? null,
      removedFromLiveAtIST: formatIST(r.removedFromLiveAt),
      firstSeenAt: r.firstSeenAt.toISOString(),
      firstSeenAtIST: formatIST(r.firstSeenAt),
      lastSeenAt: r.lastSeenAt.toISOString(),
      lastSeenAtIST: formatIST(r.lastSeenAt),
      currentVersion: r.currentVersion,
      versionCount: r._count.history,
      lastSyncBatchId: r.lastSyncBatchId,
      checkpoint: r.checkpoint,
      isSimulated: r.isSimulated,
    })),
  });
});
