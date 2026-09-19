import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr, paging, paged } from "@/lib/api/with-api";

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);
  const entity = qStr(url, "entity");
  const severity = qStr(url, "severity");
  const status = qStr(url, "status");

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (severity) where.severity = severity;
  if (status) where.status = status;

  const issues = await db.dataQualityIssue.findMany({ skip: p.skip, take: p.take, where, orderBy: { detectedAt: "desc" } });

  const severityCounts = { INFO: 0, WARNING: 0, ERROR: 0, BLOCKING: 0 };
  for (const i of issues) {
    severityCounts[i.severity as keyof typeof severityCounts] = (severityCounts[i.severity as keyof typeof severityCounts] ?? 0) + 1;
  }

  const pg = paged(issues, p);
  return ok({
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
      assignedTo: i.assignedTo,
      detectedAt: i.detectedAt.toISOString(),
      resolution: i.resolution,
      resolvedBy: i.resolvedBy,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
    severityCounts,
  });
});
