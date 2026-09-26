/**
 * Blue/White plan construction for one validated stone. Pure: given the stone's rows in
 * source order, it returns its plan options. Nothing is sorted.
 *
 *   Rows 1..limit (17 Blue, 32 White) are MAIN options of one piece each.
 *   Later rows form ADDITIONAL groups, scanned in source order: the first later row starts
 *   group 1; each following row starts a new group only when its Estimated Weight is
 *   greater than the immediately preceding row's, and otherwise joins the current group.
 *   Weights are compared as exact three-decimal values.
 *
 * Server-only.
 */

import { createHash } from "node:crypto";
import { SARIN_MAIN_PLAN_LIMITS, type BlueWhiteStoneType } from "@/lib/sarin/plan-structure";
import type { TransformRow } from "@/lib/sarin/transform";

if (typeof window !== "undefined") {
  throw new Error("sarin/transform/blue-white is server-only and must not be imported by client code.");
}

/** The versioned rules this transformation applies. Its hash is stored on every output. */
export const SARIN_BLUE_WHITE_TRANSFORM_PROFILE = {
  version: "SARIN_BLUE_WHITE_TRANSFORM_V1",
  mainPlanLimits: SARIN_MAIN_PLAN_LIMITS,
  additionalGrouping: "SEQUENTIAL_GREATER_THAN_PREVIOUS_THREE_DECIMAL_V1",
  yieldCalculation: "FIXED_DECIMAL_WEIGHT_OVER_ROUGH_PERCENT_SCALE_10_HALF_UP_V1",
  shapeNormalization: "APPROVED_SARIN_SHAPE_MAPPING_SET",
} as const;

/** Key order is fixed by the literal above, so the serialization is deterministic. */
export const SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH = createHash("sha256").update(JSON.stringify(SARIN_BLUE_WHITE_TRANSFORM_PROFILE)).digest("hex");

export type PlannedOption<R> =
  | { readonly kind: "MAIN"; readonly mainOrdinal: number; readonly rows: readonly R[] }
  | { readonly kind: "ADDITIONAL"; readonly groupOrdinal: number; readonly rows: readonly R[] };

export function planBlueWhiteStone<R extends TransformRow>(stoneType: BlueWhiteStoneType, rows: readonly R[]): PlannedOption<R>[] {
  const limit = SARIN_MAIN_PLAN_LIMITS[stoneType];
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
