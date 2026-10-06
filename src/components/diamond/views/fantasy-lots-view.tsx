"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Activity, AlertTriangle, Upload } from "lucide-react";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/stores/auth-store";
import { LIVE_LOT_FIELDS, type LiveLotFieldKey } from "@/lib/fantasy/live-fields";

type LiveLotRow = Record<LiveLotFieldKey, string | boolean | null> & { id: string; sourceRecordKey: string; sourceActive: boolean; staleSince: string | null; lastSeenAt: string; mappingWarnings: number };

interface LiveDataResponse { data: LiveLotRow[]; page: number; pageSize: number; totalRecords: number; totalPages: number }
interface Facets { lotStatusDb: string[]; processName: string[]; shape: string[]; labName: string[]; companyId: string[]; departmentAccountName: string[] }
interface SyncStatus {
  enabled: boolean; configured: boolean; status: "idle" | "running"; lastSuccessfulSyncAt: string | null; lastAttemptAt: string | null; recordsInDatabase: number; staleRecords: number;
  lastRun: null | { status: string; trigger: string | null; sourceMode: string; recordsFetched: number; inserted: number; updated: number; unchanged: number; failed: number; staled: number; durationMs: number; errorCode: string | null; errorSummary: string | null; errorDetail: string | null; startedAt: string };
  scheduler: { enabled: boolean; intervalMinutes: number; nextRunAt: string | null };
}

const fmtDate = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) });
};
const fmtDecimal = (v: string | null) => (v === null ? "—" : v.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1"));

const ALL = "__all__";
function FilterSelect({ label, value, onChange, options, width = "150px" }: { label: string; value: string; onChange: (v: string) => void; options: string[]; width?: string }) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger size="sm" className="h-8 text-xs" style={{ width }} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL} className="text-xs">All {label}</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function FantasyLotsView() {
  const qc = useQueryClient();
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canSync = perms.includes("fantasy.sync.run");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 350);
  const [filters, setFilters] = useState({ lotStatusDb: "", processName: "", shape: "", labName: "", companyId: "", departmentAccountName: "", onHold: "" });
  const [sort, setSort] = useState<{ by: string; order: "asc" | "desc" }>({ by: "lastSeenAt", order: "desc" });
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setFilter = (k: keyof typeof filters) => (v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy: sort.by, sortOrder: sort.order });
    if (q) p.set("q", q);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return `/api/fantasy/live-data?${p.toString()}`;
  }, [page, pageSize, q, filters, sort]);

  const { data, isLoading, isError, refetch } = useApi<LiveDataResponse>(url, { refetchInterval: 60_000 });
  const { data: facets } = useApi<Facets>("/api/fantasy/live-data/facets", { staleTime: 5 * 60_000 });
  const { data: status, refetch: refetchStatus } = useApi<SyncStatus>("/api/fantasy/sync/status", { refetchInterval: 30_000 });

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const r = await apiPost<{ success: boolean; status: string; recordsFetched: number; recordsInserted: number; recordsUpdated: number; recordsUnchanged: number; recordsStaled: number; errorSummary: string | null; errorCode: string | null }>("/api/fantasy/live-data/sync", {});
      if (r.success) {
        toast[r.status === "partial" ? "warning" : "success"](r.status === "partial" ? "Fantasy synchronization completed with warnings" : "Fantasy synchronization completed", {
          description: `${r.recordsFetched.toLocaleString()} records processed · ${r.recordsInserted} new · ${r.recordsUpdated} updated · ${r.recordsUnchanged} unchanged${r.recordsStaled ? ` · ${r.recordsStaled} marked stale` : ""}${r.errorSummary ? ` · ${r.errorSummary}` : ""}`,
          duration: 8000,
        });
      } else {
        toast.error("Unable to synchronize Fantasy ERP", { description: `${r.errorSummary ?? "Sync failed"}. Last successful data remains available.`, duration: 10000 });
      }
      qc.invalidateQueries({ queryKey: ["/api/fantasy/live-data/facets"] });
      refetch();
      refetchStatus();
    } catch (e) {
      toast.error("Unable to synchronize Fantasy ERP", { description: `${e instanceof Error ? e.message : "Request failed"}. Last successful data remains available.` });
    } finally {
      setSyncing(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      const res = await fetch("/api/fantasy/live-data/import", { method: "POST", body: fd, credentials: "same-origin" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = body?.error?.message ?? `Import failed (${res.status})`;
        toast.error("Import rejected", { description: msg, duration: 10000 });
        return;
      }
      const r = body as { success: boolean; status: string; recordsFetched: number; recordsInserted: number; recordsUpdated: number; recordsUnchanged: number; recordsFailed: number; recordsStaled: number; mappingWarnings: number; unmappedSourceColumns: string[]; errorSummary: string | null };
      if (r.success) {
        toast[r.status === "partial" ? "warning" : "success"](`Fantasy export imported (${r.status})`, {
          description: `${r.recordsFetched.toLocaleString()} rows read · ${r.recordsInserted} new · ${r.recordsUpdated} updated · ${r.recordsUnchanged} unchanged${r.recordsFailed ? ` · ${r.recordsFailed} rejected` : ""}${r.recordsStaled ? ` · ${r.recordsStaled} marked stale` : ""}${r.unmappedSourceColumns.length ? ` · unmapped columns: ${r.unmappedSourceColumns.slice(0, 5).join(", ")}` : ""}${r.errorSummary ? ` · ${r.errorSummary}` : ""}`,
          duration: 10000,
        });
      } else {
        toast.error("Import failed", { description: `${r.errorSummary ?? "Nothing was changed"}. Last successful data remains available.`, duration: 10000 });
      }
      qc.invalidateQueries({ queryKey: ["/api/fantasy/live-data/facets"] });
      refetch();
      refetchStatus();
    } catch (e) {
      toast.error("Import failed", { description: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const columns: Column<LiveLotRow>[] = useMemo(
    () =>
      LIVE_LOT_FIELDS.map((f) => ({
        key: f.field,
        header: f.header,
        sortable: true,
        sortValue: (r) => (r[f.field] as string | null) ?? "",
        align: f.numeric ? "right" : undefined,
        exportValue: (r) => (r[f.field] === null ? "" : String(r[f.field])),
        cell: (r) => {
          const v = r[f.field];
          if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
          if (f.type === "boolean") return <Badge variant={v ? "warning" : "neutral"}>{v ? "Yes" : "No"}</Badge>;
          if (f.type === "date") return <span className="text-muted-foreground whitespace-nowrap">{fmtDate(v as string, f.field !== "docDate" && f.field !== "allocationDate")}</span>;
          if (f.type === "decimal") return <span className="tabular-nums">{fmtDecimal(v as string)}</span>;
          return <span className={f.field === "lotId" ? "font-medium whitespace-nowrap" : "whitespace-nowrap"}>{String(v)}</span>;
        },
      })),
    [],
  );

  const rows = data?.data ?? [];
  const lastRunFailed = status?.lastRun && status.lastRun.status === "FAILED";
  const syncRunning = syncing || status?.status === "running";
  const statusLabel = syncRunning ? "Syncing…" : !status?.lastRun ? "Never synced" : status.lastRun.status === "SUCCESS" ? "Synced" : status.lastRun.status === "PARTIAL" ? "Partial" : "Sync Failed";
  const statusVariant = syncRunning ? "info" : status?.lastRun?.status === "SUCCESS" ? "success" : status?.lastRun?.status === "PARTIAL" ? "warning" : status?.lastRun ? "critical" : "neutral";

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Fantasy ERP — Live Data"
        actions={
          canSync ? (
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" aria-label="Fantasy export file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f); }} />
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={syncRunning || importing} onClick={() => fileRef.current?.click()} title="Import the Fantasy lot grid export (.xlsx / .csv) through the same sync">
                <Upload className={`h-3.5 w-3.5 ${importing ? "animate-pulse" : ""}`} /> {importing ? "Importing…" : "Import Export"}
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1.5" disabled={syncRunning || importing} onClick={handleSyncNow}>
                <RefreshCw className={`h-3.5 w-3.5 ${syncRunning ? "animate-spin" : ""}`} /> {syncRunning ? "Syncing…" : "Sync Now"}
              </Button>
            </div>
          ) : undefined
        }
        meta={
          <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
            <span>Last successful sync: <span className="text-foreground font-medium">{fmtDate(status?.lastSuccessfulSyncAt)}</span></span>
            <span>·</span>
            <span><span className="text-foreground font-medium tabular-nums">{(status?.recordsInDatabase ?? 0).toLocaleString()}</span> records{status?.staleRecords ? ` (${status.staleRecords.toLocaleString()} stale)` : ""}</span>
            {status?.lastRun?.trigger === "IMPORT" || status?.lastRun?.sourceMode === "FILE_IMPORT" ? <><span>·</span><span>Last run: file import</span></> : null}
            <span>·</span>
            <span>Auto Sync: <span className="text-foreground font-medium">{status?.scheduler?.enabled ? `ON (every ${status.scheduler.intervalMinutes} min)` : "OFF"}</span></span>
            <Badge variant={statusVariant}>{statusLabel}</Badge>
          </div>
        }
      />

      {lastRunFailed && !syncRunning && (
        <InfoBanner variant="warning">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              <span title={status?.lastRun?.errorDetail ?? undefined}>
                <strong>Fantasy sync failed.</strong> {status?.lastRun?.errorSummary ?? "Unable to synchronize Fantasy ERP."}
                {status?.lastSuccessfulSyncAt ? ` Last successful data from ${fmtDate(status.lastSuccessfulSyncAt)} remains available.` : " No successful sync yet."}
                {status?.lastRun?.errorCode === "UPSTREAM_ERROR" && canSync && " Until Fantasy fixes the endpoint, use Import Export with the grid's Excel/CSV export."}
              </span>
            </span>
            {canSync && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={handleSyncNow} disabled={syncRunning}>
                <Activity className="h-3 w-3" /> Retry
              </Button>
            )}
          </div>
        </InfoBanner>
      )}
      {status && !status.configured && (
        <InfoBanner variant="warning">Fantasy ERP integration is not configured. Set the FANTASY_API_* variables on the server.</InfoBanner>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search Lot ID, Lot Name, Certificate No, Doc ID, ItemName, Metal ID…" className="h-8 text-xs w-72" aria-label="Search live data" />
        <FilterSelect label="Lot Status DB" value={filters.lotStatusDb} onChange={setFilter("lotStatusDb")} options={facets?.lotStatusDb ?? []} />
        <FilterSelect label="Process Name" value={filters.processName} onChange={setFilter("processName")} options={facets?.processName ?? []} />
        <FilterSelect label="Shape" value={filters.shape} onChange={setFilter("shape")} options={facets?.shape ?? []} width="130px" />
        <FilterSelect label="Lab Name" value={filters.labName} onChange={setFilter("labName")} options={facets?.labName ?? []} width="130px" />
        <FilterSelect label="Company ID" value={filters.companyId} onChange={setFilter("companyId")} options={facets?.companyId ?? []} width="130px" />
        <FilterSelect label="Department" value={filters.departmentAccountName} onChange={setFilter("departmentAccountName")} options={facets?.departmentAccountName ?? []} width="170px" />
        <FilterSelect label="On Hold" value={filters.onHold} onChange={setFilter("onHold")} options={["true", "false"]} width="110px" />
      </div>

      <Section title="Lots" description={`${(data?.totalRecords ?? 0).toLocaleString()} matching records · Source: Fantasy ERP · sorted by ${LIVE_LOT_FIELDS.find((f) => f.field === sort.by)?.header ?? sort.by} ${sort.order}`}>
        {isError ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Unable to load Live Data. <Button size="sm" variant="outline" className="h-7 text-xs ml-2" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <>
            <DataTable<LiveLotRow>
              columns={columns}
              rows={rows}
              loading={isLoading}
              emptyMessage={status?.lastRun ? "No records match the current filters." : "No Fantasy data synchronized yet. Use Sync Now or wait for the scheduled run."}
              initialSortKey={sort.by}
              initialSortDir={sort.order}
              exportable
              exportPermission="fantasy.read"
              exportScope="current-page"
              exportFilename={`fantasy-live-data-page-${page}.csv`}
              toolbar={
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger size="sm" className="h-7 w-[92px] text-[11px]" aria-label="Rows per page"><SelectValue /></SelectTrigger>
                  <SelectContent>{[50, 100, 200, 500].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n} / page</SelectItem>)}</SelectContent>
                </Select>
              }
            />
            <div className="pt-2 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                Sort:
                <Select value={sort.by} onValueChange={(v) => { setSort((s) => ({ ...s, by: v })); setPage(1); }}>
                  <SelectTrigger size="sm" className="h-7 w-[170px] text-[11px]" aria-label="Sort column"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lastSeenAt" className="text-xs">Last Seen</SelectItem>
                    {LIVE_LOT_FIELDS.map((f) => <SelectItem key={f.field} value={f.field} className="text-xs">{f.header}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setSort((s) => ({ ...s, order: s.order === "asc" ? "desc" : "asc" }))}>{sort.order === "asc" ? "Ascending" : "Descending"}</Button>
              </div>
              <ServerPagination page={data?.page ?? page} pageSize={pageSize} total={data?.totalRecords ?? 0} hasMore={(data?.page ?? page) < (data?.totalPages ?? 1)} onPageChange={setPage} />
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
