/**
 * The top-three yield ranking of one output's plan options, per rough stone (design v1.7
 * §15.13, as the client's Blue, White and Pink reference workbooks apply it).
 *
 *   - Candidates are every stored plan option of the stone — Blue/White main plans and
 *     additional groups, Pink MK, SL, BP and BT — each as one logical option, whatever its
 *     number of pieces. Stones are never compared with each other.
 *   - The value is the option's stored exact yield percentage (ten decimal places), never
 *     the two-place display and never re-derived from pieces.
 *   - Order: exact yield descending, then option sequence ascending, then option id, so
 *     equal yields always resolve the same way in the preview and the workbook.
 *   - An option without a valid, complete stored yield is not ranked.
 *
 * The rank is derived from immutable stored output, so a version previews and exports
 * with the same ranks however often it is read and whatever mappings change later.
 *
 * Server-only. The preview receives the result from the API; it never ranks by itself.
 */

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
  /** The option's output rows, as stored. */
  readonly outputRows: readonly number[];
}

export interface RankedYieldOption {
  readonly stoneId: string;
  readonly optionId: string;
  /** The exact stored percentage, or null when it is not a valid yield. */
  readonly yieldPercent: string | null;
  readonly rank: SarinYieldRank | null;
  readonly outputRows: readonly number[];
}

/** A stored yield that can be ranked: present, finite, not negative, and its option complete. */
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

/** Ranks every candidate within its own stone; the result keeps the input order. */
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

/** Option id → rank, for the options that have one. */
export function yieldRankMap(candidates: readonly YieldRankCandidate[]): Map<string, SarinYieldRank> {
  return new Map(rankYieldOptions(candidates).flatMap((r) => (r.rank === null ? [] : [[r.optionId, r.rank] as const])));
}

/** The output rows of an option stored as a contiguous first..last range. */
export const outputRowRange = (first: number, last: number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
