/**
 * Resolves a raw Sarin shape against one APPROVED mapping set.
 *
 * The lookup key is the raw shape trimmed and upper-cased — the confirmed policy
 * ("compares trimmed Shape text without case sensitivity", design v1.7 §15.10). Nothing
 * else is normalized: no substring matching, no collapsing of inner spaces, no fallback
 * shape. Exactly one rule must apply; anything else is a finding for review.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { SARIN_ECOSYSTEM_SHAPES } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/shape-normalization is server-only and must not be imported by client code.");
}

export interface MappingRule {
  readonly id: string;
  readonly rawShapeKey: string;
  readonly normalizedShape: string;
  readonly conditionKind: string;
  readonly ratioMin: Prisma.Decimal | null;
  readonly ratioMax: Prisma.Decimal | null;
}

export type ShapeResolution =
  | { readonly result: "MAPPED" | "CONDITIONALLY_MAPPED"; readonly key: string; readonly rule: MappingRule }
  | {
      readonly result: "UNMAPPED" | "AMBIGUOUS";
      readonly key: string | null;
      readonly issue: "SHAPE_MISSING" | "SHAPE_UNMAPPED" | "MAPPING_RATIO_MISSING" | "MAPPING_NO_CONDITIONAL_RULE" | "MAPPING_MULTIPLE_RULES" | "MAPPING_NORMALIZED_SHAPE_INVALID";
    };

const VOCABULARY = new Set<string>(SARIN_ECOSYSTEM_SHAPES);

export const canonicalShapeKey = (raw: string) => raw.trim().toUpperCase();

export function isEcosystemShape(shape: string): boolean {
  return VOCABULARY.has(shape);
}

/** Rules of one set, indexed by key once so each row is resolved without a scan. */
export function indexRules(rules: readonly MappingRule[]): Map<string, MappingRule[]> {
  const byKey = new Map<string, MappingRule[]>();
  for (const r of rules) {
    const list = byKey.get(r.rawShapeKey) ?? [];
    list.push(r);
    byKey.set(r.rawShapeKey, list);
  }
  return byKey;
}

const withinRange = (ratio: Prisma.Decimal, r: MappingRule) =>
  (r.ratioMin === null || ratio.greaterThanOrEqualTo(r.ratioMin)) && (r.ratioMax === null || ratio.lessThanOrEqualTo(r.ratioMax));

export function resolveShape(index: Map<string, MappingRule[]>, shapeRaw: string | null, ratio: Prisma.Decimal | null): ShapeResolution {
  if (shapeRaw === null || shapeRaw.trim() === "") return { result: "UNMAPPED", key: null, issue: "SHAPE_MISSING" };
  const key = canonicalShapeKey(shapeRaw);
  const rules = index.get(key) ?? [];
  if (rules.length === 0) return { result: "UNMAPPED", key, issue: "SHAPE_UNMAPPED" };

  const exact = rules.filter((r) => r.conditionKind === "NONE");
  const conditional = rules.filter((r) => r.conditionKind === "RATIO_RANGE");

  let applied: MappingRule;
  let result: "MAPPED" | "CONDITIONALLY_MAPPED";
  if (exact.length > 0) {
    // The database refuses an unconditional rule beside any other rule for the same key,
    // so this is defensive: an approved set is never trusted to be unambiguous.
    if (exact.length > 1 || conditional.length > 0) return { result: "AMBIGUOUS", key, issue: "MAPPING_MULTIPLE_RULES" };
    applied = exact[0];
    result = "MAPPED";
  } else {
    if (ratio === null) return { result: "UNMAPPED", key, issue: "MAPPING_RATIO_MISSING" };
    const matching = conditional.filter((r) => withinRange(ratio, r));
    if (matching.length === 0) return { result: "UNMAPPED", key, issue: "MAPPING_NO_CONDITIONAL_RULE" };
    if (matching.length > 1) return { result: "AMBIGUOUS", key, issue: "MAPPING_MULTIPLE_RULES" };
    applied = matching[0];
    result = "CONDITIONALLY_MAPPED";
  }
  if (!isEcosystemShape(applied.normalizedShape)) return { result: "UNMAPPED", key, issue: "MAPPING_NORMALIZED_SHAPE_INVALID" };
  return { result, key, rule: applied };
}
