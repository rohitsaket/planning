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
import { AlertTriangle, FlaskConical, Info, PackageX, Search, Target, X } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * STOCKOUT RISK — which categories have confirmed demand that available finished
 * polished stock does not cover.
 *
 * Every figure is read from the API exactly as returned. This file performs no business
 * arithmetic: the shortage shown here is the shortage the demand engine stored, which is
 * what makes this page and Demand Overview the same answer rather than two answers that
 * happen to look alike.
 *
 * The page it replaces projected forecast predictions against available stock and ranked
 * the result CRITICAL / HIGH / MEDIUM — a risk model nobody approved, over numbers that
 * were not the confirmed shortage.
 */

type StockoutState = "OUT_OF_STOCK" | "SHORTAGE" | "COVERED" | "EXCESS" | "REVIEW_REQUIRED";
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
  countryScopeSupported: false;
  countryScopeNotice: string;
}

interface StockoutRow {
  categoryId: string;
  categoryLabel: string;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  sales90d: number;
  targetQuantity: number;
  physicalAvailable: number;
  physicalShortage: number;
  memoQuantity: number;
  wipQuantity: number;
  stockoutState: StockoutState;
  dataState: DataState;
}

interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

interface CategoriesResponse {
  available: boolean;
  runId: string | null;
  unavailableMessage: string | null;
  rows: StockoutRow[];
  paging: PagingMeta;
  totals: {
    categoriesWithShortage: number;
    categoriesOutOfStock: number;
    totalTargetQuantity: number;
    totalPhysicalAvailable: number;
    totalPhysicalShortage: number;
    categoriesRequiringReview: number;
  };
  sort: { key: string; dir: string };
}

interface DetailResponse {
  available: boolean;
  runId: string | null;
  detail:
    | ({ found: true } & StockoutRow & {
        reservedQuantity: number;
        blockedQuantity: number;
        excessQuantity: number;
        segments: Array<{ key: string; label: string; quantity: number }>;
        trend: string;
        latestSaleDateIst: string | null;
        contributingStockLots: number;
        excludedRecords: number;
      })
    | { found: false; categoryId: string; message: string };
}

const STATE_LABELS: Record<StockoutState, string> = {
  OUT_OF_STOCK: "Out of stock",
  SHORTAGE: "Shortage",
  COVERED: "Covered",
  EXCESS: "Excess",
  REVIEW_REQUIRED: "Review required",
};

const STATE_VARIANT: Record<StockoutState, "critical" | "warning" | "success" | "info" | "default"> = {
  OUT_OF_STOCK: "critical",
  SHORTAGE: "warning",
  COVERED: "success",
  EXCESS: "info",
  REVIEW_REQUIRED: "default",
};

const SORT_OPTIONS = [
  { value: "physicalShortage", label: "Physical shortage" },
  { value: "target", label: "Target quantity" },
  { value: "available", label: "Physical available" },
  { value: "sales90d", label: "Confirmed sales 90D" },
  { value: "category", label: "Category" },
];

const PAGE_SIZE = 25;

export function StockoutView() {
  const trace = useNavStore((s) => s.trace);
  const openDemandTrace = useNavStore((s) => s.openDemandTrace);
  const setView = useNavStore((s) => s.setView);
  const setTraceCategory = useNavStore((s) => s.setTraceCategory);
  const clearTraceCategory = useNavStore((s) => s.clearTraceCategory);
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const globalFilter = useGlobalFilter();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [dataStateFilter, setDataStateFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState("physicalShortage");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [shortageOnly, setShortageOnly] = useState(true);

  const canExport = perms.includes("analysis.export");
  const canRunDemand = perms.includes("demand.run");

  // The category comes from the URL/nav context, never from the first row.
  const selectedCategory = trace?.category ?? null;
  const requestedRunId = trace?.runId ?? null;

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (requestedRunId) p.set("runId", requestedRunId);
    // Lab is a real dimension of the stored result; country and branch are not.
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    if (appliedSearch) p.set("search", appliedSearch);
    if (stateFilter) p.set("stockoutState", stateFilter);
    if (dataStateFilter) p.set("dataState", dataStateFilter);
    p.set("shortageOnly", String(shortageOnly));
    p.set("sort", sortKey);
    p.set("dir", sortDir);
    return p;
  }, [requestedRunId, globalFilter.lab, appliedSearch, stateFilter, dataStateFilter, shortageOnly, sortKey, sortDir]);

  const url = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(qs);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/api/analysis/stockout?${p.toString()}`;
  };

  const status = useApi<SnapshotStatus>(url({ section: "status" }));
  const categories = useApi<CategoriesResponse>(url({ section: "categories", page, pageSize: PAGE_SIZE }));
  const detail = useApi<DetailResponse>(
    selectedCategory ? url({ section: "detail", category: selectedCategory }) : "",
  );

  const s = status.data;
  const totals = categories.data?.totals;
  const hasRun = s?.hasRun ?? false;
  const scopeIgnored = Boolean(globalFilter.country || globalFilter.branch);

  const applySearch = () => { setAppliedSearch(search.trim()); setPage(1); };
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns: Column<StockoutRow>[] = [
    {
      key: "categoryId", header: "Category", width: "18rem", sticky: "left",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          // The canonical key is carried verbatim.
          onClick={() => setTraceCategory(r.categoryId)}
          title={r.categoryId}
        >
          {r.categoryLabel}
        </button>
      ),
    },
    { key: "lab", header: "Lab", width: "6rem", cell: (r) => <span className="text-muted-foreground">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", width: "8rem", cell: (r) => <span className="text-muted-foreground">{r.shape ?? "—"}</span> },
    { key: "weightBand", header: "Weight Band", width: "9rem", cell: (r) => <span className="text-muted-foreground">{r.weightBand ?? "—"}</span> },
    { key: "sales90d", header: "Confirmed sales 90D (pcs)", align: "right", cell: (r) => <NumberCell value={r.sales90d} /> },
    { key: "targetQuantity", header: "Target (pcs)", align: "right", cell: (r) => <NumberCell value={r.targetQuantity} intent="info" /> },
    { key: "physicalAvailable", header: "Physical available polished (pcs)", align: "right", cell: (r) => <NumberCell value={r.physicalAvailable} intent="success" /> },
    { key: "physicalShortage", header: "Physical shortage (pcs)", align: "right", cell: (r) => <NumberCell value={r.physicalShortage} intent="critical" zeroAsDash /> },
    { key: "memoQuantity", header: "Memo — advisory (pcs)", align: "right", cell: (r) => <NumberCell value={r.memoQuantity} zeroAsDash /> },
    { key: "wipQuantity", header: "WIP — separate (pcs)", align: "right", cell: (r) => <NumberCell value={r.wipQuantity} zeroAsDash /> },
    {
      key: "stockoutState", header: "Stockout state", width: "10rem",
      cell: (r) => <Badge variant={STATE_VARIANT[r.stockoutState]}>{STATE_LABELS[r.stockoutState]}</Badge>,
      exportValue: (r) => STATE_LABELS[r.stockoutState],
    },
    {
      key: "dataState", header: "Data state", width: "9rem",
      cell: (r) => (
        <Badge variant={r.dataState === "CONFIRMED" ? "success" : "warning"}>{r.dataState.replace(/_/g, " ")}</Badge>
      ),
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
        title="Stockout Risk"
        subtitle="Categories whose confirmed demand is not covered by physically available finished polished stock"
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
                onClick={() => window.open(`/api/analysis/stockout/export?${qs.toString()}`, "_blank")}
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

      {/* Business totals. Never zeros when there is no run. */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Categories with shortage" value={hasRun ? (totals?.categoriesWithShortage ?? 0) : "NOT RUN"} intent="warning" icon={AlertTriangle} hint="Target not covered by available finished stock" />
        <KpiCard label="Out of stock" value={hasRun ? (totals?.categoriesOutOfStock ?? 0) : "NOT RUN"} intent="critical" icon={PackageX} hint="Target exists and nothing is available" />
        <KpiCard label="Target quantity" value={hasRun ? (totals?.totalTargetQuantity ?? 0) : "NOT RUN"} unit="pcs" intent="info" icon={Target} hint="Across matching categories" />
        <KpiCard label="Physical available" value={hasRun ? (totals?.totalPhysicalAvailable ?? 0) : "NOT RUN"} unit="pcs" intent="success" hint="Finished polished stock only" />
        <KpiCard label="Physical shortage" value={hasRun ? (totals?.totalPhysicalShortage ?? 0) : "NOT RUN"} unit="pcs" intent="critical" hint="As calculated by the demand run" />
        <KpiCard label="Needing review" value={hasRun ? (totals?.categoriesRequiringReview ?? 0) : "NOT RUN"} intent="default" hint="Excluded from the totals shown here" />
      </div>

      <Section
        title="Categories"
        description={
          hasRun
            ? "Shortage as calculated by the selected demand run. Memo is advisory and WIP is shown separately; neither reduces the shortage."
            : "Stockout risk comes from a completed 90-day demand calculation."
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
            <Select value={stateFilter || "__all"} onValueChange={resetPage((v: string) => setStateFilter(v === "__all" ? "" : v))}>
              <SelectTrigger size="sm" className="h-8 w-[10rem] text-xs"><SelectValue placeholder="All states" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All states</SelectItem>
                {(Object.keys(STATE_LABELS) as StockoutState[]).map((k) => (
                  <SelectItem key={k} value={k}>{STATE_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={dataStateFilter || "__all"} onValueChange={resetPage((v: string) => setDataStateFilter(v === "__all" ? "" : v))}>
              <SelectTrigger size="sm" className="h-8 w-[9rem] text-xs"><SelectValue placeholder="All data states" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All data states</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                <SelectItem value="REVIEW_REQUIRED">Review required</SelectItem>
                <SelectItem value="BLOCKED">Blocked</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={resetPage(setSortKey)}>
              <SelectTrigger size="sm" className="h-8 w-[11rem] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>Sort: {o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setSortDir(sortDir === "desc" ? "asc" : "desc"); setPage(1); }}>
              {sortDir === "desc" ? "Desc" : "Asc"}
            </Button>
            <Button size="sm" variant={shortageOnly ? "default" : "outline"} className="h-8" onClick={() => { setShortageOnly(!shortageOnly); setPage(1); }}>
              {shortageOnly ? "Shortage only" : "All categories"}
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

      {selectedCategory && (
        <Section
          title="Category detail"
          description={selectedCategory}
          actions={
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={clearTraceCategory}>
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          }
        >
          {detail.isLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Loading category detail…</div>
          ) : detail.data?.detail.found === false ? (
            <EmptyState
              title="Category not in this run"
              message={detail.data.detail.message}
              icon={<Info className="h-5 w-5" />}
            />
          ) : detail.data?.detail.found === true ? (
            <CategoryDetail d={detail.data.detail} onTrace={() => openDemandTrace({ runId: detail.data?.runId ?? null, category: selectedCategory })} />
          ) : null}
        </Section>
      )}
    </div>
  );
}

/** Business supporting figures only — no formula, no source table, no rule identifier. */
function CategoryDetail({
  d,
  onTrace,
}: {
  d: Extract<DetailResponse["detail"], { found: true }>;
  onTrace: () => void;
}) {
  const figures: Array<[string, number | string]> = [
    ["Confirmed sales 90D (pcs)", d.sales90d],
    ["Target (pcs)", d.targetQuantity],
    ["Physical available polished (pcs)", d.physicalAvailable],
    ["Physical shortage (pcs)", d.physicalShortage],
    ["Memo — advisory (pcs)", d.memoQuantity],
    ["Reserved (pcs)", d.reservedQuantity],
    ["Blocked (pcs)", d.blockedQuantity],
    ["WIP — separate (pcs)", d.wipQuantity],
    ["Excess (pcs)", d.excessQuantity],
    ["Contributing stock lots", d.contributingStockLots],
    ["Records needing review", d.excludedRecords],
    ["Latest confirmed sale", d.latestSaleDateIst ?? "—"],
  ];

  return (
    <div className="space-y-3 px-3 pb-3">
      <div className="flex flex-wrap gap-2 text-[11px]">
        {d.segments.map((seg) => (
          <Badge key={seg.key} variant="info">{seg.label}: {seg.quantity} pcs</Badge>
        ))}
        <Badge variant="default">Trend: {d.trend.replace(/_/g, " ")}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs md:grid-cols-3 lg:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums font-medium">{value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7" onClick={onTrace}>
          Open in Demand Trace
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Record-level evidence lives in Demand Trace, subject to its own permissions.
        </span>
      </div>
    </div>
  );
}
