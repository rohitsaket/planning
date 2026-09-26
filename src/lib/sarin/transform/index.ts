/**
 * The transformation each declared stone type uses, behind one shape, so the output
 * service stores every type through the same versioned, audited path.
 *
 * Server-only.
 */

import type { Prisma } from "@prisma/client";
import type { SarinPlanOptionKind, SarinStoneType } from "@/lib/sarin/domain";
import { planBlueWhiteStone, SARIN_BLUE_WHITE_TRANSFORM_PROFILE, SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH } from "@/lib/sarin/transform/blue-white";
import { planPinkStone, SARIN_PINK_TRANSFORM_PROFILE, SARIN_PINK_TRANSFORM_PROFILE_HASH } from "@/lib/sarin/transform/pink";

if (typeof window !== "undefined") {
  throw new Error("sarin/transform is server-only and must not be imported by client code.");
}

export interface TransformRow {
  readonly estimatedWeight: Prisma.Decimal;
}

export interface GeneratedOption<R> {
  readonly kind: SarinPlanOptionKind;
  readonly mainOrdinal: number | null;
  readonly additionalGroupOrdinal: number | null;
  readonly pairWeightDifference: Prisma.Decimal | null;
  readonly rows: readonly R[];
}

export interface StoneTransform {
  readonly version: string;
  readonly hash: string;
  plan<R extends TransformRow>(rows: readonly R[]): GeneratedOption<R>[];
}

export function transformFor(stoneType: SarinStoneType): StoneTransform {
  if (stoneType === "PINK") {
    return {
      version: SARIN_PINK_TRANSFORM_PROFILE.version,
      hash: SARIN_PINK_TRANSFORM_PROFILE_HASH,
      plan: (rows) => planPinkStone(rows).map((o) => ({ kind: o.code, mainOrdinal: null, additionalGroupOrdinal: null, pairWeightDifference: o.pairWeightDifference, rows: o.rows })),
    };
  }
  return {
    version: SARIN_BLUE_WHITE_TRANSFORM_PROFILE.version,
    hash: SARIN_BLUE_WHITE_TRANSFORM_PROFILE_HASH,
    plan: (rows) =>
      planBlueWhiteStone(stoneType, rows).map((o) => ({
        kind: o.kind,
        mainOrdinal: o.kind === "MAIN" ? o.mainOrdinal : null,
        additionalGroupOrdinal: o.kind === "ADDITIONAL" ? o.groupOrdinal : null,
        pairWeightDifference: null,
        rows: o.rows,
      })),
  };
}
