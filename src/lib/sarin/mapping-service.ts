import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, notFound } from "@/lib/api/errors";
import type { ApiContext } from "@/lib/api/with-api";
import type { EffectiveScope } from "@/lib/auth/access-scope";
import { readFixedDecimal } from "@/lib/sarin/raw-contract";
import { canonicalShapeKey, isEcosystemShape } from "@/lib/sarin/shape-normalization";
import { displayNamesOf } from "@/lib/sarin/import-queries";
import { findConflicts, RULE_SELECT, shapesNeedingMapping, unconfirmedShapes, type StoredRule } from "@/lib/sarin/mapping-analysis";
import { SARIN_FANTASY_SHAPE_CODES, type SarinEcosystemShape } from "@/lib/sarin/domain";

if (typeof window !== "undefined") {
  throw new Error("sarin/mapping-service is server-only and must not be imported by client code.");
}

export const SARIN_MAPPING_AUDIT = {
  saved: "SARIN_MAPPING_SAVED",
  removed: "SARIN_MAPPING_REMOVED",
} as const;

const ENTITY = "SarinShapeMappingSet";

export const SHAPE_MAPPING_SAVE_BODY = z
  .object({
    ruleId: z.string().min(1).max(64).optional(),
    sarinShape: z.string().max(256),
    fantasyShape: z.string().max(128),
    applyTo: z.enum(["ALL_RATIOS", "RATIO_RANGE"]),
    minimumRatio: z.string().max(16).nullable().optional(),
    maximumRatio: z.string().max(16).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();
export type ShapeMappingSaveInput = z.infer<typeof SHAPE_MAPPING_SAVE_BODY>;

export const MAPPING_MESSAGES = {
  saved: "Mapping saved",
  removed: "Mapping removed",
  duplicate: "This shape is already mapped",
  overlap: "This ratio overlaps another mapping",
  fantasyShape: "Choose a valid Fantasy shape",
  ratio: "Enter a valid ratio range",
  sarinShape: "Enter a Sarin shape",
  unsafe: "Remove invisible or special characters",
  failed: "Mapping could not be saved",
  missing: "This mapping no longer exists. Reload the page.",
  notConfigured: "Shape mappings are not configured.",
} as const;

type Field = "sarinShape" | "fantasyShape" | "ratio" | null;
const refuse = (status: number, code: string, message: string, field: Field) => new ApiError(status, code, message, { field });

export interface MappingActor {
  readonly userId: string;
  readonly audit: ApiContext<unknown>["audit"];
}

const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}]/u;
const RATIO = { integerDigits: 3, fractionDigits: 3, allowZero: true } as const;

function postgresCode(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "23505";
  const m = e instanceof Error ? /code: "([0-9A-Z]{5})"/.exec(e.message) : null;
  return m?.[1] ?? null;
}

interface CheckedRule {
  rawShapeKey: string;
  sourceRawShape: string;
  normalizedShape: string;
  conditionKind: "NONE" | "RATIO_RANGE";
  ratioMin: Prisma.Decimal | null;
  ratioMax: Prisma.Decimal | null;
  note: string | null;
}

function checkInput(input: ShapeMappingSaveInput): CheckedRule {
  if (UNSAFE_TEXT.test(input.sarinShape) || UNSAFE_TEXT.test(input.fantasyShape) || (input.note && UNSAFE_TEXT.test(input.note))) {
    throw refuse(400, "UNSAFE_CHARACTERS", MAPPING_MESSAGES.unsafe, null);
  }
  const rawShapeKey = canonicalShapeKey(input.sarinShape);
  if (rawShapeKey === "" || rawShapeKey.length > 128) throw refuse(400, "INVALID_SARIN_SHAPE", MAPPING_MESSAGES.sarinShape, "sarinShape");
  if (!isEcosystemShape(input.fantasyShape)) throw refuse(400, "UNKNOWN_FANTASY_SHAPE", MAPPING_MESSAGES.fantasyShape, "fantasyShape");
  const ranged = input.applyTo === "RATIO_RANGE";
  const bound = (v: string | null | undefined) => {
    if (v === undefined || v === null || v.trim() === "") return null;
    const r = readFixedDecimal(v.trim(), RATIO);
    if (!r.ok) throw refuse(400, "INVALID_RATIO_RANGE", MAPPING_MESSAGES.ratio, "ratio");
    return new Prisma.Decimal(r.value);
  };
  if (!ranged && ((input.minimumRatio ?? "").trim() !== "" || (input.maximumRatio ?? "").trim() !== "")) {
    throw refuse(400, "INVALID_RATIO_RANGE", MAPPING_MESSAGES.ratio, "ratio");
  }
  const ratioMin = ranged ? bound(input.minimumRatio) : null;
  const ratioMax = ranged ? bound(input.maximumRatio) : null;
  if (ranged && ratioMin === null && ratioMax === null) throw refuse(400, "INVALID_RATIO_RANGE", MAPPING_MESSAGES.ratio, "ratio");
  if (ratioMin !== null && ratioMax !== null && ratioMin.greaterThan(ratioMax)) throw refuse(400, "INVALID_RATIO_RANGE", MAPPING_MESSAGES.ratio, "ratio");
  const note = input.note?.trim() ? input.note.trim() : null;
  return { rawShapeKey, sourceRawShape: input.sarinShape.trim(), normalizedShape: input.fantasyShape, conditionKind: ranged ? "RATIO_RANGE" : "NONE", ratioMin, ratioMax, note };
}

const d3 = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(3));
type Condition = Pick<CheckedRule, "rawShapeKey" | "normalizedShape" | "ratioMin" | "ratioMax"> & { conditionKind: string };
const sameMapping = (a: Condition, b: Condition) =>
  a.rawShapeKey === b.rawShapeKey && a.normalizedShape === b.normalizedShape && a.conditionKind === b.conditionKind && d3(a.ratioMin) === d3(b.ratioMin) && d3(a.ratioMax) === d3(b.ratioMax);

function clash(rule: CheckedRule, others: readonly StoredRule[]): ApiError | null {
  const lo = (v: Prisma.Decimal | null) => v ?? new Prisma.Decimal(-1);
  const hi = (v: Prisma.Decimal | null) => v ?? new Prisma.Decimal(1_000_000);
  for (const o of others) {
    if (o.rawShapeKey !== rule.rawShapeKey) continue;
    if (o.conditionKind === "NONE" || rule.conditionKind === "NONE") return refuse(409, "MAPPING_DUPLICATE", MAPPING_MESSAGES.duplicate, "sarinShape");
    if (lo(o.ratioMin).lessThanOrEqualTo(hi(rule.ratioMax)) && lo(rule.ratioMin).lessThanOrEqualTo(hi(o.ratioMax))) {
      return refuse(409, "MAPPING_RATIO_OVERLAP", MAPPING_MESSAGES.overlap, "ratio");
    }
  }
  return null;
}

type Client = Prisma.TransactionClient | typeof db;

async function lockCatalog(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('sarin.shape-mapping.catalog'))`;
}

const rulesOf = (client: Client, setId: string): Promise<StoredRule[]> =>
  client.sarinShapeMappingRule.findMany({ where: { mappingSetId: setId }, select: RULE_SELECT, orderBy: [{ rawShapeKey: "asc" }, { ratioMin: { sort: "asc", nulls: "first" } }, { id: "asc" }] });

export async function captureEffectiveSnapshot(tx: Prisma.TransactionClient): Promise<{ id: string; version: number } | null> {
  const rows = await tx.$queryRaw<{ id: string; version: number }[]>`
    SELECT "id", "version" FROM "SarinShapeMappingSet"
     WHERE "sourceSystem" = 'SARIN' AND "status" = 'EFFECTIVE'
     FOR SHARE`;
  return rows[0] ?? null;
}

export async function mappingsConfigured(): Promise<boolean> {
  return (await db.sarinShapeMappingSet.count({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" } })) > 0;
}

type NextRule = CheckedRule & { changedAt: Date | null; changedByUserId: string | null };

async function writeSnapshot(tx: Prisma.TransactionClient, actor: MappingActor, current: { id: string } | null, next: NextRule[]) {
  const top = await tx.sarinShapeMappingSet.aggregate({ where: { sourceSystem: "SARIN" }, _max: { version: true } });
  const version = (top._max.version ?? 0) + 1;
  const set = await tx.sarinShapeMappingSet.create({
    data: { sourceSystem: "SARIN", version, origin: "USER", copiedFromSetId: current?.id ?? null, createdByUserId: actor.userId },
    select: { id: true },
  });
  if (next.length) await tx.sarinShapeMappingRule.createMany({ data: next.map((r) => ({ mappingSetId: set.id, ...r })) });
  if (current) await tx.sarinShapeMappingSet.update({ where: { id: current.id }, data: { status: "SUPERSEDED", supersededBySetId: set.id } });
  await tx.sarinShapeMappingSet.update({ where: { id: set.id }, data: { status: "EFFECTIVE" } });
  return { id: set.id, version };
}

const carried = (r: StoredRule): NextRule => ({
  rawShapeKey: r.rawShapeKey,
  sourceRawShape: r.sourceRawShape,
  normalizedShape: r.normalizedShape,
  conditionKind: r.conditionKind as "NONE" | "RATIO_RANGE",
  ratioMin: r.ratioMin,
  ratioMax: r.ratioMax,
  note: r.note,
  changedAt: r.changedAt ?? r.createdAt,
  changedByUserId: r.changedByUserId,
});

async function locateRule(tx: Prisma.TransactionClient, ruleId: string, currentRules: StoredRule[]): Promise<StoredRule> {
  const direct = currentRules.find((r) => r.id === ruleId);
  if (direct) return direct;
  const earlier = await tx.sarinShapeMappingRule.findUnique({ where: { id: ruleId }, select: RULE_SELECT });
  const copy = earlier ? currentRules.find((r) => sameMapping(r, earlier) && r.sourceRawShape === earlier.sourceRawShape) : undefined;
  if (!copy) throw new ApiError(404, "MAPPING_NOT_FOUND", MAPPING_MESSAGES.missing);
  return copy;
}

function asStoreError(e: unknown): never {
  if (e instanceof ApiError) throw e;
  const code = postgresCode(e);
  if (code === "23P01") throw refuse(409, "MAPPING_RATIO_OVERLAP", MAPPING_MESSAGES.overlap, "ratio");
  if (code === "23505") throw refuse(409, "MAPPING_DUPLICATE", MAPPING_MESSAGES.duplicate, "sarinShape");
  throw e;
}

export async function readMappingCatalog(scope: EffectiveScope) {
  const effective = await db.sarinShapeMappingSet.findFirst({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" }, select: { id: true } });
  const rules = effective ? await rulesOf(db, effective.id) : [];
  const names = await displayNamesOf(rules.map((r) => r.changedByUserId).filter((v): v is string => !!v));
  const needing = await shapesNeedingMapping(scope, rules);
  return {
    configured: !!effective,
    mappings: rules.map((r) => ({
      id: r.id,
      sarinShape: r.sourceRawShape,
      fantasyShape: r.normalizedShape,
      fantasyCode: SARIN_FANTASY_SHAPE_CODES[r.normalizedShape as SarinEcosystemShape] ?? null,
      applyTo: r.conditionKind === "NONE" ? ("ALL_RATIOS" as const) : ("RATIO_RANGE" as const),
      minimumRatio: d3(r.ratioMin),
      maximumRatio: d3(r.ratioMax),
      note: r.note,
      updatedAt: (r.changedAt ?? r.createdAt).toISOString(),
      updatedBy: r.changedByUserId ? (names.get(r.changedByUserId) ?? null) : null,
    })),
    needsMapping: needing.shapes,
    partialCounts: needing.partial,
    unconfirmed: unconfirmedShapes(rules).filter((shape) => !needing.shapes.some((s) => s.sarinShape === shape)),
  };
}

export async function saveShapeMapping(actor: MappingActor, input: ShapeMappingSaveInput) {
  const rule = checkInput(input);
  try {
    return await db.$transaction(async (tx) => {
      await lockCatalog(tx);
      const current = await tx.sarinShapeMappingSet.findFirst({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" }, select: { id: true, version: true } });
      const currentRules = current ? await rulesOf(tx, current.id) : [];
      const target = input.ruleId ? await locateRule(tx, input.ruleId, currentRules) : null;
      const unchanged = target
        ? sameMapping(target, rule) && target.sourceRawShape === rule.sourceRawShape && (target.note ?? null) === rule.note
        : currentRules.some((r) => sameMapping(r, rule));
      if (unchanged) return { changed: false, message: MAPPING_MESSAGES.saved };

      const others = currentRules.filter((r) => r.id !== target?.id);
      const refusal = clash(rule, others);
      if (refusal) throw refusal;
      const next = [...others.map(carried), { ...rule, changedAt: new Date(), changedByUserId: actor.userId }];
      const snapshot = await writeSnapshot(tx, actor, current, next);
      if (findConflicts(await rulesOf(tx, snapshot.id)).length) throw refuse(409, "MAPPING_CONFLICT", MAPPING_MESSAGES.failed, null);
      await actor.audit(tx, {
        action: SARIN_MAPPING_AUDIT.saved,
        entity: ENTITY,
        entityId: snapshot.id,
        before: target ? { sarinShape: target.sourceRawShape, fantasyShape: target.normalizedShape, conditionKind: target.conditionKind, ratioMin: d3(target.ratioMin), ratioMax: d3(target.ratioMax) } : undefined,
        after: { sarinShape: rule.sourceRawShape, fantasyShape: rule.normalizedShape, conditionKind: rule.conditionKind, ratioMin: d3(rule.ratioMin), ratioMax: d3(rule.ratioMax), snapshotVersion: snapshot.version, replacesVersion: current?.version ?? null },
        reason: target ? "Sarin shape mapping changed" : "Sarin shape mapping added",
      });
      return { changed: true, message: MAPPING_MESSAGES.saved };
    });
  } catch (e) {
    asStoreError(e);
  }
}

export async function removeShapeMapping(actor: MappingActor, ruleId: string) {
  try {
    return await db.$transaction(async (tx) => {
      await lockCatalog(tx);
      const current = await tx.sarinShapeMappingSet.findFirst({ where: { sourceSystem: "SARIN", status: "EFFECTIVE" }, select: { id: true, version: true } });
      if (!current) throw notFound("Mapping");
      const currentRules = await rulesOf(tx, current.id);
      const target = await locateRule(tx, ruleId, currentRules);
      const snapshot = await writeSnapshot(tx, actor, current, currentRules.filter((r) => r.id !== target.id).map(carried));
      await actor.audit(tx, {
        action: SARIN_MAPPING_AUDIT.removed,
        entity: ENTITY,
        entityId: snapshot.id,
        before: { sarinShape: target.sourceRawShape, fantasyShape: target.normalizedShape, conditionKind: target.conditionKind, ratioMin: d3(target.ratioMin), ratioMax: d3(target.ratioMax) },
        after: { snapshotVersion: snapshot.version, replacesVersion: current.version },
        reason: "Sarin shape mapping removed",
      });
      return { removed: true, message: MAPPING_MESSAGES.removed };
    });
  } catch (e) {
    asStoreError(e);
  }
}
