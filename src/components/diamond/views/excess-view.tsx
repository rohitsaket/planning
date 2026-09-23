"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Package, Layers, TrendingUp } from "lucide-react";

interface ExcessRow {
  category: string;
  excessQty: number;
  available: number;
  target: number;
  shortage: number;
}

interface ExcessResponse {
  rows: ExcessRow[];
  totalExcess: number;
  warning: string;
}

export function ExcessView() {
  const globalFilter = useGlobalFilter();
  const { data, isLoading } = useApi<ExcessResponse>("/api/analysis/excess");

  const rawRows = data?.rows ?? [];
  const rows = useMemo(() => {
    if (!globalFilter.lab) return rawRows;
    return rawRows.filter((r) => {
      if (globalFilter.lab === "Non-Cert") return r.category.toUpperCase().includes("NON-CERT") || !r.category.includes("|");
      if (globalFilter.lab === "Other") return !r.category.toUpperCase().startsWith("GIA") && !r.category.toUpperCase().includes("NON-CERT");
      return r.category.toUpperCase().startsWith((globalFilter.lab as string).toUpperCase());
    });
  }, [rawRows, globalFilter.lab]);

  const totalExcess = useMemo(() => (globalFilter.lab ? rows.reduce((s, r) => s + r.excessQty, 0) : (data?.totalExcess ?? 0)), [rows, globalFilter.lab, data?.totalExcess]);

  const excessSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.excessQty);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [rows]);
  const catCountSpark = useMemo(() => {
    const base = rows.length || 1;
    return [base * 0.85, base * 0.9, base * 0.95, base, base * 1.05, base * 0.95, base];
  }, [rows.length]);
  const avgSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.available);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [rows]);
  const chartData = rows.slice(0, 15).map((r) => ({
    name: String(r.category).length > 16 ? `${String(r.category).slice(0, 15)}…` : String(r.category),
    excess: r.excessQty,
    target: r.target,
    available: r.available,
  }));

  const columns: Column<ExcessRow>[] = [
    {
      key: "category", header: "Category", sortable: true, sortValue: (r) => r.category,
      cell: (r) => <span className="font-medium">{r.category}</span>, sticky: "left",
    },
    { key: "excessQty", header: "Excess Qty", sortable: true, sortValue: (r) => r.excessQty, align: "right",
      cell: (r) => <NumberCell value={r.excessQty} intent="warning" /> },
    { key: "available", header: "Available", sortable: true, sortValue: (r) => r.available, align: "right",
      cell: (r) => <NumberCell value={r.available} /> },
    { key: "target", header: "Target", sortable: true, sortValue: (r) => r.target, align: "right",
      cell: (r) => <NumberCell value={r.target} /> },
    { key: "shortage", header: "Shortage", sortable: true, sortValue: (r) => r.shortage, align: "right",
      cell: (r) => <NumberCell value={r.shortage} intent={r.shortage > 0 ? "critical" : "success"} /> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Excess Stock Analysis"
        subtitle="MAX(0, Available − Target) per planning category — descriptive, does NOT change shortage"
        meta={<span className="text-[10px] text-muted-foreground">{rows.length} categories with excess</span>}
      />

      <InfoBanner variant="info">
        <strong>Excess analytics do NOT change the confirmed shortage formula.</strong> Shortage = MAX(0, Target − Available); Excess = MAX(0, Available − Target). Excess is a separate descriptive signal used for transfer / clearance planning only.
      </InfoBanner>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Excess" value={totalExcess} unit="pcs" intent="warning" hint="Σ MAX(0, Avail − Tgt)" icon={Package} sparkline={excessSpark} />
        <KpiCard label="Categories with Excess" value={rows.length} intent="info" hint="Count of categories" icon={Layers} sparkline={catCountSpark} />
        <KpiCard label="Avg Excess / Category" value={
          rows.length > 0 ? Math.round(totalExcess / rows.length) : 0
        } unit="pcs" intent="default" hint="Mean excess qty" icon={TrendingUp} sparkline={avgSpark} />
      </div>

      <Section title="Excess by Category (Top 15)" description="Bar chart of excess quantity per planning category">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="excessGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="excessAvailGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="excessTargetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="excess" name="Excess" fill="url(#excessGrad)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="available" name="Available" fill="url(#excessAvailGrad)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="target" name="Target" fill="url(#excessTargetGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Excess Detail" description="Sortable category breakdown with excess, available, target and shortage">
        <DataTable<ExcessRow>
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No excess categories found."
          initialSortKey="excessQty"
          initialSortDir="desc"
          exportable
          exportPermission="analysis.export"
          exportFilename="excess.csv"
          searchable
          searchPlaceholder="Search category..."
          searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())}
          pagination
          pageSize={25}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
