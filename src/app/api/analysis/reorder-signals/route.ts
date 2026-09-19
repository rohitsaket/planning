import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";

// Customer Reorder Signal — data science advisory feature (spec section 64).
// Analyzes each customer's historical repeat purchase intervals per category and predicts:
// - typical repeat interval (days)
// - likely reorder window (next N days)
// - likely quantity range
// Clearly labeled as PREDICTION — never converts prediction into confirmed order.
export const GET = withApi({ permission: "analysis.read" }, async () => {
  const customers = await db.customer.findMany({ take: SCAN_MAX,
    include: {
      salesRecords: {
        where: { lotStatusDb: "Invoice" },
        orderBy: { docDate: "asc" },
      },
    },
  }).then(scanned);

  const now = new Date();
  const signals: Array<{
    customerId: string;
    customerCode: string;
    customerName: string;
    country: string;
    businessPriority: string | null;
    totalOrders: number;
    lastPurchaseDate: string | null;
    avgIntervalDays: number | null;
    typicalCategories: string[];
    likelyReorderWindow: string | null;
    likelyReorderDate: string | null;
    likelyQtyRange: string;
    daysSinceLastPurchase: number | null;
    confidence: number;
    signal: "PREDICTED_SOON" | "PREDICTED_LATER" | "INSUFFICIENT_DATA" | "DORMANT";
  }> = [];

  for (const c of customers) {
    const records = c.salesRecords;
    if (records.length === 0) {
      signals.push({
        customerId: c.id,
        customerCode: c.customerCode,
        customerName: c.name,
        country: c.country,
        businessPriority: c.businessPriority,
        totalOrders: 0,
        lastPurchaseDate: null,
        avgIntervalDays: null,
        typicalCategories: [],
        likelyReorderWindow: null,
        likelyReorderDate: null,
        likelyQtyRange: "—",
        daysSinceLastPurchase: null,
        confidence: 0,
        signal: "DORMANT",
      });
      continue;
    }

    // Sort by date and compute intervals
    const sorted = [...records].sort((a, b) => new Date(a.docDate).getTime() - new Date(b.docDate).getTime());
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const diff = (new Date(sorted[i].docDate).getTime() - new Date(sorted[i - 1].docDate).getTime()) / (1000 * 60 * 60 * 24);
      if (diff > 0 && diff < 365) intervals.push(diff);
    }
    const avgInterval = intervals.length > 0 ? intervals.reduce((s, x) => s + x, 0) / intervals.length : null;
    const lastDate = new Date(sorted[sorted.length - 1].docDate);
    const daysSinceLast = Math.floor((now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    // Categories purchased
    const catCounts = new Map<string, number>();
    for (const r of sorted) {
      const cat = `${r.labNormalized ?? "Non-Cert"}|${r.shape}|${r.weightBandId ?? "Unmapped"}`;
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
    const typicalCategories = Array.from(catCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => {
        const [lab, shape] = cat.split("|");
        return `${shape} (${lab})`;
      });

    // Predict reorder
    let likelyReorderDate: string | null = null;
    let likelyReorderWindow: string | null = null;
    let signal: "PREDICTED_SOON" | "PREDICTED_LATER" | "INSUFFICIENT_DATA" | "DORMANT" = "INSUFFICIENT_DATA";
    let confidence = 0;
    let likelyQtyRange = "—";

    if (avgInterval && intervals.length >= 2) {
      const predictedReorder = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);
      likelyReorderDate = predictedReorder.toISOString();
      const daysUntilReorder = Math.floor((predictedReorder.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilReorder < 0) {
        likelyReorderWindow = `Overdue by ${Math.abs(daysUntilReorder)}d`;
        signal = "PREDICTED_SOON";
      } else if (daysUntilReorder <= 14) {
        likelyReorderWindow = `Within ${daysUntilReorder}d`;
        signal = "PREDICTED_SOON";
      } else if (daysUntilReorder <= 45) {
        likelyReorderWindow = `Within ${daysUntilReorder}d`;
        signal = "PREDICTED_LATER";
      } else {
        likelyReorderWindow = `In ${daysUntilReorder}d`;
        signal = "PREDICTED_LATER";
      }
      // Confidence based on interval consistency
      const intervalVariance = intervals.length > 1
        ? Math.sqrt(intervals.reduce((s, x) => s + Math.pow(x - avgInterval, 2), 0) / intervals.length)
        : avgInterval * 0.5;
      const cv = avgInterval > 0 ? intervalVariance / avgInterval : 1;
      confidence = Math.max(0.3, Math.min(0.95, 1 - cv));
      // Likely quantity range = min/max of historical order sizes
      const orderSizes = Array.from(catCounts.values());
      const minQty = Math.min(...orderSizes);
      const maxQty = Math.max(...orderSizes);
      likelyQtyRange = `${minQty}-${maxQty} pcs`;
    } else if (records.length > 0) {
      signal = "INSUFFICIENT_DATA";
      confidence = 0.2;
      likelyQtyRange = "1-3 pcs";
    }

    signals.push({
      customerId: c.id,
      customerCode: c.customerCode,
      customerName: c.name,
      country: c.country,
      businessPriority: c.businessPriority,
      totalOrders: records.length,
      lastPurchaseDate: lastDate.toISOString(),
      avgIntervalDays: avgInterval ? Math.round(avgInterval) : null,
      typicalCategories,
      likelyReorderWindow,
      likelyReorderDate,
      likelyQtyRange,
      daysSinceLastPurchase: daysSinceLast,
      confidence: num(confidence),
      signal,
    });
  }

  // Sort by signal urgency
  const order = { PREDICTED_SOON: 0, PREDICTED_LATER: 1, INSUFFICIENT_DATA: 2, DORMANT: 3 };
  signals.sort((a, b) => order[a.signal] - order[b.signal]);

  return ok({
    rows: signals,
    advisoryNotice: "PREDICTION — Customer reorder signals are advisory only. Never convert a prediction into a confirmed order without business approval.",
  });
});
