/**
 * Sarin shape-mapping sets: draft, edit, approve, retire. Every write is audited and every
 * rule the database would refuse is refused here first with a clear, safe reason.
 *
 * The database remains the authority. It freezes approved sets and their rules, refuses
 * overlapping ranges (also under concurrency), computes the content hash, and refuses an
 * approval by the set's creator or last editor. This service records the last editor in
 * the same transaction as every rule change, so that separation-of-duties check has the
 * facts it needs.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError, conflict, forbidden, notFound } from "@/lib/api/errors";
import type { ApiContext } from "@/lib/api/with-api";
import { readFixedDecimal } from "@/lib/sarin/raw-contract";
import { canonicalShapeKey, isEcosystemShape } from "@/lib/sarin/shape-normalization";
import type { Page } from "@/lib/sarin/import-queries";

if (typeof window !== "undefined") {
  throw new Error("sarin/mapping-service is server-only and must not be imported by client code.");
}

export const SARIN_MAPPING_AUDIT = {
  created: "SARIN_MAPPING_SET_CREATED",
  ruleAdded: "SARIN_MAPPING_RULE_ADDED",
  ruleUpdated: "SARIN_MAPPING_RULE_UPDATED",
  approved: "SARIN_MAPPING_SET_APPROVED",
  retired: "SARIN_MAPPING_SET_RETIRED",
} as const;

const ENTITY = "SarinShapeMappingSet";
export const SARIN_MAPPING_SET_PAGE = { default: 25, max: 100 } as const;
export const SARIN_MAPPING_RULE_PAGE = { default: 100, max: 500 } as const;

/** Request body for adding or replacing a rule. The raw shape key is derived server-side. */
export const SARIN_MAPPING_RULE_BODY = z
  .object({
    rawShape: z.string().max(256),
    normalizedShape: z.string().max(128),
    conditionKind: z.enum(["NONE", "RATIO_RANGE"]),
    ratioMin: z.string().max(16).nullable().optional(),
    ratioMax: z.string().max(16).nullable().optional(),
  })
  .strict();

export interface MappingActor {
  readonly userId: string;
  readonly audit: ApiContext<unknown>["audit"];
}

export interface RuleInput {
  readonly rawShape: string;
  readonly normalizedShape: string;
  readonly conditionKind: "NONE" | "RATIO_RANGE";
  readonly ratioMin?: string | null;
  readonly ratioMax?: string | null;
}

/** The PostgreSQL error code behind a Prisma error, when there is one. */
function postgresCode(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "23505";
  const m = e instanceof Error ? /code: "([0-9A-Z]{5})"/.exec(e.message) : null;
  return m?.[1] ?? null;
}

const RATIO = { integerDigits: 3, fractionDigits: 3, allowZero: true } as const;

/** Validates a rule and returns the stored shape. Refusals are 400s with fixed wording. */
function normalizeRuleInput(input: RuleInput) {
  const rawShape = input.rawShape;
  const rawShapeKey = canonicalShapeKey(rawShape);
  if (rawShapeKey === "" || rawShapeKey.length > 128) throw new ApiError(400, "INVALID_RAW_SHAPE", "The Sarin shape must be 1 to 128 characters.");
  if (!isEcosystemShape(input.normalizedShape)) throw new ApiError(400, "UNKNOWN_ECOSYSTEM_SHAPE", "The target shape is not in the ecosystem shape list.");
  const bound = (v: string | null | undefined) => {
    if (v === undefined || v === null || v === "") return null;
    const r = readFixedDecimal(v, RATIO);
    if (!r.ok) throw new ApiError(400, "INVALID_RATIO_BOUND", "A Ratio bound must be a plain decimal with at most three decimal places.");
    return r.value;
  };
  const ratioMin = bound(input.ratioMin);
  const ratioMax = bound(input.ratioMax);
  if (input.conditionKind === "NONE" && (ratioMin !== null || ratioMax !== null)) throw new ApiError(400, "UNEXPECTED_RATIO_BOUND", "An unconditional rule has no Ratio bounds.");
  if (input.conditionKind === "RATIO_RANGE" && ratioMin === null && ratioMax === null) throw new ApiError(400, "MISSING_RATIO_BOUND", "A Ratio rule needs at least one bound.");
  if (ratioMin !== null && ratioMax !== null && new Prisma.Decimal(ratioMin).greaterThan(ratioMax)) throw new ApiError(400, "INVALID_RATIO_RANGE", "The lower Ratio bound is above the upper bound.");
  return { rawShapeKey, sourceRawShape: rawShape.trim(), normalizedShape: input.normalizedShape, conditionKind: input.conditionKind, ratioMin, ratioMax };
}

type NormalizedRule = ReturnType<typeof normalizeRuleInput>;

/** True when the rule would overlap another rule of the set for the same raw shape. */
async function overlaps(tx: Prisma.TransactionClient, setId: string, rule: NormalizedRule, exceptRuleId: string | null) {
  const others = await tx.sarinShapeMappingRule.findMany({
    where: { mappingSetId: setId, rawShapeKey: rule.rawShapeKey, ...(exceptRuleId ? { id: { not: exceptRuleId } } : {}) },
    select: { conditionKind: true, ratioMin: true, ratioMax: true },
  });
  const lo = (v: Prisma.Decimal | string | null) => (v === null ? new Prisma.Decimal(-1) : new Prisma.Decimal(v));
  const hi = (v: Prisma.Decimal | string | null) => (v === null ? new Prisma.Decimal(1_000_000) : new Prisma.Decimal(v));
  return others.some(
    (o) => o.conditionKind === "NONE" || rule.conditionKind === "NONE" || (lo(o.ratioMin).lessThanOrEqualTo(hi(rule.ratioMax)) && lo(rule.ratioMin).lessThanOrEqualTo(hi(o.ratioMax))),
  );
}

const ruleConflict = () => conflict("RULE_CONFLICT", "This rule overlaps or duplicates another rule for the same Sarin shape.");

/** Locks a draft set for editing and records the editor. 404 when absent, 409 when not a draft. */
async function touchDraft(tx: Prisma.TransactionClient, setId: string, actor: MappingActor) {
  const touched = await tx.sarinShapeMappingSet.updateMany({ where: { id: setId, status: "DRAFT" }, data: { lastModifiedByUserId: actor.userId, lastModifiedAt: new Date() } });
  if (touched.count === 1) return;
  const exists = await tx.sarinShapeMappingSet.count({ where: { id: setId } });
  if (!exists) throw notFound("Mapping set");
  throw conflict("MAPPING_SET_NOT_DRAFT", "Only a draft mapping set can be changed.");
}

// ---------------------------------------------------------------------------------------

export async function listMappingSets(status: string | null, page: Page) {
  const where: Prisma.SarinShapeMappingSetWhereInput = { sourceSystem: "SARIN", ...(status ? { status } : {}) };
  const [total, rows] = await Promise.all([
    db.sarinShapeMappingSet.count({ where }),
    db.sarinShapeMappingSet.findMany({
      where,
      orderBy: { version: "desc" },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: { id: true, version: true, status: true, origin: true, description: true, createdAt: true, approvedAt: true, retiredAt: true, _count: { select: { rules: true } } },
    }),
  ]);
  return {
    rows: rows.map((s) => ({ id: s.id, version: s.version, status: s.status, origin: s.origin, description: s.description, ruleCount: s._count.rules, createdAt: s.createdAt.toISOString(), approvedAt: s.approvedAt?.toISOString() ?? null, retiredAt: s.retiredAt?.toISOString() ?? null })),
    page: page.page,
    pageSize: page.pageSize,
    total,
    hasMore: page.page * page.pageSize < total,
  };
}

/**
 * The approved sets a validator may choose from, newest first. Read-only discovery: no
 * drafts, no rules, no editing facts, and only a prefix of the content hash, which is
 * enough to tell versions apart when confirming a choice.
 */
export async function listApprovedMappingSets(page: Page) {
  const where: Prisma.SarinShapeMappingSetWhereInput = { sourceSystem: "SARIN", status: "APPROVED" };
  const [total, rows] = await Promise.all([
    db.sarinShapeMappingSet.count({ where }),
    db.sarinShapeMappingSet.findMany({
      where,
      orderBy: { version: "desc" },
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: { id: true, version: true, status: true, sourceSystem: true, approvedAt: true, contentHash: true, _count: { select: { rules: true } } },
    }),
  ]);
  return {
    rows: rows.map((s) => ({
      id: s.id,
      version: s.version,
      status: s.status,
      sourceSystem: s.sourceSystem,
      approvedAt: s.approvedAt?.toISOString() ?? null,
      contentHashPrefix: s.contentHash?.slice(0, 12) ?? null,
      ruleCount: s._count.rules,
    })),
    page: page.page,
    pageSize: page.pageSize,
    total,
    hasMore: page.page * page.pageSize < total,
  };
}

export async function getMappingSet(setId: string) {
  const s = await db.sarinShapeMappingSet.findUnique({
    where: { id: setId },
    select: {
      id: true, version: true, status: true, origin: true, description: true, contentHash: true, createdByUserId: true, createdAt: true,
      lastModifiedByUserId: true, lastModifiedAt: true, approvedByUserId: true, approvedAt: true, retiredByUserId: true, retiredAt: true,
      _count: { select: { rules: true, attempts: true } },
    },
  });
  if (!s) return null;
  const { _count, ...rest } = s;
  return {
    ...rest,
    createdAt: s.createdAt.toISOString(),
    lastModifiedAt: s.lastModifiedAt?.toISOString() ?? null,
    approvedAt: s.approvedAt?.toISOString() ?? null,
    retiredAt: s.retiredAt?.toISOString() ?? null,
    ruleCount: _count.rules,
    validationAttemptCount: _count.attempts,
  };
}

export async function listMappingRules(setId: string, page: Page) {
  const exists = await db.sarinShapeMappingSet.count({ where: { id: setId } });
  if (!exists) return null;
  const where = { mappingSetId: setId };
  const [total, rows] = await Promise.all([
    db.sarinShapeMappingRule.count({ where }),
    db.sarinShapeMappingRule.findMany({
      where,
      orderBy: [{ rawShapeKey: "asc" }, { conditionKind: "asc" }, { ratioMin: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
      select: { id: true, rawShapeKey: true, sourceRawShape: true, normalizedShape: true, conditionKind: true, ratioMin: true, ratioMax: true },
    }),
  ]);
  return {
    setId,
    rows: rows.map((r) => ({ ...r, ratioMin: r.ratioMin?.toFixed(3) ?? null, ratioMax: r.ratioMax?.toFixed(3) ?? null })),
    page: page.page,
    pageSize: page.pageSize,
    total,
    hasMore: page.page * page.pageSize < total,
  };
}

export async function createDraftSet(actor: MappingActor, input: { description?: string; copyFromSetId?: string }) {
  // The next version is chosen inside the transaction; a concurrent create that picks the
  // same number loses on the unique (sourceSystem, version) index and simply retries.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const top = await tx.sarinShapeMappingSet.aggregate({ where: { sourceSystem: "SARIN" }, _max: { version: true } });
        const version = (top._max.version ?? 0) + 1;
        let copied: Array<Omit<Prisma.SarinShapeMappingRuleCreateManyInput, "mappingSetId">> = [];
        if (input.copyFromSetId) {
          const source = await tx.sarinShapeMappingSet.findUnique({ where: { id: input.copyFromSetId }, select: { id: true } });
          if (!source) throw new ApiError(400, "UNKNOWN_MAPPING_SET", "The mapping set to copy from does not exist.");
          const rules = await tx.sarinShapeMappingRule.findMany({ where: { mappingSetId: source.id }, select: { rawShapeKey: true, sourceRawShape: true, normalizedShape: true, conditionKind: true, ratioMin: true, ratioMax: true } });
          copied = rules;
        }
        const set = await tx.sarinShapeMappingSet.create({
          data: { sourceSystem: "SARIN", version, origin: "USER", description: input.description ?? null, createdByUserId: actor.userId, lastModifiedByUserId: actor.userId, lastModifiedAt: new Date() },
          select: { id: true, version: true },
        });
        if (copied.length) await tx.sarinShapeMappingRule.createMany({ data: copied.map((r) => ({ ...r, mappingSetId: set.id })) });
        await actor.audit(tx, { action: SARIN_MAPPING_AUDIT.created, entity: ENTITY, entityId: set.id, after: { version, copiedFromSetId: input.copyFromSetId ?? null, rulesCopied: copied.length }, reason: "Sarin mapping draft created" });
        return set;
      });
    } catch (e) {
      if (postgresCode(e) === "23505" && attempt < 2) continue;
      throw e;
    }
  }
  throw conflict("MAPPING_SET_VERSION_CONFLICT", "Another mapping set was created at the same time. Retry.");
}

export async function addMappingRule(actor: MappingActor, setId: string, input: RuleInput) {
  const rule = normalizeRuleInput(input);
  try {
    return await db.$transaction(async (tx) => {
      await touchDraft(tx, setId, actor);
      if (await overlaps(tx, setId, rule, null)) throw ruleConflict();
      const created = await tx.sarinShapeMappingRule.create({ data: { mappingSetId: setId, ...rule }, select: { id: true } });
      await actor.audit(tx, { action: SARIN_MAPPING_AUDIT.ruleAdded, entity: ENTITY, entityId: setId, after: { ruleId: created.id, ...rule }, reason: "Sarin mapping rule added" });
      return created;
    });
  } catch (e) {
    const code = postgresCode(e);
    if (code === "23P01" || code === "23505") throw ruleConflict();
    throw e;
  }
}

export async function updateMappingRule(actor: MappingActor, setId: string, ruleId: string, input: RuleInput) {
  const rule = normalizeRuleInput(input);
  try {
    return await db.$transaction(async (tx) => {
      await touchDraft(tx, setId, actor);
      const before = await tx.sarinShapeMappingRule.findFirst({ where: { id: ruleId, mappingSetId: setId }, select: { rawShapeKey: true, normalizedShape: true, conditionKind: true, ratioMin: true, ratioMax: true } });
      if (!before) throw notFound("Mapping rule");
      if (await overlaps(tx, setId, rule, ruleId)) throw ruleConflict();
      await tx.sarinShapeMappingRule.update({ where: { id: ruleId }, data: rule });
      await actor.audit(tx, {
        action: SARIN_MAPPING_AUDIT.ruleUpdated,
        entity: ENTITY,
        entityId: setId,
        before: { ruleId, ...before, ratioMin: before.ratioMin?.toFixed(3) ?? null, ratioMax: before.ratioMax?.toFixed(3) ?? null },
        after: { ruleId, ...rule },
        reason: "Sarin mapping rule changed",
      });
      return { id: ruleId };
    });
  } catch (e) {
    const code = postgresCode(e);
    if (code === "23P01" || code === "23505") throw ruleConflict();
    throw e;
  }
}

export async function approveMappingSet(actor: MappingActor, setId: string) {
  return db.$transaction(async (tx) => {
    const set = await tx.sarinShapeMappingSet.findUnique({ where: { id: setId }, select: { status: true, createdByUserId: true, lastModifiedByUserId: true, version: true } });
    if (!set) throw notFound("Mapping set");
    if (set.status !== "DRAFT") throw conflict("MAPPING_SET_NOT_DRAFT", "Only a draft mapping set can be approved.");
    // Separation of duties, also enforced by the database: the approver is someone other
    // than the person who created the draft and the person who last changed it.
    if (set.createdByUserId === actor.userId || set.lastModifiedByUserId === actor.userId) {
      throw forbidden("The creator or last editor of a mapping set cannot approve it.");
    }
    const rules = await tx.sarinShapeMappingRule.findMany({ where: { mappingSetId: setId }, select: { normalizedShape: true } });
    if (rules.length === 0) throw conflict("MAPPING_SET_EMPTY", "An empty mapping set cannot be approved.");
    if (rules.some((r) => !isEcosystemShape(r.normalizedShape))) throw conflict("MAPPING_SET_UNKNOWN_SHAPE", "The mapping set names a shape outside the ecosystem shape list.");
    const approved = await tx.sarinShapeMappingSet.update({ where: { id: setId }, data: { status: "APPROVED", approvedByUserId: actor.userId }, select: { id: true, version: true, contentHash: true, approvedAt: true } });
    await actor.audit(tx, { action: SARIN_MAPPING_AUDIT.approved, entity: ENTITY, entityId: setId, after: { version: approved.version, rules: rules.length, contentHashPrefix: approved.contentHash?.slice(0, 12) ?? null }, reason: "Sarin mapping set approved" });
    return approved;
  });
}

export async function retireMappingSet(actor: MappingActor, setId: string, reason: string) {
  return db.$transaction(async (tx) => {
    // Lock the set first, then check: an attempt cannot start on it in between.
    const retired = await tx.sarinShapeMappingSet.updateMany({ where: { id: setId, status: "APPROVED" }, data: { status: "RETIRED", retiredByUserId: actor.userId } });
    if (retired.count !== 1) {
      const exists = await tx.sarinShapeMappingSet.count({ where: { id: setId } });
      if (!exists) throw notFound("Mapping set");
      throw conflict("MAPPING_SET_NOT_APPROVED", "Only an approved mapping set can be retired.");
    }
    const running = await tx.sarinValidationAttempt.count({ where: { shapeMappingSetId: setId, status: "RUNNING" } });
    if (running > 0) throw conflict("MAPPING_SET_IN_USE", "A validation is running with this mapping set. Retire it once that finishes.");
    await actor.audit(tx, { action: SARIN_MAPPING_AUDIT.retired, entity: ENTITY, entityId: setId, after: { status: "RETIRED" }, reason });
    return { id: setId, status: "RETIRED" };
  });
}
