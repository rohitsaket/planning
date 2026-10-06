import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { badRequest, forbidden } from "@/lib/api/errors";

if (typeof window !== "undefined") {
  throw new Error("auth/access-scope is server-only and must not be imported by client code.");
}

export const SCOPE_DIMENSIONS = ["COUNTRY", "LAB"] as const;
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

export function isScopeDimension(value: unknown): value is ScopeDimension {
  return typeof value === "string" && (SCOPE_DIMENSIONS as readonly string[]).includes(value);
}

export interface EffectiveScope {
  readonly countries: readonly string[] | null;
  readonly labs: readonly string[] | null;
}

export const UNRESTRICTED_SCOPE: EffectiveScope = { countries: null, labs: null };

export function isUnrestricted(scope: EffectiveScope): boolean {
  return scope.countries === null && scope.labs === null;
}

export async function readEffectiveScope(
  userId: string,
  client: typeof db = db,
): Promise<EffectiveScope> {
  const delegate = (client as any).userAccessScope;
  if (!delegate?.findMany) {
    return { countries: null, labs: null };
  }

  const rows: Array<{ dimension: string; value: string }> = await delegate.findMany({
    where: { userId },
    select: { dimension: true, value: true },
    orderBy: [{ dimension: "asc" }, { value: "asc" }],
  });

  const countries = rows.filter((r) => r.dimension === "COUNTRY").map((r) => r.value);
  const labs = rows.filter((r) => r.dimension === "LAB").map((r) => r.value);

  return {
    countries: countries.length ? countries : null,
    labs: labs.length ? labs : null,
  };
}

export interface RequestedScope {
  readonly country?: string | null;
  readonly lab?: string | null;
}

function allows(allowed: readonly string[] | null, requested: string | null | undefined): boolean {
  if (requested === null || requested === undefined) return true;
  if (allowed === null) return true;
  return allowed.includes(requested);
}

export function assertScopeGrantable(granter: EffectiveScope, grant: { countries: readonly string[]; labs: readonly string[] }): void {
  const within = (held: readonly string[] | null, given: readonly string[]) => held === null || (given.length > 0 && given.every((v) => held.includes(v)));
  if (!within(granter.countries, grant.countries) || !within(granter.labs, grant.labs)) {
    throw forbidden("You cannot grant a country or lab scope wider than your own.");
  }
}

const SCOPE_VOCABULARY_LIMIT = 500;

export async function scopeVocabulary(within: EffectiveScope = UNRESTRICTED_SCOPE): Promise<{ countries: Array<{ code: string; name: string }>; labs: string[] }> {
  const [countries, labs] = await Promise.all([
    db.country.findMany({
      where: within.countries === null ? {} : { code: { in: [...within.countries] } },
      select: { code: true, name: true },
      orderBy: { code: "asc" },
      take: SCOPE_VOCABULARY_LIMIT,
    }),
    db.labMapping.findMany({
      where: { active: true, ...(within.labs === null ? {} : { normalizedLab: { in: [...within.labs] } }) },
      distinct: ["normalizedLab"],
      select: { normalizedLab: true },
      orderBy: { normalizedLab: "asc" },
      take: SCOPE_VOCABULARY_LIMIT,
    }),
  ]);
  return { countries, labs: labs.map((l) => l.normalizedLab) };
}

export async function assertKnownScopeValues(grant: { countries: readonly string[]; labs: readonly string[] }): Promise<void> {
  const [countries, labs] = await Promise.all([
    grant.countries.length ? db.country.findMany({ where: { code: { in: [...grant.countries] } }, select: { code: true } }) : [],
    grant.labs.length ? db.labMapping.findMany({ where: { active: true, normalizedLab: { in: [...grant.labs] } }, distinct: ["normalizedLab"], select: { normalizedLab: true } }) : [],
  ]);
  const knownCountries = new Set(countries.map((c) => c.code));
  const knownLabs = new Set(labs.map((l) => l.normalizedLab));
  const unknown = [...grant.countries.filter((c) => !knownCountries.has(c)), ...grant.labs.filter((l) => !knownLabs.has(l))];
  if (unknown.length > 0) throw badRequest(`Not a registered country or lab: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}.`);
}

export function assertWithinScope(scope: EffectiveScope, requested: RequestedScope): void {
  if (!allows(scope.countries, requested.country)) {
    throw forbidden("You are not authorized to view data for the requested country.");
  }
  if (!allows(scope.labs, requested.lab)) {
    throw forbidden("You are not authorized to view data for the requested lab.");
  }
}

export interface ScopeColumns {
  readonly country: string | null;
  readonly lab: string | null;
}

export function scopePredicates(scope: EffectiveScope, columns: ScopeColumns): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (scope.countries !== null && columns.country) {
    const col = Prisma.raw(columns.country);
    parts.push(Prisma.sql`(${col} IS NOT NULL AND ${col} IN (${Prisma.join([...scope.countries])}))`);
  }
  if (scope.labs !== null && columns.lab) {
    const col = Prisma.raw(columns.lab);
    parts.push(Prisma.sql`(${col} IS NOT NULL AND ${col} IN (${Prisma.join([...scope.labs])}))`);
  }
  return parts;
}

export function scopeSql(scope: EffectiveScope, columns: ScopeColumns): Prisma.Sql {
  const parts = scopePredicates(scope, columns).map((p) => Prisma.sql`AND ${p}`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

export interface ScopeFields {
  readonly country: string | null;
  readonly lab: string | null;
}

export function scopeWhere(scope: EffectiveScope, fields: ScopeFields): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (scope.countries !== null && fields.country) {
    where[fields.country] = { in: [...scope.countries] };
  }
  if (scope.labs !== null && fields.lab) {
    where[fields.lab] = { in: [...scope.labs] };
  }
  return where;
}

export interface ScopeDisclosure {
  readonly unrestricted: boolean;
  readonly countries: string[] | null;
  readonly labs: string[] | null;
  readonly summary: string;
}

export function describeScope(scope: EffectiveScope): ScopeDisclosure {
  const countries = scope.countries === null ? null : [...scope.countries];
  const labs = scope.labs === null ? null : [...scope.labs];
  const parts: string[] = [];
  if (countries) parts.push(`countries ${countries.join(", ")}`);
  if (labs) parts.push(`labs ${labs.join(", ")}`);
  return {
    unrestricted: isUnrestricted(scope),
    countries,
    labs,
    summary: parts.length
      ? `Your access is limited to ${parts.join(" and ")}.`
      : "You have access to all countries and labs.",
  };
}

export interface ScopeApplication {
  readonly applied: ScopeDimension[];
  readonly notEnforceable: ScopeDimension[];
  readonly notice: string | null;
}

const DIMENSION_LABELS: Record<ScopeDimension, string> = {
  COUNTRY: "country",
  LAB: "lab",
};

export function describeScopeApplication(
  scope: EffectiveScope,
  supported: readonly ScopeDimension[],
): ScopeApplication {
  const restricted: ScopeDimension[] = [];
  if (scope.countries !== null) restricted.push("COUNTRY");
  if (scope.labs !== null) restricted.push("LAB");

  const applied = restricted.filter((d) => supported.includes(d));
  const notEnforceable = restricted.filter((d) => !supported.includes(d));

  return {
    applied,
    notEnforceable,
    notice: notEnforceable.length
      ? `These figures are not limited by ${notEnforceable.map((d) => DIMENSION_LABELS[d]).join(" or ")}: ` +
        "the underlying records carry no such dimension, so there is nothing to narrow them by."
      : null,
  };
}
