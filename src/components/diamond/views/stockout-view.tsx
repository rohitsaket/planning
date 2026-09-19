"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";

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

const stockoutColumns: Column<StockoutRow>[] = [
  { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.category}</span>, sortable: true, sortValue: (r) => r.category, sticky: "left" },
  { key: "available", header: "Available", cell: (r) => <NumberCell value={r.available} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.available },
  { key: "prediction30d", header: "Pred 30D", cell: (r) => <NumberCell value={r.prediction30d} />, align: "right", sortable: true, sortValue: (r) => r.prediction30d },
  { key: "prediction60d", header: "Pred 60D", cell: (r) => <NumberCell value={r.prediction60d} />, align: "right", sortable: true, sortValue: (r) => r.prediction60d },
  { key: "prediction90d", header: "Pred 90D", cell: (r) => <NumberCell value={r.prediction90d} />, align: "right", sortable: true, sortValue: (r) => r.prediction90d },
  { key: "projected30d", header: "Proj 30D", cell: (r) => <NumberCell value={r.projected30d} intent={projIntent(r.projected30d)} />, align: "right", sortable: true, sortValue: (r) => r.projected30d },
  { key: "projected60d", header: "Proj 60D", cell: (r) => <NumberCell value={r.projected60d} intent={projIntent(r.projected60d)} />, align: "right", sortable: true, sortValue: (r) => r.projected60d },
  { key: "projected90d", header: "Proj 90D", cell: (r) => <NumberCell value={r.projected90d} intent={projIntent(r.projected90d)} />, align: "right", sortable: true, sortValue: (r) => r.projected90d },
  { key: "stockoutRisk", header: "Stockout Risk", cell: (r) => (r.stockoutRisk ? <StatusBadge status={r.stockoutRisk} /> : <span className="text-muted-foreground">—</span>) },
  { key: "stockoutDate", header: "Stockout Date", cell: (r) => (r.stockoutDate ? <span className="tabular-nums">{new Date(r.stockoutDate).toLocaleDateString()}</span> : <span className="text-muted-foreground">—</span>) },
  { key: "confidence", header: "Confidence", cell: (r) => <span className="tabular-nums text-[10px]">{(r.confidence * 100).toFixed(0)}%</span>, align: "right", sortable: true, sortValue: (r) => r.confidence },
  { key: "trend", header: "Trend", cell: (r) => <Badge variant={trendVariant[r.trend] ?? "default"}>{r.trend.replace(/_/g, " ")}</Badge> },
];

export function StockoutView() {
  const { data, isLoading } = useApi<StockoutData>("/api/analysis/stockout");

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

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Critical Risk" value={data?.critical ?? 0} intent="critical" hint="Categories at CRITICAL risk" />
        <KpiCard label="High Risk" value={data?.high ?? 0} intent="warning" hint="Categories at HIGH risk" />
        <KpiCard label="Medium Risk" value={data?.medium ?? 0} intent="default" hint="Categories at MEDIUM risk" />
      </div>

      <Section title="Projected Position by Category" description="Color-coded: red ≤ 0, amber ≤ 10, green > 10">
        <DataTable
          columns={stockoutColumns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No stockout predictions"
          maxHeight="560px"
          exportable
          exportFilename="stockout-risk.csv"
          searchable
          searchPlaceholder="Search category..."
          searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())}
        />
      </Section>
    </div>
  );
}
