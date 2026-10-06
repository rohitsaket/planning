import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { formatIST } from "@/lib/fantasy/time";
import { resolveSalesSnapshot, type SalesSnapshot } from "@/lib/analytics/sales-history";
import { scopeSql, UNRESTRICTED_SCOPE, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveSourceDisclosure, UNESTABLISHED_SOURCE, type SourceDisclosure } from "@/lib/analysis/source-disclosure";

if (typeof window !== "undefined") {
  throw new Error("analysis/geography is server-only and must not be imported by client code.");
}

type DbClient = typeof db;

const BUSINESS_TIMEZONE = "Asia/Kolkata";

export const GEOGRAPHY_ROW_MAX = 200;

export const GEOGRAPHIC_DEMAND_UNAVAILABLE_MESSAGE =
  "Demand is not currently calculated by country or branch, so geographic shortage, excess and transfer " +
  "recommendations are unavailable.";

export const GEOGRAPHIC_DEMAND_UNAVAILABLE_DETAIL =
  "The demand target is calculated once per planning category for the whole business, so there is no " +
  "country-level or branch-level target to compare stock against. Confirmed sales and current inventory are " +
  "shown below because both are recorded per location; they are separate figures and neither is a shortage.";

export interface GeographyFilters {
  readonly country: string | null;
  readonly branch: string | null;
  readonly lab: string | null;
  readonly scope: EffectiveScope;
}

export const EMPTY_GEOGRAPHY_FILTERS: GeographyFilters = {
  country: null, branch: null, lab: null, scope: UNRESTRICTED_SCOPE,
};

export interface GeographySalesRow {
  readonly key: string;
  readonly country: string;
  readonly branch: string | null;
  readonly confirmedQuantity: number;
  readonly measuredWeight: number;
  readonly saleRecordCount: number;
  readonly distinctCustomers: number | null;
  readonly latestSaleDateIst: string | null;
}

export interface GeographySalesResult {
  readonly sourceDisclosure: SourceDisclosure;
  readonly available: boolean;
  readonly unavailableMessage: string | null;
  readonly snapshot: {
    readonly runId: string;
    readonly windowDays: number;
    readonly businessDateIst: string;
    readonly periodLabel: string;
    readonly isSimulated: boolean;
  } | null;
  readonly byCountry: GeographySalesRow[];
  readonly byBranch: GeographySalesRow[];
  readonly totals: {
    readonly confirmedQuantity: number;
    readonly measuredWeight: number;
    readonly saleRecordCount: number;
    readonly countries: number;
  };
  readonly rows: {
    readonly countriesShown: number;
    readonly branchesShown: number;
    readonly limit: number;
    readonly truncated: boolean;
  };
}

function salesFilterSql(f: GeographyFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.country) parts.push(Prisma.sql`AND "m"."country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`AND "m"."branch" = ${f.branch}`);
  if (f.lab) parts.push(Prisma.sql`AND "t"."lab" = ${f.lab}`);
  const scope = scopeSql(f.scope, { country: '"m"."country"', lab: '"t"."lab"' });
  if (scope !== Prisma.empty) parts.push(scope);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

function salesCte(run: SalesSnapshot, f: GeographyFilters): Prisma.Sql {
  return Prisma.sql`
    WITH sale AS (
      SELECT
        COALESCE(NULLIF("m"."country", ''), '(unattributed)') AS country,
        COALESCE(NULLIF("m"."branch", ''), '(unattributed)')  AS branch,
        COALESCE("t"."quantity", 0)::float8 AS qty,
        COALESCE("t"."weight", 0)::float8   AS wt,
        "m"."customerCode"                  AS customer_code,
        "t"."docDate"                       AS doc_date,
        ((("t"."docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE})::date) AS ist_date
      FROM "DemandMetricTraceItem" "t"
      LEFT JOIN "LotMasterRecord" "m" ON "m"."lotId" = "t"."lotId"
      WHERE "t"."runId" = ${run.id}
        AND "t"."traceType" = 'SALE'
        AND "t"."isIncluded" = TRUE
        AND "t"."docDate" IS NOT NULL
        ${salesFilterSql(f)}
    ),
    windowed AS (
      SELECT * FROM sale
      WHERE ist_date <= ${run.businessDateIst}::date
        AND ist_date >= (${run.businessDateIst}::date - ${run.windowDays - 1}::int)
    )
  `;
}

interface RawSalesGroup {
  country: string;
  branch: string | null;
  qty: number | null;
  wt: number | null;
  records: bigint;
  customers: bigint;
  latest: Date | null;
}

function toSalesRow(g: RawSalesGroup, canSeeCustomers: boolean): GeographySalesRow {
  return {
    key: g.branch === null ? g.country : `${g.country}\u0001${g.branch}`,
    country: g.country,
    branch: g.branch,
    confirmedQuantity: num(g.qty ?? 0),
    measuredWeight: Math.round(num(g.wt ?? 0) * 1e6) / 1e6,
    saleRecordCount: Number(g.records),
    distinctCustomers: canSeeCustomers ? Number(g.customers) : null,
    latestSaleDateIst: g.latest ? formatIST(g.latest, false) : null,
  };
}

export async function readSalesByGeography(
  filters: GeographyFilters,
  canSeeCustomers: boolean,
  client: DbClient = db,
): Promise<GeographySalesResult> {
  const run = await resolveSalesSnapshot();

  if (!run) {
    return {
      sourceDisclosure: UNESTABLISHED_SOURCE,
      available: false,
      unavailableMessage:
        "No completed demand run has persisted a sale trace, so confirmed sales by location are unavailable.",
      snapshot: null,
      byCountry: [],
      byBranch: [],
      totals: { confirmedQuantity: 0, measuredWeight: 0, saleRecordCount: 0, countries: 0 },
      rows: { countriesShown: 0, branchesShown: 0, limit: GEOGRAPHY_ROW_MAX, truncated: false },
    };
  }

  const cte = salesCte(run, filters);

  const [byCountryRaw, byBranchRaw, totalsRaw] = await Promise.all([
    client.$queryRaw<RawSalesGroup[]>`
      ${cte}
      SELECT
        "country"                            AS country,
        NULL::text                           AS branch,
        SUM("qty")::float8                   AS qty,
        SUM("wt")::float8                    AS wt,
        COUNT(*)                             AS records,
        COUNT(DISTINCT "customer_code")      AS customers,
        MAX("doc_date")                      AS latest
      FROM windowed
      GROUP BY "country"
      ORDER BY SUM("qty") DESC NULLS LAST, "country" ASC
      LIMIT ${GEOGRAPHY_ROW_MAX + 1}`,
    client.$queryRaw<RawSalesGroup[]>`
      ${cte}
      SELECT
        "country"                            AS country,
        "branch"                             AS branch,
        SUM("qty")::float8                   AS qty,
        SUM("wt")::float8                    AS wt,
        COUNT(*)                             AS records,
        COUNT(DISTINCT "customer_code")      AS customers,
        MAX("doc_date")                      AS latest
      FROM windowed
      GROUP BY "country", "branch"
      ORDER BY SUM("qty") DESC NULLS LAST, "country" ASC, "branch" ASC
      LIMIT ${GEOGRAPHY_ROW_MAX + 1}`,
    client.$queryRaw<Array<{ qty: number | null; wt: number | null; records: bigint; countries: bigint }>>`
      ${cte}
      SELECT
        SUM("qty")::float8            AS qty,
        SUM("wt")::float8             AS wt,
        COUNT(*)                      AS records,
        COUNT(DISTINCT "country")     AS countries
      FROM windowed`,
  ]);

  const countries = byCountryRaw.slice(0, GEOGRAPHY_ROW_MAX);
  const branches = byBranchRaw.slice(0, GEOGRAPHY_ROW_MAX);
  const t = totalsRaw[0];

  return {
    sourceDisclosure: resolveSourceDisclosure({ isSimulated: run.isSimulated, hasData: true }),
    available: true,
    unavailableMessage: null,
    snapshot: {
      runId: run.id,
      windowDays: run.windowDays,
      businessDateIst: run.businessDateIst,
      periodLabel: `Past ${run.windowDays} days to ${run.businessDateIst} IST`,
      isSimulated: run.isSimulated,
    },
    byCountry: countries.map((g) => toSalesRow(g, canSeeCustomers)),
    byBranch: branches.map((g) => toSalesRow(g, canSeeCustomers)),
    totals: {
      confirmedQuantity: num(t?.qty ?? 0),
      measuredWeight: Math.round(num(t?.wt ?? 0) * 1e6) / 1e6,
      saleRecordCount: Number(t?.records ?? 0),
      countries: Number(t?.countries ?? 0),
    },
    rows: {
      countriesShown: countries.length,
      branchesShown: branches.length,
      limit: GEOGRAPHY_ROW_MAX,
      truncated: byCountryRaw.length > countries.length || byBranchRaw.length > branches.length,
    },
  };
}
