import { Prisma } from "@prisma/client";

if (typeof window !== "undefined") {
  throw new Error("sarin/yield is server-only and must not be imported by client code.");
}

const Exact = Prisma.Decimal.clone({ precision: 60, rounding: Prisma.Decimal.ROUND_HALF_UP });

export const YIELD_SCALE = 10;

export interface PlanYield {
  readonly numerator: Prisma.Decimal;
  readonly denominator: Prisma.Decimal;
  readonly percent: Prisma.Decimal;
}

export function planYield(pieceWeights: readonly Prisma.Decimal[], roughWeight: Prisma.Decimal): PlanYield {
  if (!roughWeight.greaterThan(0)) throw new Error("A plan yield needs a positive Rough Weight.");
  if (pieceWeights.length === 0) throw new Error("A plan yield needs at least one piece.");
  const numerator = pieceWeights.reduce((sum, w) => sum.plus(w), new Exact(0));
  const percent = new Exact(numerator).times(100).dividedBy(new Exact(roughWeight)).toDecimalPlaces(YIELD_SCALE, Prisma.Decimal.ROUND_HALF_UP);
  return { numerator: new Prisma.Decimal(numerator), denominator: new Prisma.Decimal(roughWeight), percent: new Prisma.Decimal(percent) };
}

export function displayYield(percent: Prisma.Decimal): string {
  return new Exact(percent).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}
