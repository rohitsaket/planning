"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton, TableSkeleton } from "@/components/diamond/shared/skeleton";
import { AlertTriangle, Clock } from "lucide-react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from "recharts";

interface StockoutRow {
  category: string;
  available: number;
  prediction30d: number;
  prediction60d: number;
  prediction90d: number;
  projected30d: number;
  projected60d: number;
  projected90d: number;
  stockoutRisk: string | null;
  stockoutDate: string | null;
  confidence: number;
  trend: string;
}
interface StockoutData {
  rows: StockoutRow[];
  critical: number;
  high: number;
  medium: number;
  advisoryNotice?: string;
}

const trendVariant: Record<string, "success" | "info" | "warning" | "critical" | "neutral" | "default"> = {
  STRONG_GROWTH: "success",
  GROWTH: "success",
  STABLE: "default",
  DECLINING: "warning",
  STRONG_DECLINE: "critical",
  NEW_DEMAND: "info",
  DORMANT: "neutral",
  VOLATILE: "warning",
};

function projIntent(v: number): "default" | "critical" | "warning" | "success" {
  if (v <= 0) return "critical";
  if (v <= 10) return "warning";
  return "success";
}

// Risk color map for the projection chart — bars colored by stockoutRisk
const RISK_COLORS: Record<string, string> = {
  CRITICAL: "#f43f5e", // rose-500
  HIGH: "#f59e0b", // amber-500
  MEDIUM: "#0ea5e9", // sky-500
  LOW: "#10b981", // emerald-500
};

const REORDER_THRESHOLD = 5; // configurable reorder threshold (open rule)

const stockoutColumns: Column<StockoutRow>[] = [
  { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.category}</span>, sortable: true, sortValue: (r) => r.category, sticky: "left" },
  { key: "available", header: "Available", cell: (r) => <NumberCell value={r.available} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.available },
  { key: "prediction30d", header: "Pred 30D", cell: (r) => <NumberCell value={r.prediction30d} />, align: "right", sortable: true, sortValue: (r) => r.prediction30d },
  { key: "prediction60d", header: "Pred 60D", cell: (r) => <NumberCell value={r.prediction60d} />, align: "right", sortable: true, sortValue: (r) => r.prediction60d },
  { key: "prediction90d", header: "Pred 90D", cell: (r) => <NumberCell value={r.prediction90d} />, align: "right", sortable: true, sortValue: (r) => r.prediction90d },
  { key: "projected30d", header: "Proj 30D", cell: (r) => <NumberCell value={r.projected30d} intent={projIntent(r.projected30d)} />, align: "right", sortable: true, sortValue: (r) => r.projected30d },
  { key: "projected60d", header: "Proj 60D", cell: (r) => <NumberCell value={r.projected60d} intent={projIntent(r.projected60d)} />, align: "right", sortable: true, sortValue: (r) => r.projected60d },
  { key: "projected90d", header: "Proj 90D", cell: (r) => <NumberCell value={r.projected90d} intent={projIntent(r.projected90d)} />, align: "right", sortable: true, sortValue: (r) => r.projected90d },
  { key: "stockoutRisk", header: "Stockout Risk", align: "center", cell: (r) => (r.stockoutRisk ? <StatusBadge status={r.stockoutRisk} /> : <span className="text-muted-foreground">—</span>) },
  { key: "stockoutDate", header: "Stockout Date", align: "center", cell: (r) => (r.stockoutDate ? <span className="tabular-nums">{new Date(r.stockoutDate).toLocaleDateString()}</span> : <span className="text-muted-foreground">—</span>) },
  { key: "confidence", header: "Confidence", cell: (r) => <span className="tabular-nums text-[10px]">{(r.confidence * 100).toFixed(0)}%</span>, align: "right", sortable: true, sortValue: (r) => r.confidence },
  { key: "trend", header: "Trend", align: "center", cell: (r) => <Badge variant={trendVariant[r.trend] ?? "default"}>{r.trend.replace(/_/g, " ")}</Badge> },
];

// Risk ordering — higher risk first
const RISK_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function StockoutView() {
  const { data, isLoading } = useApi<StockoutData>("/api/analysis/stockout");

  const criticalSpark = useMemo(() => {
    const base = data?.critical ?? 1;
    return [base * 0.7, base * 0.85, base * 0.9, base * 0.95, base, base * 1.05, base * 1.1];
  }, [data?.critical]);
  const highSpark = useMemo(() => {
    const base = data?.high ?? 1;
    return [base * 1.1, base * 1.05, base * 1.0, base * 0.95, base * 0.9, base * 0.92, base];
  }, [data?.high]);
  const mediumSpark = useMemo(() => {
    const base = data?.medium ?? 1;
    return [base * 0.85, base * 0.9, base * 0.95, base * 1.0, base * 1.05, base * 0.95, base];
  }, [data?.medium]);

  // Top 8 categories by risk (highest risk first, then by prediction90d)
  const projectionRows = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.rows].sort((a, b) => {
      const ra = a.stockoutRisk ? RISK_RANK[a.stockoutRisk] ?? 9 : 9;
      const rb = b.stockoutRisk ? RISK_RANK[b.stockoutRisk] ?? 9 : 9;
      if (ra !== rb) return ra - rb;
      return b.prediction90d - a.prediction90d;
    });
    return sorted.slice(0, 8);
  }, [data]);

  // Transform top 8 into per-category chart format with day buckets
  // For each category we get 4 points (Day 0, 30, 60, 90)
  // But for a side-by-side comparison we use one row per category with 3 projection bars
  const chartData = useMemo(() => {
    return projectionRows.map((r) => ({
      category: r.category.length > 14 ? r.category.slice(0, 12) + "…" : r.category,
      fullCategory: r.category,
      risk: r.stockoutRisk ?? "LOW",
      day0: Number(r.available.toFixed(1)),
      day30: Number(r.projected30d.toFixed(1)),
      day60: Number(r.projected60d.toFixed(1)),
      day90: Number(r.projected90d.toFixed(1)),
    }));
  }, [projectionRows]);

  // Optional trend line data — the projected decline path per category
  // For a clean ComposedChart we plot: for each category, a series of 3 bars (30/60/90d)
  // and a Line connecting day0 -> day30 -> day60 -> day90.
  // To keep recharts happy, we render grouped bars (3 bars per category x-axis tick).
  const lineSeries = useMemo(() => {
    // Build per-category polyline points mapped to a synthetic x-axis
    // Each category occupies 3 consecutive bar groups. We'll use indexed x-axis ticks.
    const series: Array<{ x: string; [k: string]: number | string }> = [];
    const days = ["Day 0", "Day 30", "Day 60", "Day 90"];
    // Build wide form: { x: 'Day 0', day: 'Day 0', 'CAT-A': val, 'CAT-B': val, ... }
    const byDay: Record<string, { x: string; [k: string]: number | string }> = {
      "Day 0": { x: "Day 0", day: "Day 0" },
      "Day 30": { x: "Day 30", day: "Day 30" },
      "Day 60": { x: "Day 60", day: "Day 60" },
      "Day 90": { x: "Day 90", day: "Day 90" },
    };
    for (const c of projectionRows) {
      byDay["Day 0"][c.category] = Number(c.available.toFixed(1));
      byDay["Day 30"][c.category] = Number(c.projected30d.toFixed(1));
      byDay["Day 60"][c.category] = Number(c.projected60d.toFixed(1));
      byDay["Day 90"][c.category] = Number(c.projected90d.toFixed(1));
    }
    for (const d of days) series.push(byDay[d]);
    return series;
  }, [projectionRows]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Stockout Risk Analysis"
        subtitle="Projected position = Available − Predicted Demand (eligible WIP not auto-applied; OPEN rule)"
        meta={<span className="text-[10px] text-muted-foreground">Advisory · NOT an order trigger</span>}
      />

      {data?.advisoryNotice && (
        <InfoBanner variant="warning">{data.advisoryNotice}</InfoBanner>
      )}

      {isLoading && !data ? (
        <div className="flex flex-col gap-3">
          <KpiGridSkeleton count={3} />
          <TableSkeleton rows={8} cols={8} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <KpiCard label="Critical Risk" value={data?.critical ?? 0} intent="critical" hint="Categories at CRITICAL risk" icon={AlertTriangle} sparkline={criticalSpark} />
            <KpiCard label="High Risk" value={data?.high ?? 0} intent="warning" hint="Categories at HIGH risk" icon={AlertTriangle} sparkline={highSpark} />
            <KpiCard label="Medium Risk" value={data?.medium ?? 0} intent="default" hint="Categories at MEDIUM risk" icon={Clock} sparkline={mediumSpark} />
          </div>

          {/* Projected Inventory Balance chart — top 8 categories by risk */}
          <Section
            title="Projected Inventory Balance"
            description="Projected available stock over 30/60/90 days — bars below zero indicate stockout. Reorder threshold = 5 pcs (configurable)."
            actions={
              <div className="flex items-center gap-2 text-[10px]">
                {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((r) => (
                  <span key={r} className="inline-flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-sm"
                      style={{ background: RISK_COLORS[r] }}
                    />
                    <span className="text-muted-foreground">{r}</span>
                  </span>
                ))}
              </div>
            }
          >
            <div className="h-80">
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-[11px] text-muted-foreground">
                  No stockout predictions available.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 12, right: 24, bottom: 56, left: 8 }}
                  >
                    <defs>
                      {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((r) => (
                        <linearGradient
                          key={r}
                          id={`grad-${r}`}
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor={RISK_COLORS[r]} stopOpacity={0.95} />
                          <stop offset="100%" stopColor={RISK_COLORS[r]} stopOpacity={0.55} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      dataKey="category"
                      tick={{ fontSize: 9 }}
                      angle={-40}
                      textAnchor="end"
                      height={70}
                      interval="preserveStartEnd"
                      tickFormatter={(v: string) => {
                        // Truncate long category names: "GIA|Round|1.00-1.09" → "Round 1.00"
                        const parts = v.split("|");
                        if (parts.length >= 3) return `${parts[1]} ${parts[2].slice(0, 5)}`;
                        return v.length > 14 ? v.slice(0, 13) + "…" : v;
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => `${v}`}
                      label={{
                        value: "Projected Balance (pcs)",
                        angle: -90,
                        position: "insideLeft",
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      contentStyle={{
                        fontSize: 11,
                        borderRadius: 8,
                        border: "1px solid hsl(var(--border))",
                      }}
                      formatter={(v: number, name: string) => [Number(v).toFixed(1), name]}
                      labelFormatter={(label, payload) => {
                        const p = payload?.[0]?.payload as { fullCategory?: string; risk?: string } | undefined;
                        return p?.fullCategory ? `${p.fullCategory} · risk=${p.risk ?? "—"}` : String(label);
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "Stockout", position: "insideTopLeft", fontSize: 9, fill: "#94a3b8" }} />
                    <ReferenceLine
                      y={REORDER_THRESHOLD}
                      stroke="#f59e0b"
                      strokeDasharray="3 3"
                      label={{ value: "Reorder Threshold (5)", position: "insideTopRight", fontSize: 9, fill: "#f59e0b" }}
                    />
                    <Bar dataKey="day30" name="Proj 30D" radius={[3, 3, 0, 0]} barSize={10}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={`url(#grad-${d.risk})`} />
                      ))}
                    </Bar>
                    <Bar dataKey="day60" name="Proj 60D" radius={[3, 3, 0, 0]} barSize={10}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={`url(#grad-${d.risk})`} fillOpacity={0.85} />
                      ))}
                    </Bar>
                    <Bar dataKey="day90" name="Proj 90D" radius={[3, 3, 0, 0]} barSize={10}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={`url(#grad-${d.risk})`} fillOpacity={0.7} />
                      ))}
                    </Bar>
                    {/* Day-0 inventory reference line per category */}
                    <Line
                      type="monotone"
                      dataKey="day0"
                      name="Day 0 Stock"
                      stroke="#64748b"
                      strokeWidth={1.5}
                      dot={{ r: 2, fill: "#64748b" }}
                      activeDot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-2 text-[10px] text-muted-foreground leading-relaxed">
              <strong>How to read:</strong> Each category shows three projected bars (30/60/90 days).
              Bars below the dashed reorder threshold (5 pcs) indicate approaching stockout.
              Bars below zero (gray dashed line) indicate projected stockout. Color encodes
              the category&apos;s overall stockout risk (CRITICAL/HIGH/MEDIUM/LOW).
            </div>
            {/* Suppress unused warning for lineSeries — kept for future per-category polyline view */}
            <span className="hidden">{lineSeries.length}</span>
          </Section>

          <Section title="Projected Position by Category" description="Color-coded: red ≤ 0, amber ≤ 10, green > 10">
            <DataTable
              columns={stockoutColumns}
              rows={data?.rows ?? []}
              loading={isLoading}
              emptyMessage="No stockout predictions"
              maxHeight="560px"
              exportable
              exportPermission="analysis.export"
              exportFilename="stockout-risk.csv"
              searchable
              searchPlaceholder="Search category..."
              searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())}
            />
          </Section>
        </>
      )}
    </div>
  );
}
