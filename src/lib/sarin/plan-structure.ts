/**
 * The Blue/White plan structure contract, shared by validation (which proves a stone can be
 * transformed) and transformation (which builds it), so the two can never disagree.
 *
 *   BLUE   rows 1-17 of a stone are main individual plans
 *   WHITE  rows 1-32 of a stone are main individual plans
 *   every later row belongs to an additional plan group
 *
 * Every row that becomes a plan piece must carry the values the structured output shows.
 *
 * Server-only.
 */

if (typeof window !== "undefined") {
  throw new Error("sarin/plan-structure is server-only and must not be imported by client code.");
}

export const SARIN_MAIN_PLAN_LIMITS = { BLUE: 17, WHITE: 32 } as const;
export type BlueWhiteStoneType = keyof typeof SARIN_MAIN_PLAN_LIMITS;

export function isBlueWhite(stoneType: string): stoneType is BlueWhiteStoneType {
  return stoneType === "BLUE" || stoneType === "WHITE";
}

/** Source values every plan piece carries into the output, with their positional field. */
export const SARIN_OUTPUT_REQUIRED_FIELDS = [
  { field: "clarity", position: 5 },
  { field: "color", position: 6 },
  { field: "depthPct", position: 7 },
  { field: "ratio", position: 8 },
  { field: "length", position: 9 },
  { field: "width", position: 10 },
  { field: "depthMm", position: 11 },
] as const;

/**
 * The validation contract a validation attempt runs. V1 (Phase 4) covered identity, blocks,
 * Rough Weight and shape resolution; V2 added the Blue/White plan structure; V3 adds the
 * Pink 45-record structure (pink-structure.ts) and non-blocking advisories. An attempt
 * proves only its own profile's checks, so a V2 attempt must be validated again.
 */
export const SARIN_VALIDATION_PROFILE_VERSION = "SARIN_VALIDATION_V3";
