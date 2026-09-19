import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { num } from "@/lib/api-utils";
import { ApiError } from "@/lib/api/errors";
import { SCAN_MAX, scanned, log } from "@/lib/api/with-api";
import { addDays, businessDate, businessMonth, businessWindow, daysBetween, type BusinessWindow } from "@/lib/analytics/reporting-date";
import { DEFAULT_SALES_DIMENSION, isSalesDimension, type SalesDimension, type SalesGroupRow } from "@/lib/analytics/sales-dimensions";

// Sales Analysis business rules (unchanged by remediation):
//   qualifying row = SalesRecord with lotStatusDb "Invoice" whose business date is in the window
//   Pieces   = count of qualifying rows (one row = one Lot ID = one stone; qty is NOT summed)
//   Carats   = Σ weight          Value = Σ saleTotalUsd
//   Avg $/ct = group value / group carats (weighted)
//   Value Mix % = group value / total value × 100

export function parseSalesDimension(raw: string | null): SalesDimension {
  if (raw === null || raw === "") return DEFAULT_SALES_DIMENSION;
  if (!isSalesDimension(raw)) throw new ApiError(400, "INVALID_DIMENSION", "Unsupported sales-analysis dimension.");
  return raw;
}

export interface SalesFilters {
  dimension: SalesDimension;
  windowDays: number;
  country?: string | null;
  branch?: string | null;
  lab?: string | null;
  now: Date;
  timezone: string;
}

export interface SalesFactRow {
  docDate: Date;
  weight: number;
  saleTotalUsd: number;
  qty: number;
  shape: string;
  labNormalized: string | null;
  weightBandId: string | null;
  color: string | null;
  clarity: string | null;
  treatment: string | null;
  customerId: string;
  country: string;
  branch: string;
}

export interface TrendPoint {
  periodStart: string;
  periodEnd: string;
  value: number;
}

export interface SalesAnalysisResult {
  dimension: SalesDimension;
  windowDays: number;
  window: { startDate: string; endDate: string; timezone: string };
  totalPieces: number;
  totalCarats: number;
  totalValue: number;
  rows: SalesGroupRow[];
  trendSeries: { bucketDays: number; pieces: TrendPoint[]; carats: TrendPoint[]; value: TrendPoint[]; excludedPartialPeriod: { startDate: string; endDate: string } | null };
  dataQuality: { qtyNotOneCount: number };
}

// Persisted column behind each dimension, and the key used when that column is NULL.
// Shared by the database aggregation and the in-memory reference, so both group identically.
// Lab and Weight Band are normalised at ingestion (labNormalized, weightBandId): no rule is re-derived here.
export const DIMENSION_COLUMN = {
  lab: "labNormalized",
  shape: "shape",
  weightBand: "weightBandId",
  color: "color",
  clarity: "clarity",
  treatment: "treatment",
  customer: "customerId",
  country: "country",
  branch: "branch",
} as const satisfies Record<Exclude<SalesDimension, "month">, keyof SalesFactRow>;

const NULL_KEY: Partial<Record<SalesDimension, string>> = { lab: "Non-Cert", weightBand: "", color: "Unknown", clarity: "Unknown", treatment: "NULL" };

export function keyFromColumn(dimension: SalesDimension, raw: string | null): string {
  return raw ?? NULL_KEY[dimension] ?? "";
}

/** Raw grouping key for a row — the single place dimension semantics are defined. */
export function dimensionKey(r: SalesFactRow, dimension: SalesDimension, tz: string): string {
  if (dimension === "month") return businessMonth(r.docDate, tz);
  return keyFromColumn(dimension, r[DIMENSION_COLUMN[dimension]] as string | null);
}

export function dimensionLabel(key: string, dimension: SalesDimension, labels: Map<string, string>): string {
  if (dimension === "customer") return labels.get(key) ?? "Unknown";
  if (dimension === "weightBand") return (key && labels.get(key)) || "Unmapped";
  return key;
}

/** Trend buckets: daily for windows ≤ 14 days, otherwise weekly, anchored at the run date so the
 *  newest bucket is complete. A leading partial bucket is reported but not plotted. */
export function trendLayout(window: BusinessWindow, windowDays: number) {
  const bucketDays = windowDays <= 14 ? 1 : 7;
  const full = Math.floor(windowDays / bucketDays);
  const remainder = windowDays - full * bucketDays;
  const buckets = Array.from({ length: full }, (_, i) => {
    const back = full - 1 - i; // 0 = newest
    const periodEnd = addDays(window.endDate, -back * bucketDays);
    return { periodStart: addDays(periodEnd, -(bucketDays - 1)), periodEnd };
  });
  const excludedPartialPeriod = remainder > 0 ? { startDate: window.startDate, endDate: addDays(window.startDate, remainder - 1) } : null;
  return { bucketDays, buckets, excludedPartialPeriod };
}

/** Index of the plotted bucket (oldest = 0) for a business date, or -1 for the partial period. */
export function bucketIndex(date: string, endDate: string, bucketDays: number, bucketCount: number): number {
  const back = Math.floor(daysBetween(date, endDate) / bucketDays);
  return back < bucketCount ? bucketCount - 1 - back : -1;
}

/** Pure aggregation over already-filtered qualifying rows. Reference implementation for tests. */
export function aggregateSales(rows: SalesFactRow[], f: Pick<SalesFilters, "dimension" | "windowDays" | "timezone">, window: BusinessWindow, labels: Map<string, string>): SalesAnalysisResult {
  const agg = new Map<string, { pieces: number; carats: number; value: number }>();
  const layout = trendLayout(window, f.windowDays);
  const series = layout.buckets.map(() => ({ pieces: 0, carats: 0, value: 0 }));
  let qtyNotOne = 0;
  let totalCarats = 0;
  let totalValue = 0;
  for (const r of rows) {
    const key = dimensionKey(r, f.dimension, f.timezone);
    const cur = agg.get(key) ?? { pieces: 0, carats: 0, value: 0 };
    cur.pieces += 1;
    cur.carats += r.weight;
    cur.value += r.saleTotalUsd;
    agg.set(key, cur);
    totalCarats += r.weight;
    totalValue += r.saleTotalUsd;
    if (r.qty !== 1) qtyNotOne++;
    const b = bucketIndex(businessDate(r.docDate, f.timezone), window.endDate, layout.bucketDays, layout.buckets.length);
    if (b >= 0) {
      series[b].pieces += 1;
      series[b].carats += r.weight;
      series[b].value += r.saleTotalUsd;
    }
  }
  return buildResult(f, window, layout, rows.length, totalCarats, totalValue, agg, series, labels, qtyNotOne);
}

export function buildResult(
  f: Pick<SalesFilters, "dimension" | "windowDays" | "timezone">,
  window: BusinessWindow,
  layout: ReturnType<typeof trendLayout>,
  totalPieces: number,
  totalCarats: number,
  totalValue: number,
  agg: Map<string, { pieces: number; carats: number; value: number }>,
  series: { pieces: number; carats: number; value: number }[],
  labels: Map<string, string>,
  qtyNotOneCount: number,
): SalesAnalysisResult {
  const rows = Array.from(agg.entries())
    .map(([k, v]) => ({
      dimension: dimensionLabel(k, f.dimension, labels),
      pieces: v.pieces,
      carats: num(v.carats),
      value: num(v.value),
      avgPerCt: v.carats > 0 ? num(v.value / v.carats) : 0,
      pct: totalValue > 0 ? num((v.value / totalValue) * 100) : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const point = (m: "pieces" | "carats" | "value") => layout.buckets.map((b, i) => ({ ...b, value: series[i][m] }));
  return {
    dimension: f.dimension,
    windowDays: f.windowDays,
    window: { startDate: window.startDate, endDate: window.endDate, timezone: window.timezone },
    totalPieces,
    totalCarats: num(totalCarats),
    totalValue: num(totalValue),
    rows,
    trendSeries: { bucketDays: layout.bucketDays, pieces: point("pieces"), carats: point("carats"), value: point("value"), excludedPartialPeriod: layout.excludedPartialPeriod },
    dataQuality: { qtyNotOneCount },
  };
}

export function salesWhere(f: SalesFilters, window: BusinessWindow) {
  const where: Record<string, unknown> = { lotStatusDb: "Invoice", docDate: { gte: window.start, lt: window.endExclusive } };
  if (f.country) where.country = f.country;
  if (f.branch) where.branch = f.branch;
  if (f.lab) where.labNormalized = f.lab;
  return where;
}

export async function loadLabels(dimension: SalesDimension): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (dimension === "customer") for (const c of await db.customer.findMany({ select: { id: true, name: true }, take: SCAN_MAX }).then(scanned)) labels.set(c.id, c.name);
  if (dimension === "weightBand") for (const b of await db.weightBand.findMany({ select: { id: true, label: true }, take: SCAN_MAX }).then(scanned)) labels.set(b.id, b.label);
  return labels;
}

export function logQtyAnomalies(result: SalesAnalysisResult, requestId?: string) {
  if (result.dataQuality.qtyNotOneCount > 0) {
    log("warn", "sales.qty_anomaly", { requestId, count: result.dataQuality.qtyNotOneCount, window: result.window, note: "qty != 1 on a stone-level Invoice row; Pieces still counts rows" });
  }
}

/** Qualifying rows as plain facts — used by tests and the benchmark to run the in-memory reference. */
export async function loadSalesFactRows(f: SalesFilters, window: BusinessWindow, take?: number): Promise<SalesFactRow[]> {
  const records = await db.salesRecord.findMany({
    take,
    where: salesWhere(f, window),
    select: { docDate: true, weight: true, saleTotalUsd: true, qty: true, shape: true, labNormalized: true, weightBandId: true, color: true, clarity: true, treatment: true, customerId: true, country: true, branch: true },
  });
  return records.map((r) => ({ ...r, weight: num(r.weight), saleTotalUsd: num(r.saleTotalUsd), qty: num(r.qty) }));
}

// ---------- database aggregation (SA-11) ----------
// The database returns one row per group and one row per trend bucket — never the stone rows —
// so memory no longer grows with sales volume and the 50k-row scan ceiling is not needed here.

/** Business date of docDate in the reporting timezone. docDate is stored as UTC `timestamp`. */
const businessDateSql = (tz: string) => Prisma.sql`(("docDate" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;

function whereSql(f: SalesFilters, window: BusinessWindow) {
  const parts = [
    Prisma.sql`"lotStatusDb" = 'Invoice'`,
    Prisma.sql`"docDate" >= (${window.start.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
    Prisma.sql`"docDate" < (${window.endExclusive.toISOString()}::timestamptz AT TIME ZONE 'UTC')`,
  ];
  if (f.country) parts.push(Prisma.sql`"country" = ${f.country}`);
  if (f.branch) parts.push(Prisma.sql`"branch" = ${f.branch}`);
  if (f.lab) parts.push(Prisma.sql`"labNormalized" = ${f.lab}`);
  return Prisma.join(parts, " AND ");
}

function groupKeySql(f: SalesFilters) {
  if (f.dimension === "month") return Prisma.sql`to_char(${businessDateSql(f.timezone)}, 'YYYY-MM')`;
  // Identifier comes from the fixed DIMENSION_COLUMN map, never from the request.
  return Prisma.raw(`"${DIMENSION_COLUMN[f.dimension]}"`);
}

interface AggRow { k: string | null; pieces: number; carats: number | null; value: number | null; qty_anomalies: number }
interface TrendRow { back: number; pieces: number; carats: number | null; value: number | null }

export async function getSalesAnalysis(f: SalesFilters, requestId?: string): Promise<SalesAnalysisResult> {
  const window = businessWindow(f.now, f.windowDays, f.timezone);
  const layout = trendLayout(window, f.windowDays);
  const where = whereSql(f, window);
  const [groups, trend, labels] = await Promise.all([
    db.$queryRaw<AggRow[]>`
      SELECT ${groupKeySql(f)} AS k,
             COUNT(*)::int AS pieces,
             SUM("weight")::float8 AS carats,
             SUM(COALESCE("saleTotalUsd", 0))::float8 AS value,
             (COUNT(*) FILTER (WHERE "qty" <> 1))::int AS qty_anomalies
      FROM "SalesRecord" WHERE ${where} GROUP BY 1`,
    db.$queryRaw<TrendRow[]>`
      SELECT ((${window.endDate}::date - ${businessDateSql(f.timezone)}) / ${layout.bucketDays}::int)::int AS back,
             COUNT(*)::int AS pieces,
             SUM("weight")::float8 AS carats,
             SUM(COALESCE("saleTotalUsd", 0))::float8 AS value
      FROM "SalesRecord" WHERE ${where} GROUP BY 1`,
    loadLabels(f.dimension),
  ]);

  const agg = new Map<string, { pieces: number; carats: number; value: number }>();
  let totalPieces = 0, totalCarats = 0, totalValue = 0, qtyNotOne = 0;
  for (const g of groups) {
    const key = f.dimension === "month" ? g.k ?? "" : keyFromColumn(f.dimension, g.k);
    const cur = agg.get(key) ?? { pieces: 0, carats: 0, value: 0 };
    cur.pieces += g.pieces;
    cur.carats += g.carats ?? 0;
    cur.value += g.value ?? 0;
    agg.set(key, cur);
    totalPieces += g.pieces;
    totalCarats += g.carats ?? 0;
    totalValue += g.value ?? 0;
    qtyNotOne += g.qty_anomalies;
  }
  const series = layout.buckets.map(() => ({ pieces: 0, carats: 0, value: 0 }));
  for (const t of trend) {
    if (t.back < 0 || t.back >= layout.buckets.length) continue; // leading partial period
    const s = series[layout.buckets.length - 1 - t.back];
    s.pieces += t.pieces;
    s.carats += t.carats ?? 0;
    s.value += t.value ?? 0;
  }
  const result = buildResult(f, window, layout, totalPieces, totalCarats, totalValue, agg, series, labels, qtyNotOne);
  logQtyAnomalies(result, requestId);
  return result;
}
