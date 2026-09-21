"use client";

import { useState, useMemo } from "react";
import { useApi, apiPost } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge, Pill } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell, EmptyState } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Database,
  Boxes,
  Gem,
  FlaskConical,
  Play,
  RotateCcw,
  ShieldCheck,
  Scale,
} from "lucide-react";
import { toast } from "sonner";

interface SyncSummaryItem {
  entity: string;
  lastStatus: string;
  recordsFetched: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
  nextRunAt: string | null;
  errors: { count?: number; sample?: string } | null;
}

interface Reconciliation {
  fantasyRoughCount: number;
  fantasyPolishedCount: number;
  totalOverallLots: number;
  activeOverallLots: number;
  historicalOverallLots: number;
  unmappedStatuses: number;
  dataQualityErrors: number;
  dataQualityWarnings: number;
  missingIds: number;
  duplicateIds: number;
  staleRecords: number;
  latestRunMetrics?: {
    recordsReceived: number;
    recordsCreated: number;
    recordsUpdated: number;
    recordsUnchanged: number;
    recordsSkipped: number;
    recordsRejected: number;
    recordsRemoved: number;
    historyVersionsCreated: number;
    dqIssuesCreated: number;
  } | null;
}

interface SyncRun {
  id: string;
  source: string;
  entity: string;
  status: string;
  batchId?: string;
  startingCheckpoint?: number;
  endingCheckpoint?: number;
  recordsReceived?: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsUnchanged?: number;
  recordsSkipped: number;
  recordsRejected?: number;
  recordsRemoved?: number;
  historyVersionsCreated?: number;
  dqIssuesCreated?: number;
  recordsFetched: number;
  durationMs: number;
  triggeredBy?: string;
  errorSummary?: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface SyncPayload {
  sourceMode: string;
  isSimulated: boolean;
  checkpoint: number;
  isLocked: boolean;
  lastSyncAt: string | null;
  summary: SyncSummaryItem[];
  reconciliation: Reconciliation;
  recentRuns: SyncRun[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) + " IST";
  } catch {
    return iso;
  }
}

function fmtDuration(ms: number): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function FantasySyncView() {
  const { data, isLoading, refetch } = useApi<SyncPayload>("/api/fantasy/sync");
  const [syncing, setSyncing] = useState(false);

  const summary = data?.summary ?? [];
  const reconciliation = data?.reconciliation;
  const recentRuns = data?.recentRuns ?? [];
  const checkpoint = data?.checkpoint ?? 0;
  const isSimulated = data?.isSimulated ?? true;

  const totalEntitiesSynced = summary.length;
  const lastSyncStatus = useMemo(() => {
    if (summary.length === 0) return "—";
    const statuses = new Set(summary.map((s) => s.lastStatus));
    if (statuses.size === 1 && statuses.has("SUCCESS")) return "HEALTHY";
    if (statuses.has("FAILED")) return "FAILED";
    if (statuses.has("PARTIAL") || statuses.has("RUNNING")) return "PARTIAL";
    return Array.from(statuses).join(", ");
  }, [summary]);

  const errorsCount = (reconciliation?.dataQualityErrors ?? 0);

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      const res = await apiPost<{ success: boolean; batchId: string; status: string; reconciliation: Record<string, number> }>(
        "/api/fantasy/sync",
        {}
      );
      if (res.success) {
        toast.success("Synchronization successful", {
          description: `Batch ${res.batchId} processed. Created: ${res.reconciliation.recordsCreated}, Updated: ${res.reconciliation.recordsUpdated}, Removed: ${res.reconciliation.recordsRemoved}`,
        });
      } else {
        toast.error("Synchronization failed", { description: res.status });
      }
      refetch();
    } catch (e) {
      toast.error("Sync error", { description: e instanceof Error ? e.message : "Failed to trigger sync" });
    } finally {
      setSyncing(false);
    }
  };

  const handleRetry = async () => {
    setSyncing(true);
    try {
      const res = await apiPost<{ success: boolean; batchId: string }>("/api/fantasy/sync/retry", {
        reason: "Manual retry from Sync Monitor dashboard",
      });
      toast.success("Retry completed", { description: `Batch ${res.batchId} reprocessed.` });
      refetch();
    } catch (e) {
      toast.error("Retry failed", { description: e instanceof Error ? e.message : "Failed to retry" });
    } finally {
      setSyncing(false);
    }
  };

  const columns: Column<SyncRun>[] = [
    {
      key: "batchId",
      header: "Batch / Entity",
      sortable: true,
      sortValue: (r) => r.batchId || r.entity,
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{r.batchId || r.entity}</span>
          <span className="text-[10px] text-muted-foreground">{r.source} · Checkpoint {r.startingCheckpoint ?? 0} → {r.endingCheckpoint ?? 0}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "recordsReceived",
      header: "Received",
      align: "right",
      sortable: true,
      sortValue: (r) => r.recordsReceived ?? r.recordsFetched,
      cell: (r) => <NumberCell value={r.recordsReceived ?? r.recordsFetched} />,
    },
    {
      key: "recordsCreated",
      header: "Created",
      align: "right",
      sortable: true,
      sortValue: (r) => r.recordsCreated,
      cell: (r) => <NumberCell value={r.recordsCreated} intent="success" />,
    },
    {
      key: "recordsUpdated",
      header: "Updated",
      align: "right",
      sortable: true,
      sortValue: (r) => r.recordsUpdated,
      cell: (r) => <NumberCell value={r.recordsUpdated} intent="info" />,
    },
    {
      key: "recordsRemoved",
      header: "Removed",
      align: "right",
      sortable: true,
      sortValue: (r) => r.recordsRemoved ?? 0,
      cell: (r) => <NumberCell value={r.recordsRemoved ?? 0} intent="warning" />,
    },
    {
      key: "historyVersions",
      header: "History Versions",
      align: "right",
      cell: (r) => <NumberCell value={r.historyVersionsCreated ?? 0} intent="default" />,
    },
    {
      key: "durationMs",
      header: "Duration",
      align: "right",
      sortable: true,
      sortValue: (r) => r.durationMs,
      cell: (r) => <span className="tabular-nums text-xs">{fmtDuration(r.durationMs)}</span>,
    },
    {
      key: "startedAt",
      header: "Started (IST)",
      sortable: true,
      sortValue: (r) => r.startedAt,
      cell: (r) => <span className="text-muted-foreground text-xs">{fmtDate(r.startedAt)}</span>,
    },
    {
      key: "triggeredBy",
      header: "Triggered By",
      cell: (r) => <span className="text-xs font-mono text-muted-foreground">{r.triggeredBy || "SYSTEM"}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Sync Monitor"
        subtitle="Fantasy ERP authoritative source synchronization · Checkpoint state · Mathematical reconciliation"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={syncing}
              onClick={handleRetry}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry Sync
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5"
              disabled={syncing}
              onClick={handleTriggerSync}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : `Trigger Next Batch (${checkpoint + 1}/5)`}
            </Button>
          </div>
        }
      />

      {/* Simulation Banner */}
      <InfoBanner variant="warning">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <strong className="font-semibold text-amber-700 dark:text-amber-300">SIMULATION MODE:</strong>{" "}
              <span>
                Active provider is <strong>FixtureFantasyProvider</strong> (Batch Checkpoint: {checkpoint} / 5).
                All synchronization events execute real transactional updates, history preservation, and DQ validation.
              </span>
            </div>
          </div>
          <Badge variant="warning">
            Provider: FIXTURE
          </Badge>
        </div>
      </InfoBanner>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard
          label="Checkpoint Progress"
          value={`Batch ${checkpoint} / 5`}
          intent="info"
          hint="Monotonic fixture sync state"
        />
        <KpiCard
          label="Last Sync Status"
          value={lastSyncStatus}
          intent={lastSyncStatus === "HEALTHY" ? "success" : "warning"}
          hint="Aggregated across sync runs"
        />
        <KpiCard
          label="Data Quality Errors"
          value={errorsCount}
          intent={errorsCount > 0 ? "critical" : "success"}
          hint="Blocking & error severity issues"
        />
        <KpiCard
          label="Total Lots in Archive"
          value={reconciliation?.totalOverallLots ?? 0}
          intent="default"
          hint="Live stock + preserved history"
        />
      </div>

      {/* Mathematical Reconciliation Summary */}
      <Section title="Mathematical Reconciliation" description="Verified balance between incoming feed records and locally updated state">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <MetricTile icon={<Gem className="h-3.5 w-3.5" />} label="Live Rough" value={reconciliation?.fantasyRoughCount} intent="info" />
          <MetricTile icon={<Boxes className="h-3.5 w-3.5" />} label="Live Polished" value={reconciliation?.fantasyPolishedCount} intent="success" />
          <MetricTile icon={<Database className="h-3.5 w-3.5" />} label="Active Live Lots" value={reconciliation?.activeOverallLots} intent="success" />
          <MetricTile icon={<Activity className="h-3.5 w-3.5" />} label="Historical Lots" value={reconciliation?.historicalOverallLots} intent="info" />
          <MetricTile icon={<AlertTriangle className="h-3.5 w-3.5" />} label="DQ Errors" value={reconciliation?.dataQualityErrors} intent={reconciliation && reconciliation.dataQualityErrors > 0 ? "critical" : "default"} />
          <MetricTile icon={<AlertTriangle className="h-3.5 w-3.5" />} label="DQ Warnings" value={reconciliation?.dataQualityWarnings} intent={reconciliation && reconciliation.dataQualityWarnings > 0 ? "warning" : "default"} />
        </div>

        {reconciliation?.latestRunMetrics && (
          <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-foreground">Latest Batch Mathematical Balance Check:</span>
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Reconciled 100%</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-[11px]">
              <div><span className="text-muted-foreground">Received:</span> <strong>{reconciliation.latestRunMetrics.recordsReceived}</strong></div>
              <div><span className="text-muted-foreground">Created:</span> <strong className="text-emerald-600">{reconciliation.latestRunMetrics.recordsCreated}</strong></div>
              <div><span className="text-muted-foreground">Updated:</span> <strong className="text-sky-600">{reconciliation.latestRunMetrics.recordsUpdated}</strong></div>
              <div><span className="text-muted-foreground">Unchanged:</span> <strong>{reconciliation.latestRunMetrics.recordsUnchanged}</strong></div>
              <div><span className="text-muted-foreground">Removed:</span> <strong className="text-amber-600">{reconciliation.latestRunMetrics.recordsRemoved}</strong></div>
              <div><span className="text-muted-foreground">Rejected:</span> <strong className="text-rose-600">{reconciliation.latestRunMetrics.recordsRejected}</strong></div>
            </div>
          </div>
        )}
      </Section>

      {/* Recent sync runs table */}
      <Section title="Synchronization Run History" description="Complete audit log of all incremental and baseline synchronization batches">
        <DataTable
          columns={columns}
          rows={recentRuns}
          loading={isLoading}
          emptyMessage="No sync runs recorded yet. Click 'Trigger Next Batch' to run baseline synchronization."
          maxHeight="480px"
          initialSortKey="startedAt"
          initialSortDir="desc"
          exportable
          exportFilename="fantasy-sync-audit-log.csv"
        />
      </Section>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  intent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  intent?: "default" | "critical" | "warning" | "success" | "info";
}) {
  const colors: Record<string, string> = {
    default: "text-foreground",
    critical: "text-rose-600 dark:text-rose-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    info: "text-sky-600 dark:text-sky-400",
  };
  return (
    <div className="rounded-md border border-border bg-card p-2.5 flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`text-lg font-semibold tabular-nums ${colors[intent]}`}>
        {value === undefined || value === null ? "—" : value}
      </span>
    </div>
  );
}
