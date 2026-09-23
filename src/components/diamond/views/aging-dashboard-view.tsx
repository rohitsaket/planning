"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { InfoBanner, Money, NumberCell, EmptyState } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  Gem, Diamond, DollarSign, AlertTriangle, Clock, CalendarClock, TrendingDown,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface AgingSummary {
  totalPieces: number;
  totalCarats: number;
  /** null when no approved valuation model can price the stock. */
  totalValue: number | null;
  valuedPieces: number;
  unvaluedPieces: number;
  slowMovingPieces: number;
  slowMovingPct: number;
  agedPieces: number;
  agedPct: number;
  avgAgeDays: number;
}

interface ValuationState {
  status: "CONFIGURED" | "NOT_CONFIGURED";
  reason: string;
  message: string;
  modelVersion: string | null;
  currency: string | null;
  priceSource: string | null;
  isEstimate: boolean;
}

interface AgingBucket {
  label: string;
  pieces: number;
  carats: number;
  value: number | null;
  valuedPieces: number;
  pct: number;
}

interface DimAgg {
  totalPieces: number;
  slowMoving: number;
  aged: number;
}
interface CountryAgg extends DimAgg { country: string; }
interface LabAgg extends DimAgg { lab: string; }
interface ShapeAgg extends DimAgg { shape: string; }
interface SlowAlert {
  lotId: string;
  ageDays: number;
  country: string;
  branch: string;
  value: number | null;
  shape: string;
  weight: number;
}

interface AgingDashboardResponse {
  summary: AgingSummary;
  valuation: ValuationState;
  buckets: AgingBucket[];
  byCountry: CountryAgg[];
  byLab: LabAgg[];
  byShape: ShapeAgg[];
  slowMovingAlerts: SlowAlert[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/* Color palette per age bucket                                       */
/* ------------------------------------------------------------------ */
// 0-90 days  -> emerald (fresh)
// 91-180     -> amber  (slow-moving)
// 181+       -> rose   (aged / stale)
const BUCKET_COLORS: Record<string, string> = {
  "0-30": "#10b981",
  "31-60": "#10b981",
  "61-90": "#10b981",
  "91-180": "#f59e0b",
  "181-365": "#f43f5e",
  "365+": "#b91c1c",
};

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */
export function AgingDashboardView() {
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    params.set("page", String(page));
    params.set("pageSize", "25");
    return `/api/analysis/aging-dashboard?${params.toString()}`;
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, page]);
  const { data, isLoading } = useApi<AgingDashboardResponse>(url);

  const filterKey = `${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}|${globalFilter.lab ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }
  const valuationAvailable = data?.valuation.status === "CONFIGURED";

  const summary = data?.summary;
  const buckets = data?.buckets ?? [];
  const byCountry = data?.byCountry ?? [];
  const byLab = data?.byLab ?? [];
  const byShape = data?.byShape ?? [];
  const alerts = data?.slowMovingAlerts ?? [];

  const piecesSpark = buckets.map((b) => b.pieces);
  const valueSpark = valuationAvailable ? buckets.map((b) => b.value ?? 0) : undefined;
  const slowSpark = alerts.slice(0, 7).map((a) => a.ageDays);

  // Pie data — non-empty buckets only
  const pieData = buckets
    .filter((b) => (b.value ?? 0) > 0)
    .map((b) => ({ name: b.label, value: b.value ?? 0, pct: b.pct }));

  /* --------------------- By Country table ------------------------ */
  const countryColumns: Column<CountryAgg>[] = [
    {
      key: "country", header: "Country", sortable: true, sortValue: (r) => r.country, sticky: "left",
      cell: (r) => <span className="font-medium">{r.country}</span>,
    },
    {
      key: "totalPieces", header: "Total Pieces", sortable: true, sortValue: (r) => r.totalPieces, align: "right",
      cell: (r) => <NumberCell value={r.totalPieces} />,
    },
    {
      key: "slowMoving", header: "Slow-Moving", sortable: true, sortValue: (r) => r.slowMoving, align: "right",
      cell: (r) => <NumberCell value={r.slowMoving} intent={r.slowMoving > 0 ? "warning" : "default"} />,
    },
    {
      key: "aged", header: "Aged (365+)", sortable: true, sortValue: (r) => r.aged, align: "right",
      cell: (r) => <NumberCell value={r.aged} intent={r.aged > 0 ? "critical" : "default"} />,
    },
    {
      key: "slowPct", header: "Slow-Moving %", sortable: true, sortValue: (r) => r.slowMoving / Math.max(1, r.totalPieces), align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.totalPieces > 0 ? ((r.slowMoving / r.totalPieces) * 100).toFixed(1) : "0.0"}%
        </span>
      ),
    },
  ];

  /* --------------------- By Lab table ---------------------------- */
  const labColumns: Column<LabAgg>[] = [
    {
      key: "lab", header: "Lab", sortable: true, sortValue: (r) => r.lab, sticky: "left",
      cell: (r) => <span className="font-medium">{r.lab}</span>,
    },
    {
      key: "totalPieces", header: "Total Pieces", sortable: true, sortValue: (r) => r.totalPieces, align: "right",
      cell: (r) => <NumberCell value={r.totalPieces} />,
    },
    {
      key: "slowMoving", header: "Slow-Moving", sortable: true, sortValue: (r) => r.slowMoving, align: "right",
      cell: (r) => <NumberCell value={r.slowMoving} intent={r.slowMoving > 0 ? "warning" : "default"} />,
    },
    {
      key: "aged", header: "Aged (365+)", sortable: true, sortValue: (r) => r.aged, align: "right",
      cell: (r) => <NumberCell value={r.aged} intent={r.aged > 0 ? "critical" : "default"} />,
    },
    {
      key: "slowPct", header: "Slow-Moving %", sortable: true, sortValue: (r) => r.slowMoving / Math.max(1, r.totalPieces), align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.totalPieces > 0 ? ((r.slowMoving / r.totalPieces) * 100).toFixed(1) : "0.0"}%
        </span>
      ),
    },
  ];

  /* --------------------- By Shape table -------------------------- */
  const shapeColumns: Column<ShapeAgg>[] = [
    {
      key: "shape", header: "Shape", sortable: true, sortValue: (r) => r.shape, sticky: "left",
      cell: (r) => <span className="font-medium">{r.shape}</span>,
    },
    {
      key: "totalPieces", header: "Total Pieces", sortable: true, sortValue: (r) => r.totalPieces, align: "right",
      cell: (r) => <NumberCell value={r.totalPieces} />,
    },
    {
      key: "slowMoving", header: "Slow-Moving", sortable: true, sortValue: (r) => r.slowMoving, align: "right",
      cell: (r) => <NumberCell value={r.slowMoving} intent={r.slowMoving > 0 ? "warning" : "default"} />,
    },
    {
      key: "aged", header: "Aged (365+)", sortable: true, sortValue: (r) => r.aged, align: "right",
      cell: (r) => <NumberCell value={r.aged} intent={r.aged > 0 ? "critical" : "default"} />,
    },
    {
      key: "slowPct", header: "Slow-Moving %", sortable: true, sortValue: (r) => r.slowMoving / Math.max(1, r.totalPieces), align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          {r.totalPieces > 0 ? ((r.slowMoving / r.totalPieces) * 100).toFixed(1) : "0.0"}%
        </span>
      ),
    },
  ];

  /* --------------------- Slow-moving alerts table ---------------- */
  const alertColumns: Column<SlowAlert>[] = [
    {
      key: "lotId", header: "Lot ID", sortable: true, sortValue: (r) => r.lotId, sticky: "left",
      cell: (r) => <span className="font-mono text-[11px]">{r.lotId}</span>,
    },
    {
      key: "ageDays", header: "Age (days)", sortable: true, sortValue: (r) => r.ageDays, align: "right",
      cell: (r) => (
        <span className={`tabular-nums font-semibold ${r.ageDays >= 365 ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>
          {r.ageDays}
        </span>
      ),
    },
    {
      key: "country", header: "Country", sortable: true, sortValue: (r) => r.country,
      cell: (r) => <span>{r.country}</span>,
    },
    {
      key: "shape", header: "Shape", sortable: true, sortValue: (r) => r.shape,
      cell: (r) => <span>{r.shape}</span>,
    },
    {
      key: "weight", header: "Weight (ct)", sortable: true, sortValue: (r) => r.weight, align: "right",
      cell: (r) => <NumberCell value={r.weight} decimals={2} />,
    },
    {
      key: "value", header: "Est. Value", sortable: true, sortValue: (r) => r.value ?? -1, align: "right",
      exportValue: (r) => (r.value === null ? "UNAVAILABLE" : r.value),
      cell: (r) => (r.value === null ? <span className="text-[10px] font-mono text-muted-foreground">—</span> : <Money value={r.value} />),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Inventory Aging Dashboard"
        subtitle="Stock age analysis — slow-moving and aged inventory detection"
        meta={
          summary ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {summary.totalPieces} pcs · {summary.totalCarats.toFixed(2)} ct · avg age {summary.avgAgeDays}d
            </span>
          ) : null
        }
      />

      <InfoBanner variant="info">
        Stock aging helps identify slow-moving and aged inventory for transfer, discount, or repurposing decisions.
        Slow-moving = 91+ days, Aged = 365+ days.
      </InfoBanner>

      {data?.valuation && !valuationAvailable && (
        <InfoBanner variant="warning">{data.valuation.message}</InfoBanner>
      )}

      {/* Summary KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <KpiCard
          label="Total Pieces"
          value={summary?.totalPieces ?? 0}
          unit="pcs"
          intent="info"
          hint="Polished inventory"
          icon={Gem}
          sparkline={piecesSpark.length >= 2 ? piecesSpark : [1, 2, 3, 4, 5]}
        />
        <KpiCard
          label="Total Carats"
          value={(summary?.totalCarats ?? 0).toFixed(2)}
          unit="ct"
          intent="default"
          hint="Σ weights"
          icon={Diamond}
          sparkline={piecesSpark.length >= 2 ? piecesSpark : [1, 2, 3, 4, 5]}
        />
        <KpiCard
          label="Total Value"
          value={
            !valuationAvailable || summary?.totalValue == null
              ? "UNAVAILABLE"
              : summary.totalValue >= 1000
              ? `${(summary.totalValue / 1000).toFixed(1)}K`
              : summary.totalValue.toFixed(0)
          }
          unit={valuationAvailable ? data?.valuation.currency ?? "USD" : undefined}
          intent={valuationAvailable ? "success" : "warning"}
          hint={
            valuationAvailable
              ? `Estimate from ${data?.valuation.modelVersion} · ${summary?.valuedPieces ?? 0} of ${summary?.totalPieces ?? 0} pieces priced`
              : "No approved valuation model configured"
          }
          icon={DollarSign}
          sparkline={valueSpark && valueSpark.length >= 2 ? valueSpark : undefined}
        />
        <KpiCard
          label="Slow-Moving"
          value={summary?.slowMovingPieces ?? 0}
          unit="pcs"
          intent={Number(summary?.slowMovingPieces ?? 0) > 0 ? "warning" : "default"}
          hint={`91+ days · ${Number(summary?.slowMovingPct ?? 0).toFixed(1)}% of stock`}
          icon={TrendingDown}
          sparkline={slowSpark.length >= 2 ? slowSpark : [1, 2, 3, 4, 5]}
        />
        <KpiCard
          label="Aged"
          value={summary?.agedPieces ?? 0}
          unit="pcs"
          intent={Number(summary?.agedPieces ?? 0) > 0 ? "critical" : "default"}
          hint={`365+ days · ${Number(summary?.agedPct ?? 0).toFixed(1)}% of stock`}
          icon={AlertTriangle}
          sparkline={slowSpark.length >= 2 ? slowSpark : [1, 2, 3, 4, 5]}
        />
        <KpiCard
          label="Avg Age"
          value={summary?.avgAgeDays ?? 0}
          unit="days"
          intent="info"
          hint="Mean across all stones"
          icon={Clock}
          sparkline={piecesSpark.length >= 2 ? piecesSpark : [1, 2, 3, 4, 5]}
        />
      </div>

      {/* Aging distribution bar chart */}
      <Section
        title="Aging Distribution"
        description="Piece count by age bucket — emerald = fresh (0-90d), amber = slow-moving (91-180d), rose = aged (181+d)"
      >
        <div className="h-72">
          {buckets.length === 0 ? (
            <EmptyState title="No aging data" message="Polished stock has not been loaded yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                <defs>
                  <linearGradient id="ageEmerald" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="ageAmber" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="ageRose" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n: string) => [`${v} ${n === "pieces" ? "pcs" : ""}`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="pieces" name="Pieces" radius={[6, 6, 0, 0]}>
                  {buckets.map((b) => (
                    <Cell
                      key={b.label}
                      fill={
                        b.label === "0-30" || b.label === "31-60" || b.label === "61-90"
                          ? "url(#ageEmerald)"
                          : b.label === "91-180"
                          ? "url(#ageAmber)"
                          : "url(#ageRose)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>

      {/* Value at Risk pie chart */}
      <Section
        title="Value at Risk"
        description="Estimated value distribution across age buckets — how much capital is locked in aged stock"
      >
        <div className="h-72">
          {pieData.length === 0 ? (
            <EmptyState title="No value data" message="No polished stock with non-zero value found." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={40}
                  paddingAngle={2}
                  label={(entry: { name?: string; pct?: number }) =>
                    `${entry.name ?? ""} (${(entry.pct ?? 0).toFixed(1)}%)`
                  }
                  labelLine={false}
                >
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={BUCKET_COLORS[d.name] ?? "#94a3b8"} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n: string) => [`$${v.toLocaleString()}`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>

      {/* Two-column By Country / By Lab tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="By Country" description="Aging breakdown by country">
          <DataTable<CountryAgg>
            columns={countryColumns}
            rows={byCountry}
            loading={isLoading}
            emptyMessage="No country data."
            initialSortKey="totalPieces"
            initialSortDir="desc"
            maxHeight="320px"
          />
        </Section>
        <Section title="By Lab" description="Aging breakdown by certification lab">
          <DataTable<LabAgg>
            columns={labColumns}
            rows={byLab}
            loading={isLoading}
            emptyMessage="No lab data."
            initialSortKey="totalPieces"
            initialSortDir="desc"
            maxHeight="320px"
          />
        </Section>
      </div>

      <Section title="By Shape" description="Aging breakdown by polished shape">
        <DataTable<ShapeAgg>
          columns={shapeColumns}
          rows={byShape}
          loading={isLoading}
          emptyMessage="No shape data."
          initialSortKey="totalPieces"
          initialSortDir="desc"
          maxHeight="400px"
          pagination
          pageSize={25}
          exportable
          exportPermission="analysis.export"
          exportFilename="aging-by-shape.csv"
          excelExportable
          excelExportFilename="aging-by-shape.xlsx"
          pdfExportable
          pdfExportFilename="aging-by-shape"
        />
      </Section>

      {/* Slow-Moving Alerts */}
      <Section
        title="Slow-Moving Alerts"
        description="Oldest lots first (91+ days) — review for transfer, discount, or repurposing"
        actions={
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
            <CalendarClock className="h-3 w-3" />
            {data?.total ?? 0} flagged
          </span>
        }
      >
        <DataTable<SlowAlert>
          columns={alertColumns}
          rows={alerts}
          loading={isLoading}
          emptyMessage="No slow-moving lots detected. All stock is fresh (< 91 days)."
          initialSortKey="ageDays"
          initialSortDir="desc"
          maxHeight="440px"
          rowClassName={(r) =>
            r.ageDays >= 365
              ? "bg-rose-50/60 dark:bg-rose-950/15"
              : r.ageDays >= 181
              ? "bg-rose-50/30 dark:bg-rose-950/10"
              : "bg-amber-50/40 dark:bg-amber-950/10"
          }
          exportable
          exportPermission="analysis.export"
          exportFilename="slow-moving-alerts.csv"
          excelExportable
          excelExportFilename="slow-moving-alerts.xlsx"
          pdfExportable
          pdfExportFilename="slow-moving-alerts"
          exportScope="current-page"
        />
        <ServerPagination
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 25}
          total={data?.total ?? 0}
          hasMore={data?.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="slow-moving lots"
        />
      </Section>
    </div>
  );
}
