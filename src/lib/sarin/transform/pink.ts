import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SARIN_PINK_BLOCK_ROWS, SARIN_PINK_BT_WEIGHT_POLICY, SARIN_PINK_LAYOUT, type SarinPinkPlanCode } from "@/lib/sarin/pink-structure";
import type { TransformRow } from "@/lib/sarin/transform";

if (typeof window !== "undefined") {
  throw new Error("sarin/transform/pink is server-only and must not be imported by client code.");
}

export const SARIN_PINK_TRANSFORM_PROFILE = {
  version: "SARIN_PINK_TRANSFORM_V1",
  blockRows: SARIN_PINK_BLOCK_ROWS,
  layout: SARIN_PINK_LAYOUT.map((slot) => ({ code: slot.code, pieces: slot.pieces.map((p) => [p.position, p.shape]) })),
  optionOrder: "PHYSICAL_RECORD_ORDER",
  bestTwinWeight: SARIN_PINK_BT_WEIGHT_POLICY,
  yieldCalculation: "FIXED_DECIMAL_WEIGHT_OVER_ROUGH_PERCENT_SCALE_10_HALF_UP_V1",
  shapeNormalization: "APPROVED_SARIN_SHAPE_MAPPING_SET",
} as const;

export const SARIN_PINK_TRANSFORM_PROFILE_HASH = createHash("sha256").update(JSON.stringify(SARIN_PINK_TRANSFORM_PROFILE)).digest("hex");

export interface PinkPlannedOption<R> {
  readonly code: SarinPinkPlanCode;
  readonly rows: readonly R[];
  readonly pairWeightDifference: Prisma.Decimal | null;
}

export function planPinkStone<R extends TransformRow>(rows: readonly R[]): PinkPlannedOption<R>[] {
  if (rows.length !== SARIN_PINK_BLOCK_ROWS) throw new Error("A Pink stone that is not exactly 45 records cannot be transformed.");
  return SARIN_PINK_LAYOUT.map((slot) => {
    const pieces = slot.pieces.map((p) => rows[p.position - 1]);
    return {
      code: slot.code,
      rows: pieces,
      pairWeightDifference: slot.code === "BT" ? pieces[0].estimatedWeight.minus(pieces[1].estimatedWeight).abs() : null,
    };
  });
}
