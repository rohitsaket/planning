import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";
import { withApi, qStr, qEnum, paging, paged } from "@/lib/api/with-api";
import { ApiError } from "@/lib/api/errors";
import {
  ISSUE_SEVERITIES,
  ISSUE_STATUSES,
  ISSUE_TYPES,
  ISSUE_TYPE_KEYS,
  isIssueType,
  issueTypeOfRule,
} from "@/lib/data-quality/issue-types";

/**
 * Recorded data-quality issues, as synchronization and the demand calculation persisted
 * them. Read-only. Filtering, search, counts and paging all run in the database, so every
 * figure covers the whole filtered set rather than one page of it.
 *
 * Only business fields leave the server: the issue type (never the internal rule code),
 * where it came from, the affected record, the message and its review state. Batch and
 * checkpoint identifiers, raw and normalised source values and internal issue keys stay
 * here.
 */
export const GET = withApi({ permission: "data_quality.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const p = paging(url);

  const rawType = qStr(url, "type", 40);
  if (rawType && !isIssueType(rawType)) throw new ApiError(400, "BAD_REQUEST", "Query parameter 'type' is not a recognized issue type.");
  const severity = qEnum(url, "severity", ["ALL", ...ISSUE_SEVERITIES] as const, "ALL");
  const status = qEnum(url, "status", ["ALL", ...ISSUE_STATUSES] as const, "ALL");
  const search = qStr(url, "search", 100)?.trim() || null;

  const base: Prisma.DataQualityIssueWhereInput = {
    ...(rawType && isIssueType(rawType) ? { rule: { in: [...ISSUE_TYPES[rawType].rules] } } : {}),
    ...(status !== "ALL" ? { status } : {}),
    ...(search
      ? { OR: [{ message: { contains: search, mode: "insensitive" } }, { recordId: { contains: search, mode: "insensitive" } }] }
      : {}),
  };
  const where: Prisma.DataQualityIssueWhereInput = { ...base, ...(severity !== "ALL" ? { severity } : {}) };

  const [total, issues, bySeverity, recordedTotal] = await Promise.all([
    db.dataQualityIssue.count({ where }),
    db.dataQualityIssue.findMany({
      where,
      skip: p.skip,
      take: p.take,
      orderBy: [{ detectedAt: "desc" }, { id: "asc" }],
      select: { id: true, source: true, entity: true, recordId: true, rule: true, message: true, severity: true, status: true, detectedAt: true, resolution: true, resolvedAt: true },
    }),
    // Counts per severity for the other active filters, so the cards and the table agree.
    db.dataQualityIssue.groupBy({ by: ["severity"], where: base, _count: { _all: true } }),
    db.dataQualityIssue.count(),
  ]);

  const severityCounts = Object.fromEntries(ISSUE_SEVERITIES.map((s) => [s, bySeverity.find((g) => g.severity === s)?._count._all ?? 0]));
  const pg = paged(issues, p);

  return ok({
    rows: pg.rows.map((i) => ({
      id: i.id,
      type: issueTypeOfRule(i.rule),
      source: i.source,
      recordId: i.recordId,
      message: i.message,
      severity: i.severity,
      status: i.status,
      detectedAt: i.detectedAt.toISOString(),
      resolution: i.resolution,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
    })),
    paging: { page: pg.page, pageSize: pg.pageSize, total, hasMore: pg.hasMore },
    severityCounts,
    // Whether anything has ever been recorded, so an empty filter result is not mistaken
    // for a clean bill of health.
    recordedTotal,
    types: ISSUE_TYPE_KEYS,
  });
});
