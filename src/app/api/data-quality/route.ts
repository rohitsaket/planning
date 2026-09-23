import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr, paging, paged } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import { isAuditableEntity } from "@/lib/domain/entity-labels";

export const GET = withApi({ permission: "data_quality.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);
  // Only a key this build knows reaches the query. An arbitrary client string is
  // refused rather than silently matching nothing.
  const entity = qStr(url, "entity", 60);
  if (entity && !isAuditableEntity(entity)) {
    throw new ApiError(400, "BAD_REQUEST", "Query parameter 'entity' is not a recognized record type.");
  }
  const severity = qStr(url, "severity");
  const status = qStr(url, "status");

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (severity) where.severity = severity;
  if (status) where.status = status;

  const [totalCount, issues] = await Promise.all([
    db.dataQualityIssue.count({ where }),
    db.dataQualityIssue.findMany({
      skip: p.skip,
      take: p.take,
      where,
      orderBy: { detectedAt: "desc" },
    }),
  ]);

  const [infoCount, warnCount, errorCount, blockCount] = await Promise.all([
    db.dataQualityIssue.count({ where: { severity: "INFO" } }),
    db.dataQualityIssue.count({ where: { severity: "WARNING" } }),
    db.dataQualityIssue.count({ where: { severity: "ERROR" } }),
    db.dataQualityIssue.count({ where: { severity: "BLOCKING" } }),
  ]);

  const severityCounts = { INFO: infoCount, WARNING: warnCount, ERROR: errorCount, BLOCKING: blockCount };
  const pg = paged(issues, p);

  return ok({
    total: totalCount,
    page: pg.page,
    pageSize: pg.pageSize,
    hasMore: pg.hasMore,
    rows: pg.rows.map((i) => ({
      id: i.id,
      issueCode: i.issueCode,
      source: i.source,
      entity: i.entity,
      recordId: i.recordId,
      rule: i.rule,
      message: i.message,
      severity: i.severity,
      status: i.status,
      syncRunId: i.syncRunId,
      batchId: i.batchId,
      checkpoint: i.checkpoint,
      affectedField: i.affectedField,
      rawValue: i.rawValue,
      normalizedValue: i.normalizedValue,
      downstreamImpact: i.downstreamImpact,
      assignedTo: i.assignedTo,
      detectedAt: i.detectedAt.toISOString(),
      resolution: i.resolution,
      resolvedBy: i.resolvedBy,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
    severityCounts,
  });
});
