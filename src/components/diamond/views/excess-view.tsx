"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";

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
  const { data, isLoading } = useApi<ExcessResponse>("/api/analysis/excess");

  const chartData = (data?.rows ?? []).slice(0, 15).map((r) => ({
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
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} categories with excess</span>}
      />

      <InfoBanner variant="info">
        <strong>Excess analytics do NOT change the confirmed shortage formula.</strong> Shortage = MAX(0, Target − Available); Excess = MAX(0, Available − Target). Excess is a separate descriptive signal used for transfer / clearance planning only.
      </InfoBanner>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Excess" value={data?.totalExcess ?? 0} unit="pcs" intent="warning" hint="Σ MAX(0, Avail − Tgt)" />
        <KpiCard label="Categories with Excess" value={data?.rows.length ?? 0} intent="info" hint="Count of categories" />
        <KpiCard label="Avg Excess / Category" value={
          data && data.rows.length > 0 ? Math.round(data.totalExcess / data.rows.length) : 0
        } unit="pcs" intent="default" hint="Mean excess qty" />
      </div>

      <Section title="Excess by Category (Top 15)" description="Bar chart of excess quantity per planning category">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="excess" name="Excess" fill="#f59e0b" />
              <Bar dataKey="available" name="Available" fill="#94a3b8" />
              <Bar dataKey="target" name="Target" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Excess Detail" description="Sortable category breakdown with excess, available, target and shortage">
        <DataTable<ExcessRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No excess categories found."
          initialSortKey="excessQty"
          initialSortDir="desc"
          exportable
          exportFilename="excess.csv"
          searchable
          searchPlaceholder="Search category..."
          searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
