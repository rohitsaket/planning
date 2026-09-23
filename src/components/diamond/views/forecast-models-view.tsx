"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";

interface Metrics {
  mae?: number;
  wape?: number;
  rmse?: number;
  bias?: number;
  predictionCoverage?: number;
  [k: string]: unknown;
}
interface ModelRow {
  id: string;
  modelName: string;
  version: string;
  algorithm: string;
  trainingPeriod: string;
  validationPeriod: string;
  metrics: Metrics | null;
  publishedBy: string | null;
  publishedAt: string | null;
  status: string;
}
interface RunRow {
  id: string;
  modelVersion: string;
  runDate: string;
  status: string;
  horizon30d: number;
  horizon60d: number;
  horizon90d: number;
  predictionCount: number;
  metrics: Metrics | null;
}
interface ForecastModelsData {
  runs: RunRow[];
  models: ModelRow[];
  advisoryNotice?: string;
}

function MetricCell({ m, keyName }: { m: Metrics | null; keyName: keyof Metrics }) {
  if (!m || m[keyName] === undefined || m[keyName] === null) return <span className="text-muted-foreground">—</span>;
  const v = Number(m[keyName]);
  return <span className="tabular-nums">{Number.isFinite(v) ? v.toFixed(3) : String(m[keyName])}</span>;
}

const modelColumns: Column<ModelRow>[] = [
  { key: "modelName", header: "Model", cell: (r) => <span className="font-medium">{r.modelName}</span>, sortable: true, sortValue: (r) => r.modelName, sticky: "left" },
  { key: "version", header: "Version", cell: (r) => <span className="font-mono text-[10px]">{r.version}</span> },
  { key: "algorithm", header: "Algorithm", cell: (r) => <span className="text-[10px]">{r.algorithm}</span> },
  { key: "trainingPeriod", header: "Training", cell: (r) => <span className="text-[10px]">{r.trainingPeriod}</span> },
  { key: "validationPeriod", header: "Validation", cell: (r) => <span className="text-[10px]">{r.validationPeriod}</span> },
  { key: "mae", header: "MAE", cell: (r) => <MetricCell m={r.metrics} keyName="mae" />, align: "right" },
  { key: "wape", header: "WAPE", cell: (r) => <MetricCell m={r.metrics} keyName="wape" />, align: "right" },
  { key: "rmse", header: "RMSE", cell: (r) => <MetricCell m={r.metrics} keyName="rmse" />, align: "right" },
  { key: "bias", header: "Bias", cell: (r) => <MetricCell m={r.metrics} keyName="bias" />, align: "right" },
  { key: "publishedBy", header: "Published By", cell: (r) => <span className="text-[10px]">{r.publishedBy ?? "—"}</span> },
  { key: "publishedAt", header: "Published At", cell: (r) => <span className="tabular-nums text-[10px]">{r.publishedAt ? new Date(r.publishedAt).toLocaleString() : "—"}</span> },
  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
];

const runColumns: Column<RunRow>[] = [
  { key: "modelVersion", header: "Model Version", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.modelVersion}</span>, sortable: true, sortValue: (r) => r.modelVersion, sticky: "left" },
  { key: "runDate", header: "Run Date", cell: (r) => <span className="tabular-nums text-[10px]">{new Date(r.runDate).toLocaleString()}</span>, sortable: true, sortValue: (r) => r.runDate },
  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  { key: "horizon30d", header: "Horizon 30D", cell: (r) => <NumberCell value={r.horizon30d} />, align: "right", sortable: true, sortValue: (r) => r.horizon30d },
  { key: "horizon60d", header: "Horizon 60D", cell: (r) => <NumberCell value={r.horizon60d} />, align: "right", sortable: true, sortValue: (r) => r.horizon60d },
  { key: "horizon90d", header: "Horizon 90D", cell: (r) => <NumberCell value={r.horizon90d} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.horizon90d },
  { key: "predictionCount", header: "Predictions", cell: (r) => <NumberCell value={r.predictionCount} />, align: "right" },
  { key: "mae", header: "MAE", cell: (r) => <MetricCell m={r.metrics} keyName="mae" />, align: "right" },
  { key: "wape", header: "WAPE", cell: (r) => <MetricCell m={r.metrics} keyName="wape" />, align: "right" },
  { key: "rmse", header: "RMSE", cell: (r) => <MetricCell m={r.metrics} keyName="rmse" />, align: "right" },
  { key: "bias", header: "Bias", cell: (r) => <MetricCell m={r.metrics} keyName="bias" />, align: "right" },
];

export function ForecastModelsView() {
  const { data, isLoading } = useApi<ForecastModelsData>("/api/forecast");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Forecast Models & Runs"
        subtitle="Model governance, metrics, and run history"
        meta={<span className="text-[10px] text-muted-foreground">{data?.models.length ?? 0} models · {data?.runs.length ?? 0} runs</span>}
      />

      {data?.advisoryNotice && (
        <InfoBanner variant="warning">
          <strong className="font-semibold">Use time-aware validation. Never random-split time series.</strong> Forecast is advisory and remains separate from confirmed manufacturing requirement.
        </InfoBanner>
      )}

      <Section title="Forecast Models" description="Registered and published forecast models with their validation metrics">
        <DataTable
          columns={modelColumns}
          rows={data?.models ?? []}
          loading={isLoading}
          emptyMessage="No models registered"
          maxHeight="480px"
          exportable
          exportPermission="analysis.export"
          exportFilename="forecast-models.csv"
          pagination
          pageSize={25}
        />
      </Section>

      <Section title="Forecast Runs" description="Recent forecast executions and their aggregate metrics">
        <DataTable
          columns={runColumns}
          rows={data?.runs ?? []}
          loading={isLoading}
          emptyMessage="No runs executed"
          maxHeight="480px"
          exportable
          exportPermission="analysis.export"
          exportFilename="forecast-runs.csv"
          pagination
          pageSize={25}
        />
      </Section>

      <Section title="Metrics Formulas" description="Definitions for forecast accuracy metrics">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Badge variant="info">MAE</Badge>
            <p className="mt-2 text-[10px] text-muted-foreground">Mean Absolute Error</p>
            <p className="mt-1 text-[11px] font-mono">MAE = (1/n) · Σ |yᵢ − ŷᵢ|</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Average magnitude of forecast errors, in same units as the prediction.</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Badge variant="info">WAPE</Badge>
            <p className="mt-2 text-[10px] text-muted-foreground">Weighted Absolute Percentage Error</p>
            <p className="mt-1 text-[11px] font-mono">WAPE = Σ|yᵢ − ŷᵢ| / Σ|yᵢ|</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Error normalized by total volume — robust to low-volume categories.</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Badge variant="info">RMSE</Badge>
            <p className="mt-2 text-[10px] text-muted-foreground">Root Mean Squared Error</p>
            <p className="mt-1 text-[11px] font-mono">RMSE = √[ (1/n) · Σ(yᵢ − ŷᵢ)² ]</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Penalises large errors more heavily than MAE.</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Badge variant="info">Bias</Badge>
            <p className="mt-2 text-[10px] text-muted-foreground">Forecast Bias</p>
            <p className="mt-1 text-[11px] font-mono">Bias = (1/n) · Σ(yᵢ − ŷᵢ)</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Positive = under-forecast, negative = over-forecast.</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <Badge variant="info">Prediction Coverage</Badge>
            <p className="mt-2 text-[10px] text-muted-foreground">Catalog coverage ratio</p>
            <p className="mt-1 text-[11px] font-mono">Coverage = #categories predicted / #active categories</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Fraction of the active catalog the model produced predictions for.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
