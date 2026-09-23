"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { useGlobalFilter } from "@/stores/global-filter";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Gem, CalendarClock, Diamond, TrendingUp } from "lucide-react";

interface AgingBucket {
  label: string;
  pieces: number;
  carats: number;
}

interface AgingLotRow {
  lotId: string;
  ageDays: number;
  bucket: string;
  country: string;
  branch: string;
  shape: string | null;
  lab: string | null;
  weight: number;
}

interface AgingResponse {
  buckets: AgingBucket[];
  totalPieces: number;
  slowMoving: number;
  slowMovingPct: number;
  slowMovingThresholdDays: number;
  rows: AgingLotRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export function AgingView() {
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const [bucket, setBucket] = useState<string | null>(null);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    if (bucket) params.set("bucket", bucket);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return `/api/analysis/aging?${params.toString()}`;
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, bucket, page]);
  const { data, isLoading } = useApi<AgingResponse>(url);

  const filterKey = `${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}|${globalFilter.lab ?? ""}|${bucket ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const buckets = data?.buckets ?? [];
  const piecesSpark = useMemo(() => {
    const slice = buckets.map((b) => b.pieces);
    return slice.length >= 2 ? slice : undefined;
  }, [buckets]);
  const caratsSpark = useMemo(() => {
    const slice = buckets.map((b) => b.carats);
    return slice.length >= 2 ? slice : undefined;
  }, [buckets]);
  // Slow-moving KPIs have no time series behind them, so they carry no sparkline
  // rather than an invented trend.
  const chartData = buckets.map((b) => ({
    name: b.label,
    pieces: b.pieces,
    carats: Number((b.carats ?? 0).toFixed(2)),
  }));

  const totalPieces = data?.totalPieces ?? 0;
  const totalCarats = buckets.reduce((s, b) => s + b.carats, 0);

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

  const lotColumns: Column<AgingLotRow>[] = [
    { key: "lotId", header: "Lot ID", sortable: true, sortValue: (r) => r.lotId, cell: (r) => <span className="font-mono text-[11px]">{r.lotId}</span> },
    { key: "ageDays", header: "Age (days)", sortable: true, sortValue: (r) => r.ageDays, align: "right", cell: (r) => <NumberCell value={r.ageDays} intent={r.ageDays >= 365 ? "critical" : r.ageDays >= 91 ? "warning" : undefined} /> },
    { key: "bucket", header: "Bucket", align: "center", cell: (r) => <span className="text-[11px]">{r.bucket}</span> },
    { key: "lab", header: "Lab", align: "center", cell: (r) => <span className="text-[11px]">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", align: "center", cell: (r) => <span className="text-[11px]">{r.shape ?? "—"}</span> },
    { key: "weight", header: "Carats", sortable: true, sortValue: (r) => r.weight, align: "right", cell: (r) => <NumberCell value={r.weight} /> },
    { key: "country", header: "Location", align: "center", cell: (r) => <span className="text-[11px]">{r.country} / {r.branch}</span> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Stock Aging"
        subtitle="Polished inventory age buckets — pieces, carats and slow-moving exposure"
        meta={<span className="text-[10px] text-muted-foreground">{totalPieces} pcs · {totalCarats.toFixed(2)} ct total in stock</span>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Pieces" value={totalPieces} unit="pcs" intent="info" hint="Polished inventory" icon={Gem} sparkline={piecesSpark} />
        <KpiCard label="Total Carats" value={totalCarats.toFixed(2)} unit="ct" intent="default" hint="Σ weights" icon={Diamond} sparkline={caratsSpark} />
        <KpiCard label="Slow-Moving (91D+)" value={data?.slowMoving ?? 0} unit="pcs" intent="warning" hint="Pieces aged 91+ days" icon={CalendarClock} />
        <KpiCard label="Slow-Moving %" value={`${(data?.slowMovingPct ?? 0).toFixed(1)}%`} intent={Number(data?.slowMovingPct ?? 0) > 30 ? "critical" : "warning"} hint="Slow-moving / total pieces" icon={TrendingUp} />
      </div>

      <Section title="Aging Buckets" description="Polished lot count and carats by age bucket">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="agingPiecesGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.3} />
                </linearGradient>
                <linearGradient id="agingCaratsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="url(#agingPiecesGrad)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="carats" name="Carats" fill="url(#agingCaratsGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section
        title="Aging Buckets Detail"
        description="Sortable age bucket breakdown — click a bucket to filter the lot list below"
      >
        <DataTable<AgingBucket>
          columns={columns}
          rows={data?.buckets ?? []}
          loading={isLoading}
          emptyMessage="No aging data available."
          initialSortKey="label"
          initialSortDir="asc"
          exportable
          exportPermission="analysis.export"
          exportFilename="stock-aging.csv"
          onRowClick={(r) => setBucket(bucket === r.label ? null : r.label)}
          rowClassName={(r) => (bucket === r.label ? "bg-sky-500/10" : "")}
          maxHeight="400px"
        />
      </Section>

      <Section
        title={bucket ? `Lots aged ${bucket} days` : "Polished Lots by Age"}
        description="Oldest first — one server page at a time"
      >
        <DataTable<AgingLotRow>
          columns={lotColumns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No lots for the current filters."
          exportable
          exportPermission="analysis.export"
          exportFilename="stock-aging-lots.csv"
          exportScope="current-page"
          maxHeight="420px"
        />
        <ServerPagination
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 50}
          total={data?.total ?? 0}
          hasMore={data?.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="polished lots"
        />
      </Section>
    </div>
  );
}
