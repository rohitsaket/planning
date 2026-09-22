"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  Cell,
} from "recharts";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertOctagon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { KpiGridSkeleton, ChartSkeleton, TableSkeleton } from "@/components/diamond/shared/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Severity = "HIGH" | "MEDIUM" | "LOW";
type AnomalyType = "SPIKE" | "DROP";

interface AnomalyRow {
  category: string;
  metric: string;
  observed: number;
  expected: number;
  deviation: number;
  zScore: number;
  severity: Severity;
  type: AnomalyType;
  description: string;
  recommendedAction: string;
}

interface AnomalySummary {
  totalAnomalies: number;
  spikes: number;
  drops: number;
  highSeverity: number;
}

interface AnomalyResponse {
  rows: AnomalyRow[];
  summary: AnomalySummary;
  windowStart: string;
  latestMonthEnd: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SEVERITY_COLORS: Record<Severity, string> = {
  HIGH: "#ef4444",
  MEDIUM: "#f59e0b",
  LOW: "#0ea5e9",
};

const TYPE_COLORS: Record<AnomalyType, string> = {
  SPIKE: "#10b981",
  DROP: "#f43f5e",
};

function severityIntent(s: Severity): "default" | "critical" | "warning" | "info" {
  return s === "HIGH" ? "critical" : s === "MEDIUM" ? "warning" : "info";
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function AnomalyDetectionView() {
  const { data, isLoading } = useApi<AnomalyResponse>("/api/analysis/anomalies");
  const rows = data?.rows ?? [];
  const summary = data?.summary;

  // Sparklines
  const totalSpark = useMemo(() => {
    const slice = rows.slice(0, 7).map((r) => Math.abs(r.zScore));
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [rows]);
  const spikesSpark = useMemo(() => {
    const slice = rows.filter((r) => r.type === "SPIKE").slice(0, 7).map((r) => r.observed);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [rows]);
  const dropsSpark = useMemo(() => {
    const slice = rows.filter((r) => r.type === "DROP").slice(0, 7).map((r) => r.observed);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [rows]);
  const highSpark = useMemo(() => {
    const slice = rows.filter((r) => r.severity === "HIGH").slice(0, 7).map((r) => Math.abs(r.zScore));
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [rows]);

  // Scatter data: x=expected, y=observed, colored by severity
  const scatterData = useMemo(
    () =>
      rows.map((r) => ({
        x: Number(r.expected.toFixed(2)),
        y: Number(r.observed.toFixed(2)),
        z: 120,
        label: r.category,
        severity: r.severity,
        type: r.type,
        zScore: r.zScore,
      })),
    [rows]
  );

  // Chart domains
  const maxX = useMemo(() => {
    if (rows.length === 0) return 10;
    return Math.max(10, ...rows.map((r) => r.expected)) * 1.1;
  }, [rows]);
  const maxY = useMemo(() => {
    if (rows.length === 0) return 10;
    return Math.max(10, ...rows.map((r) => r.observed)) * 1.1;
  }, [rows]);

  // Table columns
  const columns: Column<AnomalyRow>[] = [
    {
      key: "category",
      header: "Category",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.category,
      cell: (r) => (
        <span className="font-mono text-[11px]">{r.category}</span>
      ),
    },
    {
      key: "metric",
      header: "Metric",
      cell: (r) => <span className="text-[10px] text-muted-foreground">{r.metric}</span>,
    },
    {
      key: "type",
      header: "Type",
      align: "center",
      sortable: true,
      sortValue: (r) => r.type,
      cell: (r) => (
        <Badge
          variant={r.type === "SPIKE" ? "success" : "critical"}
          className="gap-1"
        >
          {r.type === "SPIKE" ? (
            <TrendingUp className="h-2.5 w-2.5" />
          ) : (
            <TrendingDown className="h-2.5 w-2.5" />
          )}
          {r.type}
        </Badge>
      ),
    },
    {
      key: "observed",
      header: "Observed",
      align: "right",
      sortable: true,
      sortValue: (r) => r.observed,
      cell: (r) => (
        <NumberCell
          value={r.observed}
          intent={r.type === "SPIKE" ? "warning" : "critical"}
        />
      ),
    },
    {
      key: "expected",
      header: "Expected",
      align: "right",
      sortable: true,
      sortValue: (r) => r.expected,
      cell: (r) => <NumberCell value={r.expected} decimals={1} />,
    },
    {
      key: "deviation",
      header: "Deviation %",
      align: "right",
      sortable: true,
      sortValue: (r) => r.deviation,
      cell: (r) => (
        <span
          className={cn(
            "tabular-nums font-medium",
            r.deviation > 0 ? "text-emerald-600 dark:text-emerald-400" :
            r.deviation < 0 ? "text-rose-600 dark:text-rose-400" :
            "text-muted-foreground"
          )}
        >
          {r.deviation > 0 ? "+" : ""}{(r.deviation * 100).toFixed(1)}%
        </span>
      ),
    },
    {
      key: "zScore",
      header: "Z-Score",
      align: "right",
      sortable: true,
      sortValue: (r) => r.zScore,
      cell: (r) => (
        <span
          className={cn(
            "tabular-nums font-semibold",
            Math.abs(r.zScore) > 3 ? "text-rose-600 dark:text-rose-400" :
            Math.abs(r.zScore) > 2.5 ? "text-amber-600 dark:text-amber-400" :
            "text-sky-600 dark:text-sky-400"
          )}
        >
          {r.zScore > 0 ? "+" : ""}{r.zScore.toFixed(2)}
        </span>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      align: "center",
      sortable: true,
      sortValue: (r) => r.severity,
      cell: (r) => (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
          style={{
            color: SEVERITY_COLORS[r.severity],
            borderColor: SEVERITY_COLORS[r.severity] + "55",
            backgroundColor: SEVERITY_COLORS[r.severity] + "15",
          }}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {r.severity}
        </span>
      ),
    },
    {
      key: "description",
      header: "Description",
      cell: (r) => (
        <span className="text-[11px] text-muted-foreground leading-tight block max-w-[280px]">
          {r.description}
        </span>
      ),
    },
    {
      key: "recommendedAction",
      header: "Recommended Action",
      cell: (r) => (
        <span className="text-[11px] text-muted-foreground leading-tight block max-w-[280px]">
          {r.recommendedAction}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Anomaly Detection"
        subtitle="Statistical anomalies in sales velocity — advisory, not confirmed demand"
        meta={
          data ? (
            <span className="text-[10px] text-muted-foreground">
              Window: {fmtDate(data.windowStart)} → {fmtDate(data.latestMonthEnd)}
            </span>
          ) : null
        }
      />

      <InfoBanner variant="warning">
        <div className="flex items-start gap-2">
          <AlertOctagon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <strong>Advisory only.</strong> Anomaly detection flags statistical outliers for investigation. Never auto-trigger production orders based on anomalies.
          </div>
        </div>
      </InfoBanner>

      {isLoading && !data ? (
        <div className="flex flex-col gap-3">
          <KpiGridSkeleton count={4} />
          <ChartSkeleton />
          <TableSkeleton rows={6} cols={7} />
        </div>
      ) : (
        <>
      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard
          label="Total Anomalies"
          value={summary?.totalAnomalies ?? 0}
          unit="flags"
          intent={(summary?.totalAnomalies ?? 0) > 0 ? "warning" : "success"}
          icon={AlertTriangle}
          hint="Across all planning categories"
          sparkline={totalSpark}
        />
        <KpiCard
          label="Spikes"
          value={summary?.spikes ?? 0}
          unit="↑"
          intent="success"
          icon={TrendingUp}
          hint="z-score > 2 (above expected)"
          sparkline={spikesSpark}
        />
        <KpiCard
          label="Drops"
          value={summary?.drops ?? 0}
          unit="↓"
          intent="critical"
          icon={TrendingDown}
          hint="z-score < -2 (below expected)"
          sparkline={dropsSpark}
        />
        <KpiCard
          label="High Severity"
          value={summary?.highSeverity ?? 0}
          unit="|z|>3"
          intent={(summary?.highSeverity ?? 0) > 0 ? "critical" : "success"}
          icon={AlertTriangle}
          hint="Investigate immediately"
          sparkline={highSpark}
        />
      </div>

      {/* Scatter plot: expected (x) vs observed (y) */}
      <Section
        title="Expected vs Observed Sales Velocity"
        description="Each point = one planning category anomaly. Points above the diagonal y=x are spikes (observed > expected); below are drops. Color = severity."
        actions={
          <Badge variant="info" className="gap-1">
            <Activity className="h-2.5 w-2.5" /> {scatterData.length} points
          </Badge>
        }
      >
        <div className="h-80">
          {scatterData.length === 0 ? (
            <EmptyState
              title="No anomalies detected"
              message="No planning categories exceeded the z-score threshold of |2| in the latest month."
              icon={<Activity className="h-8 w-8" />}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  type="number"
                  dataKey="x"
                  name="Expected"
                  tick={{ fontSize: 10 }}
                  domain={[0, maxX]}
                  label={{ value: "Expected (pcs)", position: "insideBottom", offset: -12, fontSize: 10 }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  name="Observed"
                  tick={{ fontSize: 10 }}
                  domain={[0, maxY]}
                  label={{ value: "Observed (pcs)", angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <ZAxis type="number" dataKey="z" range={[120, 120]} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, name: string) =>
                    name === "Expected" || name === "Observed" ? Number(v).toFixed(1) : v
                  }
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as { label?: string; severity?: Severity; type?: AnomalyType; zScore?: number } | undefined;
                    return p?.label
                      ? `${p.label} · ${p.severity ?? ""} · ${p.type ?? ""} · z=${p.zScore?.toFixed(2) ?? ""}`
                      : "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {/* Spike region — above the diagonal */}
                <ReferenceArea
                  x1={0}
                  y1={0}
                  x2={maxX}
                  y2={0}
                  fillOpacity={0}
                />
                <ReferenceLine
                  segment={[{ x: 0, y: 0 }, { x: maxX, y: maxX }]}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: "y = x (expected)", position: "top", fontSize: 9, fill: "#94a3b8" }}
                />
                <Scatter name="Anomalies" data={scatterData}>
                  {scatterData.map((p, i) => (
                    <Cell
                      key={i}
                      fill={SEVERITY_COLORS[p.severity]}
                      fillOpacity={0.7}
                      stroke={p.type === "SPIKE" ? "#065f46" : "#9f1239"}
                      strokeWidth={p.type === "SPIKE" ? 1.5 : 1}
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLORS.HIGH }} /> HIGH (|z|&gt;3)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLORS.MEDIUM }} /> MEDIUM (|z|&gt;2.5)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLORS.LOW }} /> LOW (|z|&gt;2)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" /> Reference y = x
          </span>
        </div>
      </Section>

      {/* Anomalies table */}
      <Section
        title="Detected Anomalies"
        description="Sortable list of all flagged categories — severity-colored rows. Investigate before acting."
        actions={
          summary ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="success" className="gap-1">
                <TrendingUp className="h-2.5 w-2.5" /> {summary.spikes} spikes
              </Badge>
              <Badge variant="critical" className="gap-1">
                <TrendingDown className="h-2.5 w-2.5" /> {summary.drops} drops
              </Badge>
            </div>
          ) : null
        }
      >
        <DataTable<AnomalyRow>
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No anomalies detected — all categories within 2 standard deviations of their baseline."
          initialSortKey="zScore"
          initialSortDir="desc"
          searchable
          searchPlaceholder="Search category, type, severity..."
          searchFn={(r, q) => {
            const lq = q.toLowerCase();
            return (
              r.category.toLowerCase().includes(lq) ||
              r.metric.toLowerCase().includes(lq) ||
              r.type.toLowerCase().includes(lq) ||
              r.severity.toLowerCase().includes(lq) ||
              r.description.toLowerCase().includes(lq)
            );
          }}
          exportable
          exportPermission="analysis.export"
          exportFilename="anomaly-detection.csv"
          rowClassName={(r) => {
            if (r.severity === "HIGH") return "bg-rose-50/50 dark:bg-rose-950/20";
            if (r.severity === "MEDIUM") return "bg-amber-50/50 dark:bg-amber-950/20";
            return "bg-sky-50/40 dark:bg-sky-950/20";
          }}
          maxHeight="600px"
        />
      </Section>

      {/* Methodology footnote */}
      <Section title="Methodology" description="How anomalies are computed">
        <div className="text-[11px] text-muted-foreground space-y-1.5 leading-relaxed">
          <p>
            <strong className="text-foreground">Baseline:</strong> For each planning category
            (lab | shape | weightBand), the trailing 11 calendar months of invoiced sales
            pieces (excluding the latest month) are used to compute the mean and standard
            deviation.
          </p>
          <p>
            <strong className="text-foreground">Detection:</strong> The latest month&apos;s
            observed count is converted to a z-score = (observed − mean) / std-dev. A
            category is flagged when |z-score| &gt; 2.
          </p>
          <p>
            <strong className="text-foreground">Classification:</strong> z &gt; 2 → SPIKE
            (above expected), z &lt; −2 → DROP (below expected). Severity:
            <span className="text-rose-600 dark:text-rose-400"> HIGH (|z|&gt;3)</span>,
            <span className="text-amber-600 dark:text-amber-400"> MEDIUM (|z|&gt;2.5)</span>,
            <span className="text-sky-600 dark:text-sky-400"> LOW (|z|&gt;2)</span>.
          </p>
          <p>
            <strong className="text-foreground">Deviation %</strong> = (observed − expected) /
            expected — relative change vs baseline mean.
          </p>
        </div>
      </Section>
        </>
      )}
    </div>
  );
}
