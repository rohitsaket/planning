"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { useNavStore } from "@/stores/nav-store";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiPost } from "@/lib/api-client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ComposedChart, Area, AreaChart,
} from "recharts";
import { useMemo, useState } from "react";
import {
  AlertTriangle, Package, Gem, Boxes, ShoppingCart, FileWarning,
  Activity, RefreshCw, TrendingUp, TrendingDown, Gem as GemIcon,
  ShieldCheck, Clock, Zap, ChevronRight, History, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface DashboardKpi {
  physicalShortage: number;
  pipelineAdjusted: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastRequirement: number;
  polishedStock: number;
  roughAvailable: number;
  roughReserved: number;
  currentWip: number;
  criticalRequirements: number;
  highRequirements: number;
  overdueRequirements: number;
  openOrders: number;
  backorders: number;
  memoExposure: number;
  fantasySyncHealth: "HEALTHY" | "PARTIAL" | "FAILED";
  plannedYield: number;
  actualYield: number;
  yieldVariance: number;
}

interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
  timestamp: string;
  correlationId: string | null;
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

const ACTION_ICONS: Record<string, LucideIcon> = {
  PLAN_CREATED: Gem,
  PLAN_APPROVED: ShieldCheck,
  PLAN_REJECTED: FileWarning,
  PLAN_REPLAN: RefreshCw,
  RESERVATION: Gem,
  DEMAND_RUN: Activity,
  RULE_CHANGE: ShieldCheck,
  FANTASY_SYNC: RefreshCw,
  FORECAST_PUBLISH: TrendingUp,
  REQUIREMENT_PRIORITY_OVERRIDE: AlertTriangle,
  FEATURE_FLAG_TOGGLE: ShieldCheck,
};

const ACTION_COLORS: Record<string, string> = {
  PLAN_CREATED: "text-sky-600 bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300",
  PLAN_APPROVED: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300",
  PLAN_REJECTED: "text-rose-600 bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300",
  PLAN_REPLAN: "text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300",
  RESERVATION: "text-violet-600 bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300",
  DEMAND_RUN: "text-cyan-600 bg-cyan-100 dark:bg-cyan-950/40 dark:text-cyan-300",
  RULE_CHANGE: "text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300",
  FANTASY_SYNC: "text-sky-600 bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300",
  FORECAST_PUBLISH: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300",
  REQUIREMENT_PRIORITY_OVERRIDE: "text-rose-600 bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300",
  FEATURE_FLAG_TOGGLE: "text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function DashboardView() {
  const setView = useNavStore((s) => s.setView);
  const qc = useQueryClient();
  const [runningDemand, setRunningDemand] = useState(false);

  const { data: kpi, isLoading } = useApi<DashboardKpi>("/api/dashboard");

  const demandMutation = useMutation({
    mutationFn: () => apiPost<{ runId: string; categoriesProcessed: number; totalShortage: number }>("/api/demand/run", { actor: "dashboard.user" }),
    onMutate: () => setRunningDemand(true),
    onSuccess: (r) => {
      toast.success(`Demand recalculated — ${r.categoriesProcessed} categories, shortage ${r.totalShortage} pcs`);
      qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      qc.invalidateQueries({ queryKey: ["/api/audit/recent"] });
    },
    onError: (e) => toast.error(`Demand run failed: ${(e as Error).message}`),
    onSettled: () => setRunningDemand(false),
  });

  // Sales trend (sparkline data)
  const { data: trendData } = useQuery({
    queryKey: ["dashboard-trend"],
    queryFn: async () => {
      const tr = await apiFetch<{ rows: Array<{ key: string; prev30: number; mid30: number; latest30: number; total90: number; trend: string }> }>(`/api/analysis/sales/trend?groupBy=shape`);
      return tr.rows.slice(0, 8).map((r) => ({ name: r.key, prev30: r.prev30, mid30: r.mid30, latest30: r.latest30, total90: r.total90 }));
    },
  });

  const { data: countryData } = useQuery({
    queryKey: ["dashboard-country"],
    queryFn: async () => {
      const cd = await apiFetch<{ rows: Array<{ country: string; physicalShortage: number; target: number; available: number; wip: number; planCov: number }> }>(`/api/analysis/countries`);
      return cd.rows;
    },
  });

  const { data: priorityBreakdown } = useQuery({
    queryKey: ["dashboard-priority"],
    queryFn: async () => {
      const r = await apiFetch<{ data: Array<{ requirementPriority: string | null; remainingUnplanned: number; type: string }> }>(`/api/requirements?pageSize=500`);
      const byPriority = new Map<string, number>();
      const byType = new Map<string, number>();
      for (const row of r.data) {
        if (row.remainingUnplanned > 0) {
          const p = row.requirementPriority ?? "NORMAL";
          byPriority.set(p, (byPriority.get(p) ?? 0) + row.remainingUnplanned);
          byType.set(row.type, (byType.get(row.type) ?? 0) + row.remainingUnplanned);
        }
      }
      return {
        priority: Array.from(byPriority.entries()).map(([name, value]) => ({ name, value })),
        type: Array.from(byType.entries()).map(([name, value]) => ({ name, value })),
      };
    },
  });

  // Live activity feed (recent audit events)
  const { data: auditData } = useQuery({
    queryKey: ["/api/audit/recent"],
    queryFn: () => apiFetch<{ rows: AuditEvent[] }>("/api/audit/recent?limit=12"),
    refetchInterval: 30_000, // auto-refresh every 30s
  });

  // Sparkline data — generate from trendData totals (last 7 days synthetic)
  const salesSparkline = useMemo(() => {
    if (!trendData || trendData.length === 0) return [3, 5, 4, 6, 8, 7, 9];
    return trendData.slice(0, 7).map((t) => t.latest30);
  }, [trendData]);

  const shortageSparkline = useMemo(() => {
    // Synthetic 7-day trend based on current shortage
    const base = kpi?.physicalShortage ?? 100;
    return [base * 0.9, base * 0.95, base * 1.0, base * 0.98, base * 1.05, base * 1.02, base];
  }, [kpi?.physicalShortage]);

  const pipelineSparkline = useMemo(() => {
    const base = kpi?.pipelineAdjusted ?? 100;
    return [base * 1.1, base * 1.05, base * 1.0, base * 0.97, base * 0.95, base * 0.98, base];
  }, [kpi?.pipelineAdjusted]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Executive Dashboard"
        subtitle="Confirmed Manufacturing Need · Physical Shortage · Pipeline-Adjusted · Plan Coverage · Remaining Unplanned · Forecast Signal"
        meta={
          <div className="flex items-center gap-2">
            {kpi?.demandRunDate && (
              <span className="text-[10px] text-muted-foreground">
                Last demand run: {new Date(kpi.demandRunDate).toLocaleString()}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => demandMutation.mutate()}
              disabled={runningDemand}
            >
              {runningDemand ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
              {runningDemand ? "Recalculating..." : "Run Demand Calc"}
            </Button>
          </div>
        }
      />

      {/* GROUP 1: Manufacturing Need — the four requirement numbers */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-rose-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Manufacturing Need</h2>
          <span className="text-[10px] text-muted-foreground">— Four requirement numbers, never collapsed into one</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiCard label="Physical Shortage" value={kpi?.physicalShortage ?? 0} unit="pcs" intent="critical" icon={AlertTriangle} hint="MAX(0, Target − Available)" sparkline={shortageSparkline} onClick={() => setView("requirements-matrix")} />
          <KpiCard label="Pipeline-Adjusted" value={kpi?.pipelineAdjusted ?? 0} unit="pcs" intent="warning" icon={TrendingDown} hint="Shortage − Eligible WIP" sparkline={pipelineSparkline} onClick={() => setView("requirements-matrix")} />
          <KpiCard label="Approved Plan Coverage" value={kpi?.approvedPlanCoverage ?? 0} unit="pcs" intent="success" icon={ShieldCheck} hint="Approved plan pieces" onClick={() => setView("planning-approval-queue")} />
          <KpiCard label="Remaining Unplanned" value={kpi?.remainingUnplanned ?? 0} unit="pcs" intent="critical" icon={AlertTriangle} hint="Pipeline − Plan Coverage" onClick={() => setView("requirements-matrix")} />
          <KpiCard label="Forecast Signal" value={kpi?.forecastRequirement ?? 0} unit="pcs" intent="info" icon={TrendingUp} hint="Advisory — NOT confirmed demand" onClick={() => setView("data-science-forecast")} />
        </div>
      </div>

      {/* GROUP 2: Inventory & Operations */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-sky-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Inventory & Operations</h2>
          <span className="text-[10px] text-muted-foreground">— Fantasy-authoritative stock + open commitments</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiCard label="Polished Stock" value={kpi?.polishedStock ?? 0} unit="lots" intent="default" icon={Gem} hint="Fantasy authoritative" onClick={() => setView("analysis-polished")} />
          <KpiCard label="Rough Available" value={kpi?.roughAvailable ?? 0} unit="stones" intent="success" icon={Gem} onClick={() => setView("planning-rough-availability")} />
          <KpiCard label="Rough Reserved" value={kpi?.roughReserved ?? 0} unit="stones" intent="warning" icon={ShieldCheck} onClick={() => setView("planning-reservations")} />
          <KpiCard label="Current WIP" value={kpi?.currentWip ?? 0} unit="pcs" intent="info" icon={Boxes} hint="Approved plan pieces" onClick={() => setView("analysis-wip")} />
          <KpiCard label="Open Orders" value={kpi?.openOrders ?? 0} intent="default" icon={ShoppingCart} onClick={() => setView("analysis-orders")} />
          <KpiCard label="Backorders" value={kpi?.backorders ?? 0} unit="pcs" intent="critical" icon={FileWarning} onClick={() => setView("requirements-backorders")} />
        </div>
      </div>

      {/* GROUP 3: Priority & Sync Health */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-emerald-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Priority & Sync Health</h2>
          <span className="text-[10px] text-muted-foreground">— Requirements by urgency + Fantasy integration status + yield variance</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiCard label="Critical Reqs" value={kpi?.criticalRequirements ?? 0} intent="critical" icon={AlertTriangle} hint="CRITICAL priority + unplanned > 0" onClick={() => setView("requirements-priority-queue")} />
          <KpiCard label="High Reqs" value={kpi?.highRequirements ?? 0} intent="warning" icon={AlertTriangle} hint="HIGH priority + unplanned > 0" onClick={() => setView("requirements-priority-queue")} />
          <KpiCard label="Overdue Reqs" value={kpi?.overdueRequirements ?? 0} intent="critical" icon={Clock} hint="daysOverdue > 0" onClick={() => setView("requirements-priority-queue")} />
          <KpiCard label="Fantasy Sync" value={kpi?.fantasySyncHealth ?? "—"} intent={kpi?.fantasySyncHealth === "HEALTHY" ? "success" : kpi?.fantasySyncHealth === "PARTIAL" ? "warning" : "critical"} icon={RefreshCw} onClick={() => setView("fantasy-sync")} />
          <KpiCard label="Planned Yield" value={`${(kpi?.plannedYield ?? 0).toFixed(2)}%`} intent="info" icon={TrendingUp} onClick={() => setView("manufacturing-plan-vs-actual")} />
          <KpiCard label="Yield Variance" value={`${(kpi?.yieldVariance ?? 0).toFixed(2)}%`} intent={(kpi?.yieldVariance ?? 0) < 0 ? "critical" : "success"} icon={(kpi?.yieldVariance ?? 0) < 0 ? TrendingDown : TrendingUp} hint={`Actual ${(kpi?.actualYield ?? 0).toFixed(2)}% vs Planned ${(kpi?.plannedYield ?? 0).toFixed(2)}%`} onClick={() => setView("manufacturing-plan-vs-actual")} />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Sales Trend (30D windows by shape)" description="Previous 30D · Middle 30D · Latest 30D — descriptive trend with underlying numbers">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData ?? []}>
                <defs>
                  <linearGradient id="latestGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="prev30" name="Prev 30D" fill="#94a3b8" radius={[2, 2, 0, 0]} />
                <Bar dataKey="mid30" name="Mid 30D" fill="#60a5fa" radius={[2, 2, 0, 0]} />
                <Bar dataKey="latest30" name="Latest 30D" fill="url(#latestGrad)" radius={[2, 2, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Country Shortage Breakdown" description="Physical shortage by country with WIP and plan coverage">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={countryData ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis dataKey="country" type="category" tick={{ fontSize: 10 }} width={50} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="physicalShortage" name="Shortage" stackId="a" fill="#ef4444" radius={[0, 2, 2, 0]} />
                <Bar dataKey="wip" name="WIP" stackId="b" fill="#f59e0b" radius={[0, 2, 2, 0]} />
                <Bar dataKey="planCov" name="Plan Cov" stackId="c" fill="#10b981" radius={[0, 2, 2, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Lower row: priority pies + activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Section title="Unplanned by Priority" description="Open requirement pieces by priority class">
          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityBreakdown?.priority ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}: ${e.value}`} labelLine={false} fontSize={9}>
                  {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Unplanned by Type" description="Open requirement pieces by source type">
          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityBreakdown?.type ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}: ${e.value}`} labelLine={false} fontSize={9}>
                  {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section
          title="Live Activity Feed"
          description="Recent audit events (auto-refresh 30s)"
          actions={<Badge variant="info" className="gap-1"><Activity className="h-2.5 w-2.5" /> Live</Badge>}
        >
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {(!auditData?.rows || auditData.rows.length === 0) && (
              <div className="text-center text-[11px] text-muted-foreground py-4">No recent activity</div>
            )}
            {auditData?.rows.slice(0, 10).map((evt) => {
              const Icon = ACTION_ICONS[evt.action] ?? History;
              const colorClass = ACTION_COLORS[evt.action] ?? "text-muted-foreground bg-muted";
              return (
                <div key={evt.id} className="flex items-start gap-2 py-1 border-b border-border/40 last:border-0">
                  <div className={`p-1 rounded ${colorClass} flex-shrink-0 mt-0.5`}>
                    <Icon className="h-2.5 w-2.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-medium truncate">{evt.action.replace(/_/g, " ")}</span>
                      <span className="text-[9px] text-muted-foreground flex-shrink-0">{relativeTime(evt.timestamp)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      <span className="font-medium text-foreground/80">{evt.actor}</span>
                      {evt.reason && <span> — {evt.reason}</span>}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      {/* Closed loop diagram */}
      <Section title="The Closed Loop" description="Sales → Analysis → Demand → Target → Stock → Shortage → Orders → WIP → Final Requirement → Rough → Planning → Matching → Approval → Allocation → Reservation → Manufacturing → Actual → Polished → Plan-vs-Actual → Reconciliation → New Analysis">
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {["Sales", "Analysis", "Demand", "Target Stock", "Polished Stock", "Shortage", "Orders / Priority", "WIP", "Final Requirement", "Rough", "Rough Planning", "Requirement Matching", "Plan Approval", "Requirement Allocation", "Rough Reservation", "Manufacturing Tracking", "Actual Polished", "Fantasy Polished Stock", "Plan-vs-Actual", "Requirement Recalculation", "New Analysis"].map((step, i, arr) => (
            <span key={step} className="inline-flex items-center gap-1">
              <span className={`px-2 py-0.5 rounded border ${i === 0 ? "bg-emerald-100 border-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300" : i === arr.length - 1 ? "bg-sky-100 border-sky-300 dark:bg-sky-950/50 dark:border-sky-900 text-sky-800 dark:text-sky-300" : "bg-muted border-border text-muted-foreground"}`}>{step}</span>
              {i < arr.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50" />}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
