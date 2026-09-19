import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = url.searchParams.get("entity");
  const severity = url.searchParams.get("severity");
  const status = url.searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (entity) where.entity = entity;
  if (severity) where.severity = severity;
  if (status) where.status = status;

  const issues = await db.dataQualityIssue.findMany({ where, orderBy: { detectedAt: "desc" } });

  const severityCounts = { INFO: 0, WARNING: 0, ERROR: 0, BLOCKING: 0 };
  for (const i of issues) {
    severityCounts[i.severity as keyof typeof severityCounts] = (severityCounts[i.severity as keyof typeof severityCounts] ?? 0) + 1;
  }

  return ok({
    rows: issues.map((i) => ({
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
}
