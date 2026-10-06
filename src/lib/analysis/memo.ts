import { Prisma } from "@prisma/client";
import { badRequest } from "@/lib/api/errors";
import { scopePredicates, scopeWhere, type EffectiveScope } from "@/lib/auth/access-scope";

/**
 * MEMO FILTERS — the one place a memo query's filter is built.
 *
 * Memo Analysis, the dashboard's memo exposure and the per-customer memo exposure all
 * read `MemoRecord`, through the Prisma query builder and through raw SQL. Each used to
 * build its own filter, and one of them assigned the requested country over the scope
 * restriction instead of adding to it. Here the caller's scope is always one term of an
 * `AND` and each requested filter is another, so a filter can only narrow what the scope
 * allows; no path can replace the restriction.
 *
 * The scope comes from the authenticated session (`api.scope`), never from the request.
 */

export const MEMO_STATUSES = ["OPEN", "RETURNED", "INVOICED"] as const;
export type MemoStatus = (typeof MEMO_STATUSES)[number];

export interface MemoFilters {
  readonly scope: EffectiveScope;
  readonly country: string | null;
  readonly branch: string | null;
  readonly lab: string | null;
  readonly status: MemoStatus | null;
}

const FILTER_MAX = 60;
// Printable text without leading or trailing space: the stored codes look like "IN", "SRT", "GIA".
const FILTER_VALUE = /^[^\s\p{C}](?:[^\p{C}]*[^\s\p{C}])?$/u;

function filterValue(url: URL, name: string): string | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  if (raw.length === 0 || raw.length > FILTER_MAX || !FILTER_VALUE.test(raw)) {
    throw badRequest(`Query parameter '${name}' is not a valid value.`);
  }
  return raw;
}

/**
 * The location filters of a memo request. Country and lab have already been checked
 * against the scope by the wrapper of a `scoped` route; this checks only their form.
 */
export function readMemoFilters(url: URL, scope: EffectiveScope): MemoFilters {
  const status = filterValue(url, "status");
  if (status !== null && !(MEMO_STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`Query parameter 'status' must be one of: ${MEMO_STATUSES.join(", ")}.`);
  }
  return {
    scope,
    country: filterValue(url, "country"),
    branch: filterValue(url, "branch"),
    lab: filterValue(url, "lab"),
    status: status as MemoStatus | null,
  };
}

/** The filter for the Prisma query builder. */
export function memoWhere(f: MemoFilters): Prisma.MemoRecordWhereInput {
  const requested: Prisma.MemoRecordWhereInput[] = [];
  if (f.country) requested.push({ country: f.country });
  if (f.branch) requested.push({ branch: f.branch });
  if (f.lab) requested.push({ labNormalized: f.lab });
  if (f.status) requested.push({ status: f.status });
  return { AND: [scopeWhere(f.scope, { country: "country", lab: "labNormalized" }), ...requested] };
}

/**
 * The same filter as SQL predicates, to be joined with AND. `alias` qualifies the columns
 * when the memo table is aliased in a larger query.
 */
export function memoPredicates(f: MemoFilters, alias?: string): Prisma.Sql[] {
  const col = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  const parts = scopePredicates(f.scope, { country: alias ? `${alias}."country"` : '"country"', lab: alias ? `${alias}."labNormalized"` : '"labNormalized"' });
  if (f.country) parts.push(Prisma.sql`${col("country")} = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`${col("branch")} = ${f.branch}`);
  if (f.lab) parts.push(Prisma.sql`${col("labNormalized")} = ${f.lab}`);
  if (f.status) parts.push(Prisma.sql`${col("status")} = ${f.status}`);
  return parts;
}
