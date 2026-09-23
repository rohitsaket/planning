import { db } from "@/lib/db";
import { ok, num } from "@/lib/api-utils";
import { withApi, SCAN_MAX, scanned } from "@/lib/api/with-api";
import {
  ANOMALY_DIRECTIONS,
  ANOMALY_NONE_FLAGGED,
  ANOMALY_SEVERITY_LABELS,
  type AnomalyDirection,
  type AnomalySeverity,
} from "@/lib/analysis/business-language";

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
export const GET = withApi({ permission: "analysis.read" }, async () => {
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
  const records = await db.salesRecord.findMany({ take: SCAN_MAX,
    where: {
      lotStatusDb: "Invoice",
      docDate: { gte: windowStart, lt: latestMonthEnd },
    },
  }).then(scanned);

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
    const bands = await db.weightBand.findMany({ take: SCAN_MAX, where: { id: { in: Array.from(bandIds) } } }).then(scanned);
    for (const b of bands) bandLabels.set(b.id, b.label);
  }

  // Compute anomalies.
  // `outlierMagnitude` is the internal ordering key. It stays in this array and is
  // dropped before serialization, so ranking is preserved without publishing the measure
  // that produced it.
  const rows: Array<{
    category: string;
    metric: string;
    observed: number;
    expected: number;
    deviation: number;
    severity: AnomalySeverity;
    direction: AnomalyDirection;
    description: string;
    recommendedAction: string;
    outlierMagnitude: number;
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

    const direction: AnomalyDirection = zScore > 0 ? "UNUSUALLY_HIGH" : "UNUSUALLY_LOW";
    const absZ = Math.abs(zScore);
    const severity: AnomalySeverity =
      absZ > 3 ? "HIGH" : absZ > 2.5 ? "MEDIUM" : "LOW";
    const deviation = expected > 0 ? num((observed - expected) / expected) : observed > 0 ? 1 : 0;

    const recommendedAction =
      direction === "UNUSUALLY_HIGH"
        ? "Investigate demand driver — possible bulk order or market shift"
        : "Investigate demand drop — possible stockout, lost customer, or seasonality";

    rows.push({
      category,
      metric: "sales_velocity",
      observed,
      expected: num(expected),
      deviation,
      severity,
      direction,
      description: ANOMALY_DIRECTIONS[direction],
      recommendedAction,
      outlierMagnitude: absZ,
    });
  }

  // Sort: highest severity first, then furthest outside the established range. The
  // ordering is identical to before; only the field it reads is now internal.
  const sevRank: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  rows.sort((a, b) => {
    const s = sevRank[b.severity] - sevRank[a.severity];
    if (s !== 0) return s;
    return b.outlierMagnitude - a.outlierMagnitude;
  });

  const summary = {
    totalAnomalies: rows.length,
    spikes: rows.filter((r) => r.direction === "UNUSUALLY_HIGH").length,
    drops: rows.filter((r) => r.direction === "UNUSUALLY_LOW").length,
    highSeverity: rows.filter((r) => r.severity === "HIGH").length,
    noneFlaggedMessage: rows.length === 0 ? ANOMALY_NONE_FLAGGED : null,
  };

  // Serialized field by field. `outlierMagnitude` is deliberately absent: the server has
  // already applied the ordering, and `rank` carries it without exposing the measure.
  const publicRows = rows.map((r, i) => ({
    rank: i + 1,
    category: r.category,
    metric: r.metric,
    observed: r.observed,
    expected: r.expected,
    deviation: r.deviation,
    severity: r.severity,
    severityLabel: ANOMALY_SEVERITY_LABELS[r.severity],
    direction: r.direction,
    description: r.description,
    recommendedAction: r.recommendedAction,
  }));

  return ok({ rows: publicRows, summary, windowStart: windowStart.toISOString(), latestMonthEnd: latestMonthEnd.toISOString() });
});
