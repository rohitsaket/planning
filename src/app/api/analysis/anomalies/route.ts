import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";

// Anomaly Detection — statistical outliers in monthly sales velocity per
// planning category (lab|shape|weightBand). Spec §61 — data science
// infrastructure. ADVISORY ONLY.
//
// Method:
//   • For each planning category, compute the mean + std-dev of monthly sales
//     (pieces) over the trailing 12 calendar months.
//   • Compare the most recent calendar month's count to that distribution.
//   • Flag a category when |z-score| > 2:
//       - z > 2 → SPIKE
//       - z < -2 → DROP
//   • Severity:
//       - |z| > 3  → HIGH
//       - |z| > 2.5 → MEDIUM
//       - |z| > 2  → LOW
//   • deviation = (observed − expected) / expected  (relative change)
//   • expected = mean, observed = latest month count.
//
// We compute the calendar-month skeleton so missing months contribute 0,
// giving a more honest std-dev for sparse categories.
export async function GET() {
  // Anchor "latest month" to the most recent calendar month with sales, but
  // fall back to the current month if no sales exist.
  const now = new Date();
  const latestSales = await db.salesRecord.findFirst({
    where: { lotStatusDb: "Invoice" },
    orderBy: { docDate: "desc" },
    select: { docDate: true },
  });

  // Determine the latest calendar month boundary (first day of the next month
  // after the most recent sale, or first day of next month from now).
  const anchorDate = latestSales?.docDate ?? now;
  const anchorYear = anchorDate.getFullYear();
  const anchorMonth = anchorDate.getMonth(); // 0-11

  // End of the latest month = first day of the following month.
  const latestMonthEnd = new Date(anchorYear, anchorMonth + 1, 1);
  // Start of the 12-month window = first day of the month 12 months before latestMonthEnd.
  const windowStart = new Date(latestMonthEnd);
  windowStart.setMonth(windowStart.getMonth() - 12);

  // Pull all invoiced sales in the window.
  const records = await db.salesRecord.findMany({
    where: {
      lotStatusDb: "Invoice",
      docDate: { gte: windowStart, lt: latestMonthEnd },
    },
  });

  // Group by planning category (lab|shape|weightBand label) and by month bucket.
  // Month bucket key = `${year}-${month0Indexed}` for stable sorting.
  interface MonthAgg {
    year: number;
    month: number; // 0-11
    pieces: number;
  }
  const byCategory = new Map<string, MonthAgg[]>();

  // Build the 12-month skeleton once so every category has 12 buckets (zero-filled).
  const monthSkeleton: { year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(latestMonthEnd);
    d.setMonth(d.getMonth() - 1 - i);
    monthSkeleton.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const skeletonKey = (y: number, m: number) => `${y}-${m}`;

  for (const r of records) {
    const lab = r.labNormalized ?? "Non-Cert";
    const shape = r.shape ?? "Unknown";
    // We don't join WeightBand here (extra query) — use the denormalized label
    // stored on the record if present, else "Unmapped".
    const bandId = r.weightBandId;
    const bandKey = bandId ?? "Unmapped";
    const category = `${lab}|${shape}|${bandKey}`;

    const d = new Date(r.docDate);
    const mk = skeletonKey(d.getFullYear(), d.getMonth());
    const arr = byCategory.get(category) ?? monthSkeleton.map((m) => ({ ...m, pieces: 0 }));
    const found = arr.find((m) => skeletonKey(m.year, m.month) === mk);
    if (found) found.pieces += 1;
    byCategory.set(category, arr);
  }

  // Resolve bandId → label for nicer display.
  const bandIds = new Set<string>();
  for (const k of byCategory.keys()) {
    const parts = k.split("|");
    const band = parts[2] ?? "";
    if (band !== "Unmapped") bandIds.add(band);
  }
  const bandLabels = new Map<string, string>();
  if (bandIds.size > 0) {
    const bands = await db.weightBand.findMany({ where: { id: { in: Array.from(bandIds) } } });
    for (const b of bands) bandLabels.set(b.id, b.label);
  }

  // Compute anomalies.
  const rows: Array<{
    category: string;
    metric: string;
    observed: number;
    expected: number;
    deviation: number;
    zScore: number;
    severity: "HIGH" | "MEDIUM" | "LOW";
    type: "SPIKE" | "DROP";
    description: string;
    recommendedAction: string;
  }> = [];

  for (const [rawCategory, months] of byCategory.entries()) {
    const parts = rawCategory.split("|");
    const lab = parts[0] ?? "Non-Cert";
    const shape = parts[1] ?? "Unknown";
    const bandIdOrLabel = parts[2] ?? "Unmapped";
    const bandLabel = bandLabels.get(bandIdOrLabel) ?? bandIdOrLabel;
    const category = `${lab}|${shape}|${bandLabel}`;

    // Use the trailing 11 months (excluding the latest month) as the baseline
    // distribution, then compare the latest month's count to it.
    if (months.length < 12) continue;
    const baselineMonths = months.slice(0, 11); // oldest 11 months
    const latestMonth = months[11]; // most recent month

    const baselineValues = baselineMonths.map((m) => m.pieces);
    const n = baselineValues.length;
    const mean = baselineValues.reduce((a, b) => a + b, 0) / n;
    const variance =
      baselineValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) continue; // no dispersion → cannot flag

    const observed = latestMonth.pieces;
    const expected = num(mean);
    const zScore = num((observed - mean) / stdDev);

    if (Math.abs(zScore) <= 2) continue; // not an outlier

    const type: "SPIKE" | "DROP" = zScore > 0 ? "SPIKE" : "DROP";
    const absZ = Math.abs(zScore);
    const severity: "HIGH" | "MEDIUM" | "LOW" =
      absZ > 3 ? "HIGH" : absZ > 2.5 ? "MEDIUM" : "LOW";
    const deviation = expected > 0 ? num((observed - expected) / expected) : observed > 0 ? 1 : 0;

    const recommendedAction =
      type === "SPIKE"
        ? "Investigate demand driver — possible bulk order or market shift"
        : "Investigate demand drop — possible stockout, lost customer, or seasonality";

    rows.push({
      category,
      metric: "sales_velocity",
      observed,
      expected: num(expected),
      deviation,
      zScore,
      severity,
      type,
      description: `Sales velocity ${observed} vs expected ${expected.toFixed(1)} (z-score ${zScore.toFixed(2)})`,
      recommendedAction,
    });
  }

  // Sort: highest severity first, then largest |z|
  const sevRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  rows.sort((a, b) => {
    const s = sevRank[b.severity] - sevRank[a.severity];
    if (s !== 0) return s;
    return Math.abs(b.zScore) - Math.abs(a.zScore);
  });

  const summary = {
    totalAnomalies: rows.length,
    spikes: rows.filter((r) => r.type === "SPIKE").length,
    drops: rows.filter((r) => r.type === "DROP").length,
    highSeverity: rows.filter((r) => r.severity === "HIGH").length,
  };

  return ok({ rows, summary, windowStart: windowStart.toISOString(), latestMonthEnd: latestMonthEnd.toISOString() });
}
