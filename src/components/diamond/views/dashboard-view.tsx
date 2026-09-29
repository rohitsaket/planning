"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useApi, apiFetch } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section } from "@/components/diamond/shared/page-header";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ComposedChart,
} from "recharts";
import { useMemo } from "react";
import {
  AlertTriangle, Gem, Boxes, ShoppingCart, FileWarning,
  TrendingUp, TrendingDown, ShieldCheck, Clock, RefreshCw,
} from "lucide-react";
import { KpiGridSkeleton, PageSkeleton } from "@/components/diamond/shared/skeleton";

interface DashboardKpi {
  physicalShortage: number;
  pipelineAdjusted: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastRequirement: number;
  polishedStock: number;
  roughAvailable: number;
  roughReserved: number;
  approvedPlanPieces: number;
  criticalRequirements: number;
  highRequirements: number;
  overdueRequirements: number;
  openOrders: number;
  backorders: number;
  memoExposure: number;
  fantasySyncHealth: "HEALTHY" | "PARTIAL" | "FAILED" | "NOT_RUN";
  demandRunDate?: string | null;
}

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316"];

// Compact USD formatter — keeps KPI values short enough to fit alongside sparklines
function fmtMoney(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
}

const SYNC_HEALTH_LABEL: Record<string, string> = { HEALTHY: "Healthy", PARTIAL: "Partial", FAILED: "Failed", NOT_RUN: "Not Run" };

export function DashboardView() {
  const setView = useNavStore((s) => s.setView);
  const globalFilter = useGlobalFilter();

  const filterQs = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    if (globalFilter.windowDays !== 90) params.set("windowDays", String(globalFilter.windowDays));
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, globalFilter.windowDays]);

  const { data: kpi, isLoading } = useApi<DashboardKpi>(`/api/dashboard${filterQs}`);
  // Widgets are fetched only when the role may read them (UX only — the API enforces it anyway).
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canSales = perms.includes("sales.read");

  // Sales trend (sparkline data)
  const { data: trendData } = useQuery({
    queryKey: ["dashboard-trend", globalFilter.country, globalFilter.branch, globalFilter.lab, globalFilter.windowDays],
    enabled: canSales,
    queryFn: async () => {
      const params = new URLSearchParams({ groupBy: "shape" });
      if (globalFilter.country) params.set("country", globalFilter.country);
      if (globalFilter.branch) params.set("branch", globalFilter.branch);
      if (globalFilter.lab) params.set("lab", globalFilter.lab);
      if (globalFilter.windowDays) params.set("windowDays", String(globalFilter.windowDays));
      const tr = await apiFetch<{ rows: Array<{ key: string; prev30: number; mid30: number; latest30: number; total90: number; trend: string }> }>(`/api/analysis/sales/trend?${params.toString()}`);
      return tr.rows.slice(0, 8).map((r) => ({ name: r.key, prev30: r.prev30, mid30: r.mid30, latest30: r.latest30, total90: r.total90 }));
    },
  });

  const { data: priorityBreakdown } = useQuery({
    queryKey: ["dashboard-priority", globalFilter.country, globalFilter.branch, globalFilter.lab],
    queryFn: async () => {
      const params = new URLSearchParams({ pageSize: "500" });
      if (globalFilter.country) params.set("country", globalFilter.country);
      if (globalFilter.branch) params.set("branch", globalFilter.branch);
      if (globalFilter.lab) params.set("lab", globalFilter.lab);
      const r = await apiFetch<{ data: Array<{ requirementPriority: string | null; remainingUnplanned: number; type: string }> }>(`/api/requirements?${params.toString()}`);
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

  // Demand run history — for real sparkline data (last 7 runs chronologically)
  const { data: demandHistoryRaw } = useQuery({
    queryKey: ["demand-history-spark"],
    queryFn: async () => {
      const r = await apiFetch<{
        rows: Array<{ totalShortage: number; totalExcess: number }>;
      }>("/api/demand/history");
      return r.rows;
    },
  });

  // Forecast predictions — for forecast signal sparkline (top categories' prediction90d)
  const { data: forecastData } = useQuery({
    queryKey: ["forecast-predictions-spark", globalFilter.lab],
    queryFn: async () => {
      const r = await apiFetch<{
        rows: Array<{ category: string; prediction90d: number }>;
      }>("/api/analysis/forecast");
      if (globalFilter.lab) {
        return {
          rows: r.rows.filter((row) => row.category.toUpperCase().startsWith(globalFilter.lab!.toUpperCase())),
        };
      }
      return r;
    },
  });

  // Memo analysis — for memo exposure sparkline (top customers' values)
  const { data: memoData } = useQuery({
    queryKey: ["memo-spark", globalFilter.country, globalFilter.branch],
    enabled: canSales,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (globalFilter.country) params.set("country", globalFilter.country);
      if (globalFilter.branch) params.set("branch", globalFilter.branch);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const r = await apiFetch<{
        byCustomer: Array<{ value: number }>;
      }>(`/api/analysis/memo${qs}`);
      return r;
    },
  });

  // Sparkline data — wire to real historical aggregates where available, omit when unavailable (never fabricate)
  const salesSparkline = useMemo(() => {
    if (!trendData || trendData.length < 2) return undefined;
    return trendData.slice(0, 7).map((t) => t.latest30);
  }, [trendData]);

  // Most recent 7 demand runs in chronological order (oldest → newest)
  const demandHistory7 = useMemo(() => {
    if (!demandHistoryRaw || demandHistoryRaw.length < 2) return [];
    return demandHistoryRaw.slice(0, 7).reverse();
  }, [demandHistoryRaw]);

  const shortageSparkline = useMemo(() => {
    if (demandHistory7.length >= 2) {
      return demandHistory7.map((r) => r.totalShortage);
    }
    return undefined;
  }, [demandHistory7]);

  const forecastSparkline = useMemo(() => {
    if (forecastData?.rows && forecastData.rows.length >= 2) {
      return forecastData.rows.slice(0, 7).map((r) => r.prediction90d);
    }
    return undefined;
  }, [forecastData]);

  const memoSparkline = useMemo(() => {
    if (memoData?.byCustomer && memoData.byCustomer.length >= 2) {
      return memoData.byCustomer.slice(0, 7).map((c) => c.value);
    }
    return undefined;
  }, [memoData]);

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {isLoading && !kpi ? (
        <PageSkeleton kpiCount={18} sections={4} />
      ) : (
        <>

      {/* GROUP 1: Planning Need — the confirmed requirement numbers */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-rose-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Planning Need</h2>
        </div>
        {isLoading ? (
          <KpiGridSkeleton count={5} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <KpiCard label="Physical Shortage" value={kpi?.physicalShortage ?? 0} unit="pcs" intent="critical" icon={AlertTriangle} hint="Quantity still needed" sparkline={shortageSparkline} onClick={() => setView("requirements-matrix")} />
            <KpiCard label="Pipeline-Adjusted" value={kpi?.pipelineAdjusted ?? 0} unit="pcs" intent="warning" icon={TrendingDown} hint="Still needed after work in progress" onClick={() => setView("requirements-matrix")} />
            <KpiCard label="Approved Plan Coverage" value={kpi?.approvedPlanCoverage ?? 0} unit="pcs" intent="success" icon={ShieldCheck} hint="Coverage from approved plans" onClick={() => setView("planning-approval-queue")} />
            <KpiCard label="Remaining Unplanned" value={kpi?.remainingUnplanned ?? 0} unit="pcs" intent="critical" icon={AlertTriangle} hint="Still needed after approved plans" onClick={() => setView("requirements-matrix")} />
            <KpiCard label="Forecast Signal" value={kpi?.forecastRequirement ?? 0} unit="pcs" intent="info" icon={TrendingUp} hint="Advisory. Not confirmed demand" sparkline={forecastSparkline} />
          </div>
        )}
      </div>

      {/* GROUP 2: Inventory & Operations */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-sky-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Inventory & Operations</h2>
          <span className="text-[10px] text-muted-foreground">— Stock and open commitments</span>
        </div>
        {isLoading ? (
          <KpiGridSkeleton count={6} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-2">
            <KpiCard label="Polished Stock" value={kpi?.polishedStock ?? 0} unit="lots" intent="default" icon={Gem} hint="Polished lots in stock" onClick={() => setView("analysis-polished")} />
            <KpiCard label="Rough Available" value={kpi?.roughAvailable ?? 0} unit="stones" intent="success" icon={Gem} onClick={() => setView("planning-rough-availability")} />
            <KpiCard label="Rough Reserved" value={kpi?.roughReserved ?? 0} unit="stones" intent="warning" icon={ShieldCheck} onClick={() => setView("planning-reservations")} />
            <KpiCard label="Approved Plan Pieces" value={kpi?.approvedPlanPieces ?? 0} unit="pcs" intent="info" icon={Boxes} hint="Pieces in approved plans" onClick={() => setView("planning-workbench", "pieces")} />
            <KpiCard label="Open Orders" value={kpi?.openOrders ?? 0} intent="default" icon={ShoppingCart} onClick={() => setView("analysis-orders")} />
            <KpiCard label="Backorders" value={kpi?.backorders ?? 0} unit="pcs" intent="critical" icon={FileWarning} onClick={() => setView("requirements-backorders")} />
            <KpiCard label="Memo Exposure" value={fmtMoney(kpi?.memoExposure ?? 0)} intent="warning" icon={FileWarning} hint="Open memo value" sparkline={memoSparkline} onClick={() => setView("analysis-memo")} />
          </div>
        )}
      </div>

      {/* GROUP 3: Priority & Sync Health */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-emerald-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Priority & Sync Health</h2>
          <span className="text-[10px] text-muted-foreground">— Requirements and sync status</span>
        </div>
        {isLoading ? (
          <KpiGridSkeleton count={6} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            <KpiCard label="Critical Reqs" value={kpi?.criticalRequirements ?? 0} intent="critical" icon={AlertTriangle} hint="Critical, not yet planned" onClick={() => setView("requirements-priority-queue")} />
            <KpiCard label="High Reqs" value={kpi?.highRequirements ?? 0} intent="warning" icon={AlertTriangle} hint="High priority, not yet planned" onClick={() => setView("requirements-priority-queue")} />
            <KpiCard label="Overdue Reqs" value={kpi?.overdueRequirements ?? 0} intent="critical" icon={Clock} hint="Past required date" onClick={() => setView("requirements-priority-queue")} />
            <KpiCard label="Fantasy Sync" value={kpi?.fantasySyncHealth ? SYNC_HEALTH_LABEL[kpi.fantasySyncHealth] ?? kpi.fantasySyncHealth : "—"} intent={kpi?.fantasySyncHealth === "HEALTHY" ? "success" : kpi?.fantasySyncHealth === "NOT_RUN" ? "default" : kpi?.fantasySyncHealth === "PARTIAL" ? "warning" : "critical"} icon={RefreshCw} onClick={() => setView("fantasy-sync")} />
          </div>
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-3">
        <Section title="Sales Trend (30D windows by shape)" description="Sales by shape over the last three 30-day periods">
          <div className="h-52">
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

      </div>

      {/* Lower row: priority pies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="Unplanned by Priority" description="Open requirement pieces by priority class">
          <div className="h-48 flex items-center justify-center">
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
          <div className="h-48 flex items-center justify-center">
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
      </div>
        </>
      )}
    </div>
  );
}
