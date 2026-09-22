"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import { useGlobalFilter } from "@/stores/global-filter";
import {
  ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
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
  // Global filter — /api/analysis/sales/trend?groupBy=X currently only respects the
  // `groupBy` param. We append country/lab/branch so the URL stays consistent (forward-
  // compat) and so the user has an explicit indicator that the trend is being filtered.
  const globalFilter = useGlobalFilter();
  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("groupBy", groupBy);
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    if (globalFilter.windowDays !== 90) params.set("windowDays", String(globalFilter.windowDays));
    return `/api/analysis/sales/trend?${params.toString()}`;
  }, [groupBy, globalFilter.country, globalFilter.branch, globalFilter.lab, globalFilter.windowDays]);
  const { data, isLoading } = useApi<TrendResponse>(url);

  const chartData = (data?.rows ?? []).slice(0, 15).map((r) => ({
    name: String(r.key).length > 12 ? `${String(r.key).slice(0, 11)}…` : String(r.key),
    prev30: r.prev30,
    mid30: r.mid30,
    latest30: r.latest30,
  }));

  const totalLatest30 = (data?.rows ?? []).reduce((s, r) => s + r.latest30, 0);
  const total90 = (data?.rows ?? []).reduce((s, r) => s + r.total90, 0);
  const growthGroups = (data?.rows ?? []).filter((r) => ["Strong Growth", "Growth", "New Demand"].includes(r.trend)).length;
  const declineGroups = (data?.rows ?? []).filter((r) => ["Strong Decline", "Declining", "Volatile"].includes(r.trend)).length;
  const latest30Spark = useMemo(() => {
    const slice = (data?.rows ?? []).slice(0, 7).map((r) => r.latest30);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [data?.rows]);
  const total90Spark = useMemo(() => {
    const slice = (data?.rows ?? []).slice(0, 7).map((r) => r.total90);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [data?.rows]);

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
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {globalFilter.hasActiveFilters() && (
              <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
                Filtered by: {[
                  globalFilter.country && `Country=${globalFilter.country}`,
                  globalFilter.branch && `Branch=${globalFilter.branch}`,
                  globalFilter.lab && `Lab=${globalFilter.lab}`,
                ].filter(Boolean).join(", ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">Group: {GROUPS.find((g) => g.value === groupBy)?.label}</span>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Latest 30D Total" value={totalLatest30} unit="pcs" intent="info" hint="Σ pieces in latest window" icon={Activity} sparkline={latest30Spark} />
        <KpiCard label="90D Total" value={total90} unit="pcs" intent="default" hint="Σ 90-day pieces" icon={TrendingUp} sparkline={total90Spark} />
        <KpiCard label="Growth Groups" value={growthGroups} intent="success" hint="Strong Growth / Growth / New Demand" icon={TrendingUp} />
        <KpiCard label="Declining Groups" value={declineGroups} intent="critical" hint="Strong Decline / Declining / Volatile" icon={TrendingDown} />
      </div>

      <Section title="Trend Chart (Top 15)" description="Prev 30D vs Mid 30D vs Latest 30D — pieces per group">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="trendLatestGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="prev30" name="Prev 30D" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="mid30" name="Mid 30D" fill="#60a5fa" radius={[4, 4, 0, 0]} />
              <Bar dataKey="latest30" name="Latest 30D" fill="url(#trendLatestGrad)" radius={[4, 4, 0, 0]} />
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
          exportPermission="sales.export"
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
