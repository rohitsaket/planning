import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { notFound } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { getFantasyConfig } from "@/lib/fantasy/config";
import { formatIST } from "@/lib/fantasy/time";

export const GET = withApi<{ lotId: string }>({ permission: "overall.read" }, async (_req, ctx) => {
  const { lotId } = await ctx.params;
  const config = getFantasyConfig();

  const master = await db.lotMasterRecord.findUnique({
    where: { lotId },
    include: {
      history: {
        orderBy: { version: "asc" },
      },
    },
  });

  if (!master) {
    throw notFound(`Lot "${lotId}"`);
  }

  return ok({
    sourceMode: config.sourceMode,
    isSimulated: config.isSimulation,
    lot: {
      id: master.id,
      lotId: master.lotId,
      sourceType: master.sourceType,
      entityType: master.entityType,
      currentStatus: master.currentStatus,
      previousStatus: master.previousStatus,
      statusEffectiveDate: master.statusEffectiveDate.toISOString(),
      statusEffectiveDateIST: formatIST(master.statusEffectiveDate),
      docDate: master.docDate.toISOString(),
      docDateIST: formatIST(master.docDate, false),
      quantity: num(master.quantity),
      shape: master.shape,
      shapeNormalized: master.shapeNormalized,
      weight: num(master.weight),
      color: master.color,
      clarity: master.clarity,
      labRaw: master.labRaw,
      labNormalized: master.labNormalized,
      certificate: master.certificate,
      treatment: master.treatment,
      saleTotalUsd: master.saleTotalUsd ? num(master.saleTotalUsd) : null,
      customerCode: master.customerCode,
      customerName: master.customerName,
      departmentId: master.departmentId,
      departmentName: master.departmentName,
      locationId: master.locationId,
      locationName: master.locationName,
      country: master.country,
      branch: master.branch,
      roughOrPolished: master.roughOrPolished,
      wipStage: master.wipStage,
      parentRoughId: master.parentRoughId,
      kapan: master.kapan,
      stoneName: master.stoneName,
      isCurrent: master.isCurrent,
      removalReason: master.removalReason,
      removedFromLiveAt: master.removedFromLiveAt?.toISOString() ?? null,
      removedFromLiveAtIST: formatIST(master.removedFromLiveAt),
      firstSeenAt: master.firstSeenAt.toISOString(),
      firstSeenAtIST: formatIST(master.firstSeenAt),
      lastSeenAt: master.lastSeenAt.toISOString(),
      lastSeenAtIST: formatIST(master.lastSeenAt),
      currentVersion: master.currentVersion,
      lastSyncBatchId: master.lastSyncBatchId,
      checkpoint: master.checkpoint,
      isSimulated: master.isSimulated,
    },
    timeline: master.history.map((h) => ({
      id: h.id,
      version: h.version,
      status: h.status,
      docDate: h.docDate.toISOString(),
      docDateIST: formatIST(h.docDate, false),
      statusEffectiveDate: h.statusEffectiveDate.toISOString(),
      statusEffectiveDateIST: formatIST(h.statusEffectiveDate),
      shape: h.shape,
      weight: num(h.weight),
      color: h.color,
      clarity: h.clarity,
      labNormalized: h.labNormalized,
      saleTotalUsd: h.saleTotalUsd ? num(h.saleTotalUsd) : null,
      customerName: h.customerName,
      departmentName: h.departmentName,
      locationName: h.locationName,
      country: h.country,
      branch: h.branch,
      wipStage: h.wipStage,
      isCurrent: h.isCurrent,
      removalReason: h.removalReason,
      changeReason: h.changeReason,
      syncBatchId: h.syncBatchId,
      checkpoint: h.checkpoint,
      isSimulated: h.isSimulated,
      recordedAt: h.recordedAt.toISOString(),
      recordedAtIST: formatIST(h.recordedAt),
    })),
  });
});
