import { createHash } from "node:crypto";
import { SARIN_MAIN_PLAN_LIMITS, type BlueWhitePacketType } from "@/lib/sarin/plan-structure";
import type { TransformRow } from "@/lib/sarin/transform";

if (typeof window !== "undefined") {
  throw new Error("sarin/transform/blue-white is server-only and must not be imported by client code.");
}

export const SARIN_BLUE_WHITE_TRANSFORM_PROFILE = {
  version: "SARIN_BLUE_WHITE_TRANSFORM_V1",
  mainPlanLimits: SARIN_MAIN_PLAN_LIMITS,
  additionalGrouping: "SEQUENTIAL_GREATER_THAN_PREVIOUS_THREE_DECIMAL_V1",
  yieldCalculation: "FIXED_DECIMAL_WEIGHT_OVER_ROUGH_PERCENT_SCALE_10_HALF_UP_V1",
  shapeNormalization: "APPROVED_SARIN_SHAPE_MAPPING_SET",
} as const;

export const SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH = createHash("sha256").update(JSON.stringify(SARIN_BLUE_WHITE_TRANSFORM_PROFILE)).digest("hex");

export type PlannedOption<R> =
  | { readonly kind: "MAIN"; readonly mainOrdinal: number; readonly rows: readonly R[] }
  | { readonly kind: "ADDITIONAL"; readonly groupOrdinal: number; readonly rows: readonly R[] };

export function planBlueWhiteStone<R extends TransformRow>(packetType: BlueWhitePacketType, rows: readonly R[]): PlannedOption<R>[] {
  const limit = SARIN_MAIN_PLAN_LIMITS[packetType];
  if (rows.length < limit) throw new Error("A Blue/White stone shorter than its main-plan limit cannot be transformed.");

  const options: PlannedOption<R>[] = rows.slice(0, limit).map((row, i) => ({ kind: "MAIN", mainOrdinal: i + 1, rows: [row] }));

  let group: R[] = [];
  let groupOrdinal = 0;
  let previous: R | null = null;
  for (const row of rows.slice(limit)) {
    if (previous === null || row.estimatedWeight.greaterThan(previous.estimatedWeight)) {
      if (group.length) options.push({ kind: "ADDITIONAL", groupOrdinal, rows: group });
      group = [];
      groupOrdinal++;
    }
    group.push(row);
    previous = row;
  }
  if (group.length) options.push({ kind: "ADDITIONAL", groupOrdinal, rows: group });
  return options;
}
