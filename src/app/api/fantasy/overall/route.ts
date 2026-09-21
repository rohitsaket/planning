import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, paging, paged } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";

export const GET = withApi({ permission: "overall.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);
  const config = getFantasyConfig();

  const q = qStr(url, "q");
  const isCurrentParam = qStr(url, "isCurrent");
  const status = qStr(url, "status");
  const shape = qStr(url, "shape");
  const lab = qStr(url, "lab");
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");

  const where: Record<string, unknown> = {};

  if (isCurrentParam === "true") where.isCurrent = true;
  else if (isCurrentParam === "false") where.isCurrent = false;

  if (status && status !== "ALL") where.currentStatus = status;
  if (shape && shape !== "ALL") where.shapeNormalized = shape;
  if (lab && lab !== "ALL") where.labNormalized = lab;
  if (country && country !== "ALL") where.country = country;
  if (branch && branch !== "ALL") where.branch = branch;

  if (q) {
    where.OR = [
      { lotId: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { certificate: { contains: q, mode: "insensitive" } },
      { kapan: { contains: q, mode: "insensitive" } },
      { stoneName: { contains: q, mode: "insensitive" } },
    ];
  }

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
    sourceMode: config.sourceMode,
    isSimulated: config.isSimulation,
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
