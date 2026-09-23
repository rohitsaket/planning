"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ComposedChart, Bar,
} from "recharts";
import {
  History, Activity, AlertTriangle, Package, Gauge, CalendarClock, User,
} from "lucide-react";

interface DemandHistoryRow {
  id: string;
  runDate: string;
  windowDays: number;
  status: string;
  totalShortage: number;
  totalExcess: number;
  metricCount: number;
  actor: string;
}

interface DemandHistorySummary {
  totalRuns: number;
  avgShortage: number;
  avgExcess: number;
  lastRunDate: string | null;
  lastShortage: number;
  lastExcess: number;
  lastMetricCount: number;
}

interface DemandHistoryResponse {
  rows: DemandHistoryRow[];
  summary: DemandHistorySummary;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// "high" thresholds for color callouts
const SHORTAGE_HIGH = 100;
const EXCESS_HIGH = 5;

export function DemandHistoryView() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<DemandHistoryResponse>(
    `/api/demand/history?page=${page}&pageSize=50`,
  );

  const globalFilter = useGlobalFilter();
  const rawRows = data?.rows ?? [];
  const rows = useMemo(() => {
    const matching = rawRows.filter((r) => r.windowDays === globalFilter.windowDays);
    return matching.length > 0 ? matching : rawRows;
  }, [rawRows, globalFilter.windowDays]);
  const summary = data?.summary;

  // Sparkline: last 7 runs' shortage (oldest→newest). Rows come newest-first.
  const shortageSparkline = rows.slice(0, 7).reverse().map((r) => r.totalShortage);
  const excessSparkline = rows.slice(0, 7).reverse().map((r) => r.totalExcess);
  const metricsSparkline = rows.slice(0, 7).reverse().map((r) => r.metricCount);

  // Chart data — chronological order (oldest first)
  const chartData = rows
    .slice()
    .reverse()
    .map((r) => ({
      label: formatShortDate(r.runDate),
      runDate: r.runDate,
      shortage: r.totalShortage,
      excess: r.totalExcess,
      metrics: r.metricCount,
    }));

  const columns: Column<DemandHistoryRow>[] = [
    {
      key: "runDate",
      header: "Run Date",
      align: "center",
      sortable: true,
      sortValue: (r) => r.runDate,
      cell: (r) => (
        <span className="tabular-nums text-xs">{formatDateTime(r.runDate)}</span>
      ),
      width: "160px",
    },
    {
      key: "windowDays",
      header: "Window",
      sortable: true,
      sortValue: (r) => r.windowDays,
      align: "right",
      width: "80px",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.windowDays}d
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      align: "center",
      width: "110px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "totalShortage",
      header: "Total Shortage",
      sortable: true,
      sortValue: (r) => r.totalShortage,
      align: "right",
      width: "120px",
      cell: (r) => (
        <NumberCell
          value={r.totalShortage}
          intent={r.totalShortage >= SHORTAGE_HIGH ? "critical" : undefined}
        />
      ),
    },
    {
      key: "totalExcess",
      header: "Total Excess",
      sortable: true,
      sortValue: (r) => r.totalExcess,
      align: "right",
      width: "110px",
      cell: (r) => (
        <NumberCell
          value={r.totalExcess}
          intent={r.totalExcess >= EXCESS_HIGH ? "warning" : undefined}
        />
      ),
    },
    {
      key: "metricCount",
      header: "Metrics",
      sortable: true,
      sortValue: (r) => r.metricCount,
      align: "right",
      width: "90px",
      cell: (r) => <NumberCell value={r.metricCount} />,
    },
    {
      key: "actor",
      header: "Actor",
      sortable: true,
      sortValue: (r) => r.actor,
      width: "140px",
      cell: (r) => (
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <User className="h-3 w-3" />
          {r.actor}
        </span>
      ),
    },
  ];

  const lastRunMeta = summary?.lastRunDate ? (
    <span className="text-[10px] text-muted-foreground">
      Last run: {formatDateTime(summary.lastRunDate)}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Demand Run History"
        subtitle="Audit trail of past demand calculation runs — rule version, shortage, excess & actor"
        meta={lastRunMeta}
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard
          label="Total Runs"
          value={summary?.totalRuns ?? 0}
          unit="runs"
          intent="info"
          icon={History}
          hint="All recorded demand runs"
          sparkline={metricsSparkline}
        />
        <KpiCard
          label="Avg Shortage"
          value={summary?.avgShortage ?? 0}
          unit="pcs"
          intent="critical"
          icon={AlertTriangle}
          hint="Mean across all runs"
          sparkline={shortageSparkline}
        />
        <KpiCard
          label="Avg Excess"
          value={summary?.avgExcess ?? 0}
          unit="pcs"
          intent="warning"
          icon={Package}
          hint="Mean across all runs"
          sparkline={excessSparkline}
        />
        <KpiCard
          label="Last Run Shortage"
          value={summary?.lastShortage ?? 0}
          unit="pcs"
          intent={summary && summary.lastShortage >= SHORTAGE_HIGH ? "critical" : "default"}
          icon={AlertTriangle}
          hint="Most recent run"
        />
        <KpiCard
          label="Last Run Excess"
          value={summary?.lastExcess ?? 0}
          unit="pcs"
          intent={summary && summary.lastExcess >= EXCESS_HIGH ? "warning" : "default"}
          icon={Package}
          hint="Most recent run"
        />
        <KpiCard
          label="Last Run Metrics"
          value={summary?.lastMetricCount ?? 0}
          unit="cats"
          intent="default"
          icon={Gauge}
          hint="Planning categories processed"
        />
      </div>

      {/* Shortage/excess trend chart */}
      <Section
        title="Shortage & Excess Over Runs"
        description="Chronological comparison of total shortage vs excess across all recorded demand runs"
      >
        {chartData.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            No demand run history available yet. Trigger a demand calc from the dashboard to populate.
          </div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="shortageLineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={50} interval={0} />
                <YAxis yAxisId="left" tick={{ fontSize: 9 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar
                  yAxisId="right"
                  dataKey="excess"
                  name="Excess"
                  fill="#f59e0b"
                  radius={[2, 2, 0, 0]}
                  barSize={8}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="shortage"
                  name="Shortage"
                  stroke="#ef4444"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#ef4444" }}
                  activeDot={{ r: 5 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* Demand runs table */}
      <Section
        title="Demand Runs"
        description="Most recent first — click any header to sort"
        actions={
          <Badge variant="neutral" className="gap-1">
            <Activity className="h-2.5 w-2.5" />
            {data?.total ?? 0} {(data?.total ?? 0) === 1 ? "run" : "runs"}
          </Badge>
        }
      >
        <DataTable<DemandHistoryRow>
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No demand runs recorded yet. Trigger a demand calc from the Executive Dashboard."
          initialSortKey="runDate"
          initialSortDir="desc"
          exportable
          exportPermission="demand.export"
          exportFilename="demand-history.csv"
          searchable
          searchPlaceholder="Search actor, rule version, status..."
          searchFn={(r, q) =>
            `${r.actor} ${r.status} ${r.id}`.toLowerCase().includes(q.toLowerCase())
          }
          exportScope="current-page"
          maxHeight="540px"
        />
        <ServerPagination
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 50}
          total={data?.total ?? 0}
          hasMore={data?.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="demand runs"
        />
      </Section>
    </div>
  );
}
