/**
 * Validation reads for one import: a bounded summary for the batch detail, and paginated
 * lists of stone blocks, findings and row interpretations. Every list first resolves the
 * batch inside the caller's scope (an out-of-scope batch is a 404) and is then narrowed
 * to it; nothing returns an unbounded collection.
 *
 * The attempt shown by default is the latest COMPLETED one: a failed or running attempt
 * never replaces the last complete result.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { describeIssue } from "@/lib/sarin/issue-catalog";
import type { Page } from "@/lib/sarin/import-queries";

if (typeof window !== "undefined") {
  throw new Error("sarin/validation-queries is server-only and must not be imported by client code.");
}

export const SARIN_BLOCK_PAGE = { default: 100, max: 500 } as const;
export const SARIN_ISSUE_PAGE = { default: 100, max: 500 } as const;
export const SARIN_INTERPRETATION_PAGE = { default: 100, max: 500 } as const;

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: "country", lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

async function scopedBatchId(scope: EffectiveScope, batchId: string): Promise<string | null> {
  const b = await db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(scope) }, select: { id: true } });
  return b?.id ?? null;
}

async function latestCompletedAttempt(batchId: string) {
  return db.sarinValidationAttempt.findFirst({ where: { batchId, status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, select: { attemptNumber: true } });
}

const attemptView = (a: {
  attemptNumber: number;
  status: string;
  result: string | null;
  failureCode: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  shapeMappingSet: { id: string; version: number; status: string };
}) => ({
  number: a.attemptNumber,
  status: a.status,
  result: a.result,
  failureCode: a.failureCode,
  startedAt: a.startedAt.toISOString(),
  finishedAt: a.finishedAt?.toISOString() ?? null,
  mappingSet: { id: a.shapeMappingSet.id, version: a.shapeMappingSet.version, status: a.shapeMappingSet.status },
});

const ATTEMPT_SELECT = {
  attemptNumber: true,
  status: true,
  result: true,
  failureCode: true,
  startedAt: true,
  finishedAt: true,
  blockCount: true,
  parsedBlockCount: true,
  quarantinedBlockCount: true,
  interpretationCount: true,
  issueCount: true,
  blockingIssueCount: true,
  shapeMappingSet: { select: { id: true, version: true, status: true } },
} as const satisfies Prisma.SarinValidationAttemptSelect;

/** The validation part of a batch detail: bounded aggregates only. */
export async function getValidationSummary(batchId: string) {
  const [latest, completed] = await Promise.all([
    db.sarinValidationAttempt.findFirst({ where: { batchId }, orderBy: { attemptNumber: "desc" }, select: ATTEMPT_SELECT }),
    db.sarinValidationAttempt.findFirst({ where: { batchId, status: "COMPLETED" }, orderBy: { attemptNumber: "desc" }, select: ATTEMPT_SELECT }),
  ]);
  let issues: { bySeverity: Record<string, number>; byStatus: Record<string, number> } | null = null;
  if (completed) {
    const groups = await db.sarinValidationIssue.groupBy({ by: ["severity", "status"], where: { batchId, validationAttempt: completed.attemptNumber }, _count: { _all: true } });
    const bySeverity: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const g of groups) {
      bySeverity[g.severity] = (bySeverity[g.severity] ?? 0) + g._count._all;
      byStatus[g.status] = (byStatus[g.status] ?? 0) + g._count._all;
    }
    issues = { bySeverity, byStatus };
  }
  return {
    attemptCount: latest?.attemptNumber ?? 0,
    latestAttempt: latest ? attemptView(latest) : null,
    lastCompletedAttempt: completed
      ? {
          ...attemptView(completed),
          blocks: { total: completed.blockCount, parsed: completed.parsedBlockCount, quarantined: completed.quarantinedBlockCount },
          interpretations: completed.interpretationCount,
          issues: { total: completed.issueCount, blocking: completed.blockingIssueCount, ...issues },
        }
      : null,
    lastValidatedAt: completed?.finishedAt?.toISOString() ?? null,
  };
}

const paged = <T>(rows: T[], page: Page, total: number) => ({ rows, page: page.page, pageSize: page.pageSize, total, hasMore: page.page * page.pageSize < total });

export async function listStoneBlocks(scope: EffectiveScope, batchId: string, parseStatus: string | null, page: Page) {
  const id = await scopedBatchId(scope, batchId);
  if (!id) return null;
  const where: Prisma.SarinStoneBlockWhereInput = { batchId: id, ...(parseStatus ? { parseStatus } : {}) };
  const [total, rows] = await Promise.all([
    db.sarinStoneBlock.count({ where }),
    db.sarinStoneBlock.findMany({
      where,
      orderBy: { blockSequence: "asc" },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: { blockSequence: true, stoneNameRaw: true, kapan: true, packet: true, signer: true, firstRowNumber: true, lastRowNumber: true, rowCount: true, roughWeight: true, parseStatus: true },
    }),
  ]);
  return {
    batchId: id,
    ...paged(
      rows.map((b) => ({
        sequence: b.blockSequence,
        stoneName: b.stoneNameRaw,
        kapan: b.kapan,
        packet: b.packet,
        signer: b.signer,
        firstRowNumber: b.firstRowNumber,
        lastRowNumber: b.lastRowNumber,
        rowCount: b.rowCount,
        roughWeight: b.roughWeight?.toFixed(3) ?? null,
        parseStatus: b.parseStatus,
      })),
      page,
      total,
    ),
  };
}

export interface IssueFilters {
  readonly attempt: number | null;
  readonly severity: string | null;
  readonly status: string | null;
  readonly code: string | null;
}

export async function listValidationIssues(scope: EffectiveScope, batchId: string, filters: IssueFilters, page: Page) {
  const id = await scopedBatchId(scope, batchId);
  if (!id) return null;
  const attempt = filters.attempt ?? (await latestCompletedAttempt(id))?.attemptNumber ?? null;
  if (attempt === null) return { batchId: id, attempt: null, ...paged([], page, 0) };
  const where: Prisma.SarinValidationIssueWhereInput = {
    batchId: id,
    validationAttempt: attempt,
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.code ? { code: filters.code } : {}),
  };
  const [total, rows] = await Promise.all([
    db.sarinValidationIssue.count({ where }),
    db.sarinValidationIssue.findMany({
      where,
      orderBy: [{ ordinal: { sort: "asc", nulls: "last" } }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: {
        id: true, code: true, severity: true, blocking: true, status: true, validationAttempt: true, fieldPosition: true, fieldName: true, parametersJson: true, createdAt: true, resolvedAt: true,
        stoneBlock: { select: { blockSequence: true, stoneNameRaw: true } },
        sourceRow: { select: { sourceRowNumber: true } },
      },
    }),
  ]);
  return {
    batchId: id,
    attempt,
    ...paged(
      rows.map((i) => ({
        id: i.id,
        code: i.code,
        ...describeIssue(i.code),
        severity: i.severity,
        blocking: i.blocking,
        reviewStatus: i.status,
        attempt: i.validationAttempt,
        block: i.stoneBlock ? { sequence: i.stoneBlock.blockSequence, stoneName: i.stoneBlock.stoneNameRaw } : null,
        sourceRowNumber: i.sourceRow?.sourceRowNumber ?? null,
        fieldPosition: i.fieldPosition,
        field: i.fieldName,
        details: i.parametersJson ? (JSON.parse(i.parametersJson) as Record<string, unknown>) : null,
        raisedAt: i.createdAt.toISOString(),
        resolvedAt: i.resolvedAt?.toISOString() ?? null,
      })),
      page,
      total,
    ),
  };
}

export async function listRowInterpretations(scope: EffectiveScope, batchId: string, filters: { attempt: number | null; mappingResult: string | null }, page: Page) {
  const id = await scopedBatchId(scope, batchId);
  if (!id) return null;
  const attempt = filters.attempt ?? (await latestCompletedAttempt(id))?.attemptNumber ?? null;
  if (attempt === null) return { batchId: id, attempt: null, ...paged([], page, 0) };
  const where: Prisma.SarinRowInterpretationWhereInput = { batchId: id, validationAttempt: attempt, ...(filters.mappingResult ? { mappingResult: filters.mappingResult } : {}) };
  const [total, rows] = await Promise.all([
    db.sarinRowInterpretation.count({ where }),
    db.sarinRowInterpretation.findMany({
      where,
      orderBy: { sourceRowNumber: "asc" },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: {
        sourceRowNumber: true, rawShapeKey: true, normalizedShape: true, mappingResult: true, mappingRuleId: true,
        stoneBlock: { select: { blockSequence: true } },
        sourceRow: { select: { shapeRaw: true } },
        shapeMappingSet: { select: { id: true, version: true } },
      },
    }),
  ]);
  return {
    batchId: id,
    attempt,
    ...paged(
      rows.map((r) => ({
        sourceRowNumber: r.sourceRowNumber,
        blockSequence: r.stoneBlock.blockSequence,
        rawShape: r.sourceRow.shapeRaw,
        normalizedShape: r.normalizedShape,
        mappingResult: r.mappingResult,
        mappingRuleId: r.mappingRuleId,
        mappingSet: { id: r.shapeMappingSet.id, version: r.shapeMappingSet.version },
      })),
      page,
      total,
    ),
  };
}
