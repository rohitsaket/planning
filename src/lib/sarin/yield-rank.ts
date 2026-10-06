import { Prisma } from "@prisma/client";
import type { SarinYieldRank } from "@/lib/sarin/yield-rank-style";

if (typeof window !== "undefined") {
  throw new Error("sarin/yield-rank is server-only and must not be imported by client code.");
}

export interface YieldRankCandidate {
  readonly stoneId: string;
  readonly optionId: string;
  readonly optionSequence: number;
  readonly pieceCount: number;
  readonly yieldPercent: Prisma.Decimal | null;
  readonly outputRows: readonly number[];
}

export interface RankedYieldOption {
  readonly stoneId: string;
  readonly optionId: string;
  readonly yieldPercent: string | null;
  readonly rank: SarinYieldRank | null;
  readonly outputRows: readonly number[];
}

function eligible(c: YieldRankCandidate): boolean {
  const y = c.yieldPercent;
  return y !== null && y.isFinite() && !y.isNegative() && c.pieceCount > 0 && c.outputRows.length === c.pieceCount;
}

function compare(a: YieldRankCandidate, b: YieldRankCandidate): number {
  const byYield = b.yieldPercent!.comparedTo(a.yieldPercent!);
  if (byYield !== 0) return byYield;
  if (a.optionSequence !== b.optionSequence) return a.optionSequence - b.optionSequence;
  return a.optionId < b.optionId ? -1 : a.optionId > b.optionId ? 1 : 0;
}

export function rankYieldOptions(candidates: readonly YieldRankCandidate[]): RankedYieldOption[] {
  const rankOf = new Map<string, SarinYieldRank>();
  const byStone = new Map<string, YieldRankCandidate[]>();
  for (const c of candidates) if (eligible(c)) byStone.set(c.stoneId, [...(byStone.get(c.stoneId) ?? []), c]);
  for (const stone of byStone.values()) {
    stone.sort(compare).slice(0, 3).forEach((c, i) => rankOf.set(c.optionId, (i + 1) as SarinYieldRank));
  }
  return candidates.map((c) => ({
    stoneId: c.stoneId,
    optionId: c.optionId,
    yieldPercent: eligible(c) ? c.yieldPercent!.toFixed(10) : null,
    rank: rankOf.get(c.optionId) ?? null,
    outputRows: c.outputRows,
  }));
}

export function yieldRankMap(candidates: readonly YieldRankCandidate[]): Map<string, SarinYieldRank> {
  return new Map(rankYieldOptions(candidates).flatMap((r) => (r.rank === null ? [] : [[r.optionId, r.rank] as const])));
}

export const outputRowRange = (first: number, last: number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
