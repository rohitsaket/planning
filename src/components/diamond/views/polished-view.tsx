"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, Money, InfoBanner } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { useGlobalFilter } from "@/stores/global-filter";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Gem, Diamond, Layers } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface PolishedRow {
  dimension: string;
  pieces: number;
  carats: number;
  /** null when no approved valuation model can price these stones. */
  estimatedValue: number | null;
  valuedPieces: number;
  unvaluedPieces: number;
}

interface AgingBucketRow {
  label: string;
  pieces: number;
  carats: number;
}

interface ValuationState {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  reason: string;
  message: string;
  modelVersion: string | null;
  effectiveDate: string | null;
  currency: string | null;
  priceSource: string | null;
  isEstimate: boolean;
}

interface PolishedDetailRow {
  id: string;
  fantasyLotId: string;
  planningClass: string;
  fantasyStatus: string;
  lab: string | null;
  shape: string;
  weightBand: string | null;
  weight: number;
  color: string | null;
  clarity: string | null;
  country: string;
  branch: string;
  lastUpdated: string;
  estimatedValue: number | null;
}

interface PolishedResponse {
  dimension: string;
  rows: PolishedRow[];
  aging: AgingBucketRow[];
  slowMoving: number;
  slowMovingPct: number;
  summary: {
    pieces: number;
    carats: number;
    estimatedValue: number | null;
    valuedPieces: number;
    unvaluedPieces: number;
  };
  valuation: ValuationState;
  detail: PolishedDetailRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const DIMENSIONS = [
  { value: "planningClass", label: "Planning Class" },
  { value: "lab", label: "Lab" },
  { value: "shape", label: "Shape" },
  { value: "weightBand", label: "Weight Band" },
  { value: "country", label: "Country" },
  { value: "branch", label: "Branch" },
  { value: "treatment", label: "Treatment" },
  { value: "fantasyStatus", label: "Fantasy Status" },
];

export function PolishedView() {
  const [dimension, setDimension] = useState("planningClass");
  const [page, setPage] = useState(1);
  const globalFilter = useGlobalFilter();

  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set("dimension", dimension);
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return `/api/analysis/polished?${params.toString()}`;
  }, [dimension, globalFilter.country, globalFilter.branch, globalFilter.lab, page]);

  const { data, isLoading } = useApi<PolishedResponse>(url);

  // A changed filter or dimension is a different dataset: restart at page one.
  const filterKey = `${dimension}|${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}|${globalFilter.lab ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const aging = data?.aging ?? [];
  const agingData = aging.map((b) => ({ name: b.label, pieces: b.pieces }));
  const valuationAvailable = data?.valuation.status === "CONFIGURED";

  // Sparklines are drawn only from real data — never from synthetic filler.
  const piecesSpark = useMemo(() => (aging.length >= 2 ? aging.map((b) => b.pieces) : undefined), [aging]);
  const caratsSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.carats);
    return slice.length >= 2 ? slice : undefined;
  }, [rows]);
  const dimPiecesSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => r.pieces);
    return slice.length >= 2 ? slice : undefined;
  }, [rows]);

  const columns: Column<PolishedRow>[] = [
    {
      key: "dimension", header: "Dimension", sortable: true, sortValue: (r) => r.dimension,
      cell: (r) => <span className="font-medium">{r.dimension}</span>, sticky: "left",
    },
    { key: "pieces", header: "Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right",
      cell: (r) => <NumberCell value={r.pieces} /> },
    { key: "carats", header: "Carats", sortable: true, sortValue: (r) => r.carats, align: "right",
      cell: (r) => <NumberCell value={r.carats} /> },
    {
      key: "estimatedValue",
      header: valuationAvailable ? `Estimated Value (${data?.valuation.currency ?? "USD"})` : "Estimated Value",
      sortable: true,
      sortValue: (r) => r.estimatedValue ?? -1,
      align: "right",
      exportValue: (r) => (r.estimatedValue === null ? "UNAVAILABLE" : r.estimatedValue),
      cell: (r) =>
        r.estimatedValue === null ? (
          <span className="text-[10px] font-mono text-muted-foreground">UNAVAILABLE</span>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <Money value={r.estimatedValue} />
            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-mono">EST</span>
          </div>
        ),
    },
  ];

  const detailColumns: Column<PolishedDetailRow>[] = [
    { key: "fantasyLotId", header: "Lot ID", sortable: true, sortValue: (r) => r.fantasyLotId, cell: (r) => <span className="font-mono text-[11px]">{r.fantasyLotId}</span> },
    { key: "planningClass", header: "Class", cell: (r) => <span className="text-[11px]">{r.planningClass}</span> },
    { key: "lab", header: "Lab", cell: (r) => <span className="text-[11px]">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", cell: (r) => <span className="text-[11px]">{r.shape}</span> },
    { key: "weightBand", header: "Weight Band", cell: (r) => <span className="text-[11px]">{r.weightBand ?? "—"}</span> },
    { key: "weight", header: "Carats", align: "right", sortable: true, sortValue: (r) => r.weight, cell: (r) => <NumberCell value={r.weight} /> },
    { key: "country", header: "Location", cell: (r) => <span className="text-[11px]">{r.country} / {r.branch}</span> },
    {
      key: "estimatedValue",
      header: "Est. Value",
      align: "right",
      exportValue: (r) => (r.estimatedValue === null ? "UNAVAILABLE" : r.estimatedValue),
      cell: (r) => (r.estimatedValue === null ? <span className="text-[10px] font-mono text-muted-foreground">—</span> : <Money value={r.estimatedValue} />),
    },
    { key: "lastUpdated", header: "Last Updated", sortable: true, sortValue: (r) => r.lastUpdated, cell: (r) => <span className="text-[11px]">{new Date(r.lastUpdated).toLocaleDateString()}</span> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Polished Stock Analysis"
        subtitle="Physical polished inventory by dimension with aging buckets — Fantasy is the authoritative source"
        actions={
          <Select value={dimension} onValueChange={setDimension}>
            <SelectTrigger size="sm" className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="Dimension" />
            </SelectTrigger>
            <SelectContent>
              {DIMENSIONS.map((d) => (
                <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
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
            <span className="text-[10px] text-muted-foreground">Dimension: {DIMENSIONS.find((d) => d.value === dimension)?.label}</span>
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                valuationAvailable
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              Valuation: {valuationAvailable ? `${data?.valuation.modelVersion} (estimate)` : "NOT_CONFIGURED"}
            </span>
          </div>
        }
      />

      {data?.valuation && (
        <InfoBanner variant={valuationAvailable ? "info" : "warning"}>{data.valuation.message}</InfoBanner>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <KpiCard label="Total Pieces" value={data?.summary.pieces ?? 0} unit="pcs" intent="info" hint="Polished lots matching the filters" icon={Gem} sparkline={piecesSpark} />
        <KpiCard label="Total Carats" value={(data?.summary.carats ?? 0).toFixed(2)} unit="ct" intent="default" hint="Σ weight" icon={Diamond} sparkline={caratsSpark} />
        <KpiCard
          label="Estimated Value"
          value={valuationAvailable && data?.summary.estimatedValue !== null ? (data?.summary.estimatedValue ?? 0) : "UNAVAILABLE"}
          unit={valuationAvailable ? data?.valuation.currency ?? "USD" : undefined}
          intent={valuationAvailable ? "success" : "warning"}
          hint={valuationAvailable ? `${data?.summary.valuedPieces ?? 0} of ${data?.summary.pieces ?? 0} pieces priced by the model` : "No approved valuation model configured"}
          icon={Layers}
        />
        <KpiCard label="Dimensions Distinct" value={rows.length} intent="success" hint={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label}`} icon={Layers} sparkline={dimPiecesSpark} />
      </div>

      <Section title="Aging Buckets" description="Polished lot count by days since last update">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agingData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <defs>
                <linearGradient id="polishedAgingGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.3} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="url(#polishedAgingGrad)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label}`} description="Sortable breakdown with pieces, carats and — when an approved model exists — estimated value">
        <DataTable<PolishedRow>
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No polished stock data available."
          initialSortKey="pieces"
          initialSortDir="desc"
          exportable
          exportPermission="analysis.export"
          exportFilename={`polished-${dimension}.csv`}
          searchable
          searchPlaceholder="Search dimension..."
          searchFn={(r, q) => r.dimension.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>

      <Section title="Polished Lots" description="Individual lots for the current filters">
        <DataTable<PolishedDetailRow>
          columns={detailColumns}
          rows={data?.detail ?? []}
          loading={isLoading}
          emptyMessage="No polished lots for the current filters."
          exportable
          exportPermission="analysis.export"
          exportFilename="polished-lots.csv"
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
