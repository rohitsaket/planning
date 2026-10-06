import type { Prisma } from "@prisma/client";
import type { SarinEcosystemShape } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/pink-structure is server-only and must not be imported by client code.");
}

export const SARIN_PINK_BLOCK_ROWS = 45;

export const SARIN_PINK_PLAN_CODES = ["MK", "SL", "BP", "BT"] as const;
export type SarinPinkPlanCode = (typeof SARIN_PINK_PLAN_CODES)[number];

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

export const SARIN_PINK_LAYOUT: readonly PinkOptionSlot[] = buildLayout();

export const SARIN_PINK_CANDIDATE_FIELDS = ["normalizedShape", "estimatedWeight", "clarity", "color", "depthPct", "ratio", "length", "width", "depthMm"] as const;
export type PinkCandidateField = (typeof SARIN_PINK_CANDIDATE_FIELDS)[number];

export const SARIN_PINK_BT_WEIGHT_POLICY = "UNCONFIRMED_TOLERANCE_ADVISORY_V1";
export function bestTwinWeightFinding(difference: Prisma.Decimal): "BT_WEIGHT_VARIANCE_UNCONFIRMED" | null {
  return difference.isZero() ? null : "BT_WEIGHT_VARIANCE_UNCONFIRMED";
}
