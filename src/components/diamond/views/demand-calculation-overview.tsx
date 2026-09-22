"use client";

import { useState } from "react";
import { useApi, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Calculator, AlertTriangle, Package, Boxes, ShieldCheck,
  TrendingDown, TrendingUp, RefreshCw, Zap, Lock, Unlock,
  Layers, ChevronRight, CheckCircle2, XCircle, Clock, Info,
} from "lucide-react";

interface CategoryMetricRow {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  sales90d: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  excessStock: number;
  wipCoverage: number | null;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  status: string;
}

interface DemandOverviewSummary {
  totalCategories: number;
  totalShortage: number;
  totalExcess: number;
  totalTarget: number;
  totalPhysicalStock: number;
  totalMemo: number;
  totalWipCoverage: number;
  totalPipelineNeed: number;
  totalApprovedPlanCoverage: number;
  totalRemainingUnplanned: number;
  categoriesWithShortage: number;
  categoriesWithExcess: number;
  categoriesRequiringReview?: number;
}

interface DemandOverviewResponse {
  hasEverRun: boolean;
  sourceMode: "FIXTURE_SIMULATION" | "LIVE";
  isSimulated: boolean;
  runId: string | null;
  calculatedAt: string | null;
  calculatedAtIst: string | null;
  businessDateIst: string | null;
  lookbackStart: string | null;
  lookbackEnd: string | null;
  windowDays: number;
  categories: CategoryMetricRow[];
  summary: DemandOverviewSummary;
  /** Manufacturing coverage availability in business language. */
  wipCoverage: { available: boolean; appliedInRun: boolean; message: string };
}

export function DemandCalculationOverview() {
  const openDemandTrace = useNavStore((s) => s.openDemandTrace);
  const qc = useQueryClient();
  const [runningDemand, setRunningDemand] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockReason, setUnlockReason] = useState("");

  const { data, isLoading } = useApi<DemandOverviewResponse>("/api/analysis/demand-trace");
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canRunDemand = perms.includes("demand.run");
  const canUnlockDemand = perms.includes("demand.unlock");
  const canTrace = perms.includes("demand.trace");

  // Demand result queries are keyed by their full request URL, so every run/category/page
  // variant is invalidated by path rather than by one exact key.
  const invalidateDemandResults = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/analysis/demand-trace"),
    });

  const runMutation = useMutation({
    mutationFn: () => apiPost<{ runId: string; categoriesProcessed: number; totalShortage: number }>("/api/demand/run", {}),
    onMutate: () => setRunningDemand(true),
    onSuccess: (r) => {
      toast.success(`Demand calculated successfully — ${r.categoriesProcessed} categories, shortage ${r.totalShortage} pcs`);
      invalidateDemandResults();
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/demand/history"] });
    },
    onError: (e) => toast.error(`Demand calculation failed: ${(e as Error).message}`),
    onSettled: () => setRunningDemand(false),
  });

  const unlockMutation = useMutation({
    mutationFn: (reason: string) => apiPost<{ success: boolean; message: string }>("/api/demand/run/unlock", { reason }),
    onMutate: () => setUnlocking(true),
    onSuccess: (r) => {
      toast.success(r.message || "Demand calculation unlocked");
      setUnlockModalOpen(false);
      setUnlockReason("");
      invalidateDemandResults();
    },
    onError: (e) => toast.error(`Unlock failed: ${(e as Error).message}`),
    onSettled: () => setUnlocking(false),
  });

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const reason = unlockReason.trim();
    if (reason.length < 3) {
      toast.error("A justification reason of at least 3 characters is mandatory");
      return;
    }
    unlockMutation.mutate(reason);
  };

  const summary = data?.summary;
  const categories = data?.categories ?? [];
  const hasEverRun = data?.hasEverRun ?? false;
  const wipApplied = data?.wipCoverage?.appliedInRun ?? false;

  const columns: Column<CategoryMetricRow>[] = [
    {
      key: "category",
      header: "Category (Lab | Shape | Band)",
      sortable: true,
      sortValue: (r) => r.category,
      sticky: "left",
      width: "220px",
      cell: (r) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">
            {r.lab} <span className="text-muted-foreground">·</span> {r.shape} <span className="text-muted-foreground">·</span> {r.weightBand}
          </span>
          <span className="text-[9px] text-muted-foreground/70 truncate font-mono">
            {r.category}
          </span>
        </div>
      ),
    },
    {
      key: "sales90d",
      header: "90D Sales",
      sortable: true,
      sortValue: (r) => r.sales90d,
      align: "right",
      width: "90px",
      cell: (r) => <NumberCell value={r.sales90d} />,
    },
    {
      key: "roundedTarget",
      header: "Target",
      sortable: true,
      sortValue: (r) => r.roundedTarget,
      align: "right",
      width: "80px",
      cell: (r) => <NumberCell value={r.roundedTarget} intent="info" />,
    },
    {
      key: "availableStock",
      header: "Physical Stock",
      sortable: true,
      sortValue: (r) => r.availableStock,
      align: "right",
      width: "95px",
      cell: (r) => <NumberCell value={r.availableStock} />,
    },
    {
      key: "memoQty",
      header: "Memo (Adv)",
      sortable: true,
      sortValue: (r) => r.memoQty,
      align: "right",
      width: "90px",
      cell: (r) => (
        <span className="text-muted-foreground text-xs" title="Memo stock is NOT deducted from shortage">
          {r.memoQty}
        </span>
      ),
    },
    {
      key: "physicalShortage",
      header: "Physical Shortage",
      sortable: true,
      sortValue: (r) => r.physicalShortage,
      align: "right",
      width: "115px",
      cell: (r) => (
        <NumberCell
          value={r.physicalShortage}
          intent={r.physicalShortage > 0 ? "critical" : undefined}
        />
      ),
    },
    {
      key: "wipCoverage",
      header: "Eligible WIP",
      sortable: true,
      sortValue: (r) => r.wipCoverage ?? -1,
      align: "right",
      width: "90px",
      cell: (r) =>
        r.wipCoverage === null ? (
          <span className="text-[10px] font-mono text-muted-foreground">—</span>
        ) : (
          <NumberCell value={r.wipCoverage} intent={r.wipCoverage > 0 ? "info" : undefined} />
        ),
    },
    {
      key: "pipelineNeed",
      header: "Pipeline Req",
      sortable: true,
      sortValue: (r) => r.pipelineNeed,
      align: "right",
      width: "100px",
      cell: (r) => (
        <NumberCell
          value={r.pipelineNeed}
          intent={r.pipelineNeed > 0 ? "warning" : undefined}
        />
      ),
    },
    {
      key: "approvedPlanCoverage",
      header: "Plan Cov",
      sortable: true,
      sortValue: (r) => r.approvedPlanCoverage,
      align: "right",
      width: "85px",
      cell: (r) => <NumberCell value={r.approvedPlanCoverage} intent={r.approvedPlanCoverage > 0 ? "success" : undefined} />,
    },
    {
      key: "remainingUnplanned",
      header: "Remaining Req",
      sortable: true,
      sortValue: (r) => r.remainingUnplanned,
      align: "right",
      width: "110px",
      cell: (r) => (
        <NumberCell
          value={r.remainingUnplanned}
          intent={r.remainingUnplanned > 0 ? "critical" : "success"}
        />
      ),
    },
    {
      key: "excessStock",
      header: "Excess",
      sortable: true,
      sortValue: (r) => r.excessStock,
      align: "right",
      width: "80px",
      cell: (r) => (
        <NumberCell
          value={r.excessStock}
          intent={r.excessStock > 0 ? "warning" : undefined}
        />
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      align: "center",
      width: "110px",
      cell: (r) => (
        <Badge
          variant={
            r.status === "COMPLETED"
              ? "success"
              : r.status === "BLOCKED_BY_DATA_QUALITY"
              ? "critical"
              : "neutral"
          }
        >
          {r.status || "CALCULATED"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "Trace",
      align: "center",
      width: "80px",
      cell: (r) => (
        canTrace ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[10px] gap-1 text-sky-600 hover:text-sky-700 dark:text-sky-400"
            // The clicked row carries the canonical category key the API returned. It is passed
            // through untouched, together with the run these figures came from.
            onClick={() => openDemandTrace({ runId: data?.runId ?? null, category: r.category })}
          >
            Trace <ChevronRight className="h-3 w-3" />
          </Button>
        ) : (
          <span className="text-[10px] text-muted-foreground italic" title="Requires demand.trace">
            Locked
          </span>
        )
      ),
    },
  ];

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <PageHeader
          title="Demand & Inventory Calculation"
          subtitle="Canonical 90-day IST demand engine, stock posture, shortage, WIP coverage, and pipeline requirements"
        />
        <KpiGridSkeleton count={8} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Simulation Watermark Banner */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 text-xs">
        <div className="flex items-center gap-2">
          <Badge variant="warning" className="uppercase font-bold tracking-wider text-[9px]">
            {data?.isSimulated ? "Simulated Mode" : "Live Mode"}
          </Badge>
          {data?.businessDateIst && (
            <span className="text-muted-foreground text-[11px]">
              · IST Business Date: <strong className="text-foreground">{data.businessDateIst}</strong>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="neutral" className="text-[10px]">
            90D IST Window
          </Badge>
        </div>
      </div>

      {/* Page Header with Run Action Bar */}
      <PageHeader
        title="Demand & Inventory Calculation"
        subtitle="Transparent, reproducible demand, physical shortage, WIP coverage, plan coverage, and pipeline requirements"
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {data?.calculatedAtIst && (
              <span className="text-[11px] text-muted-foreground">
                Last calculated: <span className="tabular-nums font-medium text-foreground">{data.calculatedAtIst}</span>
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => setUnlockModalOpen(true)}
              disabled={unlocking || !canUnlockDemand}
              title={canUnlockDemand ? "Unlock demand calculation lock" : "Requires demand.unlock permission"}
            >
              {unlocking ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Unlock className="h-3 w-3" />}
              Unlock Engine
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-[11px] gap-1.5 bg-primary text-primary-foreground font-semibold"
              onClick={() => runMutation.mutate()}
              disabled={runningDemand || !canRunDemand}
              title={canRunDemand ? undefined : "Your role cannot run the demand calculation"}
            >
              {runningDemand ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {runningDemand ? "Calculating 90D Demand..." : "Run Demand Calc"}
            </Button>
          </div>
        }
      />

      {data?.wipCoverage && !data.wipCoverage.available && (
        <InfoBanner variant="warning">{data.wipCoverage.message}</InfoBanner>
      )}

      {!hasEverRun ? (
        <EmptyState
          title="Demand Calculation Not Run Yet"
          message="No operational demand calculation has been executed. Click 'Run Demand Calc' above to process sales history, finished inventory, and manufacturing WIP."
          icon={<Calculator className="h-8 w-8 text-primary" />}
        />
      ) : (
        <>
          {/* Headline Requirement & Inventory Posture KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-2">
            <KpiCard
              label="Total Target"
              value={summary?.totalTarget ?? 0}
              unit="pcs"
              intent="info"
              icon={Calculator}
              hint="Σ 2-month target stock"
            />
            <KpiCard
              label="Physical Stock"
              value={summary?.totalPhysicalStock ?? 0}
              unit="pcs"
              intent="default"
              icon={Package}
              hint="Available finished stock"
            />
            <KpiCard
              label="Physical Shortage"
              value={summary?.totalShortage ?? 0}
              unit="pcs"
              intent="critical"
              icon={AlertTriangle}
              hint="MAX(0, Target − Stock)"
            />
            <KpiCard
              label="Eligible WIP"
              value={wipApplied ? summary?.totalWipCoverage ?? 0 : "UNAVAILABLE"}
              unit={wipApplied ? "pcs" : undefined}
              intent={wipApplied ? "info" : "warning"}
              icon={Boxes}
              hint={wipApplied ? "Mapped manufacturing WIP applied by this run" : "No confirmed WIP coverage rule — nothing deducted"}
            />
            <KpiCard
              label="Pipeline Req"
              value={summary?.totalPipelineNeed ?? 0}
              unit="pcs"
              intent="warning"
              icon={TrendingDown}
              hint={wipApplied ? "MAX(0, Shortage − Eligible WIP)" : "Equals physical shortage while WIP coverage is unavailable"}
            />
            <KpiCard
              label="Plan Coverage"
              value={summary?.totalApprovedPlanCoverage ?? 0}
              unit="pcs"
              intent="success"
              icon={ShieldCheck}
              hint="Approved rough plan pieces"
            />
            <KpiCard
              label="Remaining Req"
              value={summary?.totalRemainingUnplanned ?? 0}
              unit="pcs"
              intent="critical"
              icon={AlertTriangle}
              hint="Pipeline − Plan Coverage"
            />
            <KpiCard
              label="Total Excess"
              value={summary?.totalExcess ?? 0}
              unit="pcs"
              intent="warning"
              icon={Package}
              hint="Stock − Target (advisory)"
            />
            <KpiCard
              label="Memo Stock"
              value={summary?.totalMemo ?? 0}
              unit="pcs"
              intent="default"
              icon={Info}
              hint="Memo does NOT reduce shortage"
            />
          </div>

          {/* Planning Categories Table */}
          <Section
            title="Planning Categories"
            description="Normalized Lab + Shape + Weight Band breakdown. Server-authoritative calculations with full traceability."
            actions={
              <div className="flex items-center gap-2">
                <Badge variant="neutral" className="gap-1">
                  <Layers className="h-3 w-3" />
                  {categories.length} Categories
                </Badge>
                {summary?.categoriesWithShortage ? (
                  <Badge variant="critical">
                    {summary.categoriesWithShortage} in Shortage
                  </Badge>
                ) : null}
              </div>
            }
          >
            <DataTable<CategoryMetricRow>
              columns={columns}
              rows={categories}
              initialSortKey="physicalShortage"
              initialSortDir="desc"
              searchable
              searchPlaceholder="Filter category (e.g. IGI, ROUND, 0.30)..."
              searchFn={(r, q) =>
                `${r.lab} ${r.shape} ${r.weightBand} ${r.category}`.toLowerCase().includes(q.toLowerCase())
              }
              exportable
              exportPermission="demand.export"
              exportFilename="demand-categories.csv"
              maxHeight="600px"
              rowClassName={(r) =>
                r.physicalShortage > 0
                  ? "bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/50"
                  : ""
              }
            />
          </Section>
        </>
      )}

      {/* Unlock Justification Modal */}
      <Dialog open={unlockModalOpen} onOpenChange={setUnlockModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleUnlockSubmit}>
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold flex items-center gap-2">
                <Unlock className="h-4 w-4 text-amber-500" />
                Unlock Demand Calculation Engine
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Releasing an active engine lock requires an explicit justification for audit logging and operational safety.
              </DialogDescription>
            </DialogHeader>

            <div className="py-3">
              <label className="text-[11px] font-medium text-foreground block mb-1">
                Justification Reason <span className="text-rose-500">*</span>
              </label>
              <Input
                value={unlockReason}
                onChange={(e) => setUnlockReason(e.target.value)}
                placeholder="e.g. Stale lock cleanup after worker process timeout"
                className="h-8 text-xs"
                autoFocus
              />
              <span className="text-[10px] text-muted-foreground mt-1 block">
                Minimum 3 characters. Stored immutably in system audit logs.
              </span>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setUnlockModalOpen(false);
                  setUnlockReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium"
                disabled={unlocking || unlockReason.trim().length < 3}
              >
                {unlocking ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : null}
                Confirm Unlock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
