"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface ForecastRow {
  category: string;
  prediction30d: number;
  prediction60d: number;
  prediction90d: number;
  confidence: number;
  trend: string;
  stockoutRisk: string | null;
  stockoutDate: string | null;
}
interface ForecastData {
  rows: ForecastRow[];
  modelVersion: string | null;
  runDate?: string;
  horizon30d: number;
  horizon60d: number;
  horizon90d: number;
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

function trendLabel(t: string): string {
  return t.replace(/_/g, " ");
}

const forecastColumns: Column<ForecastRow>[] = [
  { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.category}</span>, sortable: true, sortValue: (r) => r.category, sticky: "left" },
  { key: "prediction30d", header: "30D", cell: (r) => <NumberCell value={r.prediction30d} />, align: "right", sortable: true, sortValue: (r) => r.prediction30d },
  { key: "prediction60d", header: "60D", cell: (r) => <NumberCell value={r.prediction60d} />, align: "right", sortable: true, sortValue: (r) => r.prediction60d },
  { key: "prediction90d", header: "90D", cell: (r) => <NumberCell value={r.prediction90d} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.prediction90d },
  {
    key: "confidence",
    header: "Confidence",
    cell: (r) => (
      <div className="flex items-center gap-2 min-w-[100px]">
        <Progress value={r.confidence * 100} className="h-1.5 w-16" />
        <span className="text-[10px] tabular-nums text-muted-foreground">{(r.confidence * 100).toFixed(0)}%</span>
      </div>
    ),
    sortable: true, sortValue: (r) => r.confidence,
  },
  { key: "trend", header: "Trend", cell: (r) => <Badge variant={trendVariant[r.trend] ?? "default"}>{trendLabel(r.trend)}</Badge> },
  { key: "stockoutRisk", header: "Stockout Risk", cell: (r) => (r.stockoutRisk ? <StatusBadge status={r.stockoutRisk} /> : <span className="text-muted-foreground">—</span>) },
  { key: "stockoutDate", header: "Stockout Date", cell: (r) => (r.stockoutDate ? <span className="tabular-nums">{new Date(r.stockoutDate).toLocaleDateString()}</span> : <span className="text-muted-foreground">—</span>) },
];

export function ForecastView() {
  const { data, isLoading } = useApi<ForecastData>("/api/analysis/forecast");

  const chartData = (data?.rows ?? []).map((r) => ({
    name: r.category.length > 12 ? r.category.slice(0, 10) + "…" : r.category,
    "30D": r.prediction30d,
    "60D": r.prediction60d,
    "90D": r.prediction90d,
  }));

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Forecast Analysis"
        subtitle="Predicted future demand by category — horizon 30 / 60 / 90 days"
        meta={<span className="text-[10px] text-muted-foreground">Model: {data?.modelVersion ?? "—"}</span>}
      />

      {data?.advisoryNotice && (
        <InfoBanner variant="warning">
          <strong className="font-semibold">FORECAST IS A PREDICTION, NOT CONFIRMED DEMAND.</strong> Forecast must remain separate from confirmed current manufacturing requirement.
        </InfoBanner>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Model Version" value={data?.modelVersion ?? "—"} intent="info" hint="Active forecast model" />
        <KpiCard label="Horizon 30D Total" value={data?.horizon30d ?? 0} unit="pcs" intent="default" hint="Σ 30-day predictions" />
        <KpiCard label="Horizon 60D Total" value={data?.horizon60d ?? 0} unit="pcs" intent="default" hint="Σ 60-day predictions" />
        <KpiCard label="Horizon 90D Total" value={data?.horizon90d ?? 0} unit="pcs" intent="info" hint="Σ 90-day predictions" />
      </div>

      <Section title="Predictions by Category" description="Each row is a predicted demand figure, not a confirmed order requirement">
        <DataTable
          columns={forecastColumns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No forecast rows"
          maxHeight="520px"
          exportable
          exportFilename="forecast-predictions.csv"
          searchable
          searchPlaceholder="Search category..."
          searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())}
        />
      </Section>

      <Section title="Prediction Horizon Chart" description="30D / 60D / 90D predicted demand per category">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="30D" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="60D" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="90D" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
