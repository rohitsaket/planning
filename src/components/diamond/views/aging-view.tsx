"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";

interface AgingBucket {
  label: string;
  pieces: number;
  carats: number;
}

interface AgingResponse {
  buckets: AgingBucket[];
  slowMoving: number;
  slowMovingPct: number;
}

export function AgingView() {
  const { data, isLoading } = useApi<AgingResponse>("/api/analysis/aging");

  const chartData = (data?.buckets ?? []).map((b) => ({
    name: b.label,
    pieces: b.pieces,
    carats: Number((b.carats ?? 0).toFixed(2)),
  }));

  const totalPieces = (data?.buckets ?? []).reduce((s, b) => s + b.pieces, 0);
  const totalCarats = (data?.buckets ?? []).reduce((s, b) => s + b.carats, 0);

  const columns: Column<AgingBucket>[] = [
    {
      key: "label", header: "Bucket", sortable: true, sortValue: (r) => r.label,
      cell: (r) => <span className="font-medium">{r.label}</span>, sticky: "left",
    },
    { key: "pieces", header: "Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right",
      cell: (r) => <NumberCell value={r.pieces} intent={
        r.label === "365+" ? "critical" :
        r.label === "181-365" ? "warning" :
        undefined
      } /> },
    { key: "carats", header: "Carats", sortable: true, sortValue: (r) => r.carats, align: "right",
      cell: (r) => <NumberCell value={r.carats} /> },
    { key: "pct", header: "% of Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {totalPieces > 0 ? ((r.pieces / totalPieces) * 100).toFixed(1) : "0.0"}%
        </span>
      ) },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Stock Aging"
        subtitle="Polished inventory age buckets — pieces, carats and slow-moving exposure"
        meta={<span className="text-[10px] text-muted-foreground">{totalPieces} pcs · {totalCarats.toFixed(2)} ct total in stock</span>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Pieces" value={totalPieces} unit="pcs" intent="default" hint="Polished inventory" />
        <KpiCard label="Total Carats" value={totalCarats.toFixed(2)} unit="ct" intent="info" hint="Σ weights" />
        <KpiCard label="Slow-Moving (91D+)" value={data?.slowMoving ?? 0} unit="pcs" intent="warning" hint="Pieces aged 91+ days" />
        <KpiCard label="Slow-Moving %" value={`${(data?.slowMovingPct ?? 0).toFixed(1)}%`} intent={Number(data?.slowMovingPct ?? 0) > 30 ? "critical" : "warning"} hint="Slow-moving / total pieces" />
      </div>

      <Section title="Aging Buckets" description="Polished lot count and carats by age bucket">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="#0ea5e9" />
              <Bar dataKey="carats" name="Carats" fill="#94a3b8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Aging Detail" description="Sortable age bucket breakdown">
        <DataTable<AgingBucket>
          columns={columns}
          rows={data?.buckets ?? []}
          loading={isLoading}
          emptyMessage="No aging data available."
          initialSortKey="label"
          initialSortDir="asc"
          exportable
          exportFilename="stock-aging.csv"
          maxHeight="400px"
        />
      </Section>
    </div>
  );
}
