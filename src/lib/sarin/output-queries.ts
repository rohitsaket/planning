/**
 * Reads of Sarin output versions: the versions of one import, one version's summary, and
 * paginated stones, plan options and plan pieces. Every read first resolves the batch
 * inside the caller's scope (an out-of-scope batch or version is a 404) and nothing
 * returns an unbounded collection.
 *
 * Values are the stored values: weights and measurements as fixed three-place decimals,
 * the yield with its exact numerator, denominator and ten-place percentage plus the
 * confirmed two-place display. Nothing is recomputed here and nothing is ranked.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import type { Page } from "@/lib/sarin/import-queries";
import { bestTwinWeightFinding } from "@/lib/sarin/pink-structure";
import { displayYield, YIELD_SCALE } from "@/lib/sarin/yield";

if (typeof window !== "undefined") {
  throw new Error("sarin/output-queries is server-only and must not be imported by client code.");
}

export const SARIN_OUTPUT_VERSION_PAGE = { default: 25, max: 100 } as const;
export const SARIN_OUTPUT_STONE_PAGE = { default: 100, max: 500 } as const;
export const SARIN_OUTPUT_OPTION_PAGE = { default: 100, max: 500 } as const;
export const SARIN_OUTPUT_PIECE_PAGE = { default: 100, max: 500 } as const;

const scopeOf = (scope: EffectiveScope) => scopeWhere(scope, { country: "country", lab: "labScope" }) as Prisma.SarinImportBatchWhereInput;

const paged = <T>(rows: T[], page: Page, total: number) => ({ rows, page: page.page, pageSize: page.pageSize, total, hasMore: page.page * page.pageSize < total });
const skipTake = (page: Page) => ({ skip: (page.page - 1) * page.pageSize, take: page.pageSize });
const d3 = (v: Prisma.Decimal) => v.toFixed(3);

/** The option kinds a version of each stone type holds, in display order. */
const KINDS_OF = (stoneType: string): string[] => (stoneType === "PINK" ? ["MK", "SL", "BP", "BT"] : ["MAIN", "ADDITIONAL"]);

async function scopedBatch(scope: EffectiveScope, batchId: string) {
  return db.sarinImportBatch.findFirst({ where: { id: batchId, ...scopeOf(scope) }, select: { id: true, validationAttempt: true } });
}

/** The version within the batch within scope; null otherwise. */
async function scopedVersionId(scope: EffectiveScope, batchId: string, versionId: string): Promise<string | null> {
  const v = await db.sarinOutputVersion.findFirst({ where: { id: versionId, batchId, batch: scopeOf(scope) }, select: { id: true } });
  return v?.id ?? null;
}

const VERSION_SELECT = {
  id: true,
  versionNumber: true,
  status: true,
  stoneType: true,
  validationProfileVersion: true,
  transformProfileVersion: true,
  transformProfileHash: true,
  generatedByUserId: true,
  generatedAt: true,
  supersededAt: true,
  supersedesVersionId: true,
  stoneCount: true,
  optionCount: true,
  pieceCount: true,
  validationAttempt: { select: { attemptNumber: true } },
  shapeMappingSet: { select: { id: true, version: true } },
} as const satisfies Prisma.SarinOutputVersionSelect;

function versionView(v: Prisma.SarinOutputVersionGetPayload<{ select: typeof VERSION_SELECT }>, currentAttempt: number) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    status: v.status,
    // Current means: the batch's one GENERATED version, derived from its current validation.
    isCurrent: v.status === "GENERATED" && v.validationAttempt.attemptNumber === currentAttempt,
    stoneType: v.stoneType,
    validationAttempt: v.validationAttempt.attemptNumber,
    mappingSet: { id: v.shapeMappingSet.id, version: v.shapeMappingSet.version },
    validationProfile: v.validationProfileVersion,
    transformProfile: { version: v.transformProfileVersion, hash: v.transformProfileHash },
    generatedByUserId: v.generatedByUserId,
    generatedAt: v.generatedAt.toISOString(),
    supersededAt: v.supersededAt?.toISOString() ?? null,
    supersedesVersionId: v.supersedesVersionId,
    counts: { stones: v.stoneCount, options: v.optionCount, pieces: v.pieceCount },
  };
}

export async function listOutputVersions(scope: EffectiveScope, batchId: string, page: Page) {
  const batch = await scopedBatch(scope, batchId);
  if (!batch) return null;
  const where = { batchId: batch.id };
  const [total, rows] = await Promise.all([
    db.sarinOutputVersion.count({ where }),
    db.sarinOutputVersion.findMany({ where, orderBy: { versionNumber: "desc" }, ...skipTake(page), select: VERSION_SELECT }),
  ]);
  return { batchId: batch.id, ...paged(rows.map((v) => versionView(v, batch.validationAttempt)), page, total) };
}

/** One version with bounded aggregates of its content. */
export async function getOutputVersion(scope: EffectiveScope, batchId: string, versionId: string) {
  const batch = await scopedBatch(scope, batchId);
  if (!batch) return null;
  const v = await db.sarinOutputVersion.findFirst({ where: { id: versionId, batchId: batch.id }, select: VERSION_SELECT });
  if (!v) return null;
  const kinds = await db.sarinPlanOption.groupBy({ by: ["optionKind"], where: { outputVersionId: v.id }, _count: { _all: true }, _sum: { pieceCount: true } });
  const content = Object.fromEntries(
    KINDS_OF(v.stoneType).map((k) => {
      const g = kinds.find((x) => x.optionKind === k);
      return [k.toLowerCase(), { options: g?._count._all ?? 0, pieces: g?._sum.pieceCount ?? 0 }];
    }),
  );
  return {
    batchId: batch.id,
    version: versionView(v, batch.validationAttempt),
    content,
    yield: { scale: YIELD_SCALE, displayDecimals: 2, rounding: "HALF_UP" },
  };
}

export async function listOutputStones(scope: EffectiveScope, batchId: string, versionId: string, page: Page) {
  const version = await db.sarinOutputVersion.findFirst({ where: { id: versionId, batchId, batch: scopeOf(scope) }, select: { id: true, stoneType: true } });
  if (!version) return null;
  const id = version.id;
  const where: Prisma.SarinStoneBlockWhereInput = { batchId, planOptions: { some: { outputVersionId: id } } };
  const [total, blocks] = await Promise.all([
    db.sarinStoneBlock.count({ where }),
    db.sarinStoneBlock.findMany({
      where,
      orderBy: { blockSequence: "asc" },
      ...skipTake(page),
      select: { id: true, blockSequence: true, stoneNameRaw: true, kapan: true, packet: true, signer: true, roughWeight: true, rowCount: true, firstRowNumber: true, lastRowNumber: true },
    }),
  ]);
  const groups = blocks.length
    ? await db.sarinPlanOption.groupBy({ by: ["stoneBlockId", "optionKind"], where: { outputVersionId: id, stoneBlockId: { in: blocks.map((b) => b.id) } }, _count: { _all: true }, _sum: { pieceCount: true } })
    : [];
  return {
    versionId: id,
    ...paged(
      blocks.map((b) => {
        const own = groups.filter((g) => g.stoneBlockId === b.id);
        return {
          sequence: b.blockSequence,
          stoneName: b.stoneNameRaw,
          kapan: b.kapan,
          packet: b.packet,
          signer: b.signer,
          roughWeight: b.roughWeight ? d3(b.roughWeight) : null,
          sourceRows: { first: b.firstRowNumber, last: b.lastRowNumber, count: b.rowCount },
          optionsByKind: Object.fromEntries(KINDS_OF(version.stoneType).map((k) => [k, own.find((g) => g.optionKind === k)?._count._all ?? 0])),
          options: own.reduce((n, g) => n + g._count._all, 0),
          pieces: own.reduce((n, g) => n + (g._sum.pieceCount ?? 0), 0),
        };
      }),
      page,
      total,
    ),
  };
}

export async function listOutputOptions(scope: EffectiveScope, batchId: string, versionId: string, filters: { stoneSequence: number | null; kind: string | null }, page: Page) {
  const id = await scopedVersionId(scope, batchId, versionId);
  if (!id) return null;
  const where: Prisma.SarinPlanOptionWhereInput = {
    outputVersionId: id,
    ...(filters.stoneSequence !== null ? { stoneBlock: { blockSequence: filters.stoneSequence } } : {}),
    ...(filters.kind ? { optionKind: filters.kind } : {}),
  };
  const [total, rows] = await Promise.all([
    db.sarinPlanOption.count({ where }),
    db.sarinPlanOption.findMany({
      where,
      // Output rows are numbered in stone order, then option order.
      orderBy: { firstOutputRow: "asc" },
      ...skipTake(page),
      select: {
        id: true, optionSequence: true, optionKind: true, mainOrdinal: true, additionalGroupOrdinal: true, pieceCount: true,
        totalEstimatedWeight: true, yieldNumerator: true, yieldDenominator: true, yieldPercent: true, firstOutputRow: true, lastOutputRow: true, pairWeightDifference: true,
        stoneBlock: { select: { blockSequence: true, stoneNameRaw: true } },
      },
    }),
  ]);
  return {
    versionId: id,
    ...paged(
      rows.map((o) => ({
        id: o.id,
        stone: { sequence: o.stoneBlock.blockSequence, stoneName: o.stoneBlock.stoneNameRaw },
        optionSequence: o.optionSequence,
        kind: o.optionKind,
        mainOrdinal: o.mainOrdinal,
        additionalGroupOrdinal: o.additionalGroupOrdinal,
        pieceCount: o.pieceCount,
        totalEstimatedWeight: d3(o.totalEstimatedWeight),
        yield: { numerator: d3(o.yieldNumerator), denominator: d3(o.yieldDenominator), percent: o.yieldPercent.toFixed(YIELD_SCALE), display: displayYield(o.yieldPercent) },
        outputRows: { first: o.firstOutputRow, last: o.lastOutputRow },
        // Best Twin only: the stored difference, and the advisory it raises under the
        // current (unconfirmed-tolerance) policy.
        pairWeightDifference: o.pairWeightDifference ? d3(o.pairWeightDifference) : null,
        advisory: o.pairWeightDifference ? bestTwinWeightFinding(o.pairWeightDifference) : null,
      })),
      page,
      total,
    ),
  };
}

export async function listOutputPieces(scope: EffectiveScope, batchId: string, versionId: string, filters: { optionId: string | null; stoneSequence: number | null }, page: Page) {
  const id = await scopedVersionId(scope, batchId, versionId);
  if (!id) return null;
  const where: Prisma.SarinPlanPieceWhereInput = {
    outputVersionId: id,
    ...(filters.optionId ? { planOptionId: filters.optionId } : {}),
    ...(filters.stoneSequence !== null ? { planOption: { stoneBlock: { blockSequence: filters.stoneSequence } } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.sarinPlanPiece.count({ where }),
    db.sarinPlanPiece.findMany({
      where,
      orderBy: { outputRowSequence: "asc" },
      ...skipTake(page),
      select: {
        outputRowSequence: true, pieceSequence: true, sourceRowNumber: true, rawShape: true, normalizedShape: true, mappingRuleId: true,
        estimatedWeight: true, clarity: true, color: true, depthPct: true, ratio: true, length: true, width: true, depthMm: true,
        planOption: { select: { id: true, optionSequence: true, optionKind: true, stoneBlock: { select: { blockSequence: true } } } },
      },
    }),
  ]);
  return {
    versionId: id,
    ...paged(
      rows.map((p) => ({
        outputRow: p.outputRowSequence,
        stoneSequence: p.planOption.stoneBlock.blockSequence,
        option: { id: p.planOption.id, sequence: p.planOption.optionSequence, kind: p.planOption.optionKind },
        pieceSequence: p.pieceSequence,
        sourceRowNumber: p.sourceRowNumber,
        rawShape: p.rawShape,
        normalizedShape: p.normalizedShape,
        mappingRuleId: p.mappingRuleId,
        estimatedWeight: d3(p.estimatedWeight),
        clarity: p.clarity,
        color: p.color,
        depthPct: d3(p.depthPct),
        ratio: d3(p.ratio),
        length: d3(p.length),
        width: d3(p.width),
        depthMm: d3(p.depthMm),
      })),
      page,
      total,
    ),
  };
}
