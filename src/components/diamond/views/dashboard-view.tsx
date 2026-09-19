"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { useNavStore } from "@/stores/nav-store";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart, ComposedChart
} from "recharts";
import { useMemo } from "react";
import { TrendingDown, TrendingUp, AlertTriangle, Package, Gem, Boxes, ShoppingCart, FileWarning, Activity } from "lucide-react";

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

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

export function DashboardView() {
  const setView = useNavStore((s) => s.setView);
  const { data: kpi, isLoading } = useApi<DashboardKpi>("/api/dashboard");

  // Top shortage categories from latest demand metrics
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

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Executive Dashboard"
        subtitle="Confirmed Manufacturing Need · Physical Shortage · Pipeline-Adjusted · Plan Coverage · Remaining Unplanned · Forecast Signal"
        meta={<span className="text-[10px] text-muted-foreground">All values drill down to evidence</span>}
      />

      {/* KPI grid — Four Requirement Numbers */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Physical Shortage" value={kpi?.physicalShortage ?? 0} unit="pcs" intent="critical" hint="MAX(0, Target - Available)" onClick={() => setView("requirements-matrix")} />
        <KpiCard label="Pipeline-Adjusted Need" value={kpi?.pipelineAdjusted ?? 0} unit="pcs" intent="warning" hint="Shortage - Eligible WIP" onClick={() => setView("requirements-matrix")} />
        <KpiCard label="Approved Plan Coverage" value={kpi?.approvedPlanCoverage ?? 0} unit="pcs" intent="success" hint="Approved plan pieces" onClick={() => setView("planning-approval-queue")} />
        <KpiCard label="Remaining Unplanned" value={kpi?.remainingUnplanned ?? 0} unit="pcs" intent="critical" hint="Pipeline - Plan Coverage" onClick={() => setView("requirements-matrix")} />
        <KpiCard label="Forecast Signal" value={kpi?.forecastRequirement ?? 0} unit="pcs" intent="info" hint="Advisory — NOT confirmed demand" onClick={() => setView("data-science-forecast")} />
        <KpiCard label="Memo Exposure" value={`$${((kpi?.memoExposure ?? 0) / 1000).toFixed(1)}K`} intent="info" hint="Memo does NOT reduce shortage" onClick={() => setView("analysis-memo")} />
      </div>

      {/* Inventory + sync grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiCard label="Polished Stock" value={kpi?.polishedStock ?? 0} unit="lots" intent="default" hint="Fantasy authoritative" onClick={() => setView("analysis-polished")} />
        <KpiCard label="Rough Available" value={kpi?.roughAvailable ?? 0} unit="stones" intent="success" onClick={() => setView("planning-rough-availability")} />
        <KpiCard label="Rough Reserved" value={kpi?.roughReserved ?? 0} unit="stones" intent="warning" onClick={() => setView("planning-reservations")} />
        <KpiCard label="Current WIP" value={kpi?.currentWip ?? 0} unit="pcs" intent="info" hint="Approved plan pieces" onClick={() => setView("analysis-wip")} />
        <KpiCard label="Open Orders" value={kpi?.openOrders ?? 0} intent="default" onClick={() => setView("analysis-orders")} />
        <KpiCard label="Backorders" value={kpi?.backorders ?? 0} unit="pcs" intent="critical" onClick={() => setView("requirements-backorders")} />
      </div>

      {/* Priority + sync grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiCard label="Critical Requirements" value={kpi?.criticalRequirements ?? 0} intent="critical" onClick={() => setView("requirements-priority-queue")} />
        <KpiCard label="High Requirements" value={kpi?.highRequirements ?? 0} intent="warning" onClick={() => setView("requirements-priority-queue")} />
        <KpiCard label="Overdue Requirements" value={kpi?.overdueRequirements ?? 0} intent="critical" onClick={() => setView("requirements-priority-queue")} />
        <KpiCard label="Fantasy Sync Health" value={kpi?.fantasySyncHealth ?? "—"} intent={kpi?.fantasySyncHealth === "HEALTHY" ? "success" : kpi?.fantasySyncHealth === "PARTIAL" ? "warning" : "critical"} onClick={() => setView("fantasy-sync")} />
        <KpiCard label="Planned Yield" value={`${(kpi?.plannedYield ?? 0).toFixed(2)}%`} intent="info" onClick={() => setView("manufacturing-plan-vs-actual")} />
        <KpiCard label="Yield Variance" value={`${(kpi?.yieldVariance ?? 0).toFixed(2)}%`} intent={(kpi?.yieldVariance ?? 0) < 0 ? "critical" : "success"} hint={`Actual ${(kpi?.actualYield ?? 0).toFixed(2)}% vs Planned ${(kpi?.plannedYield ?? 0).toFixed(2)}%`} onClick={() => setView("manufacturing-plan-vs-actual")} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Sales Trend (30D windows by shape)" description="Previous 30D · Middle 30D · Latest 30D — descriptive trend with underlying numbers">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="prev30" name="Prev 30D" fill="#94a3b8" />
                <Bar dataKey="mid30" name="Mid 30D" fill="#60a5fa" />
                <Bar dataKey="latest30" name="Latest 30D" fill="#3b82f6" />
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
                <Tooltip contentStyle={{ fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="physicalShortage" name="Shortage" stackId="a" fill="#ef4444" />
                <Bar dataKey="wip" name="WIP" stackId="b" fill="#f59e0b" />
                <Bar dataKey="planCov" name="Plan Cov" stackId="c" fill="#10b981" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Remaining Unplanned by Priority" description="Open requirement pieces by priority class">
          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityBreakdown?.priority ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}: ${e.value}`} labelLine={false} fontSize={9}>
                  {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Remaining Unplanned by Type" description="Open requirement pieces by source type">
          <div className="h-56 flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={priorityBreakdown?.type ?? []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${e.name}: ${e.value}`} labelLine={false} fontSize={9}>
                  {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </div>

      {/* Closed loop diagram */}
      <Section title="The Closed Loop" description="Sales → Analysis → Demand → Target → Stock → Shortage → Orders → WIP → Requirement → Rough → Planning → Matching → Approval → Allocation → Reservation → Manufacturing → Actual → Polished → Plan-vs-Actual → Reconciliation → New Analysis">
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {["Sales", "Analysis", "Demand", "Target Stock", "Polished Stock", "Shortage", "Orders / Priority", "WIP", "Final Requirement", "Rough", "Rough Planning", "Requirement Matching", "Plan Approval", "Requirement Allocation", "Rough Reservation", "Manufacturing Tracking", "Actual Polished", "Fantasy Polished Stock", "Plan-vs-Actual", "Requirement Recalculation", "New Analysis"].map((step, i, arr) => (
            <span key={step} className="inline-flex items-center gap-1">
              <span className={`px-2 py-0.5 rounded border ${i === 0 ? "bg-emerald-100 border-emerald-300 dark:bg-emerald-950/50 dark:border-emerald-900" : i === arr.length - 1 ? "bg-sky-100 border-sky-300 dark:bg-sky-950/50 dark:border-sky-900" : "bg-muted border-border"}`}>{step}</span>
              {i < arr.length - 1 && <span className="text-muted-foreground">→</span>}
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}
