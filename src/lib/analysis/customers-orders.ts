import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { formatIST } from "@/lib/fantasy/time";
import { toSalesTrendDirection, type SalesTrendDirection } from "@/lib/demand/demand-result-presentation";
import { resolveSalesSnapshot, salesWindows, type SalesSnapshot } from "@/lib/analytics/sales-history";
import { scopeSql, UNRESTRICTED_SCOPE, type EffectiveScope } from "@/lib/auth/access-scope";
import { resolveSourceDisclosure, UNESTABLISHED_SOURCE, type SourceDisclosure } from "@/lib/analysis/source-disclosure";

if (typeof window !== "undefined") {
  throw new Error("analysis/customers-orders is server-only and must not be imported by client code.");
}

const BUSINESS_TIMEZONE = "Asia/Kolkata";
const WINDOW_SIZE_DAYS = 30;

export const CUSTOMERS_PAGE_MAX = 200;
export const CUSTOMERS_PAGE_DEFAULT = 25;
const GROUP_CEILING = 5_000;

export const CUSTOMER_IDENTITY_SOURCES = ["CANONICAL_CUSTOMER_ID", "CUSTOMER_CODE", "MISSING"] as const;
export type CustomerIdentitySource = (typeof CUSTOMER_IDENTITY_SOURCES)[number];

export const UNIDENTIFIED_CUSTOMER_KEY = "__UNIDENTIFIED__";

export const CUSTOMER_DATA_STATES = ["CONFIRMED", "IDENTITY_MISSING", "INSUFFICIENT_HISTORY"] as const;
export type CustomerDataState = (typeof CUSTOMER_DATA_STATES)[number];

export interface CustomerFilters {
  readonly country: string | null;
  readonly branch: string | null;
  readonly lab: string | null;
  readonly customerSearch: string | null;
  readonly categoryId: string | null;
  readonly shape: string | null;
  readonly weightBand: string | null;
  readonly dataState: CustomerDataState | null;
  readonly scope: EffectiveScope;
}

export const EMPTY_CUSTOMER_FILTERS: CustomerFilters = {
  country: null, branch: null, lab: null, customerSearch: null,
  categoryId: null, shape: null, weightBand: null, dataState: null,
  scope: UNRESTRICTED_SCOPE,
};

export interface Paging {
  readonly page: number;
  readonly pageSize: number;
}

export interface PagingMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly hasMore: boolean;
}

function pageMeta(p: Paging, total: number): PagingMeta {
  const pageSize = Math.min(Math.max(1, p.pageSize), CUSTOMERS_PAGE_MAX);
  return { page: p.page, pageSize, total, hasMore: p.page * pageSize < total };
}

function filterSql(f: CustomerFilters, includeCustomerName: boolean): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (f.country) parts.push(Prisma.sql`AND "m"."country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`AND "m"."branch" = ${f.branch}`);
  if (f.lab) parts.push(Prisma.sql`AND "t"."lab" = ${f.lab}`);
  if (f.shape) parts.push(Prisma.sql`AND "t"."shape" = ${f.shape}`);
  if (f.weightBand) parts.push(Prisma.sql`AND "t"."weightBand" = ${f.weightBand}`);
  if (f.categoryId) parts.push(Prisma.sql`AND "t"."planningCategory" = ${f.categoryId}`);
  if (f.customerSearch) {
    const like = `%${f.customerSearch.replace(/[\\%_]/g, "\\$&")}%`;
    parts.push(
      includeCustomerName
        ? Prisma.sql`AND (COALESCE("m"."customerCode", '') ILIKE ${like} OR COALESCE("m"."customerName", "t"."customerName", '') ILIKE ${like})`
        : Prisma.sql`AND COALESCE("m"."customerCode", '') ILIKE ${like}`,
    );
  }
  const scope = scopeSql(f.scope, { country: '"m"."country"', lab: '"t"."lab"' });
  if (scope !== Prisma.empty) parts.push(scope);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

function saleCte(run: SalesSnapshot, f: CustomerFilters, includeCustomerName: boolean): Prisma.Sql {
  return Prisma.sql`
    WITH sale AS (
      SELECT
        "t"."id"                          AS record_id,
        "t"."lotId"                       AS lot_id,
        "t"."planningCategory"            AS category_id,
        COALESCE("t"."lab", '')           AS lab,
        COALESCE("t"."shape", '')         AS shape,
        COALESCE("t"."weightBand", '')    AS weight_band,
        COALESCE("t"."quantity", 0)::float8 AS qty,
        COALESCE("t"."weight", 0)::float8   AS wt,
        "t"."docDate"                     AS doc_date,
        ((("t"."docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TIMEZONE})::date) AS ist_date,
        -- Identity by confirmed code only. A null code is one explicit bucket; it is
        -- never merged with another record because the names happen to match.
        COALESCE("m"."customerCode", ${UNIDENTIFIED_CUSTOMER_KEY}) AS customer_key,
        "m"."customerCode"                AS customer_code,
        COALESCE("m"."customerName", "t"."customerName") AS customer_name,
        "m"."country"                     AS country,
        "m"."branch"                      AS branch
      FROM "DemandMetricTraceItem" "t"
      LEFT JOIN "LotMasterRecord" "m" ON "m"."lotId" = "t"."lotId"
      WHERE "t"."runId" = ${run.id}
        AND "t"."traceType" = 'SALE'
        AND "t"."isIncluded" = TRUE
        AND "t"."docDate" IS NOT NULL
        ${filterSql(f, includeCustomerName)}
    ),
    windowed AS (
      SELECT *, (((${run.businessDateIst}::date - ist_date) / ${WINDOW_SIZE_DAYS}::int))::int AS widx
      FROM sale
      WHERE ist_date <= ${run.businessDateIst}::date
        AND ist_date >= (${run.businessDateIst}::date - ${run.windowDays - 1}::int)
    )
  `;
}

export const ORDER_SOURCE_STATES = ["NOT_CONFIGURED", "AVAILABLE", "FIXTURE_DEMO"] as const;
export type OrderSourceState = (typeof ORDER_SOURCE_STATES)[number];

export interface OrderSourceStatus {
  readonly state: OrderSourceState;
  readonly reasonCode: string;
  readonly message: string;
  readonly seededOrderCount: number;
  readonly seededOrderLineCount: number;
  readonly fieldsAvailable: readonly string[];
  readonly fieldsUnavailable: readonly string[];
}

export async function resolveOrderSourceState(client = db): Promise<OrderSourceStatus> {
  const [seededOrderCount, seededOrderLineCount] = await Promise.all([
    client.salesOrder.count(),
    client.salesOrderLine.count(),
  ]);

  return {
    state: "NOT_CONFIGURED",
    reasonCode: "FANTASY_ORDER_ENTITY_NOT_SUPPLIED",
    message:
      "ORDER SOURCE NOT CONFIGURED — Fantasy does not currently supply an order entity or lifecycle. " +
      "Order status, requested quantity, required date, fulfilment and backorder state cannot be derived " +
      "from the columns it does supply without a confirmed business rule.",
    seededOrderCount,
    seededOrderLineCount,
    fieldsAvailable: [],
    fieldsUnavailable: [
      "ORDER_IDENTITY",
      "REQUESTED_QUANTITY",
      "FULFILLED_QUANTITY",
      "REMAINING_QUANTITY",
      "REQUIRED_DATE",
      "FULFILMENT_STATUS",
      "BACKORDER_STATE",
      "CANCELLATION",
      "CUSTOMER_OWNERSHIP",
    ],
  };
}

export interface PublicOrderAvailability {
  readonly available: boolean;
  readonly state: OrderSourceState;
  readonly message: string;
  readonly nextStep: string | null;
}

export function toPublicOrderAvailability(source: OrderSourceStatus): PublicOrderAvailability {
  if (source.state === "AVAILABLE") {
    return {
      available: true,
      state: "AVAILABLE",
      message: "An approved order source is configured.",
      nextStep: null,
    };
  }
  return {
    available: false,
    state: "NOT_CONFIGURED",
    message:
      "No authoritative order source is currently configured. Fantasy does not provide a confirmed " +
      "order identity or order lifecycle, so open orders, fulfilment and backorders cannot yet be reported.",
    nextStep: "Configure an approved order source before using this section.",
  };
}

export const CUSTOMER_SOURCE_STATES = ["SIMULATION", "LIVE"] as const;
export type CustomerSourceState = (typeof CUSTOMER_SOURCE_STATES)[number];

export const CUSTOMER_SNAPSHOT_STATES = ["AVAILABLE", "INCOMPLETE", "UNAVAILABLE"] as const;
export type CustomerSnapshotState = (typeof CUSTOMER_SNAPSHOT_STATES)[number];

export const CUSTOMER_IDENTITY_COMPLETENESS = ["COMPLETE", "PARTIAL", "UNKNOWN"] as const;
export type CustomerIdentityCompleteness = (typeof CUSTOMER_IDENTITY_COMPLETENESS)[number];

export interface CustomerSnapshotSummary {
  readonly hasSnapshot: boolean;
  readonly sourceState: CustomerSourceState;
  readonly sourceDisclosure: SourceDisclosure;
  readonly sourceLabel: string;
  readonly snapshotState: CustomerSnapshotState;
  readonly periodLabel: string;
  readonly windowDays: number | null;
  readonly snapshotGeneratedIst: string | null;
  readonly businessDateIst: string | null;
  readonly identityCompleteness: CustomerIdentityCompleteness;
  readonly recordsWithIdentity: number | null;
  readonly recordsMissingIdentity: number | null;
  readonly blockingIssueCount: number;
  readonly identityWarning: string | null;
  readonly snapshotWarning: string | null;
}

export async function readCustomerSnapshotSummary(client = db): Promise<CustomerSnapshotSummary> {
  const [run, blockingIssueCount] = await Promise.all([
    resolveSalesSnapshot(),
    client.dataQualityIssue.count({ where: { severity: "BLOCKING", status: { in: ["OPEN", "IN_REVIEW"] } } }),
  ]);

  if (!run) {
    return {
      hasSnapshot: false,
      sourceState: "SIMULATION",
      sourceLabel: "No sales snapshot",
      sourceDisclosure: UNESTABLISHED_SOURCE,
      snapshotState: "UNAVAILABLE",
      periodLabel: "Past 90 days",
      windowDays: null,
      snapshotGeneratedIst: null,
      businessDateIst: null,
      identityCompleteness: "UNKNOWN",
      recordsWithIdentity: null,
      recordsMissingIdentity: null,
      blockingIssueCount,
      identityWarning: null,
      snapshotWarning:
        "Customer activity is unavailable because no completed 90-day sales snapshot exists.",
    };
  }

  const identity = await client.$queryRaw<Array<{ with_identity: number; missing_identity: number; total: number }>>`
    SELECT
      (COUNT(*) FILTER (WHERE "m"."customerCode" IS NOT NULL))::int AS with_identity,
      (COUNT(*) FILTER (WHERE "m"."customerCode" IS NULL))::int     AS missing_identity,
      COUNT(*)::int                                                  AS total
    FROM "DemandMetricTraceItem" "t"
    LEFT JOIN "LotMasterRecord" "m" ON "m"."lotId" = "t"."lotId"
    WHERE "t"."runId" = ${run.id} AND "t"."traceType" = 'SALE' AND "t"."isIncluded" = TRUE`;

  const withIdentity = identity[0]?.with_identity ?? 0;
  const missingIdentity = identity[0]?.missing_identity ?? 0;
  const total = identity[0]?.total ?? 0;

  const simulated = run.isSimulated;
  const reviewRequired = run.status === "REVIEW_REQUIRED";

  return {
    hasSnapshot: true,
    sourceState: simulated ? "SIMULATION" : "LIVE",
    sourceLabel: simulated ? "Fixture Simulation" : "Live Fantasy",
    sourceDisclosure: resolveSourceDisclosure({ isSimulated: simulated, hasData: true }),
    snapshotState: reviewRequired ? "INCOMPLETE" : "AVAILABLE",
    periodLabel: run.windowDays === 90 ? "Past 90 days" : `Past ${run.windowDays} days`,
    windowDays: run.windowDays,
    snapshotGeneratedIst: formatIST(run.finishedAt ?? run.runDate, false),
    businessDateIst: run.businessDateIst,
    identityCompleteness: total === 0 ? "UNKNOWN" : missingIdentity > 0 ? "PARTIAL" : "COMPLETE",
    recordsWithIdentity: withIdentity,
    recordsMissingIdentity: missingIdentity,
    blockingIssueCount,
    identityWarning:
      missingIdentity > 0
        ? "Some confirmed sales could not be assigned to a customer and are excluded from customer totals."
        : null,
    snapshotWarning: reviewRequired
      ? "This snapshot completed with items that need review, so customer totals may be incomplete."
      : null,
  };
}

export interface CustomerSummaryRow {
  readonly customerKey: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
  readonly identitySource: CustomerIdentitySource;
  readonly country: string | null;
  readonly branch: string | null;
  readonly confirmedQuantity: number;
  readonly measuredWeight: number;
  readonly saleRecordCount: number;
  readonly distinctCategories: number;
  readonly latestSaleDate: string | null;
  readonly previous30Quantity: number;
  readonly middle30Quantity: number;
  readonly latest30Quantity: number;
  readonly trend: SalesTrendDirection;
  readonly dataState: CustomerDataState;
}

export interface CustomerSummaryResult {
  readonly rows: readonly CustomerSummaryRow[];
  readonly paging: PagingMeta;
  readonly totals: {
    readonly confirmedQuantity: number;
    readonly measuredWeight: number;
    readonly saleRecordCount: number;
    readonly customers: number;
  };
  readonly windows: ReturnType<typeof salesWindows>;
  readonly snapshotId: string;
  readonly businessDateIst: string;
}

export type CustomerSortKey = "confirmedQuantity" | "measuredWeight" | "saleRecordCount" | "latestSaleDate" | "customerCode";

interface CustomerAggRow {
  customer_key: string;
  customer_code: string | null;
  customer_name: string | null;
  country: string | null;
  branch: string | null;
  qty: number | null;
  wt: number | null;
  records: number;
  categories: number;
  latest_date: string | null;
  prev30: number | null;
  mid30: number | null;
  latest30: number | null;
}

export async function readCustomerSummary(
  filters: CustomerFilters,
  paging: Paging,
  sort: { key: CustomerSortKey; dir: "asc" | "desc" },
  canSeeCustomerNames: boolean,
  client = db,
): Promise<CustomerSummaryResult | null> {
  const run = await resolveSalesSnapshot();
  if (!run) return null;

  const rows = await client.$queryRaw<CustomerAggRow[]>`
    ${saleCte(run, filters, canSeeCustomerNames)}
    SELECT
      customer_key,
      MIN(customer_code)  AS customer_code,
      MIN(customer_name)  AS customer_name,
      MIN(country)        AS country,
      MIN(branch)         AS branch,
      SUM(qty)::float8    AS qty,
      SUM(wt)::float8     AS wt,
      COUNT(*)::int       AS records,
      COUNT(DISTINCT category_id)::int AS categories,
      to_char(MAX(ist_date), 'YYYY-MM-DD') AS latest_date,
      (SUM(qty) FILTER (WHERE widx = 2))::float8 AS prev30,
      (SUM(qty) FILTER (WHERE widx = 1))::float8 AS mid30,
      (SUM(qty) FILTER (WHERE widx = 0))::float8 AS latest30
    FROM windowed
    GROUP BY customer_key
    LIMIT ${GROUP_CEILING + 1}`;

  if (rows.length > GROUP_CEILING) {
    throw new Error("CUSTOMER_GROUP_LIMIT_EXCEEDED");
  }

  const mapped: CustomerSummaryRow[] = rows.map((r) => {
    const unidentified = r.customer_key === UNIDENTIFIED_CUSTOMER_KEY;
    const prev = num(r.prev30);
    const latest = num(r.latest30);
    return {
      customerKey: r.customer_key,
      customerCode: r.customer_code,
      customerName: canSeeCustomerNames ? r.customer_name : null,
      identitySource: unidentified ? "MISSING" : "CUSTOMER_CODE",
      country: r.country,
      branch: r.branch,
      confirmedQuantity: num(r.qty),
      measuredWeight: Math.round(num(r.wt) * 1e6) / 1e6,
      saleRecordCount: r.records,
      distinctCategories: r.categories,
      latestSaleDate: r.latest_date,
      previous30Quantity: num(r.prev30),
      middle30Quantity: num(r.mid30),
      latest30Quantity: latest,
      trend: toSalesTrendDirection(Math.round(prev), Math.round(latest)),
      dataState: unidentified ? "IDENTITY_MISSING" : prev > 0 ? "CONFIRMED" : "INSUFFICIENT_HISTORY",
    };
  });

  const filtered = filters.dataState ? mapped.filter((r) => r.dataState === filters.dataState) : mapped;

  const sign = sort.dir === "asc" ? 1 : -1;
  const pick = (r: CustomerSummaryRow): number | string =>
    sort.key === "confirmedQuantity" ? r.confirmedQuantity
    : sort.key === "measuredWeight" ? r.measuredWeight
    : sort.key === "saleRecordCount" ? r.saleRecordCount
    : sort.key === "latestSaleDate" ? (r.latestSaleDate ?? "")
    : (r.customerCode ?? r.customerKey);
  filtered.sort((a, b) => {
    const av = pick(a), bv = pick(b);
    const c = av === bv ? 0 : av < bv ? -1 : 1;
    return sign * c || a.customerKey.localeCompare(b.customerKey);
  });

  const totals = filtered.reduce(
    (acc, r) => ({
      confirmedQuantity: acc.confirmedQuantity + r.confirmedQuantity,
      measuredWeight: acc.measuredWeight + r.measuredWeight,
      saleRecordCount: acc.saleRecordCount + r.saleRecordCount,
      customers: acc.customers + 1,
    }),
    { confirmedQuantity: 0, measuredWeight: 0, saleRecordCount: 0, customers: 0 },
  );
  totals.measuredWeight = Math.round(totals.measuredWeight * 1e6) / 1e6;

  const pageSize = Math.min(Math.max(1, paging.pageSize), CUSTOMERS_PAGE_MAX);
  const start = (paging.page - 1) * pageSize;

  return {
    rows: filtered.slice(start, start + pageSize),
    paging: pageMeta(paging, filtered.length),
    totals,
    windows: salesWindows(run.businessDateIst),
    snapshotId: run.id,
    businessDateIst: run.businessDateIst,
  };
}

export interface CustomerCategoryContribution {
  readonly categoryId: string;
  readonly lab: string;
  readonly shape: string;
  readonly weightBand: string;
  readonly confirmedQuantity: number;
  readonly measuredWeight: number;
  readonly saleRecordCount: number;
}

export interface CustomerSaleRecord {
  readonly recordId: string;
  readonly lotId: string;
  readonly categoryId: string;
  readonly docDateIst: string | null;
  readonly confirmedQuantity: number;
  readonly measuredWeight: number;
  readonly country: string | null;
  readonly branch: string | null;
}

export interface CustomerDetailResult {
  readonly customerKey: string;
  readonly customerCode: string | null;
  readonly customerName: string | null;
  readonly identitySource: CustomerIdentitySource;
  readonly categories: readonly CustomerCategoryContribution[];
  readonly periods: ReadonlyArray<{ key: string; label: string; startDate: string; endDate: string; confirmedQuantity: number }>;
  readonly records: readonly CustomerSaleRecord[];
  readonly recordPaging: PagingMeta;
  readonly snapshotId: string;
  readonly businessDateIst: string;
  readonly isSimulated: boolean;
  readonly exclusionCodes: ReadonlyArray<{ code: string; count: number }>;
}

export async function readCustomerDetail(
  customerKey: string,
  filters: CustomerFilters,
  paging: Paging,
  canSeeCustomerNames: boolean,
  client = db,
): Promise<CustomerDetailResult | null> {
  const run = await resolveSalesSnapshot();
  if (!run) return null;

  const scoped: Prisma.Sql = Prisma.sql`AND customer_key = ${customerKey}`;
  const cte = saleCte(run, filters, canSeeCustomerNames);
  const pageSize = Math.min(Math.max(1, paging.pageSize), CUSTOMERS_PAGE_MAX);

  const [identityRows, categories, periods, records, totalRows] = await Promise.all([
    client.$queryRaw<Array<{ customer_code: string | null; customer_name: string | null }>>`
      ${cte} SELECT MIN(customer_code) AS customer_code, MIN(customer_name) AS customer_name
      FROM windowed WHERE TRUE ${scoped}`,
    client.$queryRaw<Array<{ category_id: string; lab: string; shape: string; weight_band: string; qty: number | null; wt: number | null; records: number }>>`
      ${cte}
      SELECT category_id, MIN(lab) AS lab, MIN(shape) AS shape, MIN(weight_band) AS weight_band,
             SUM(qty)::float8 AS qty, SUM(wt)::float8 AS wt, COUNT(*)::int AS records
      FROM windowed WHERE TRUE ${scoped}
      GROUP BY category_id ORDER BY SUM(qty) DESC, category_id ASC LIMIT 200`,
    client.$queryRaw<Array<{ widx: number; qty: number | null }>>`
      ${cte} SELECT widx, SUM(qty)::float8 AS qty FROM windowed WHERE TRUE ${scoped} GROUP BY widx`,
    client.$queryRaw<Array<{ record_id: string; lot_id: string; category_id: string; ist_date: string | null; qty: number | null; wt: number | null; country: string | null; branch: string | null }>>`
      ${cte}
      SELECT record_id, lot_id, category_id, to_char(ist_date, 'YYYY-MM-DD') AS ist_date,
             qty, wt, country, branch
      FROM windowed WHERE TRUE ${scoped}
      ORDER BY ist_date DESC, record_id ASC
      LIMIT ${pageSize} OFFSET ${(paging.page - 1) * pageSize}`,
    client.$queryRaw<Array<{ total: number }>>`
      ${cte} SELECT COUNT(*)::int AS total FROM windowed WHERE TRUE ${scoped}`,
  ]);

  const byWidx = new Map(periods.map((p) => [p.widx, num(p.qty)]));
  const windows = salesWindows(run.businessDateIst);
  const widxOf: Record<string, number> = { latest30: 0, middle30: 1, previous30: 2 };

  const exclusionRows = await client.$queryRaw<Array<{ reason: string; n: number }>>`
    SELECT COALESCE("t"."reason", 'UNSPECIFIED') AS reason, COUNT(*)::int AS n
    FROM "DemandMetricTraceItem" "t"
    LEFT JOIN "LotMasterRecord" "m" ON "m"."lotId" = "t"."lotId"
    WHERE "t"."runId" = ${run.id}
      AND "t"."traceType" = 'EXCLUSION'
      AND "t"."eventKey" IS NOT NULL
      AND COALESCE("m"."customerCode", ${UNIDENTIFIED_CUSTOMER_KEY}) = ${customerKey}
    GROUP BY 1`;

  return {
    customerKey,
    customerCode: identityRows[0]?.customer_code ?? null,
    customerName: canSeeCustomerNames ? (identityRows[0]?.customer_name ?? null) : null,
    identitySource: customerKey === UNIDENTIFIED_CUSTOMER_KEY ? "MISSING" : "CUSTOMER_CODE",
    categories: categories.map((c) => ({
      categoryId: c.category_id,
      lab: c.lab,
      shape: c.shape,
      weightBand: c.weight_band,
      confirmedQuantity: num(c.qty),
      measuredWeight: Math.round(num(c.wt) * 1e6) / 1e6,
      saleRecordCount: c.records,
    })),
    periods: windows.map((w) => ({
      key: w.key,
      label: w.label,
      startDate: w.startDate,
      endDate: w.endDate,
      confirmedQuantity: byWidx.get(widxOf[w.key]) ?? 0,
    })),
    records: records.map((r) => ({
      recordId: r.record_id,
      lotId: r.lot_id,
      categoryId: r.category_id,
      docDateIst: r.ist_date,
      confirmedQuantity: num(r.qty),
      measuredWeight: Math.round(num(r.wt) * 1e6) / 1e6,
      country: r.country,
      branch: r.branch,
    })),
    recordPaging: pageMeta(paging, totalRows[0]?.total ?? 0),
    snapshotId: run.id,
    businessDateIst: run.businessDateIst,
    isSimulated: run.isSimulated,
    exclusionCodes: exclusionRows.map((e) => ({ code: e.reason, count: e.n })),
  };
}
