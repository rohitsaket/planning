/**
 * COUNTRY AND LAB AUTHORIZATION SCOPE.
 *
 * A permission answers "may this user read analysis at all". A scope answers "which of
 * it". Before this module there was no answer to the second question: the country, branch
 * and lab controls on screen were a convenience filter that any caller could widen by
 * editing a query string, and every Analysis route returned the whole business to anyone
 * holding `analysis.read`.
 *
 * ## The model
 *
 * A scope is a set of allowed values per dimension, stored one row per value in
 * `UserAccessScope` — never a delimited string. A delimited string cannot be indexed,
 * cannot be uniquely constrained, cannot be revoked one value at a time, and silently
 * widens access the first time a value contains the delimiter.
 *
 * **An empty set means unrestricted.** That is the whole backward-compatibility story:
 * the table starts empty, so every account that existed before scoping keeps exactly the
 * access it had, and narrowing someone is a deliberate act. The alternative — treating an
 * empty set as "nothing allowed" — would have locked every existing user out on deploy.
 *
 * ## How it is enforced
 *
 * Two operations, both here, so a page cannot invent a third:
 *
 *   - `assertWithinScope` refuses a request that asks for a value the user may not see.
 *     It is a 403, not a silent narrowing: a caller that asked for another country gets
 *     told it is not allowed rather than quietly handed different data.
 *   - `scopeSql` / `scopeWhere` narrow the query itself. They apply whether or not the
 *     request carried a filter, so the default view of a scoped user is their own scope
 *     rather than everything.
 *
 * Both are needed. Narrowing alone would turn an unauthorized request into a confusing
 * empty result; refusing alone would leave the unfiltered request returning everything.
 *
 * The scope is always derived from the authenticated server session. Nothing here ever
 * reads a country, lab, role or actor from a request body, a header or a query parameter
 * as an authorization input.
 *
 * Server-only.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { forbidden } from "@/lib/api/errors";

if (typeof window !== "undefined") {
  throw new Error("auth/access-scope is server-only and must not be imported by client code.");
}

/** The dimensions a scope can restrict. Closed: an unknown dimension is not storable. */
export const SCOPE_DIMENSIONS = ["COUNTRY", "LAB"] as const;
export type ScopeDimension = (typeof SCOPE_DIMENSIONS)[number];

export function isScopeDimension(value: unknown): value is ScopeDimension {
  return typeof value === "string" && (SCOPE_DIMENSIONS as readonly string[]).includes(value);
}

/**
 * The effective scope of one principal.
 *
 * `null` means unrestricted for that dimension — not "none". An empty array is never
 * produced by `readEffectiveScope`: a dimension with no rows resolves to `null`.
 */
export interface EffectiveScope {
  readonly countries: readonly string[] | null;
  readonly labs: readonly string[] | null;
}

/** Full access to every country and every lab. */
export const UNRESTRICTED_SCOPE: EffectiveScope = { countries: null, labs: null };

export function isUnrestricted(scope: EffectiveScope): boolean {
  return scope.countries === null && scope.labs === null;
}

/**
 * The scope stored for a user, normalized.
 *
 * A dimension with no rows becomes `null`, which is what every consumer treats as
 * unrestricted. The values are returned exactly as stored: they are compared against
 * canonical columns verbatim, and re-casing or trimming them here would make the stored
 * grant mean something different from what was granted.
 */
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

// ---------------------------------------------------------------------------
// Refusing an out-of-scope request
// ---------------------------------------------------------------------------

/** What a request asked to see. Each value is the raw query filter, or null for "any". */
export interface RequestedScope {
  readonly country?: string | null;
  readonly lab?: string | null;
}

function allows(allowed: readonly string[] | null, requested: string | null | undefined): boolean {
  if (requested === null || requested === undefined) return true;
  if (allowed === null) return true;
  return allowed.includes(requested);
}

/**
 * Refuses a request for a value outside the caller's scope.
 *
 * The message names the dimension but never the values the caller may see: telling an
 * unauthorized caller which countries exist for them is itself a disclosure, and they
 * have their own scope on screen already.
 */
export function assertWithinScope(scope: EffectiveScope, requested: RequestedScope): void {
  if (!allows(scope.countries, requested.country)) {
    throw forbidden("You are not authorized to view data for the requested country.");
  }
  if (!allows(scope.labs, requested.lab)) {
    throw forbidden("You are not authorized to view data for the requested lab.");
  }
}

// ---------------------------------------------------------------------------
// Narrowing the query
// ---------------------------------------------------------------------------

export interface ScopeColumns {
  /** SQL expression holding the country, already qualified, e.g. `"m"."country"`. */
  readonly country: string | null;
  /** SQL expression holding the normalized lab, e.g. `"m"."labNormalized"`. */
  readonly lab: string | null;
}

/**
 * The predicates that narrow a query to the caller's scope, one per restricted
 * dimension, each self-contained so a caller can join them however its query is built.
 *
 * Returns `Prisma.empty` for an unrestricted scope, so an unscoped deployment produces
 * exactly the SQL it produced before. The values are bound parameters, never interpolated
 * text; only the column expressions — which this codebase chooses — are raw.
 *
 * A NULL country or lab is outside a restricted scope: a record that does not say where it
 * is cannot be shown to someone authorized for particular places. `IN` already yields NULL
 * (not TRUE) for a NULL left-hand side, which excludes it, but the intent is stated here
 * rather than left to be rediscovered.
 */
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

/** The same predicates as one `AND`-prefixed fragment, for a query built that way. */
export function scopeSql(scope: EffectiveScope, columns: ScopeColumns): Prisma.Sql {
  const parts = scopePredicates(scope, columns).map((p) => Prisma.sql`AND ${p}`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

export interface ScopeFields {
  readonly country: string | null;
  readonly lab: string | null;
}

/**
 * The same narrowing for Prisma query-builder callers, as fields to merge into a `where`.
 *
 * Returns `{}` for an unrestricted scope. The caller merges it at the top level of its
 * `where`, so the restriction is ANDed with everything else it already filters on.
 */
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

// ---------------------------------------------------------------------------
// Describing a scope
// ---------------------------------------------------------------------------

export interface ScopeDisclosure {
  readonly unrestricted: boolean;
  readonly countries: string[] | null;
  readonly labs: string[] | null;
  /** One sentence for the caller. Says what they can see, never what they cannot. */
  readonly summary: string;
}

/**
 * The caller's own scope, for their own session.
 *
 * Safe to return to the user it belongs to: it is what they are allowed to see, which
 * they can already observe from the data. It is never returned for another user except
 * through the access-administration surface, which has its own permission.
 */
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

// ---------------------------------------------------------------------------
// Disclosing what the scope could and could not be applied to
// ---------------------------------------------------------------------------

/**
 * Which dimensions of a caller's scope a particular dataset can actually enforce.
 *
 * Not every dataset carries every dimension. `DemandMetric` — the persisted demand
 * result — has a lab but no country: the target is calculated once per planning category
 * for the whole business. A country restriction therefore cannot narrow a demand figure,
 * because there is no country to narrow it by.
 *
 * Rather than leave that silent, a route over such a dataset says so. A page that claims
 * to be limited to one country while showing a business-wide number is exactly the kind
 * of quiet false statement this codebase refuses to make.
 */
export interface ScopeApplication {
  /** Dimensions the caller is restricted on AND the dataset can enforce. */
  readonly applied: ScopeDimension[];
  /** Dimensions the caller is restricted on but the dataset cannot express. */
  readonly notEnforceable: ScopeDimension[];
  /** Shown to the caller when something could not be enforced. Null when all of it was. */
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
