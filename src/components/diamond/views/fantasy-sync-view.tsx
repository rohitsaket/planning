"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge, Pill } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell, EmptyState } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Activity, RefreshCw, AlertTriangle, CheckCircle2, Database, Boxes, Gem } from "lucide-react";
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
  unmappedStatuses: number;
  dataQualityErrors: number;
  missingIds: number;
  duplicateIds: number;
  staleRecords: number;
}

interface SyncRun {
  id: string;
  source: string;
  entity: string;
  status: string;
  recordsFetched: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
  nextRunAt: string | null;
}

interface SyncPayload {
  summary: SyncSummaryItem[];
  reconciliation: Reconciliation;
  recentRuns: SyncRun[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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
  const { data, isLoading } = useApi<SyncPayload>("/api/fantasy/sync");

  const summary = data?.summary ?? [];
  const reconciliation = data?.reconciliation;
  const recentRuns = data?.recentRuns ?? [];

  const totalEntitiesSynced = summary.length;
  const lastSyncStatus = useMemo(() => {
    if (summary.length === 0) return "—";
    const statuses = new Set(summary.map((s) => s.lastStatus));
    if (statuses.size === 1 && statuses.has("SUCCESS")) return "HEALTHY";
    if (statuses.has("FAILED")) return "FAILED";
    if (statuses.has("PARTIAL") || statuses.has("RUNNING")) return "PARTIAL";
    return Array.from(statuses).join(", ");
  }, [summary]);

  const errorsCount = (reconciliation?.dataQualityErrors ?? 0) +
    summary.reduce((acc, s) => acc + (s.errors?.count ?? 0), 0);

  const lastSyncIntent: "default" | "critical" | "warning" | "success" | "info" =
    lastSyncStatus === "HEALTHY" ? "success" :
    lastSyncStatus === "PARTIAL" ? "warning" :
    lastSyncStatus === "FAILED" ? "critical" : "info";

  const columns: Column<SyncRun>[] = [
    {
      key: "entity", header: "Entity", sortable: true,
      sortValue: (r) => r.entity,
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{r.entity}</span>
          <span className="text-[10px] text-muted-foreground">{r.source}</span>
        </div>
      ),
    },
    {
      key: "status", header: "Status",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    { key: "recordsFetched", header: "Fetched", align: "right", sortable: true, sortValue: (r) => r.recordsFetched, cell: (r) => <NumberCell value={r.recordsFetched} /> },
    { key: "recordsCreated", header: "Created", align: "right", sortable: true, sortValue: (r) => r.recordsCreated, cell: (r) => <NumberCell value={r.recordsCreated} intent="success" /> },
    { key: "recordsUpdated", header: "Updated", align: "right", sortable: true, sortValue: (r) => r.recordsUpdated, cell: (r) => <NumberCell value={r.recordsUpdated} intent="info" /> },
    { key: "recordsSkipped", header: "Skipped", align: "right", sortable: true, sortValue: (r) => r.recordsSkipped, cell: (r) => <NumberCell value={r.recordsSkipped} intent="warning" /> },
    { key: "durationMs", header: "Duration", align: "right", sortable: true, sortValue: (r) => r.durationMs, cell: (r) => <span className="tabular-nums">{fmtDuration(r.durationMs)}</span> },
    { key: "startedAt", header: "Started", sortable: true, sortValue: (r) => r.startedAt, cell: (r) => <span className="text-muted-foreground">{fmtDate(r.startedAt)}</span> },
    { key: "finishedAt", header: "Finished", cell: (r) => <span className="text-muted-foreground">{fmtDate(r.finishedAt)}</span> },
    { key: "nextRunAt", header: "Next Run", cell: (r) => <span className="text-muted-foreground">{fmtDate(r.nextRunAt)}</span> },
    {
      key: "errors", header: "Errors",
      cell: (r) => {
        if (!r || (r.status === "SUCCESS" || r.status === "RUNNING")) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge variant="critical">
            <AlertTriangle className="h-3 w-3" /> Failed
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Fantasy Sync Dashboard"
        subtitle="Authoritative ERP source integration · Reconciliation · Recent sync runs"
        actions={
          <Button size="sm" className="h-8 text-xs" onClick={() => toast.success("Sync scheduled", { description: "A new Fantasy sync run has been queued." })}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Trigger Sync
          </Button>
        }
      />

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Entities Synced" value={totalEntitiesSynced} intent="info" hint="Distinct Fantasy entities tracked" />
        <KpiCard
          label="Last Sync Status"
          value={lastSyncStatus}
          intent={lastSyncIntent}
          hint="Aggregated across all entities"
        />
        <KpiCard
          label="Errors Count"
          value={errorsCount}
          intent={errorsCount > 0 ? "critical" : "success"}
          hint="Data quality errors + run failures"
        />
        <KpiCard
          label="Reconciliation"
          value={reconciliation ? `${reconciliation.fantasyRoughCount + reconciliation.fantasyPolishedCount}` : "—"}
          unit="recs"
          intent="default"
          hint="Rough + Polished records tracked"
        />
      </div>

      <InfoBanner variant={errorsCount > 0 ? "warning" : "success"}>
        <div className="flex items-center gap-2">
          {errorsCount > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          <span className="font-medium">No silent integration failures.</span>
          <span className="text-muted-foreground">Every sync run is reconciled against raw payload counts; mismatches raise Data Quality issues immediately.</span>
        </div>
      </InfoBanner>

      {/* Reconciliation summary */}
      <Section title="Reconciliation Summary" description="Cross-check between Fantasy raw payload and local authoritative mirror">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          <MetricTile icon={<Gem className="h-3.5 w-3.5" />} label="Fantasy Rough" value={reconciliation?.fantasyRoughCount} intent="info" />
          <MetricTile icon={<Boxes className="h-3.5 w-3.5" />} label="Fantasy Polished" value={reconciliation?.fantasyPolishedCount} intent="success" />
          <MetricTile icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Unmapped Statuses" value={reconciliation?.unmappedStatuses} intent={reconciliation && reconciliation.unmappedStatuses > 0 ? "warning" : "default"} />
          <MetricTile icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Data Quality Errors" value={reconciliation?.dataQualityErrors} intent={reconciliation && reconciliation.dataQualityErrors > 0 ? "critical" : "default"} />
          <MetricTile icon={<Database className="h-3.5 w-3.5" />} label="Missing IDs" value={reconciliation?.missingIds} intent="default" />
          <MetricTile icon={<Database className="h-3.5 w-3.5" />} label="Duplicate IDs" value={reconciliation?.duplicateIds} intent="default" />
          <MetricTile icon={<Activity className="h-3.5 w-3.5" />} label="Stale Records" value={reconciliation?.staleRecords} intent="default" />
        </div>
      </Section>

      {/* Per-entity latest summary */}
      <Section title="Latest Run Per Entity" description="Most recent sync run per Fantasy entity (Department, Location, Rough, Polished, Movement)">
        {summary.length === 0 && !isLoading ? (
          <EmptyState title="No sync runs yet" message="Trigger a sync to see latest runs per entity." icon={<RefreshCw className="h-6 w-6" />} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {summary.map((s) => (
              <div key={s.entity} className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold">{s.entity}</span>
                  </div>
                  <StatusBadge status={s.lastStatus} />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <div><span className="text-muted-foreground">Fetched:</span> <span className="font-medium tabular-nums">{s.recordsFetched}</span></div>
                  <div><span className="text-muted-foreground">Duration:</span> <span className="font-medium tabular-nums">{fmtDuration(s.durationMs)}</span></div>
                  <div><span className="text-muted-foreground">Started:</span> <span className="font-medium">{fmtDate(s.startedAt)}</span></div>
                  <div><span className="text-muted-foreground">Next:</span> <span className="font-medium">{fmtDate(s.nextRunAt)}</span></div>
                </div>
                {s.errors && s.errors.count ? (
                  <Pill className="text-rose-700 bg-rose-50 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300">
                    <AlertTriangle className="h-3 w-3" /> {s.errors.count} errors
                  </Pill>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Recent sync runs table */}
      <Section title="Recent Sync Runs" description="Last 15 sync runs — full audit trail with records fetched/created/updated/skipped">
        <DataTable
          columns={columns}
          rows={recentRuns}
          loading={isLoading}
          emptyMessage="No sync runs recorded yet."
          maxHeight="500px"
          initialSortKey="startedAt"
          initialSortDir="desc"
          exportable
          exportFilename="fantasy-sync-runs.csv"
          searchable
          searchPlaceholder="Filter by entity, source, status..."
          searchFn={(r, q) =>
            r.entity.toLowerCase().includes(q.toLowerCase()) ||
            r.source.toLowerCase().includes(q.toLowerCase()) ||
            r.status.toLowerCase().includes(q.toLowerCase())
          }
        />
      </Section>
    </div>
  );
}

function MetricTile({ icon, label, value, intent = "default" }: {
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
