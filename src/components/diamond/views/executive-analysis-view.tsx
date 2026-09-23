"use client";

import { useMemo, useState } from "react";
import { useApi, apiPost } from "@/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { toast } from "sonner";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, FlaskConical, Info, Search, TrendingUp, Package, Scale,
} from "lucide-react";

/**
 * EXECUTIVE ANALYSIS — past sales → demand → available inventory → shortage/excess.
 *
 * A read-oriented summary of results the backend already owns. Every number on this page
 * is displayed exactly as the API returned it: there is no arithmetic in this file, and
 * no formula, rule identifier or calculation step is shown to the user.
 *
 * Tables page, sort and filter on the server. The client holds one page at a time.
 */

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

type ReadinessState =
  | "CURRENT" | "SIMULATED" | "STALE" | "DEGRADED" | "FAILED" | "UNAVAILABLE" | "NOT_RUN" | "UNKNOWN";

interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

interface ActiveFilter { key: string; value: string }

interface ReadinessResponse {
  rows: Array<{ key: string; label: string; value: string; state: ReadinessState }>;
  isSimulated: boolean;
  sourceLabel: string;
  demandRunId: string | null;
  demandRunAtIst: string | null;
  hasCompletedRun: boolean;
  demandMayNeedRecalculation: boolean;
  blockingDataQualityIssues: number;
  availability: string;
  availabilityMessage: string;
  refreshRequired: boolean;
  canonicalRecordCount: number;
  ineligibleRuns: Array<{ runId: string; reasons: string[] }>;
  activeFilters: ActiveFilter[];
}

interface CategoryStatus { code: string; label: string }

interface SalesDemandResponse {
  rows: Array<{
    category: string; label: string; lab: string; shape: string; weightBand: string;
    sales90d: number; earliest30: number | null; middle30: number | null; latest30: number | null;
    target: number; trend: string | null; status: CategoryStatus;
  }>;
  meta: PageMeta;
  runId: string | null;
  runAtIst: string | null;
  windowDays: number | null;
  businessDateIst: string | null;
  available: boolean;
  unavailableReason: string | null;
  salesWindowsAvailable: boolean;
  salesWindowsUnavailableReason: string | null;
  locationFilterApplies: boolean;
  activeFilters: ActiveFilter[];
}

interface InventoryResponse {
  rows: Array<{
    country: string; branch: string;
    physicalAvailablePolished: number; reserved: number; memo: number; wip: number;
    roughAvailable: number; heldOrExcluded: number; unclassified: number;
    totalClassified: number; lastSourceUpdateIst: string | null;
  }>;
  meta: PageMeta;
  isSimulated: boolean;
  available: boolean;
  activeFilters: ActiveFilter[];
}

interface ShortageExcessResponse {
  rows: Array<{
    category: string; label: string; target: number; physicalAvailable: number;
    physicalShortage: number; excess: number; reserved: number; memo: number;
    wip: number | null; status: CategoryStatus;
  }>;
  meta: PageMeta;
  runId: string | null;
  runAtIst: string | null;
  available: boolean;
  unavailableReason: string | null;
  wipCoverage: { available: boolean; appliedInRun: boolean; message: string };
  activeFilters: ActiveFilter[];
}

interface AttentionResponse {
  rows: Array<{
    kind: string; subject: string; detail: string; count: number;
    action: string; category: string | null;
  }>;
  meta: PageMeta;
  activeFilters: ActiveFilter[];
}

// ---------------------------------------------------------------------------
// Presentation helpers (display only — no business arithmetic)
// ---------------------------------------------------------------------------

/** Advisory quantities are visually separated from confirmed facts, never colour-coded as stock. */
function Advisory({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground italic text-xs">Unavailable</span>;
  return (
    <span className="text-muted-foreground">
      {value.toLocaleString()} <span className="text-[10px] uppercase tracking-wide">adv</span>
    </span>
  );
}

/**
 * A 30-day window count. Null means this demand run kept no per-sale trace, so the
 * window cannot be counted — which is not the same statement as "nothing sold".
 */
function WindowCount({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs italic text-muted-foreground">Unavailable</span>;
  return <NumberCell value={value} zeroAsDash />;
}

/**
 * Footer under a server-paged table.
 *
 * Delegates the counts and controls to the shared ServerPagination component and adds
 * only what it does not carry: the exact filters that produced these totals.
 */
function TableFooter({
  meta, filters, onPage, loading, label,
}: {
  meta: PageMeta | undefined;
  filters: ActiveFilter[] | undefined;
  onPage: (page: number) => void;
  loading: boolean;
  label: string;
}) {
  if (!meta) return null;
  return (
    <div>
      <ServerPagination
        page={meta.page}
        pageSize={meta.pageSize}
        total={meta.total}
        hasMore={meta.hasMore}
        onPageChange={onPage}
        loading={loading}
        label={label}
      />
      {filters && filters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border bg-muted/20 px-3 py-1 text-[11px] text-muted-foreground">
          <span>Active filters:</span>
          {filters.map((f) => (
            <Badge key={f.key} variant="info">{f.key}: {f.value}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 25;

type ExecutiveTab = "sales-demand" | "inventory" | "shortage-excess" | "attention";

const TABS: Array<{
  id: ExecutiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: "sales-demand",
    label: "Sales & Demand",
    icon: TrendingUp,
    description: "Confirmed sales windows and approved targets from the completed demand run",
  },
  {
    id: "inventory",
    label: "Inventory Position",
    icon: Package,
    description: "Current classified physical polished stock, memo, WIP, and rough stock by location",
  },
  {
    id: "shortage-excess",
    label: "Shortage & Excess",
    icon: Scale,
    description: "Gap analysis between physical available inventory and approved target demand",
  },
  {
    id: "attention",
    label: "Attention Required",
    icon: AlertTriangle,
    description: "Factual operational exceptions and required administrative actions",
  },
];

export function ExecutiveAnalysisView() {
  const setView = useNavStore((s) => s.setView);
  const openDemandTrace = useNavStore((s) => s.openDemandTrace);
  const globalFilter = useGlobalFilter();
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<ExecutiveTab>("sales-demand");
  const [salesPage, setSalesPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [gapPage, setGapPage] = useState(1);
  const [attentionPage, setAttentionPage] = useState(1);
  const [gapMode, setGapMode] = useState<"ALL" | "SHORTAGE_ONLY" | "EXCESS_ONLY">("ALL");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  // Global country/lab scope travels with every request; the server applies it.
  const scope = useMemo(() => {
    const p = new URLSearchParams();
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    return p.toString();
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(scope);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    if (appliedSearch) p.set("search", appliedSearch);
    return `/api/analysis/executive?${p.toString()}`;
  };

  const readiness = useApi<ReadinessResponse>(qs({ section: "readiness" }));
  const salesDemand = useApi<SalesDemandResponse>(
    qs({ section: "sales-demand", page: salesPage, pageSize: PAGE_SIZE, sort: "sales" }),
  );
  const inventory = useApi<InventoryResponse>(
    qs({ section: "inventory", page: inventoryPage, pageSize: PAGE_SIZE }),
  );
  const gaps = useApi<ShortageExcessResponse>(
    qs({ section: "shortage-excess", page: gapPage, pageSize: PAGE_SIZE, mode: gapMode, sort: "shortage" }),
  );
  const attention = useApi<AttentionResponse>(
    qs({ section: "attention", page: attentionPage, pageSize: PAGE_SIZE }),
  );

  const applySearch = () => {
    setAppliedSearch(search.trim());
    setSalesPage(1);
    setGapPage(1);
  };

  // ---------------------------------------------------------------- columns
  const salesColumns: Column<SalesDemandResponse["rows"][number]>[] = [
    {
      key: "label", header: "Category (Lab | Shape | Weight Band)", width: "20rem",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          onClick={() => setView("analysis-sales", "analysis")}
          title={r.category}
        >
          {r.label}
        </button>
      ),
    },
    { key: "sales90d", header: "Sales 90D", align: "right", cell: (r) => <NumberCell value={r.sales90d} /> },
    { key: "earliest30", header: "Prev 30D", align: "right", cell: (r) => <WindowCount value={r.earliest30} /> },
    { key: "middle30", header: "Mid 30D", align: "right", cell: (r) => <WindowCount value={r.middle30} /> },
    { key: "latest30", header: "Latest 30D", align: "right", cell: (r) => <WindowCount value={r.latest30} /> },
    { key: "target", header: "Approved Target", align: "right", cell: (r) => <NumberCell value={r.target} /> },
    {
      key: "trend", header: "Trend", align: "center", width: "9rem",
      cell: (r) => (r.trend === null ? <span className="text-xs italic text-muted-foreground">Unknown</span> : <Badge variant="default">{r.trend}</Badge>),
    },
    { key: "status", header: "Data State", align: "center", cell: (r) => <Badge variant="default">{r.status.label}</Badge>, width: "11rem" },
  ];

  const inventoryColumns: Column<InventoryResponse["rows"][number]>[] = [
    { key: "country", header: "Country", align: "center", width: "7rem", cell: (r) => <span className="font-medium">{r.country}</span> },
    {
      key: "branch", header: "Branch / Location", align: "center", width: "11rem",
      cell: (r) => (
        <button
          type="button"
          className="text-left text-primary hover:underline"
          onClick={() => setView("analysis-inventory-position")}
        >
          {r.branch}
        </button>
      ),
    },
    {
      key: "physicalAvailablePolished", header: "Physical Available (Polished)", align: "right",
      cell: (r) => <NumberCell value={r.physicalAvailablePolished} intent="success" />,
    },
    { key: "reserved", header: "Reserved", align: "right", cell: (r) => <Advisory value={r.reserved} /> },
    { key: "memo", header: "Memo", align: "right", cell: (r) => <Advisory value={r.memo} /> },
    { key: "wip", header: "Manufacturing WIP", align: "right", cell: (r) => <Advisory value={r.wip} /> },
    { key: "roughAvailable", header: "Rough Available", align: "right", cell: (r) => <Advisory value={r.roughAvailable} /> },
    {
      key: "heldOrExcluded", header: "Held / Excluded", align: "right",
      cell: (r) => <NumberCell value={r.heldOrExcluded} intent={r.heldOrExcluded > 0 ? "warning" : "default"} zeroAsDash />,
    },
    {
      key: "unclassified", header: "Unclassified", align: "right",
      cell: (r) => <NumberCell value={r.unclassified} intent={r.unclassified > 0 ? "warning" : "default"} zeroAsDash />,
    },
    { key: "totalClassified", header: "Total Records", align: "right", cell: (r) => <NumberCell value={r.totalClassified} /> },
    {
      key: "lastSourceUpdateIst", header: "Last Source Update", align: "center", width: "13rem",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSourceUpdateIst ?? "Unknown"}</span>,
    },
  ];

  const gapColumns: Column<ShortageExcessResponse["rows"][number]>[] = [
    { key: "label", header: "Category", width: "20rem", cell: (r) => <span className="font-medium" title={r.category}>{r.label}</span> },
    { key: "target", header: "Target", align: "right", cell: (r) => <NumberCell value={r.target} /> },
    {
      key: "physicalAvailable", header: "Physical Available", align: "right",
      cell: (r) => <NumberCell value={r.physicalAvailable} intent="success" />,
    },
    {
      key: "physicalShortage", header: "Physical Shortage", align: "right",
      cell: (r) => <NumberCell value={r.physicalShortage} intent={r.physicalShortage > 0 ? "critical" : "default"} zeroAsDash />,
    },
    {
      key: "excess", header: "Excess", align: "right",
      cell: (r) => <NumberCell value={r.excess} intent={r.excess > 0 ? "warning" : "default"} zeroAsDash />,
    },
    { key: "reserved", header: "Reserved", align: "right", cell: (r) => <Advisory value={r.reserved} /> },
    { key: "memo", header: "Memo", align: "right", cell: (r) => <Advisory value={r.memo} /> },
    { key: "wip", header: "WIP", align: "right", cell: (r) => <Advisory value={r.wip} /> },
    { key: "status", header: "Data State", align: "center", width: "11rem", cell: (r) => <Badge variant="default">{r.status.label}</Badge> },
    {
      key: "trace", header: "Trace", align: "center", width: "7rem",
      cell: (r) => (
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-xs"
          onClick={() => openDemandTrace({ runId: gaps.data?.runId ?? null, category: r.category })}
        >
          Trace
        </Button>
      ),
    },
  ];

  const attentionColumns: Column<AttentionResponse["rows"][number]>[] = [
    { key: "subject", header: "Subject", width: "20rem", cell: (r) => <span className="font-medium">{r.subject}</span> },
    { key: "detail", header: "Detail", cell: (r) => <span className="text-muted-foreground">{r.detail}</span> },
    {
      key: "count", header: "Records", align: "right",
      cell: (r) => (r.count > 0 ? <NumberCell value={r.count} /> : <span className="text-muted-foreground">—</span>),
    },
    {
      key: "action", header: "Action", align: "center", width: "12rem",
      cell: (r) => (
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-xs"
          onClick={() => {
            if (r.category) openDemandTrace({ runId: readiness.data?.demandRunId ?? null, category: r.category });
            else if (r.kind === "CATEGORY_BLOCKED_BY_DATA_QUALITY") setView("data-quality-issues");
            else if (r.kind.startsWith("INVENTORY")) setView("analysis-inventory-position");
            else if (r.kind === "SOURCE_DATA_STALE") setView("fantasy-sync");
            else setView("analysis-demand-trace");
          }}
        >
          {r.action}
        </Button>
      ),
    },
  ];

  const simulated = readiness.data?.isSimulated ?? false;
  const availability = readiness.data?.availability ?? null;
  const permissions = useAuthStore((st) => st.user?.permissions ?? []);
  // Hiding the button is UX. The server enforces demand.run on every request.
  const canRunDemand = permissions.includes("demand.run");

  const refresh = useMutation({
    mutationFn: () => apiPost<{ runId: string; salesCount: number }>("/api/analysis/refresh", {}),
    onSuccess: (r) => {
      toast.success(
        `Analysis recalculated — ${r.salesCount} confirmed sales in the 90-day window`,
      );
      // Every surface that reads the snapshot, so none keeps showing the previous one.
      const affected = [
        "/api/analysis/executive",
        "/api/analysis/sales",
        "/api/analysis/demand-trace",
        "/api/demand/history",
      ];
      for (const key of affected) {
        qc.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith(key),
        });
      }
    },
    onError: (e) => toast.error(`Analysis refresh failed: ${(e as Error).message}`),
  });

  return (
    <div className="space-y-3">
      <PageHeader
        title="Executive Analysis"
        subtitle="Past sales → demand → available inventory → shortage and excess"
        meta={
          readiness.data?.demandRunAtIst
            ? `Demand snapshot: ${readiness.data.demandRunAtIst}`
            : "No completed demand run"
        }
      />

      {/* Persistent and unmistakable while fixture data is active. */}
      {simulated && (
        <InfoBanner variant="warning">
          <span className="flex items-center gap-2 font-semibold">
            <FlaskConical className="h-4 w-4" />
            Source: Fixture Simulation — these figures are simulation output, not live Fantasy data.
          </span>
        </InfoBanner>
      )}

      {readiness.data?.demandMayNeedRecalculation && (
        <InfoBanner variant="warning">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Inventory was synchronized after this demand run finished, so the demand result may need
            recalculation. The figures below are the stored run and have not been recomputed here.
          </span>
        </InfoBanner>
      )}

      {/*
        The distinct availability states. REFRESH_REQUIRED is deliberately separate from
        "no data" and from "zero sales": Fantasy data exists, it has simply not been
        analysed yet, and showing zeros here would answer a question nobody asked.
      */}
      {availability !== null && availability !== "CURRENT" && (
        <InfoBanner variant={availability === "NO_FANTASY_DATA" ? "critical" : "warning"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              <span className="font-semibold">{availability.replace(/_/g, " ")}</span>
              <span>— {readiness.data?.availabilityMessage}</span>
            </span>
            {readiness.data?.refreshRequired && canRunDemand && (
              <Button
                size="sm"
                className="h-7"
                disabled={refresh.isPending}
                onClick={() => refresh.mutate()}
              >
                {refresh.isPending ? "Calculating…" : "Calculate 90-day analysis"}
              </Button>
            )}
            {readiness.data?.refreshRequired && !canRunDemand && (
              // No permission to run it here; the authoritative page is still reachable.
              <Button size="sm" variant="outline" className="h-7" onClick={() => setView("demand-overview")}>
                Open Demand Overview
              </Button>
            )}
          </div>
        </InfoBanner>
      )}

      {/*
        Legacy runs that exist but cannot back Analysis. Listed with their fixed reason
        codes so "why is it asking me to recalculate when runs exist?" has an answer.
      */}
      {readiness.data && readiness.data.ineligibleRuns.length > 0 && readiness.data.refreshRequired && (
        <InfoBanner variant="info">
          <div className="space-y-1">
            <span className="font-medium">
              {readiness.data.ineligibleRuns.length} earlier demand run
              {readiness.data.ineligibleRuns.length === 1 ? "" : "s"} cannot be used for analysis:
            </span>
            <ul className="ml-4 list-disc text-xs">
              {readiness.data.ineligibleRuns.slice(0, 5).map((r) => (
                <li key={r.runId}>{r.reasons.map((c) => c.replace(/_/g, " ").toLowerCase()).join(", ")}</li>
              ))}
            </ul>
          </div>
        </InfoBanner>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border bg-card/60 p-1 rounded-lg">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer",
                isActive
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* -------------------------------------- TAB 1: Sales and demand summary */}
      {activeTab === "sales-demand" && (
        <Section
          title="Sales and Demand"
          description={
            salesDemand.data?.available
              ? `Confirmed sales windows and approved targets from the demand run of ${salesDemand.data.runAtIst ?? "—"}${
                  salesDemand.data.businessDateIst ? ` (business date ${salesDemand.data.businessDateIst} IST)` : ""
                }.`
              : "Sales and target figures come from a completed demand run."
          }
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                  placeholder="Search category…"
                  className="h-8 w-56 pl-7 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-8" onClick={applySearch}>Apply</Button>
            </div>
          }
        >
          {salesDemand.data && !salesDemand.data.available ? (
            <EmptyState
              title="NOT RUN"
              message="No completed demand run exists, so sales and target figures are unavailable. This is not a zero."
              icon={<Info className="h-5 w-5" />}
            />
          ) : (
            <>
              {salesDemand.data && !salesDemand.data.salesWindowsAvailable && (
                <InfoBanner variant="info">
                  This demand run kept no per-sale trace, so the 30-day windows cannot be counted from
                  it. They are shown as unavailable rather than as zero, which would contradict the
                  90-day total. Re-running the demand calculation records the trace.
                </InfoBanner>
              )}
              {salesDemand.data && !salesDemand.data.locationFilterApplies && (globalFilter.country || globalFilter.branch) && (
                <InfoBanner variant="info">
                  Demand categories have no location dimension, so the country and branch filters do not
                  narrow this table. They apply to Inventory Position.
                </InfoBanner>
              )}
              <DataTable
                columns={salesColumns}
                rows={salesDemand.data?.rows ?? []}
                loading={salesDemand.isLoading}
                emptyMessage="No categories match the active filters."
                pagination={false}
                exportScope="current-page"
              />
              <TableFooter
                meta={salesDemand.data?.meta}
                filters={salesDemand.data?.activeFilters}
                onPage={setSalesPage}
                loading={salesDemand.isLoading}
                label="rows"
              />
            </>
          )}
        </Section>
      )}

      {/* ------------------------------------------ TAB 2: Inventory position */}
      {activeTab === "inventory" && (
        <Section
          title="Inventory Position"
          description="Current classified inventory by location. Only physical available polished stock can meet finished-diamond demand; every other bucket is shown separately."
        >
          {inventory.data && !inventory.data.available ? (
            <EmptyState
              title="No classified inventory"
              message="No current inventory records are available for the active filters."
              icon={<Info className="h-5 w-5" />}
            />
          ) : (
            <>
              <DataTable
                columns={inventoryColumns}
                rows={inventory.data?.rows ?? []}
                loading={inventory.isLoading}
                emptyMessage="No locations match the active filters."
                pagination={false}
                exportScope="current-page"
              />
              <TableFooter
                meta={inventory.data?.meta}
                filters={inventory.data?.activeFilters}
                onPage={setInventoryPage}
                loading={inventory.isLoading}
                label="rows"
              />
            </>
          )}
        </Section>
      )}

      {/* --------------------------------------- TAB 3: Shortage and excess */}
      {activeTab === "shortage-excess" && (
        <Section
          title="Shortage and Excess"
          description={
            gaps.data?.available
              ? `Stored result of the demand run of ${gaps.data.runAtIst ?? "—"}. Memo, reserved and WIP quantities are advisory and do not reduce physical shortage.`
              : "Shortage and excess come from a completed demand run."
          }
          actions={
            <div className="flex items-center gap-1">
              {(["ALL", "SHORTAGE_ONLY", "EXCESS_ONLY"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={gapMode === m ? "default" : "outline"}
                  className="h-7 px-2 text-xs cursor-pointer"
                  onClick={() => { setGapMode(m); setGapPage(1); }}
                >
                  {m === "ALL" ? "All" : m === "SHORTAGE_ONLY" ? "Shortage only" : "Excess only"}
                </Button>
              ))}
            </div>
          }
        >
          {gaps.data && !gaps.data.available ? (
            <EmptyState
              title="NOT RUN"
              message="No completed demand run exists, so shortage and excess are unavailable. This is not a zero."
              icon={<Info className="h-5 w-5" />}
            />
          ) : (
            <>
              {gaps.data && !gaps.data.wipCoverage.appliedInRun && (
                <InfoBanner variant="info">{gaps.data.wipCoverage.message}</InfoBanner>
              )}
              <DataTable
                columns={gapColumns}
                rows={gaps.data?.rows ?? []}
                loading={gaps.isLoading}
                emptyMessage={
                  gapMode === "SHORTAGE_ONLY"
                    ? "No category has a physical shortage under the active filters."
                    : gapMode === "EXCESS_ONLY"
                      ? "No category has excess under the active filters."
                      : "No categories match the active filters."
                }
                pagination={false}
                exportScope="current-page"
              />
              <TableFooter
                meta={gaps.data?.meta}
                filters={gaps.data?.activeFilters}
                onPage={setGapPage}
                loading={gaps.isLoading}
                label="rows"
              />
            </>
          )}
        </Section>
      )}

      {/* ------------------------------------------ TAB 4: Attention required */}
      {activeTab === "attention" && (
        <Section
          title="Attention Required"
          description="Factual exceptions only. This section does not rank work or recommend what to manufacture."
        >
          <DataTable
            columns={attentionColumns}
            rows={attention.data?.rows ?? []}
            loading={attention.isLoading}
            emptyMessage="No exceptions for the active filters."
            pagination={false}
          />
          <TableFooter
            meta={attention.data?.meta}
            filters={attention.data?.activeFilters}
            onPage={setAttentionPage}
            loading={attention.isLoading}
            label="rows"
          />
        </Section>
      )}
    </div>
  );
}
