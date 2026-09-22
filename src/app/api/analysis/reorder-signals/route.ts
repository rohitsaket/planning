import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, qStr, qInt } from "@/lib/api/with-api";

// Customer Reorder Signal — ADVISORY prediction only.
//
// Repeat-purchase intervals are computed in PostgreSQL (one aggregate per customer,
// not one row per sale), the ranked list is paginated on the server, and category
// preferences are fetched only for the visible page.
//
// A prediction never becomes a confirmed order, requirement or reservation.

type Signal = "PREDICTED_SOON" | "PREDICTED_LATER" | "INSUFFICIENT_DATA" | "DORMANT";
const SIGNAL_RANK: Record<Signal, number> = {
  PREDICTED_SOON: 0,
  PREDICTED_LATER: 1,
  INSUFFICIENT_DATA: 2,
  DORMANT: 3,
};

interface CustomerStatsRow {
  id: string;
  customer_code: string;
  name: string;
  country: string;
  business_priority: string | null;
  total_orders: number;
  last_purchase: Date | null;
  gap_count: number;
  avg_gap: number | null;
  sd_gap: number | null;
}

export const GET = withApi({ permission: "analysis.read" }, async (req: Request) => {
  const url = new URL(req.url);
  const country = qStr(url, "country");
  const branch = qStr(url, "branch");
  const page = qInt(url, "page", { def: 1, min: 1, max: 1_000_000 });
  const pageSize = qInt(url, "pageSize", { def: 50, min: 1, max: 500 });

  const filters: Prisma.Sql[] = [];
  if (country) filters.push(Prisma.sql`c.country = ${country}`);
  if (branch) filters.push(Prisma.sql`c.branch = ${branch}`);
  const whereSql = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

  const stats = await db.$queryRaw<CustomerStatsRow[]>(Prisma.sql`
    WITH ordered AS (
      SELECT s."customerId",
             s."docDate",
             LAG(s."docDate") OVER (PARTITION BY s."customerId" ORDER BY s."docDate") AS prev_date
      FROM "SalesRecord" s
      WHERE s."lotStatusDb" = 'Invoice'
    ),
    gaps AS (
      SELECT "customerId",
             EXTRACT(EPOCH FROM ("docDate" - prev_date)) / 86400 AS gap_days
      FROM ordered
      WHERE prev_date IS NOT NULL
    ),
    gap_stats AS (
      SELECT "customerId",
             COUNT(*)::int AS gap_count,
             AVG(gap_days)::float8 AS avg_gap,
             COALESCE(STDDEV_POP(gap_days), 0)::float8 AS sd_gap
      FROM gaps
      WHERE gap_days > 0 AND gap_days < 365
      GROUP BY "customerId"
    ),
    totals AS (
      SELECT "customerId", COUNT(*)::int AS total_orders, MAX("docDate") AS last_purchase
      FROM "SalesRecord"
      WHERE "lotStatusDb" = 'Invoice'
      GROUP BY "customerId"
    )
    SELECT c.id,
           c."customerCode" AS customer_code,
           c.name,
           c.country,
           c."businessPriority" AS business_priority,
           COALESCE(t.total_orders, 0) AS total_orders,
           t.last_purchase,
           COALESCE(g.gap_count, 0) AS gap_count,
           g.avg_gap,
           g.sd_gap
    FROM "Customer" c
    LEFT JOIN totals t ON t."customerId" = c.id
    LEFT JOIN gap_stats g ON g."customerId" = c.id
    ${whereSql}
  `);

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const signals = stats.map((s) => {
    const lastPurchase = s.last_purchase ? new Date(s.last_purchase) : null;
    const daysSinceLastPurchase = lastPurchase ? Math.floor((now - lastPurchase.getTime()) / DAY) : null;

    if (s.total_orders === 0 || !lastPurchase) {
      return {
        customerId: s.id,
        customerCode: s.customer_code,
        customerName: s.name,
        country: s.country,
        businessPriority: s.business_priority,
        totalOrders: 0,
        lastPurchaseDate: null,
        avgIntervalDays: null,
        likelyReorderWindow: null,
        likelyReorderDate: null,
        daysSinceLastPurchase: null,
        confidence: 0,
        signal: "DORMANT" as Signal,
      };
    }

    // Two or more observed gaps are required before an interval is predictive.
    if (!s.avg_gap || s.gap_count < 2) {
      return {
        customerId: s.id,
        customerCode: s.customer_code,
        customerName: s.name,
        country: s.country,
        businessPriority: s.business_priority,
        totalOrders: s.total_orders,
        lastPurchaseDate: lastPurchase.toISOString(),
        avgIntervalDays: s.avg_gap ? Math.round(s.avg_gap) : null,
        likelyReorderWindow: null,
        likelyReorderDate: null,
        daysSinceLastPurchase,
        confidence: 0.2,
        signal: "INSUFFICIENT_DATA" as Signal,
      };
    }

    const predicted = new Date(lastPurchase.getTime() + s.avg_gap * DAY);
    const daysUntil = Math.floor((predicted.getTime() - now) / DAY);
    const signal: Signal = daysUntil <= 14 ? "PREDICTED_SOON" : "PREDICTED_LATER";
    const cv = s.avg_gap > 0 ? (s.sd_gap ?? 0) / s.avg_gap : 1;

    return {
      customerId: s.id,
      customerCode: s.customer_code,
      customerName: s.name,
      country: s.country,
      businessPriority: s.business_priority,
      totalOrders: s.total_orders,
      lastPurchaseDate: lastPurchase.toISOString(),
      avgIntervalDays: Math.round(s.avg_gap),
      likelyReorderWindow:
        daysUntil < 0 ? `Overdue by ${Math.abs(daysUntil)}d` : `Within ${daysUntil}d`,
      likelyReorderDate: predicted.toISOString(),
      daysSinceLastPurchase,
      confidence: num(Math.max(0.3, Math.min(0.95, 1 - cv))),
      signal,
    };
  });

  signals.sort(
    (a, b) =>
      SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal] ||
      (b.totalOrders ?? 0) - (a.totalOrders ?? 0) ||
      a.customerName.localeCompare(b.customerName),
  );

  const total = signals.length;
  const pageRows = signals.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  // Typical categories only for the customers actually shown.
  const pageIds = pageRows.map((r) => r.customerId);
  const categoryGroups = pageIds.length
    ? await db.salesRecord.groupBy({
        by: ["customerId", "labNormalized", "shape"],
        where: { customerId: { in: pageIds }, lotStatusDb: "Invoice" },
        _count: { _all: true },
      })
    : [];

  const categoriesByCustomer = new Map<string, Array<{ label: string; count: number }>>();
  for (const g of categoryGroups) {
    const list = categoriesByCustomer.get(g.customerId) ?? [];
    list.push({ label: `${g.shape} (${g.labNormalized ?? "Non-Cert"})`, count: g._count._all });
    categoriesByCustomer.set(g.customerId, list);
  }

  const rows = pageRows.map((r) => ({
    ...r,
    typicalCategories: (categoriesByCustomer.get(r.customerId) ?? [])
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 3)
      .map((c) => c.label),
  }));

  // Signal counts describe every customer in scope, not only the visible page.
  const withPrediction = signals.filter((s) => s.signal === "PREDICTED_SOON" || s.signal === "PREDICTED_LATER");
  const summary = {
    customers: total,
    predictedSoon: signals.filter((s) => s.signal === "PREDICTED_SOON").length,
    predictedLater: signals.filter((s) => s.signal === "PREDICTED_LATER").length,
    insufficientData: signals.filter((s) => s.signal === "INSUFFICIENT_DATA").length,
    dormant: signals.filter((s) => s.signal === "DORMANT").length,
    avgConfidence: withPrediction.length
      ? num(withPrediction.reduce((s, r) => s + r.confidence, 0) / withPrediction.length)
      : 0,
  };

  return ok({
    rows,
    summary,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
    advisory: true,
    advisoryNotice:
      "PREDICTION — Customer reorder signals are advisory only. They never create a confirmed order, requirement or reservation without business approval.",
  });
});
