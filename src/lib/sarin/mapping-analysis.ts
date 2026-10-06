import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";
import { SARIN_PACKET_TYPES, type SarinPacketType } from "@/lib/sarin/domain";
import { canonicalShapeKey, indexRules, isEcosystemShape, resolveShape, type MappingRule } from "@/lib/sarin/shape-normalization";

if (typeof window !== "undefined") {
  throw new Error("sarin/mapping-analysis is server-only and must not be imported by client code.");
}

const SARIN_CLIENT_RULE_REQUIRED_SHAPES = ["EMERALD 4STEP", "NP-1235-6-KITE"] as const;

const MAX_VALUE_GROUPS = 20_000;

const RATIO_MAX = new Prisma.Decimal("999.999");
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;

export interface StoredRule extends MappingRule {
  readonly sourceRawShape: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly changedAt: Date | null;
  readonly changedByUserId: string | null;
}

export const RULE_SELECT = {
  id: true, rawShapeKey: true, sourceRawShape: true, normalizedShape: true, conditionKind: true, ratioMin: true, ratioMax: true, note: true,
  createdAt: true, changedAt: true, changedByUserId: true,
} as const;

export interface MappingConflict {
  readonly kind: "DUPLICATE_RULE" | "OVERLAPPING_RANGES" | "AMBIGUOUS_RULES" | "INVALID_BOUNDARY" | "UNKNOWN_TARGET_SHAPE" | "INVALID_SOURCE_SHAPE";
  readonly rawShapeKey: string;
  readonly ruleIds: string[];
}

export function findConflicts(rules: readonly StoredRule[]): MappingConflict[] {
  const out: MappingConflict[] = [];
  for (const r of rules) {
    if (r.rawShapeKey === "" || r.rawShapeKey.length > 128 || r.rawShapeKey !== canonicalShapeKey(r.rawShapeKey) || UNSAFE_TEXT.test(r.sourceRawShape)) {
      out.push({ kind: "INVALID_SOURCE_SHAPE", rawShapeKey: r.rawShapeKey, ruleIds: [r.id] });
    }
    if (!isEcosystemShape(r.normalizedShape)) out.push({ kind: "UNKNOWN_TARGET_SHAPE", rawShapeKey: r.rawShapeKey, ruleIds: [r.id] });
    const bad =
      (r.conditionKind === "NONE" && (r.ratioMin !== null || r.ratioMax !== null)) ||
      (r.conditionKind === "RATIO_RANGE" && r.ratioMin === null && r.ratioMax === null) ||
      (r.conditionKind !== "NONE" && r.conditionKind !== "RATIO_RANGE") ||
      [r.ratioMin, r.ratioMax].some((v) => v !== null && (v.isNegative() || v.greaterThan(RATIO_MAX) || v.decimalPlaces() > 3)) ||
      (r.ratioMin !== null && r.ratioMax !== null && r.ratioMin.greaterThan(r.ratioMax));
    if (bad) out.push({ kind: "INVALID_BOUNDARY", rawShapeKey: r.rawShapeKey, ruleIds: [r.id] });
  }
  for (const [key, list] of indexRules(rules)) {
    const unconditional = list.filter((r) => r.conditionKind === "NONE");
    const ranges = list.filter((r) => r.conditionKind === "RATIO_RANGE");
    if (unconditional.length > 1) out.push({ kind: "DUPLICATE_RULE", rawShapeKey: key, ruleIds: unconditional.map((r) => r.id) });
    if (unconditional.length > 0 && ranges.length > 0) out.push({ kind: "AMBIGUOUS_RULES", rawShapeKey: key, ruleIds: list.map((r) => r.id) });
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const [a, b] = [ranges[i], ranges[j]];
        const lo = (v: Prisma.Decimal | null) => v ?? new Prisma.Decimal(-1);
        const hi = (v: Prisma.Decimal | null) => v ?? new Prisma.Decimal(1_000_000);
        if (lo(a.ratioMin).lessThanOrEqualTo(hi(b.ratioMax)) && lo(b.ratioMin).lessThanOrEqualTo(hi(a.ratioMax))) {
          const same = String(a.ratioMin) === String(b.ratioMin) && String(a.ratioMax) === String(b.ratioMax);
          out.push({ kind: same ? "DUPLICATE_RULE" : "OVERLAPPING_RANGES", rawShapeKey: key, ruleIds: [a.id, b.id] });
        }
      }
    }
  }
  return out;
}

interface ValueGroup {
  readonly packetType: SarinPacketType;
  readonly rawShapeKey: string;
  readonly ratio: Prisma.Decimal | null;
  records: number;
}

async function importedValues(scope: EffectiveScope) {
  const groups: ValueGroup[] = [];
  let partial = false;
  for (const packetType of SARIN_PACKET_TYPES) {
    const rows = await db.sarinSourceRow.groupBy({
      by: ["shapeRaw", "ratio"],
      where: {
        shapeRaw: { not: null },
        outcome: { in: ["ACCEPTED", "QUARANTINED"] },
        batch: { packetType, ...(scopeWhere(scope, { country: null, lab: "labScope" }) as Prisma.SarinImportBatchWhereInput) },
      },
      _count: { _all: true },
      orderBy: [{ shapeRaw: "asc" }, { ratio: "asc" }],
      take: MAX_VALUE_GROUPS + 1,
    });
    if (rows.length > MAX_VALUE_GROUPS) partial = true;
    const byKey = new Map<string, ValueGroup>();
    for (const g of rows.slice(0, MAX_VALUE_GROUPS)) {
      const key = canonicalShapeKey(g.shapeRaw!);
      if (key === "") continue;
      const id = `${key}|${g.ratio?.toFixed(3) ?? ""}`;
      const existing = byKey.get(id);
      if (existing) existing.records += g._count._all;
      else byKey.set(id, { packetType, rawShapeKey: key, ratio: g.ratio, records: g._count._all });
    }
    groups.push(...byKey.values());
  }
  return { groups, partial };
}

export interface ShapeNeedingMapping {
  readonly sarinShape: string;
  readonly packetTypes: SarinPacketType[];
  readonly records: number;
  readonly observedRatio: { lowest: string; highest: string } | null;
}

export async function shapesNeedingMapping(scope: EffectiveScope, rules: readonly MappingRule[]): Promise<{ shapes: ShapeNeedingMapping[]; partial: boolean }> {
  const index = indexRules(rules);
  const { groups, partial } = await importedValues(scope);
  const unresolved = new Map<string, { records: number; packetTypes: Set<SarinPacketType>; ratios: Prisma.Decimal[] }>();
  for (const g of groups) {
    const resolution = resolveShape(index, g.rawShapeKey, g.ratio);
    if (!("issue" in resolution)) continue;
    const u = unresolved.get(g.rawShapeKey) ?? { records: 0, packetTypes: new Set<SarinPacketType>(), ratios: [] };
    u.records += g.records;
    u.packetTypes.add(g.packetType);
    if (g.ratio !== null) u.ratios.push(g.ratio);
    unresolved.set(g.rawShapeKey, u);
  }
  const shapes: ShapeNeedingMapping[] = [...unresolved.entries()]
    .sort(([ak, a], [bk, b]) => b.records - a.records || (ak < bk ? -1 : 1))
    .map(([key, u]) => {
      const ratios = [...u.ratios].sort((a, b) => a.comparedTo(b));
      return {
        sarinShape: key,
        packetTypes: [...u.packetTypes].sort(),
        records: u.records,
        observedRatio: ratios.length ? { lowest: ratios[0].toFixed(3), highest: ratios[ratios.length - 1].toFixed(3) } : null,
      };
    });
  return { shapes, partial };
}

export function unconfirmedShapes(rules: readonly MappingRule[]): string[] {
  const index = indexRules(rules);
  return SARIN_CLIENT_RULE_REQUIRED_SHAPES.filter((shape) => !index.has(shape));
}
