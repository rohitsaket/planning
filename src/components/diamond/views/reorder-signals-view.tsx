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
import { AlertTriangle, FlaskConical, Info, PackageX, Search } from "lucide-react";

/**
 * REORDER SIGNALS — categories whose finished stock does not cover the stored target.
 *
 * A signal is an observation, not an instruction: this page creates no order, no plan
 * and no reservation, and the uncovered quantity is never presented as a recommended
 * order quantity.
 *
 * The page it replaces predicted a "likely reorder window" and a confidence percentage
 * from the spacing of past sales — a model nobody approved, over legacy seeded data.
 */

type Signal = "OUT_OF_STOCK" | "SHORTAGE" | "REVIEW_REQUIRED" | "STALE" | "NO_SIGNAL";
type DataState = "CONFIRMED" | "REVIEW_REQUIRED" | "BLOCKED";

interface SnapshotStatus {
  hasRun: boolean;
  runId: string | null;
  sourceState: "SIMULATION" | "LIVE";
  sourceLabel: string;
  runCompletedIst: string | null;
  businessDateIst: string | null;
  periodLabel: string;
  inventoryCutoffIst: string | null;
  inventoryChangedSinceRun: boolean;
  staleWarning: string | null;
  reviewWarning: string | null;
  unavailableMessage: string | null;
  availabilityMessage: string;
  countryScopeNotice: string;
}

interface SignalRow {
  categoryId: string;
  categoryLabel: string;
  sales90d: number;
  targetQuantity: number;
  physicalAvailable: number;
  uncoveredQuantity: number;
  memoQuantity: number;
  wipQuantity: number;
  signal: Signal;
  reason: string;
  dataState: DataState;
}

interface SignalsResponse {
  available: boolean;
  runId: string | null;
  unavailableMessage: string | null;
  advisory: boolean;
  stale: boolean;
  rows: SignalRow[];
  paging: { page: number; pageSize: number; total: number; hasMore: boolean };
  totals: {
    categoriesNeedingAttention: number;
    uncoveredQuantity: number;
    categoriesOutOfStock: number;
    categoriesRequiringReview: number;
  };
}

const SIGNAL_LABELS: Record<Signal, string> = {
  OUT_OF_STOCK: "Out of stock",
  SHORTAGE: "Shortage",
  REVIEW_REQUIRED: "Review required",
  STALE: "Stale",
  NO_SIGNAL: "No signal",
};

const SIGNAL_VARIANT: Record<Signal, "critical" | "warning" | "default" | "success"> = {
  OUT_OF_STOCK: "critical",
  SHORTAGE: "warning",
  REVIEW_REQUIRED: "default",
  STALE: "warning",
  NO_SIGNAL: "success",
};

const PAGE_SIZE = 25;

export function ReorderSignalsView() {
  const trace = useNavStore((s) => s.trace);
  const openDemandTrace = useNavStore((s) => s.openDemandTrace);
  const openCategoryView = useNavStore((s) => s.openCategoryView);
  const setView = useNavStore((s) => s.setView);
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const globalFilter = useGlobalFilter();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [shortageOnly, setShortageOnly] = useState(true);

  const canRunDemand = perms.includes("demand.run");
  const requestedRunId = trace?.runId ?? null;

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (requestedRunId) p.set("runId", requestedRunId);
    // Lab is a real dimension of the stored result; country and branch are not.
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    if (appliedSearch) p.set("search", appliedSearch);
    p.set("shortageOnly", String(shortageOnly));
    return p;
  }, [requestedRunId, globalFilter.lab, appliedSearch, shortageOnly]);

  const build = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(url);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/api/analysis/reorder-signals?${p.toString()}`;
  };

  const status = useApi<SnapshotStatus>(build({ section: "status" }));
  const signals = useApi<SignalsResponse>(build({ section: "signals", page, pageSize: PAGE_SIZE }));

  const s = status.data;
  const totals = signals.data?.totals;
  const hasRun = s?.hasRun ?? false;
  const scopeIgnored = Boolean(globalFilter.country || globalFilter.branch);

  const columns: Column<SignalRow>[] = [
    {
      key: "categoryId", header: "Category", width: "18rem", sticky: "left",
      cell: (r) => <span className="font-medium" title={r.categoryId}>{r.categoryLabel}</span>,
    },
    { key: "sales90d", header: "Confirmed sales 90D (pcs)", align: "right", cell: (r) => <NumberCell value={r.sales90d} /> },
    { key: "targetQuantity", header: "Target (pcs)", align: "right", cell: (r) => <NumberCell value={r.targetQuantity} intent="info" /> },
    { key: "physicalAvailable", header: "Physical available (pcs)", align: "right", cell: (r) => <NumberCell value={r.physicalAvailable} intent="success" /> },
    {
      // Named for what it is. It is not a recommended order quantity.
      key: "uncoveredQuantity", header: "Uncovered (pcs)", align: "right",
      cell: (r) => <NumberCell value={r.uncoveredQuantity} intent="critical" zeroAsDash />,
    },
    { key: "memoQuantity", header: "Memo — advisory (pcs)", align: "right", cell: (r) => <NumberCell value={r.memoQuantity} zeroAsDash /> },
    { key: "wipQuantity", header: "WIP — separate (pcs)", align: "right", cell: (r) => <NumberCell value={r.wipQuantity} zeroAsDash /> },
    {
      key: "signal", header: "Current signal", width: "11rem",
      cell: (r) => <Badge variant={SIGNAL_VARIANT[r.signal]}>{SIGNAL_LABELS[r.signal]}</Badge>,
      exportValue: (r) => SIGNAL_LABELS[r.signal],
    },
    {
      key: "reason", header: "Reason",
      cell: (r) => <span className="block max-w-[26rem] text-[11px] leading-tight text-muted-foreground">{r.reason}</span>,
    },
    {
      key: "dataState", header: "Data state", width: "9rem",
      cell: (r) => <Badge variant={r.dataState === "CONFIRMED" ? "success" : "warning"}>{r.dataState.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "trace", header: "Trace", width: "11rem",
      cell: (r) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm" variant="outline" className="h-6 px-2 text-[11px]"
            onClick={() => openDemandTrace({ runId: signals.data?.runId ?? null, category: r.categoryId })}
          >
            Trace
          </Button>
          <Button
            size="sm" variant="outline" className="h-6 px-2 text-[11px]"
            // The exact category, carried into Stockout Risk.
            onClick={() => openCategoryView("analysis-stockout", { runId: signals.data?.runId ?? null, category: r.categoryId })}
          >
            Stockout
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 p-3">
      <PageHeader
        title="Reorder Signals"
        subtitle="Categories whose finished stock does not cover the stored demand target — advisory only"
        actions={
          canRunDemand ? (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setView("demand-overview")}>
              Refresh demand
            </Button>
          ) : undefined
        }
      />

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
            {s.inventoryCutoffIst && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Inventory as at {s.inventoryCutoffIst} IST</span>
              </>
            )}
          </div>

          <InfoBanner variant="info">
            These signals are advisory. They describe what the calculation found; they do not create an
            order, a plan or a reservation, and the uncovered quantity is not a recommended order quantity.
          </InfoBanner>

          {s.sourceState === "SIMULATION" && hasRun && (
            <InfoBanner variant="warning">
              <span className="flex items-center gap-2 font-semibold">
                <FlaskConical className="h-4 w-4" />
                Fixture Simulation — these are simulated results, not live Fantasy data.
              </span>
            </InfoBanner>
          )}
          {s.reviewWarning && <InfoBanner variant="warning">{s.reviewWarning}</InfoBanner>}
          {s.staleWarning && (
            <InfoBanner variant="critical">
              <div className="flex flex-wrap items-center gap-2">
                <span>{s.staleWarning}</span>
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

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <KpiCard label="Needing attention" value={hasRun ? (totals?.categoriesNeedingAttention ?? 0) : "NOT RUN"} intent="warning" icon={AlertTriangle} hint="Target not covered by available finished stock" />
        <KpiCard label="Uncovered quantity" value={hasRun ? (totals?.uncoveredQuantity ?? 0) : "NOT RUN"} unit="pcs" intent="critical" hint="As calculated by the demand run" />
        <KpiCard label="Out of stock" value={hasRun ? (totals?.categoriesOutOfStock ?? 0) : "NOT RUN"} intent="critical" icon={PackageX} hint="Target exists and nothing is available" />
        <KpiCard label="Needing review" value={hasRun ? (totals?.categoriesRequiringReview ?? 0) : "NOT RUN"} intent="default" hint="Excluded from the totals shown here" />
      </div>

      <Section
        title="Signals"
        description={
          hasRun
            ? "Memo is advisory and WIP is shown separately; neither reduces the uncovered quantity."
            : "Signals come from a completed 90-day demand calculation."
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search.trim()); setPage(1); } }}
                placeholder="Category…"
                className="h-8 w-44 pl-7 text-xs"
              />
            </div>
            <Button size="sm" variant={shortageOnly ? "default" : "outline"} className="h-8" onClick={() => { setShortageOnly(!shortageOnly); setPage(1); }}>
              {shortageOnly ? "Signals only" : "All categories"}
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
              rows={signals.data?.rows ?? []}
              loading={signals.isLoading}
              emptyMessage="No category matches the active filters."
              pagination={false}
              exportScope="current-page"
            />
            <ServerPagination
              page={signals.data?.paging.page ?? 1}
              pageSize={signals.data?.paging.pageSize ?? PAGE_SIZE}
              total={signals.data?.paging.total ?? 0}
              hasMore={signals.data?.paging.hasMore ?? false}
              onPageChange={setPage}
              loading={signals.isLoading}
              label="signals"
            />
          </>
        )}
      </Section>
    </div>
  );
}
