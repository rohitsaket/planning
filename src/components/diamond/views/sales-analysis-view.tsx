"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Money, NumberCell } from "@/components/diamond/shared/empty-state";
import { useGlobalFilter } from "@/stores/global-filter";
import { useAuthStore } from "@/stores/auth-store";
import { formatCompactCurrency, formatPercent, roundPercent } from "@/lib/format";
import {
  SALES_DIMENSIONS, chartRowsByPieces, chartTitle, dimensionsAllowed,
  type SalesDimension, type SalesGroupRow,
} from "@/lib/analytics/sales-dimensions";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Package, DollarSign, Gem, AlertTriangle } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type SalesRow = SalesGroupRow;

interface TrendPoint { periodStart: string; periodEnd: string; value: number }

interface SalesAnalysisResponse {
  dimension: SalesDimension;
  windowDays: number;
  window: { startDate: string; endDate: string; timezone: string };
  totalPieces: number;
  totalCarats: number;
  totalValue: number;
  rows: SalesRow[];
  trendSeries: { bucketDays: number; pieces: TrendPoint[]; carats: TrendPoint[]; value: TrendPoint[] };
  dataQuality: { qtyNotOneCount: number };
}

interface ChartDatum { name: string; full: string; pieces: number; value: number; carats: number }

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="font-medium">{d.full}</p>
      <p className="tabular-nums">Pieces: {d.pieces}</p>
      <p className="tabular-nums text-muted-foreground">Carats: {d.carats.toFixed(2)} · Value: {formatCompactCurrency(d.value)}</p>
    </div>
  );
}

export function SalesAnalysisView() {
  // Global filter is the single source of truth for windowDays / country / lab.
  // The GlobalFilterBar in the AppShell exposes these to every view.
  const globalFilter = useGlobalFilter();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  // Customer grouping needs customers.read — hidden here, enforced by the API.
  const dimensions = useMemo(() => dimensionsAllowed(permissions), [permissions]);
  const [chosen, setDimension] = useState<SalesDimension>("shape");
  // A dimension the role may not use (e.g. after a role change) falls back to Shape.
  const dimension: SalesDimension = dimensions.some((d) => d.value === chosen) ? chosen : "shape";

  const url = useMemo(() => {
    const params = new URLSearchParams({ dimension, windowDays: String(globalFilter.windowDays) });
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    return `/api/analysis/sales?${params.toString()}`;
  }, [dimension, globalFilter.windowDays, globalFilter.country, globalFilter.branch, globalFilter.lab]);
  const { data, isLoading } = useApi<SalesAnalysisResponse>(url);

  const rows = data?.rows ?? [];
  const dimLabel = SALES_DIMENSIONS.find((d) => d.value === dimension)!.label;
  const trend = data?.trendSeries;
  const period = trend?.bucketDays === 1 ? "day" : "week";
  const periods = trend?.pieces.length ?? 0;
  const sparkTitle = (metric: string) => `${metric} per ${period}, ${periods} full ${period}s oldest to newest`;
  const spark = (points?: TrendPoint[]) => points?.map((p) => p.value);

  const chartData: ChartDatum[] = chartRowsByPieces(rows).map((r) => ({
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
      cell: (r) => <NumberCell value={r.carats} />, exportValue: (r) => Number(r.carats.toFixed(2)) },
    { key: "value", header: "Value (USD)", sortable: true, sortValue: (r) => r.value, align: "right",
      cell: (r) => <Money value={r.value} />, exportValue: (r) => Number(r.value.toFixed(2)) },
    { key: "avgPerCt", header: "Avg $/ct", sortable: true, sortValue: (r) => r.avgPerCt, align: "right",
      cell: (r) => <Money value={r.avgPerCt} />, exportValue: (r) => Number(r.avgPerCt.toFixed(2)) },
    { key: "pct", header: "Value Mix %", sortable: true, sortValue: (r) => r.pct, align: "right",
      cell: (r) => <span className="tabular-nums" title="Share of total sales value">{formatPercent(r.pct)}</span>,
      exportValue: (r) => roundPercent(r.pct) },
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
            <Select value={dimension} onValueChange={(v) => setDimension(v as SalesDimension)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs" aria-label="Group sales by dimension">
                <SelectValue placeholder="Dimension" />
              </SelectTrigger>
              <SelectContent>
                {dimensions.map((d) => (
                  <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {filterMeta}
            <span className="text-[10px] text-muted-foreground">
              Dimension: {dimLabel} · Window: {globalFilter.windowDays}D
              {data?.window && ` (${data.window.startDate} → ${data.window.endDate}, ${data.window.timezone})`}
            </span>
            {!!data?.dataQuality.qtyNotOneCount && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400" role="status">
                <AlertTriangle className="h-3 w-3" aria-hidden />
                {data.dataQuality.qtyNotOneCount} invoice row(s) have qty ≠ 1 — counted as one stone each; check source data
              </span>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Pieces" value={data?.totalPieces ?? 0} unit="pcs" intent="info" hint="Invoice lots in window" icon={Package}
          sparkline={spark(trend?.pieces)} sparklineTitle={sparkTitle("Pieces")} />
        <KpiCard label="Total Carats" value={(data?.totalCarats ?? 0).toFixed(2)} unit="ct" intent="default" hint="Sum of weights" icon={Gem}
          sparkline={spark(trend?.carats)} sparklineTitle={sparkTitle("Carats")} />
        <KpiCard label="Total Value" value={formatCompactCurrency(data?.totalValue ?? 0)} intent="success" hint="Sum of sale totals" icon={DollarSign}
          sparkline={spark(trend?.value)} sparklineTitle={sparkTitle("Value")} />
      </div>

      <Section title={chartTitle(dimension, chartData.length)} description={`Bar chart of pieces, ranked by pieces${rows.length > chartData.length ? ` (${rows.length} ${dimLabel.toLowerCase()} values in total)` : ""}`}>
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
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="url(#salesPiecesGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Detail by Dimension" description="Sortable breakdown with value, carats, avg $/ct and value mix %">
        <DataTable<SalesRow>
          columns={columns}
          rows={rows}
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
