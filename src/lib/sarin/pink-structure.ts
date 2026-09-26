/**
 * The Pink plan structure contract, shared by validation (which proves a stone can be
 * transformed) and transformation (which builds it), so the two can never disagree.
 *
 * A Pink stone is exactly 45 physical records. The raw file carries no plan code: every
 * code is derived from the record's position, never from any column value.
 *
 *   rows  1-27  nine shape families, three rows each:
 *               MK (Makeable)  one piece: the family's candidate
 *               SL (Solace)    two pieces: the same candidate again, then a Round
 *                              candidate from the remaining rough
 *   rows 28-33  three BP (Best Pair) options of two pieces
 *   rows 34-45  six BT (Best Twin) options of two pieces of one shape
 *
 * Options are numbered 1-27 in physical row order.
 *
 * Server-only.
 */

import type { Prisma } from "@prisma/client";
import type { SarinEcosystemShape } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/pink-structure is server-only and must not be imported by client code.");
}

export const SARIN_PINK_BLOCK_ROWS = 45;

export const SARIN_PINK_PLAN_CODES = ["MK", "SL", "BP", "BT"] as const;
export type SarinPinkPlanCode = (typeof SARIN_PINK_PLAN_CODES)[number];

/** One logical option: its code and the 1-based physical positions of its pieces, with the shape each must be. */
export interface PinkOptionSlot {
  readonly sequence: number;
  readonly code: SarinPinkPlanCode;
  readonly pieces: readonly { readonly position: number; readonly shape: SarinEcosystemShape }[];
}

const FAMILIES: readonly SarinEcosystemShape[] = ["Round", "Pear", "Oval", "Asscher", "Emerald", "Radiant", "Cushion Brilliant", "Antique Cushion", "Heart"];
const BEST_PAIRS: readonly (readonly [SarinEcosystemShape, SarinEcosystemShape])[] = [["Emerald", "Round"], ["Oval", "Round"], ["Emerald", "Oval"]];
const BEST_TWINS: readonly SarinEcosystemShape[] = ["Round", "Oval", "Emerald", "Radiant", "Cushion Brilliant", "Antique Cushion"];

function buildLayout(): PinkOptionSlot[] {
  const slots: PinkOptionSlot[] = [];
  const add = (code: SarinPinkPlanCode, pieces: PinkOptionSlot["pieces"]) => slots.push({ sequence: slots.length + 1, code, pieces });
  FAMILIES.forEach((shape, f) => {
    const mk = 3 * f + 1;
    add("MK", [{ position: mk, shape }]);
    add("SL", [{ position: mk + 1, shape }, { position: mk + 2, shape: "Round" }]);
  });
  BEST_PAIRS.forEach(([a, b], i) => add("BP", [{ position: 28 + 2 * i, shape: a }, { position: 29 + 2 * i, shape: b }]));
  BEST_TWINS.forEach((shape, i) => add("BT", [{ position: 34 + 2 * i, shape }, { position: 35 + 2 * i, shape }]));
  return slots;
}

/** The 27 options of every Pink stone, in output order. */
export const SARIN_PINK_LAYOUT: readonly PinkOptionSlot[] = buildLayout();

/**
 * Source values that must be identical for an SL primary to be the same candidate as its
 * MK option. Rough Weight is already one value per stone.
 */
export const SARIN_PINK_CANDIDATE_FIELDS = ["normalizedShape", "estimatedWeight", "clarity", "color", "depthPct", "ratio", "length", "width", "depthMm"] as const;
export type PinkCandidateField = (typeof SARIN_PINK_CANDIDATE_FIELDS)[number];

/**
 * Best Twin weight policy. The business describes twins as the same weight, but no
 * tolerance has been confirmed and real files differ by a few thousandths of a carat. So
 * any non-zero difference is recorded and shown as an advisory, never as invalid. A
 * confirmed tolerance replaces this function (and bumps the validation and transformation
 * profiles); nothing else decides it.
 */
export const SARIN_PINK_BT_WEIGHT_POLICY = "UNCONFIRMED_TOLERANCE_ADVISORY_V1";
export function bestTwinWeightFinding(difference: Prisma.Decimal): "BT_WEIGHT_VARIANCE_UNCONFIRMED" | null {
  return difference.isZero() ? null : "BT_WEIGHT_VARIANCE_UNCONFIRMED";
}
