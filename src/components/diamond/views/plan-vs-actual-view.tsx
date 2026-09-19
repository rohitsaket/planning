"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface YieldRow {
  planOptionCode: string | null;
  expectedPieces: number;
  actualPieces: number;
  plannedYield: number;
  actualYield: number;
  variance: number;
  expectedCoverage: number;
  actualCoverage: number;
  status: string;
}

interface Payload {
  type: string;
  rows: YieldRow[];
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function PlanVsActualView() {
  const { data, isLoading } = useApi<Payload>("/api/reports?type=yield-variance");
  const rows = data?.rows ?? [];

  const plannedAvg = avg(rows.map((r) => r.plannedYield));
  const actualAvg = avg(rows.map((r) => r.actualYield));
  const varianceAvg = avg(rows.map((r) => r.variance));
  const expCovSum = rows.reduce((a, r) => a + (r.expectedCoverage ?? 0), 0);
  const actCovSum = rows.reduce((a, r) => a + (r.actualCoverage ?? 0), 0);
  const expectedCoverageAvg = rows.length ? expCovSum / rows.length : 0;
  const actualCoverageAvg = rows.length ? actCovSum / rows.length : 0;

  const varianceIntent = varianceAvg < 0 ? "critical" : varianceAvg > 0 ? "success" : "default";

  // Chart data: only show options with valid planOptionCode
  const chartData = rows
    .filter((r) => r.planOptionCode)
    .map((r) => ({
      name: r.planOptionCode!,
      planned: Number(r.plannedYield.toFixed(2)),
      actual: Number(r.actualYield.toFixed(2)),
    }));

  const columns: Column<YieldRow>[] = [
    {
      key: "planOptionCode", header: "Plan Option", sticky: "left", sortable: true,
      sortValue: (r) => r.planOptionCode ?? "",
      cell: (r) => <span className="font-medium">{r.planOptionCode ?? "—"}</span>,
    },
    {
      key: "expectedPieces", header: "Expected", align: "right", sortable: true,
      sortValue: (r) => r.expectedPieces,
      cell: (r) => <NumberCell value={r.expectedPieces} />,
    },
    {
      key: "actualPieces", header: "Actual", align: "right", sortable: true,
      sortValue: (r) => r.actualPieces,
      cell: (r) => <NumberCell value={r.actualPieces} intent={r.actualPieces >= r.expectedPieces ? "success" : "warning"} />,
    },
    {
      key: "plannedYield", header: "Planned Yield", align: "right", sortable: true,
      sortValue: (r) => r.plannedYield,
      cell: (r) => <span className="tabular-nums">{r.plannedYield.toFixed(2)}%</span>,
    },
    {
      key: "actualYield", header: "Actual Yield", align: "right", sortable: true,
      sortValue: (r) => r.actualYield,
      cell: (r) => <span className="tabular-nums">{r.actualYield.toFixed(2)}%</span>,
    },
    {
      key: "variance", header: "Variance", align: "right", sortable: true,
      sortValue: (r) => r.variance,
      cell: (r) => (
        <span className={`tabular-nums font-medium inline-flex items-center gap-0.5 ${
          r.variance < 0 ? "text-rose-600 dark:text-rose-400" :
          r.variance > 0 ? "text-emerald-600 dark:text-emerald-400" :
          "text-muted-foreground"
        }`}>
          {r.variance < 0 ? <TrendingDown className="h-3 w-3" /> :
           r.variance > 0 ? <TrendingUp className="h-3 w-3" /> :
           <Minus className="h-3 w-3" />}
          {r.variance > 0 ? "+" : ""}{r.variance.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "expectedCoverage", header: "Expected Cov", align: "right",
      cell: (r) => <NumberCell value={r.expectedCoverage} />,
    },
    {
      key: "actualCoverage", header: "Actual Cov", align: "right",
      cell: (r) => (
        <NumberCell
          value={r.actualCoverage}
          intent={r.actualCoverage >= r.expectedCoverage ? "success" : "warning"}
        />
      ),
    },
    {
      key: "status", header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Plan vs Actual — Yield Variance"
        subtitle="Reconciliation between planned yield and actual achieved yield per plan option · Coverage gap tracking"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiCard label="Planned Yield (avg)" value={`${plannedAvg.toFixed(2)}%`} intent="info" hint="Average across all options" />
        <KpiCard label="Actual Yield (avg)" value={`${actualAvg.toFixed(2)}%`} intent={actualAvg >= plannedAvg ? "success" : "warning"} hint="Average achieved yield" />
        <KpiCard
          label="Yield Variance (avg)"
          value={`${varianceAvg > 0 ? "+" : ""}${varianceAvg.toFixed(2)}%`}
          intent={varianceIntent}
          hint="Actual − Planned (positive is better)"
        />
        <KpiCard label="Expected Coverage" value={expectedCoverageAvg.toFixed(1)} unit="pcs" intent="default" hint="Avg pieces expected per option" />
        <KpiCard
          label="Actual Coverage"
          value={actualCoverageAvg.toFixed(1)}
          unit="pcs"
          intent={actualCoverageAvg >= expectedCoverageAvg ? "success" : "warning"}
          hint="Avg pieces actually produced"
        />
      </div>

      <InfoBanner variant={varianceAvg < 0 ? "warning" : "success"}>
        <div className="flex items-center gap-2">
          {varianceAvg < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
          <span className="font-medium">
            {varianceAvg < 0 ? "Actual yield is below plan." : varianceAvg > 0 ? "Actual yield is exceeding plan." : "Yield matches plan."}
          </span>
          <span className="text-muted-foreground">
            Average variance of {varianceAvg > 0 ? "+" : ""}{varianceAvg.toFixed(2)}% across {rows.length} reconciled option{rows.length === 1 ? "" : "s"}.
          </span>
        </div>
      </InfoBanner>

      {/* Chart */}
      <Section title="Planned vs Actual Yield per Option" description="Side-by-side comparison of planned vs achieved yield percentage per plan option">
        <div className="h-72">
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
              No chart data available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={4} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" height={60} interval={0} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => `${v.toFixed(2)}%`} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="planned" name="Planned Yield" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="actual" name="Actual Yield" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Section>

      {/* Table */}
      <Section title="Reconciliation Detail" description="Per-option reconciliation: expected vs actual pieces, yield, coverage, and status">
        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No plan-actual reconciliations found."
          maxHeight="500px"
          initialSortKey="variance"
          initialSortDir="asc"
          exportable
          exportFilename="plan-vs-actual-yield-variance.csv"
          searchable
          searchPlaceholder="Search plan option code, status..."
          searchFn={(r, q) => {
            const lq = q.toLowerCase();
            return (
              (r.planOptionCode ?? "").toLowerCase().includes(lq) ||
              r.status.toLowerCase().includes(lq)
            );
          }}
        />
      </Section>
    </div>
  );
}
