"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Money, NumberCell } from "@/components/diamond/shared/empty-state";
import { useGlobalFilter } from "@/stores/global-filter";
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

export function SalesAnalysisView() {
  // Global filter is the single source of truth for windowDays / country / lab.
  // The GlobalFilterBar in the AppShell exposes these to every view.
  const globalFilter = useGlobalFilter();
  const [dimension, setDimension] = useState("shape");
  const url = useMemo(() => {
    const base = `/api/analysis/sales?dimension=${dimension}`;
    const params = new URLSearchParams();
    params.set("windowDays", String(globalFilter.windowDays));
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    return `${base}&${params.toString()}`;
  }, [dimension, globalFilter.windowDays, globalFilter.country, globalFilter.branch, globalFilter.lab]);
  const { data, isLoading } = useApi<SalesAnalysisResponse>(url);

  const totalCarats = (data?.rows ?? []).reduce((s, r) => s + r.carats, 0);
  const rows = data?.rows ?? [];
  const piecesSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.pieces);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [rows]);
  const caratsSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.carats);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [rows]);
  const valueSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.value);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [rows]);
  const chartData = rows.slice(0, 12).map((r) => ({
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

  const filterMeta = globalFilter.hasActiveFilters() && (
    <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
      Filtered by: {[
        globalFilter.country && `Country=${globalFilter.country}`,
        globalFilter.branch && `Branch=${globalFilter.branch}`,
        globalFilter.lab && `Lab=${globalFilter.lab}`,
        `Window=${globalFilter.windowDays}D`,
      ].filter(Boolean).join(", ")}
    </span>
  );

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
          </div>
        }
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {filterMeta}
            <span className="text-[10px] text-muted-foreground">Dimension: {DIMENSIONS.find((d) => d.value === dimension)?.label} · Window: {globalFilter.windowDays}D</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Pieces" value={data?.totalPieces ?? 0} unit="pcs" intent="info" hint="Invoice lots in window" icon={Package} sparkline={piecesSpark} />
        <KpiCard label="Total Carats" value={totalCarats.toFixed(2)} unit="ct" intent="default" hint="Sum of weights" icon={Gem} sparkline={caratsSpark} />
        <KpiCard label="Total Value" value={`$${((data?.totalValue ?? 0) / 1000).toFixed(1)}K`} intent="success" hint="Sum of sale totals" icon={DollarSign} sparkline={valueSpark} />
      </div>

      <Section title={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label} (Top 12)`} description="Bar chart of pieces by dimension value">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="salesPiecesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="url(#salesPiecesGrad)" radius={[4, 4, 0, 0]} />
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
          exportFilename={`sales-${dimension}-${globalFilter.windowDays}d.csv`}
          searchable
          searchPlaceholder="Search dimension..."
          searchFn={(r, q) => r.dimension.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
