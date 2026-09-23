"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  ErrorBar,
} from "recharts";
import {
  AlertTriangle,
  TrendingUp,
  Activity,
  Layers,
  AlertOctagon,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { KpiGridSkeleton, ChartSkeleton, TableSkeleton } from "@/components/diamond/shared/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

interface PredictionRow {
  caseId: string;
  caseCode: string;
  stoneName: string;
  stoneType: string;
  roughWeight: number;
  plannedYieldPct: number;
  predictedActualYield: number;
  predictionLower: number;
  predictionUpper: number;
  variance: number;
  confidence: number;
  riskLevel: RiskLevel;
  selectedOptionCode: string;
  status: string;
}

interface HistoricalRow {
  id: string;
  planOptionId: string;
  planOptionCode: string;
  plannedYield: number;
  actualYield: number;
  variance: number;
  status: string;
  reconciledAt: string | null;
}

interface YieldSummary {
  historicalReconciliations: number;
  mae: number;
  bias: number;
  movingAverageYield: number;
  naiveLastPeriodYield: number;
  exponentialSmoothedYield: number;
  stdDev: number;
  predictionInterval: { lower: number; upper: number };
  confidence: number;
  predictionCount: number;
}

interface YieldPredictionResponse {
  summary: YieldSummary;
  predictions: PredictionRow[];
  historical: HistoricalRow[];
  methodology: string;
  advisoryNotice: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const RISK_COLORS: Record<RiskLevel, string> = {
  HIGH: "#f43f5e", // rose-500
  MEDIUM: "#f59e0b", // amber-500
  LOW: "#10b981", // emerald-500
};

function fmtSigned(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function YieldPredictionView() {
  const { data, isLoading } = useApi<YieldPredictionResponse>(
    "/api/analysis/yield-prediction"
  );
  const summary = data?.summary;
  const predictions = data?.predictions ?? [];
  const historical = data?.historical ?? [];

  // Sparklines (need >=2 points to render)
  const histSpark = useMemo(() => {
    const slice = historical.map((h) => h.actualYield);
    while (slice.length < 2) slice.push(summary?.movingAverageYield ?? 0);
    return slice;
  }, [historical, summary]);
  const maSpark = useMemo(() => {
    // MA5 trailing window — visualise the actual series the MA was built on
    const slice = historical.slice(-5).map((h) => h.actualYield);
    while (slice.length < 2) slice.push(summary?.movingAverageYield ?? 0);
    return slice;
  }, [historical, summary]);
  const naiveSpark = useMemo(() => {
    const slice = historical.slice(-3).map((h) => h.actualYield);
    while (slice.length < 2) slice.push(summary?.naiveLastPeriodYield ?? 0);
    return slice;
  }, [historical, summary]);
  const expSpark = useMemo(() => {
    if (historical.length < 2) {
      return [summary?.exponentialSmoothedYield ?? 0, summary?.exponentialSmoothedYield ?? 0];
    }
    // Recursive ES trail α=0.3
    const trail: number[] = [historical[0].actualYield];
    let s = historical[0].actualYield;
    for (let i = 1; i < historical.length; i++) {
      s = 0.3 * historical[i].actualYield + 0.7 * s;
      trail.push(s);
    }
    return trail;
  }, [historical]);
  const stdSpark = useMemo(() => {
    if (historical.length < 2) {
      return [summary?.stdDev ?? 0, summary?.stdDev ?? 0];
    }
    // Rolling std-dev trail (population)
    const trail: number[] = [];
    for (let i = 0; i < historical.length; i++) {
      const slice = historical.slice(0, i + 1).map((h) => h.actualYield);
      const m = slice.reduce((a, b) => a + b, 0) / slice.length;
      const v = slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length;
      trail.push(Math.sqrt(v));
    }
    return trail;
  }, [historical]);
  const maeSpark = useMemo(() => {
    const slice = historical.map((h) => Math.abs(h.variance));
    while (slice.length < 2) slice.push(summary?.mae ?? 0);
    return slice;
  }, [historical, summary]);

  // Historical accuracy chart data
  const histChartData = useMemo(
    () =>
      historical.map((h, i) => ({
        name: h.planOptionCode ?? `REC-${i + 1}`,
        Planned: Number(h.plannedYield.toFixed(2)),
        Actual: Number(h.actualYield.toFixed(2)),
        Variance: Number(h.variance.toFixed(2)),
      })),
    [historical]
  );

  // Prediction interval chart data
  const predChartData = useMemo(
    () =>
      predictions.map((p) => ({
        name: p.caseCode,
        Predicted: Number(p.predictedActualYield.toFixed(2)),
        // recharts ErrorBar expects an array of [lower, upper] deviations or
        // a `value` + error arrays. We use the explicit low/high fields.
        Lower: Number(p.predictionLower.toFixed(2)),
        Upper: Number(p.predictionUpper.toFixed(2)),
        // ErrorBar reads `error` as the half-range on each side
        error: [
          Number((p.predictedActualYield - p.predictionLower).toFixed(2)),
          Number((p.predictionUpper - p.predictedActualYield).toFixed(2)),
        ],
        Planned: Number(p.plannedYieldPct.toFixed(2)),
        risk: p.riskLevel,
        variance: p.variance,
        fullLower: p.predictionLower,
        fullUpper: p.predictionUpper,
      })),
    [predictions]
  );

  // Predictions table columns
  const predColumns: Column<PredictionRow>[] = [
    {
      key: "caseCode",
      header: "Case Code",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.caseCode,
      cell: (r) => (
        <span className="font-mono text-[11px] font-medium">{r.caseCode}</span>
      ),
    },
    {
      key: "stoneName",
      header: "Stone Name",
      sortable: true,
      sortValue: (r) => r.stoneName,
      cell: (r) => (
        <span className="text-[11px] text-foreground/90 truncate block max-w-[180px]">
          {r.stoneName}
        </span>
      ),
    },
    {
      key: "stoneType",
      header: "Stone Type",
      align: "center",
      sortable: true,
      sortValue: (r) => r.stoneType,
      cell: (r) => (
        <Badge
          variant={
            r.stoneType === "BLUE" ? "info" : "neutral"
          }
        >
          {r.stoneType}
        </Badge>
      ),
    },
    {
      key: "roughWeight",
      header: "Rough Wt",
      align: "right",
      sortable: true,
      sortValue: (r) => r.roughWeight,
      cell: (r) => (
        <NumberCell value={r.roughWeight} decimals={2} />
      ),
    },
    {
      key: "plannedYieldPct",
      header: "Plan Yield",
      align: "right",
      sortable: true,
      sortValue: (r) => r.plannedYieldPct,
      cell: (r) => <NumberCell value={r.plannedYieldPct} decimals={2} />,
    },
    {
      key: "predictedActualYield",
      header: "Predicted Yield",
      align: "right",
      sortable: true,
      sortValue: (r) => r.predictedActualYield,
      cell: (r) => (
        <NumberCell value={r.predictedActualYield} decimals={2} intent="info" />
      ),
    },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      sortable: true,
      sortValue: (r) => r.variance,
      cell: (r) => (
        <span
          className={cn(
            "tabular-nums font-medium",
            r.variance < 0
              ? "text-rose-600 dark:text-rose-400"
              : r.variance > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          )}
        >
          {fmtSigned(r.variance)}
        </span>
      ),
    },
    {
      key: "predictionLower",
      header: "Pred Lower",
      align: "right",
      sortable: true,
      sortValue: (r) => r.predictionLower,
      cell: (r) => (
        <NumberCell value={r.predictionLower} decimals={2} />
      ),
    },
    {
      key: "predictionUpper",
      header: "Pred Upper",
      align: "right",
      sortable: true,
      sortValue: (r) => r.predictionUpper,
      cell: (r) => (
        <NumberCell value={r.predictionUpper} decimals={2} />
      ),
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "center",
      sortable: true,
      sortValue: (r) => r.confidence,
      cell: (r) => (
        <div className="flex items-center gap-1.5 min-w-[80px]">
          <Progress
            value={Math.round(r.confidence * 100)}
            className="h-1.5 w-12"
          />
          <span
            className={cn(
              "tabular-nums text-[10px] font-medium",
              r.confidence >= 0.7
                ? "text-emerald-600 dark:text-emerald-400"
                : r.confidence >= 0.4
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-rose-600 dark:text-rose-400"
            )}
          >
            {Math.round(r.confidence * 100)}%
          </span>
        </div>
      ),
    },
    {
      key: "riskLevel",
      header: "Risk",
      align: "center",
      sortable: true,
      sortValue: (r) => r.riskLevel,
      cell: (r) => (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border"
          style={{
            color: RISK_COLORS[r.riskLevel],
            borderColor: RISK_COLORS[r.riskLevel] + "55",
            backgroundColor: RISK_COLORS[r.riskLevel] + "15",
          }}
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          {r.riskLevel}
        </span>
      ),
    },
  ];

  // Historical reconciliations table columns
  const histColumns: Column<HistoricalRow>[] = [
    {
      key: "planOptionCode",
      header: "Plan Option",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.planOptionCode,
      cell: (r) => (
        <span className="font-mono text-[11px] font-medium">{r.planOptionCode}</span>
      ),
    },
    {
      key: "plannedYield",
      header: "Planned Yield",
      align: "right",
      sortable: true,
      sortValue: (r) => r.plannedYield,
      cell: (r) => <NumberCell value={r.plannedYield} decimals={2} />,
    },
    {
      key: "actualYield",
      header: "Actual Yield",
      align: "right",
      sortable: true,
      sortValue: (r) => r.actualYield,
      cell: (r) => (
        <NumberCell value={r.actualYield} decimals={2} intent="info" />
      ),
    },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      sortable: true,
      sortValue: (r) => r.variance,
      cell: (r) => (
        <span
          className={cn(
            "tabular-nums font-medium",
            r.variance < 0
              ? "text-rose-600 dark:text-rose-400"
              : r.variance > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground"
          )}
        >
          {fmtSigned(r.variance)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      sortable: true,
      sortValue: (r) => r.status,
      cell: (r) => (
        <Badge
          variant={r.status === "RECONCILED" ? "success" : "warning"}
          className="font-mono"
        >
          {r.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Yield Prediction"
        subtitle="Predicted actual yield from historical reconciliation baselines"
        meta={
          summary ? (
            <span className="text-[10px] text-muted-foreground">
              {summary.historicalReconciliations} reconciliations ·{" "}
              {summary.predictionCount} active predictions
            </span>
          ) : null
        }
      />

      <InfoBanner variant="warning">
        <div className="flex items-start gap-2">
          <AlertOctagon className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <strong>PREDICTION — </strong>
            Yield prediction is advisory. Never auto-approve or auto-reject a
            plan based on predicted yield alone.{" "}
            <strong>OPEN rule:</strong> model selection logic is unconfirmed.
          </div>
        </div>
      </InfoBanner>

      {isLoading && !data ? (
        <div className="flex flex-col gap-3">
          <KpiGridSkeleton count={6} />
          <ChartSkeleton />
          <TableSkeleton rows={5} cols={8} />
        </div>
      ) : (
        <>
      {/* Summary KPI grid — single column on phones for larger touch targets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2">
        <KpiCard
          label="Reconciliations"
          value={summary?.historicalReconciliations ?? 0}
          unit="recs"
          intent="default"
          icon={Layers}
          hint="Historical plan-actual"
          sparkline={histSpark}
        />
        <KpiCard
          label="Moving Avg Yield"
          value={summary ? summary.movingAverageYield.toFixed(2) : "—"}
          unit="%"
          intent="info"
          icon={TrendingUp}
          hint="Last 5 reconciliations — PRIMARY baseline"
          sparkline={maSpark}
        />
        <KpiCard
          label="Naive Last Period"
          value={summary ? summary.naiveLastPeriodYield.toFixed(2) : "—"}
          unit="%"
          intent="default"
          icon={Activity}
          hint="Most recent actual yield"
          sparkline={naiveSpark}
        />
        <KpiCard
          label="Exp. Smoothed"
          value={summary ? summary.exponentialSmoothedYield.toFixed(2) : "—"}
          unit="%"
          intent="info"
          icon={TrendingUp}
          hint="α = 0.3 (recent-weighted)"
          sparkline={expSpark}
        />
        <KpiCard
          label="Std Dev"
          value={summary ? summary.stdDev.toFixed(2) : "—"}
          unit="σ"
          intent="warning"
          icon={AlertTriangle}
          hint="Prediction uncertainty (±1σ)"
          sparkline={stdSpark}
        />
        <KpiCard
          label="MAE"
          value={summary ? summary.mae.toFixed(2) : "—"}
          unit="pp"
          intent="warning"
          icon={AlertTriangle}
          hint="Mean abs error of plan→actual"
          sparkline={maeSpark}
        />
      </div>

      {/* Methodology */}
      <Section
        title="Methodology — Baseline Forecasting"
        description="Naive Last Period · Moving Average · Exponential Smoothing (spec §61)"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 overflow-x-auto">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground">
                Naive Last Period
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-mono text-foreground">
                ŷ<sub>t+1</sub> = y<sub>t</sub>
              </span>{" "}
              — the most recent actual yield. Fastest, but sensitive to noise.
            </p>
            <p className="mt-1.5 text-[10px] tabular-nums text-foreground font-medium">
              {summary ? summary.naiveLastPeriodYield.toFixed(2) : "—"}%
            </p>
          </div>
          <div className="rounded-md border border-sky-200/60 bg-sky-50/60 dark:border-sky-900/60 dark:bg-sky-950/20 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
              <span className="text-[11px] font-semibold text-foreground">
                Moving Average (5) — PRIMARY
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-mono text-foreground">
                ŷ<sub>t+1</sub> = (1/5) · Σ<sub>i=t-4..t</sub> y<sub>i</sub>
              </span>{" "}
              — mean of the last 5 actual yields. Smoother than naive.
            </p>
            <p className="mt-1.5 text-[10px] tabular-nums text-sky-700 dark:text-sky-300 font-medium">
              {summary ? summary.movingAverageYield.toFixed(2) : "—"}%
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground">
                Exponential Smoothing (α=0.3)
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-mono text-foreground">
                S<sub>t</sub> = α·y<sub>t</sub> + (1−α)·S<sub>t-1</sub>
              </span>{" "}
              — recursive; recent observations weighted higher.
            </p>
            <p className="mt-1.5 text-[10px] tabular-nums text-foreground font-medium">
              {summary ? summary.exponentialSmoothedYield.toFixed(2) : "—"}%
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] overflow-x-auto">
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="text-muted-foreground uppercase tracking-wide">
              Bias (signed mean residual)
            </p>
            <p
              className={cn(
                "tabular-nums font-semibold",
                (summary?.bias ?? 0) < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : (summary?.bias ?? 0) > 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-foreground"
              )}
            >
              {summary ? fmtSigned(summary.bias) : "—"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="text-muted-foreground uppercase tracking-wide">
              MAE (model accuracy)
            </p>
            <p className="tabular-nums font-semibold text-amber-600 dark:text-amber-400">
              {summary ? summary.mae.toFixed(2) : "—"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="text-muted-foreground uppercase tracking-wide">
              Prediction Interval ±1σ
            </p>
            <p className="tabular-nums font-semibold text-foreground">
              {summary
                ? `${summary.predictionInterval.lower.toFixed(2)} → ${summary.predictionInterval.upper.toFixed(2)}`
                : "—"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
            <p className="text-muted-foreground uppercase tracking-wide">
              Confidence (1 − CV)
            </p>
            <p className="tabular-nums font-semibold text-sky-600 dark:text-sky-400">
              {summary ? `${Math.round(summary.confidence * 100)}%` : "—"}
            </p>
          </div>
        </div>

        <div className="mt-3 text-[10px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Risk classification:</strong>{" "}
          <span style={{ color: RISK_COLORS.HIGH }}>
            HIGH if |variance| &gt; 2σ
          </span>{" "}
          ·{" "}
          <span style={{ color: RISK_COLORS.MEDIUM }}>
            MEDIUM if |variance| &gt; 1σ
          </span>{" "}
          ·{" "}
          <span style={{ color: RISK_COLORS.LOW }}>
            LOW otherwise
          </span>
          . Variance = predicted actual − planned yield (signed).
        </div>

        <div className="mt-2 text-[10px] text-muted-foreground/80 italic leading-relaxed">
          {data?.methodology}
        </div>

        <div className="mt-2 rounded-md border border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10 px-2 py-1.5 text-[10px] text-amber-900 dark:text-amber-200 leading-relaxed">
          <strong>Advisory:</strong> {data?.advisoryNotice}
        </div>
      </Section>

      {/* Historical Accuracy chart */}
      <Section
        title="Historical Plan vs Actual Yield"
        description="Each reconciliation: planned yield (slate) vs actual yield (emerald), with variance line (signed)."
        actions={
          historical.length > 0 ? (
            <Badge variant="info" className="gap-1">
              <Layers className="h-2.5 w-2.5" /> {historical.length} reconciliations
            </Badge>
          ) : null
        }
      >
        <div className="h-80 overflow-x-auto">
          <div className="h-full min-w-[600px]">
          {histChartData.length === 0 ? (
            <EmptyState
              title="No reconciliations yet"
              message="Plan-actual reconciliation records will appear here once manufacturing completes."
              icon={<Layers className="h-8 w-8" />}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={histChartData}
                margin={{ top: 12, right: 24, bottom: 24, left: 8 }}
              >
                <defs>
                  <linearGradient id="gPlanned" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}`}
                  label={{
                    value: "Yield %",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(v: number, name: string) =>
                    name === "Variance"
                      ? fmtSigned(v)
                      : `${Number(v).toFixed(2)}%`
                  }
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar
                  dataKey="Planned"
                  fill="url(#gPlanned)"
                  radius={[4, 4, 0, 0]}
                  barSize={14}
                />
                <Bar
                  dataKey="Actual"
                  fill="url(#gActual)"
                  radius={[4, 4, 0, 0]}
                  barSize={14}
                />
                <Line
                  type="monotone"
                  dataKey="Variance"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#f59e0b" }}
                  activeDot={{ r: 4 }}
                />
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          </div>
        </div>
      </Section>

      {/* Prediction Interval chart */}
      <Section
        title="Prediction Interval — Un-reconciled Cases"
        description="Predicted actual yield (baseline MA) with ±1σ error bars, colored by risk level. Dashed line = planned yield."
        actions={
          predictions.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <Badge variant="critical" className="gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                {predictions.filter((p) => p.riskLevel === "HIGH").length} HIGH
              </Badge>
              <Badge variant="warning" className="gap-1">
                {predictions.filter((p) => p.riskLevel === "MEDIUM").length} MED
              </Badge>
              <Badge variant="success" className="gap-1">
                {predictions.filter((p) => p.riskLevel === "LOW").length} LOW
              </Badge>
            </div>
          ) : null
        }
      >
        <div className="h-80 overflow-x-auto">
          <div className="h-full min-w-[600px]">
          {predChartData.length === 0 ? (
            <EmptyState
              title="No predictions to display"
              message="Approved / released planning cases awaiting reconciliation will appear here."
              icon={<TrendingUp className="h-8 w-8" />}
            />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={predChartData}
                margin={{ top: 12, right: 24, bottom: 24, left: 8 }}
              >
                <defs>
                  <linearGradient id="gPredLow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RISK_COLORS.LOW} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={RISK_COLORS.LOW} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gPredMed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RISK_COLORS.MEDIUM} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={RISK_COLORS.MEDIUM} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gPredHigh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={RISK_COLORS.HIGH} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={RISK_COLORS.HIGH} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${v.toFixed(1)}`}
                  label={{
                    value: "Yield %",
                    angle: -90,
                    position: "insideLeft",
                    fontSize: 10,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(v: number, name: string) => {
                    if (name === "Predicted" || name === "Planned")
                      return `${Number(v).toFixed(2)}%`;
                    return `${Number(v).toFixed(2)}`;
                  }}
                  labelFormatter={(_, payload) => {
                    const p = payload?.[0]?.payload as
                      | { name?: string; risk?: RiskLevel; variance?: number; fullLower?: number; fullUpper?: number }
                      | undefined;
                    return p
                      ? `${p.name ?? ""} · risk=${p.risk ?? ""} · variance=${p.variance?.toFixed(2) ?? ""} · interval=[${p.fullLower?.toFixed(2) ?? ""}, ${p.fullUpper?.toFixed(2) ?? ""}]`
                      : "";
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar
                  dataKey="Predicted"
                  radius={[4, 4, 0, 0]}
                  barSize={28}
                >
                  {predChartData.map((p, i) => (
                    <Cell
                      key={i}
                      fill={
                        p.risk === "HIGH"
                          ? "url(#gPredHigh)"
                          : p.risk === "MEDIUM"
                            ? "url(#gPredMed)"
                            : "url(#gPredLow)"
                      }
                    />
                  ))}
                  <ErrorBar
                    dataKey="error"
                    width={6}
                    strokeWidth={1.5}
                    stroke="#475569"
                  />
                </Bar>
                <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
              </BarChart>
            </ResponsiveContainer>
          )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS.HIGH }} />
            HIGH (|var|&gt;2σ)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS.MEDIUM }} />
            MEDIUM (|var|&gt;1σ)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLORS.LOW }} />
            LOW (within σ)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-0 w-4 border-t-2 border-slate-500" />
            Error bar = ±1σ prediction interval
          </span>
        </div>
      </Section>

      {/* Predictions table */}
      <Section
        title="Yield Predictions — Active Cases"
        description="Approved / released planning cases awaiting reconciliation. Predicted from baseline moving average."
      >
        <DataTable<PredictionRow>
          columns={predColumns}
          rows={predictions}
          loading={isLoading}
          emptyMessage="No active cases awaiting reconciliation — all approved plans have been reconciled."
          initialSortKey="variance"
          initialSortDir="desc"
          searchable
          searchPlaceholder="Search case code, stone name, risk..."
          searchFn={(r, q) => {
            const lq = q.toLowerCase();
            return (
              r.caseCode.toLowerCase().includes(lq) ||
              r.stoneName.toLowerCase().includes(lq) ||
              r.stoneType.toLowerCase().includes(lq) ||
              r.riskLevel.toLowerCase().includes(lq) ||
              r.selectedOptionCode.toLowerCase().includes(lq)
            );
          }}
          exportable
          exportPermission="analysis.export"
          exportFilename="yield-predictions.csv"
          rowClassName={(r) => {
            if (r.riskLevel === "HIGH")
              return "bg-rose-50/50 dark:bg-rose-950/20";
            if (r.riskLevel === "MEDIUM")
              return "bg-amber-50/50 dark:bg-amber-950/20";
            return "bg-emerald-50/30 dark:bg-emerald-950/10";
          }}
          maxHeight="600px"
          pagination
          pageSize={25}
        />
      </Section>

      {/* Historical reconciliations table */}
      <Section
        title="Historical Reconciliations"
        description="Plan-actual reconciliation records — the baseline training data for predictions."
      >
        <DataTable<HistoricalRow>
          columns={histColumns}
          rows={historical}
          loading={isLoading}
          emptyMessage="No reconciliation records found — baseline cannot be computed yet."
          initialSortKey="planOptionCode"
          initialSortDir="asc"
          searchable
          searchPlaceholder="Search option code, status..."
          searchFn={(r, q) => {
            const lq = q.toLowerCase();
            return (
              r.planOptionCode.toLowerCase().includes(lq) ||
              r.status.toLowerCase().includes(lq)
            );
          }}
          exportable
          exportPermission="analysis.export"
          exportFilename="yield-historical.csv"
          pagination
          pageSize={25}
          maxHeight="500px"
        />
      </Section>
        </>
      )}
    </div>
  );
}
