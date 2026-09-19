"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Money, NumberCell } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Package, DollarSign, Gem } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface SalesRow {
  dimension: string;
  pieces: number;
  carats: number;
  value: number;
  avgPerCt: number;
  pct: number;
}

interface SalesAnalysisResponse {
  dimension: string;
  windowDays: number;
  totalPieces: number;
  totalValue: number;
  rows: SalesRow[];
}

const DIMENSIONS = [
  { value: "lab", label: "Lab" },
  { value: "shape", label: "Shape" },
  { value: "weightBand", label: "Weight Band" },
  { value: "color", label: "Color" },
  { value: "clarity", label: "Clarity" },
  { value: "treatment", label: "Treatment" },
  { value: "customer", label: "Customer" },
  { value: "country", label: "Country" },
  { value: "branch", label: "Branch" },
  { value: "month", label: "Month" },
];

const WINDOWS = [
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "60", label: "60D" },
  { value: "90", label: "90D" },
  { value: "180", label: "180D" },
  { value: "365", label: "365D" },
];

export function SalesAnalysisView() {
  const [dimension, setDimension] = useState("shape");
  const [windowDays, setWindowDays] = useState("90");
  const url = `/api/analysis/sales?dimension=${dimension}&windowDays=${windowDays}`;
  const { data, isLoading } = useApi<SalesAnalysisResponse>(url);

  const totalCarats = (data?.rows ?? []).reduce((s, r) => s + r.carats, 0);
  const chartData = (data?.rows ?? []).slice(0, 12).map((r) => ({
    name: String(r.dimension).length > 12 ? `${String(r.dimension).slice(0, 11)}…` : String(r.dimension),
    full: r.dimension,
    pieces: r.pieces,
    value: r.value,
    carats: r.carats,
  }));

  const columns: Column<SalesRow>[] = [
    {
      key: "dimension", header: "Dimension", sortable: true, sortValue: (r) => r.dimension,
      cell: (r) => <span className="font-medium">{r.dimension}</span>, sticky: "left",
    },
    { key: "pieces", header: "Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right",
      cell: (r) => <NumberCell value={r.pieces} /> },
    { key: "carats", header: "Carats", sortable: true, sortValue: (r) => r.carats, align: "right",
      cell: (r) => <NumberCell value={r.carats} /> },
    { key: "value", header: "Value (USD)", sortable: true, sortValue: (r) => r.value, align: "right",
      cell: (r) => <Money value={r.value} /> },
    { key: "avgPerCt", header: "Avg $/ct", sortable: true, sortValue: (r) => r.avgPerCt, align: "right",
      cell: (r) => <Money value={r.avgPerCt} /> },
    { key: "pct", header: "Mix %", sortable: true, sortValue: (r) => r.pct, align: "right",
      cell: (r) => <span className="tabular-nums">{r.pct.toFixed(1)}%</span> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Sales Analysis"
        subtitle="By dimension · Confirmed invoice lots only · Pieces / Carats / Value / Avg $/ct"
        actions={
          <div className="flex items-center gap-2">
            <Select value={dimension} onValueChange={setDimension}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Dimension" />
              </SelectTrigger>
              <SelectContent>
                {DIMENSIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger size="sm" className="h-8 w-[90px] text-xs">
                <SelectValue placeholder="Window" />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value} className="text-xs">{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        meta={<span className="text-[10px] text-muted-foreground">Dimension: {DIMENSIONS.find((d) => d.value === dimension)?.label} · Window: {windowDays}D</span>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Pieces" value={data?.totalPieces ?? 0} unit="pcs" intent="default" hint="Invoice lots in window" />
        <KpiCard label="Total Carats" value={totalCarats.toFixed(2)} unit="ct" intent="info" hint="Sum of weights" />
        <KpiCard label="Total Value" value={`$${((data?.totalValue ?? 0) / 1000).toFixed(1)}K`} intent="success" hint="Sum of sale totals" />
      </div>

      <Section title={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label} (Top 12)`} description="Bar chart of pieces by dimension value">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Detail by Dimension" description="Sortable breakdown with value, carats, avg $/ct and mix %">
        <DataTable<SalesRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No sales in selected window."
          initialSortKey="value"
          initialSortDir="desc"
          exportable
          exportFilename={`sales-${dimension}-${windowDays}d.csv`}
          searchable
          searchPlaceholder="Search dimension..."
          searchFn={(r, q) => r.dimension.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
