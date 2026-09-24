"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useAuthStore } from "@/stores/auth-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FlaskConical, Info, Layers, Package, Search, Target } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * EXCESS STOCK — categories holding more available finished polished stock than the
 * demand target stored for them.
 *
 * The factual counterpart of Stockout Risk, and read the same way: every figure comes
 * from the API exactly as returned, so this file performs no business arithmetic. The
 * page it replaces carried the shortage and excess formulas in its subtitle, its banner
 * and a KPI hint, and loaded every category in one unpaged response.
 */

type ExcessState = "EXCESS" | "AT_TARGET" | "BELOW_TARGET" | "NO_TARGET" | "REVIEW_REQUIRED";
type DataState = "CONFIRMED" | "REVIEW_REQUIRED" | "BLOCKED";

interface SnapshotStatus {
  sourceDisclosure: SourceDisclosure | null;
  hasRun: boolean;
  runId: string | null;
  sourceState: "SIMULATION" | "LIVE";
  sourceLabel: string;
  runCompletedIst: string | null;
  businessDateIst: string | null;
  periodLabel: string;
  inventoryCutoffIst: string | null;
  inventoryChangedSinceRun: boolean;
  latestInventoryObservedIst: string | null;
  staleWarning: string | null;
  reviewWarning: string | null;
  unavailableMessage: string | null;
  availabilityMessage: string;
  countryScopeNotice: string;
}

interface ExcessRow {
  categoryId: string;
  categoryLabel: string;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  sales90d: number;
  targetQuantity: number;
  physicalAvailable: number;
  excessQuantity: number;
  memoQuantity: number;
  wipQuantity: number;
  latestSaleDateIst: string | null;
  excessState: ExcessState;
  dataState: DataState;
}

interface CategoriesResponse {
  available: boolean;
  runId: string | null;
  unavailableMessage: string | null;
  rows: ExcessRow[];
  paging: { page: number; pageSize: number; total: number; hasMore: boolean };
  totals: {
    categoriesWithExcess: number;
    totalPhysicalAvailable: number;
    totalTargetQuantity: number;
    totalExcessQuantity: number;
    categoriesRequiringReview: number;
  };
}

const STATE_LABELS: Record<ExcessState, string> = {
  EXCESS: "Stock held above target",
  AT_TARGET: "At target",
  BELOW_TARGET: "Below target",
  NO_TARGET: "No target",
  REVIEW_REQUIRED: "Review required",
};

const STATE_VARIANT: Record<ExcessState, "info" | "success" | "warning" | "default"> = {
  EXCESS: "info",
  AT_TARGET: "success",
  BELOW_TARGET: "warning",
  NO_TARGET: "default",
  REVIEW_REQUIRED: "default",
};

const SORT_OPTIONS = [
  { value: "excess", label: "Excess quantity" },
  { value: "available", label: "Physical available" },
  { value: "target", label: "Target quantity" },
  { value: "sales90d", label: "Confirmed sales 90D" },
  { value: "category", label: "Category" },
];

const PAGE_SIZE = 25;

export function ExcessView() {
  const trace = useNavStore((s) => s.trace);
  const openDemandTrace = useNavStore((s) => s.openDemandTrace);
  const setView = useNavStore((s) => s.setView);
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const globalFilter = useGlobalFilter();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sortKey, setSortKey] = useState("excess");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [excessOnly, setExcessOnly] = useState(true);

  const canExport = perms.includes("analysis.export");
  const canRunDemand = perms.includes("demand.run");
  const requestedRunId = trace?.runId ?? null;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (requestedRunId) p.set("runId", requestedRunId);
    // Lab is a real dimension of the stored result; country and branch are not.
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    if (appliedSearch) p.set("search", appliedSearch);
    if (stateFilter) p.set("excessState", stateFilter);
    p.set("excessOnly", String(excessOnly));
    p.set("sort", sortKey);
    p.set("dir", sortDir);
    return p;
  }, [requestedRunId, globalFilter.lab, appliedSearch, stateFilter, excessOnly, sortKey, sortDir]);

  const url = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/api/analysis/excess?${p.toString()}`;
  };

  const status = useApi<SnapshotStatus>(url({ section: "status" }));
  const categories = useApi<CategoriesResponse>(url({ section: "categories", page, pageSize: PAGE_SIZE }));

  const s = status.data;
  const totals = categories.data?.totals;
  const hasRun = s?.hasRun ?? false;
  const scopeIgnored = Boolean(globalFilter.country || globalFilter.branch);

  const applySearch = () => { setAppliedSearch(search.trim()); setPage(1); };

  const columns: Column<ExcessRow>[] = [
    {
      key: "categoryId", header: "Category", width: "18rem", sticky: "left",
      cell: (r) => <span className="font-medium" title={r.categoryId}>{r.categoryLabel}</span>,
    },
    { key: "lab", header: "Lab", width: "6rem", cell: (r) => <span className="text-muted-foreground">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", width: "8rem", cell: (r) => <span className="text-muted-foreground">{r.shape ?? "—"}</span> },
    { key: "weightBand", header: "Weight Band", width: "9rem", cell: (r) => <span className="text-muted-foreground">{r.weightBand ?? "—"}</span> },
    { key: "sales90d", header: "Confirmed sales 90D (pcs)", align: "right", cell: (r) => <NumberCell value={r.sales90d} /> },
    { key: "targetQuantity", header: "Target (pcs)", align: "right", cell: (r) => <NumberCell value={r.targetQuantity} intent="info" /> },
    { key: "physicalAvailable", header: "Physical available polished (pcs)", align: "right", cell: (r) => <NumberCell value={r.physicalAvailable} intent="success" /> },
    { key: "excessQuantity", header: "Excess (pcs)", align: "right", cell: (r) => <NumberCell value={r.excessQuantity} intent="warning" zeroAsDash /> },
    { key: "memoQuantity", header: "Memo — advisory (pcs)", align: "right", cell: (r) => <NumberCell value={r.memoQuantity} zeroAsDash /> },
    { key: "wipQuantity", header: "WIP — separate (pcs)", align: "right", cell: (r) => <NumberCell value={r.wipQuantity} zeroAsDash /> },
    {
      key: "latestSaleDateIst", header: "Latest confirmed sale", width: "10rem",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.latestSaleDateIst ?? "—"}</span>,
    },
    {
      key: "excessState", header: "Excess state", width: "12rem",
      cell: (r) => <Badge variant={STATE_VARIANT[r.excessState]}>{STATE_LABELS[r.excessState]}</Badge>,
      exportValue: (r) => STATE_LABELS[r.excessState],
    },
    {
      key: "dataState", header: "Data state", width: "9rem",
      cell: (r) => <Badge variant={r.dataState === "CONFIRMED" ? "success" : "warning"}>{r.dataState.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "trace", header: "Trace", width: "6rem",
      cell: (r) => (
        <Button
          size="sm" variant="outline" className="h-6 px-2 text-[11px]"
          // The exact run and the exact category, so Demand Trace opens what was clicked.
          onClick={() => openDemandTrace({ runId: categories.data?.runId ?? null, category: r.categoryId })}
        >
          Trace
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-3">
      <PageHeader
        title="Excess Stock"
        subtitle="Categories holding more available finished polished stock than the stored demand target"
        actions={
          <div className="flex items-center gap-2">
            {canRunDemand && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setView("demand-overview")}>
                Refresh demand
              </Button>
            )}
            {canExport && hasRun && (
              <Button
                size="sm" variant="outline" className="h-8"
                onClick={() => window.open(`/api/analysis/excess/export?${qs.toString()}`, "_blank")}
              >
                Export CSV
              </Button>
            )}
          </div>
        }
      />

      {/* Compact source and snapshot status — no rule version, fingerprint or checkpoint. */}
      {s && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
            <Badge variant={s.sourceState === "SIMULATION" ? "info" : "success"} className="gap-1">
              {s.sourceState === "SIMULATION" && <FlaskConical className="h-3 w-3" />}
              {s.sourceLabel}
            </Badge>
            {s.runCompletedIst && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Demand calculated {s.runCompletedIst} IST</span>
              </>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{s.periodLabel}</span>
            {s.businessDateIst && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Business cutoff {s.businessDateIst} IST</span>
              </>
            )}
            {s.inventoryCutoffIst && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Inventory as at {s.inventoryCutoffIst} IST</span>
              </>
            )}
          </div>

          {/* Persistent and unmistakable while fixture data is on screen. */}
          <SimulationBanner disclosure={s.sourceDisclosure} />
          {s.reviewWarning && <InfoBanner variant="warning">{s.reviewWarning}</InfoBanner>}
          {s.staleWarning && (
            <InfoBanner variant="critical">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {s.staleWarning}
                  {s.latestInventoryObservedIst && (
                    <span className="text-muted-foreground"> Latest stock observed {s.latestInventoryObservedIst} IST.</span>
                  )}
                </span>
                {canRunDemand && (
                  <Button size="sm" variant="outline" className="h-6" onClick={() => setView("demand-overview")}>
                    Refresh demand
                  </Button>
                )}
              </div>
            </InfoBanner>
          )}
          {scopeIgnored && (
            <InfoBanner variant="info">
              The country and branch filters do not apply to this page. {s.countryScopeNotice}
            </InfoBanner>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        <KpiCard label="Categories with excess" value={hasRun ? (totals?.categoriesWithExcess ?? 0) : "NOT RUN"} intent="info" icon={Layers} hint="Available finished stock above target" />
        <KpiCard label="Physical available" value={hasRun ? (totals?.totalPhysicalAvailable ?? 0) : "NOT RUN"} unit="pcs" intent="success" icon={Package} hint="Finished polished stock only" />
        <KpiCard label="Target quantity" value={hasRun ? (totals?.totalTargetQuantity ?? 0) : "NOT RUN"} unit="pcs" intent="info" icon={Target} hint="Across matching categories" />
        <KpiCard label="Excess quantity" value={hasRun ? (totals?.totalExcessQuantity ?? 0) : "NOT RUN"} unit="pcs" intent="warning" hint="As calculated by the demand run" />
        <KpiCard label="Needing review" value={hasRun ? (totals?.categoriesRequiringReview ?? 0) : "NOT RUN"} intent="default" hint="Excluded from the totals shown here" />
      </div>

      <Section
        title="Categories"
        description={
          hasRun
            ? "Stock above target as calculated by the selected demand run. Memo is advisory and WIP is shown separately; neither is finished-stock excess."
            : "Excess comes from a completed 90-day demand calculation."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                placeholder="Category…"
                className="h-8 w-44 pl-7 text-xs"
              />
            </div>
            <Select value={stateFilter || "__all"} onValueChange={(v) => { setStateFilter(v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger size="sm" className="h-8 w-[13rem] text-xs"><SelectValue placeholder="All states" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All states</SelectItem>
                {(Object.keys(STATE_LABELS) as ExcessState[]).map((k) => (
                  <SelectItem key={k} value={k}>{STATE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={(v) => { setSortKey(v); setPage(1); }}>
              <SelectTrigger size="sm" className="h-8 w-[11rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>Sort: {o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setSortDir(sortDir === "desc" ? "asc" : "desc"); setPage(1); }}>
              {sortDir === "desc" ? "Desc" : "Asc"}
            </Button>
            <Button size="sm" variant={excessOnly ? "default" : "outline"} className="h-8" onClick={() => { setExcessOnly(!excessOnly); setPage(1); }}>
              {excessOnly ? "Excess only" : "All categories"}
            </Button>
          </div>
        }
      >
        {s && !hasRun ? (
          <EmptyState
            title="NOT RUN"
            message={s.unavailableMessage ?? s.availabilityMessage}
            icon={<Info className="h-5 w-5" />}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={categories.data?.rows ?? []}
              loading={categories.isLoading}
              emptyMessage="No category matches the active filters."
              pagination={false}
              exportScope="current-page"
            />
            <ServerPagination
              page={categories.data?.paging.page ?? 1}
              pageSize={categories.data?.paging.pageSize ?? PAGE_SIZE}
              total={categories.data?.paging.total ?? 0}
              hasMore={categories.data?.paging.hasMore ?? false}
              onPageChange={setPage}
              loading={categories.isLoading}
              label="categories"
            />
          </>
        )}
      </Section>
    </div>
  );
}
