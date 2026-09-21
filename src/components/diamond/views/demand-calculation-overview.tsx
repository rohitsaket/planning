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
  monthlyAverage: number;
  unroundedTarget: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  excessStock: number;
  wipCoverage: number;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastSignal: number;
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
  sourceMode: string;
  isSimulated: boolean;
  ruleVersion: string;
  runId: string | null;
  runDate: string | null;
  runDateIST: string | null;
  businessDateIst: string | null;
  lookbackStart: string | null;
  lookbackEnd: string | null;
  windowDays: number;
  checkpoint: number;
  lastBatchId: string | null;
  salesCount: number;
  inventoryCount: number;
  wipCount: number;
  excludedCount: number;
  categories: CategoryMetricRow[];
  summary: DemandOverviewSummary;
}

export function DemandCalculationOverview() {
  const setView = useNavStore((s) => s.setView);
  const qc = useQueryClient();
  const [runningDemand, setRunningDemand] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const { data, isLoading } = useApi<DemandOverviewResponse>("/api/analysis/demand-trace");
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canRunDemand = perms.includes("demand.run");

  const runMutation = useMutation({
    mutationFn: () => apiPost<{ runId: string; categoriesProcessed: number; totalShortage: number }>("/api/demand/run", {}),
    onMutate: () => setRunningDemand(true),
    onSuccess: (r) => {
      toast.success(`Demand calculated successfully — ${r.categoriesProcessed} categories, shortage ${r.totalShortage} pcs`);
      qc.invalidateQueries({ queryKey: ["/api/analysis/demand-trace"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/demand/history"] });
    },
    onError: (e) => toast.error(`Demand calculation failed: ${(e as Error).message}`),
    onSettled: () => setRunningDemand(false),
  });

  const unlockMutation = useMutation({
    mutationFn: () => apiPost<{ success: boolean; message: string }>("/api/demand/run/unlock", { reason: "Manual operator unlock" }),
    onMutate: () => setUnlocking(true),
    onSuccess: (r) => {
      toast.success(r.message || "Demand calculation unlocked");
      qc.invalidateQueries({ queryKey: ["/api/analysis/demand-trace"] });
    },
    onError: (e) => toast.error(`Unlock failed: ${(e as Error).message}`),
    onSettled: () => setUnlocking(false),
  });

  const summary = data?.summary;
  const categories = data?.categories ?? [];
  const hasEverRun = data?.hasEverRun ?? false;

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
      sortValue: (r) => r.wipCoverage,
      align: "right",
      width: "90px",
      cell: (r) => <NumberCell value={r.wipCoverage} intent={r.wipCoverage > 0 ? "info" : undefined} />,
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
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] gap-1 text-sky-600 hover:text-sky-700 dark:text-sky-400"
          onClick={() => setView("demand-trace")}
        >
          Trace <ChevronRight className="h-3 w-3" />
        </Button>
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
          <span className="text-amber-800 dark:text-amber-300 font-medium">
            Fantasy Checkpoint #{data?.checkpoint ?? 0}
          </span>
          {data?.businessDateIst && (
            <span className="text-muted-foreground text-[11px]">
              · IST Business Date: <strong className="text-foreground">{data.businessDateIst}</strong>
            </span>
          )}
          {data?.lastBatchId && (
            <span className="text-muted-foreground text-[11px] hidden sm:inline font-mono">
              · Batch {data.lastBatchId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="info" className="text-[10px]">
            Rule {data?.ruleVersion ?? "DEMAND-V1"}
          </Badge>
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
            {data?.runDateIST && (
              <span className="text-[11px] text-muted-foreground">
                Last calculated: <span className="tabular-nums font-medium text-foreground">{data.runDateIST}</span>
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => unlockMutation.mutate()}
              disabled={unlocking || !canRunDemand}
              title="Unlock demand engine lock if stuck"
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
              value={summary?.totalWipCoverage ?? 0}
              unit="pcs"
              intent="info"
              icon={Boxes}
              hint="Mapped manufacturing WIP"
            />
            <KpiCard
              label="Pipeline Req"
              value={summary?.totalPipelineNeed ?? 0}
              unit="pcs"
              intent="warning"
              icon={TrendingDown}
              hint="Shortage − Eligible WIP"
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
    </div>
  );
}
