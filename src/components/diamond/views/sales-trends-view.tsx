"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface TrendRow {
  key: string;
  prev30: number;
  mid30: number;
  latest30: number;
  total90: number;
  total180: number;
  total365: number;
  trend: string;
  pctChange: number;
}

interface TrendResponse {
  groupBy: string;
  rows: TrendRow[];
}

const GROUPS = [
  { value: "shape", label: "Shape" },
  { value: "lab", label: "Lab" },
  { value: "weightBand", label: "Weight Band" },
  { value: "category", label: "Lab + Shape + Band" },
];

function trendVariant(trend: string): React.ComponentProps<typeof Badge>["variant"] {
  switch (trend) {
    case "Strong Growth":
    case "New Demand":
      return "success";
    case "Growth":
      return "info";
    case "Stable":
      return "neutral";
    case "Declining":
      return "warning";
    case "Strong Decline":
    case "Volatile":
      return "critical";
    case "Dormant":
      return "neutral";
    default:
      return "default";
  }
}

export function SalesTrendsView() {
  const [groupBy, setGroupBy] = useState("shape");
  const url = `/api/analysis/sales/trend?groupBy=${groupBy}`;
  const { data, isLoading } = useApi<TrendResponse>(url);

  const chartData = (data?.rows ?? []).slice(0, 15).map((r) => ({
    name: String(r.key).length > 12 ? `${String(r.key).slice(0, 11)}…` : String(r.key),
    prev30: r.prev30,
    mid30: r.mid30,
    latest30: r.latest30,
  }));

  const columns: Column<TrendRow>[] = [
    {
      key: "key", header: "Group", sortable: true, sortValue: (r) => r.key, sticky: "left",
      cell: (r) => <span className="font-medium">{r.key}</span>,
    },
    { key: "prev30", header: "Prev 30D", sortable: true, sortValue: (r) => r.prev30, align: "right",
      cell: (r) => <NumberCell value={r.prev30} /> },
    { key: "mid30", header: "Mid 30D", sortable: true, sortValue: (r) => r.mid30, align: "right",
      cell: (r) => <NumberCell value={r.mid30} /> },
    { key: "latest30", header: "Latest 30D", sortable: true, sortValue: (r) => r.latest30, align: "right",
      cell: (r) => <NumberCell value={r.latest30} intent={r.latest30 > 0 ? "info" : undefined} /> },
    { key: "total90", header: "Total 90D", sortable: true, sortValue: (r) => r.total90, align: "right",
      cell: (r) => <NumberCell value={r.total90} intent="success" /> },
    { key: "total180", header: "Total 180D", sortable: true, sortValue: (r) => r.total180, align: "right",
      cell: (r) => <NumberCell value={r.total180} /> },
    { key: "total365", header: "Total 365D", sortable: true, sortValue: (r) => r.total365, align: "right",
      cell: (r) => <NumberCell value={r.total365} /> },
    { key: "trend", header: "Trend", sortable: true, sortValue: (r) => r.trend, align: "center",
      cell: (r) => <Badge variant={trendVariant(r.trend)}>{r.trend}</Badge> },
    { key: "pctChange", header: "% Change", sortable: true, sortValue: (r) => r.pctChange, align: "right",
      cell: (r) => (
        <span className={
          r.pctChange > 0 ? "text-emerald-600 dark:text-emerald-400 font-medium tabular-nums" :
          r.pctChange < 0 ? "text-rose-600 dark:text-rose-400 font-medium tabular-nums" :
          "tabular-nums text-muted-foreground"
        }>
          {r.pctChange > 0 ? "+" : ""}{r.pctChange.toFixed(1)}%
        </span>
      ) },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Sales Trend Analysis"
        subtitle="Previous 30D · Middle 30D · Latest 30D windows · Descriptive trend with underlying numbers (NOT a forecast)"
        actions={
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger size="sm" className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.map((g) => (
                <SelectItem key={g.value} value={g.value} className="text-xs">{g.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        meta={<span className="text-[10px] text-muted-foreground">Group: {GROUPS.find((g) => g.value === groupBy)?.label}</span>}
      />

      <Section title="Trend Chart (Top 15)" description="Prev 30D vs Mid 30D vs Latest 30D — pieces per group">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="prev30" name="Prev 30D" fill="#94a3b8" />
              <Bar dataKey="mid30" name="Mid 30D" fill="#60a5fa" />
              <Bar dataKey="latest30" name="Latest 30D" fill="#0ea5e9" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Trend Detail" description="Sortable table with 30D windows, totals and color-coded trend">
        <DataTable<TrendRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No sales in the trailing year."
          initialSortKey="total90"
          initialSortDir="desc"
          exportable
          exportFilename={`sales-trend-${groupBy}.csv`}
          searchable
          searchPlaceholder="Search group..."
          searchFn={(r, q) => r.key.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
