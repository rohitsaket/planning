"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useApi, apiFetch } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section } from "@/components/diamond/shared/page-header";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart,
} from "recharts";
import { useMemo } from "react";
import {
  AlertTriangle, Gem, FileWarning, TrendingUp, TrendingDown, RefreshCw,
} from "lucide-react";
import { KpiGridSkeleton, PageSkeleton } from "@/components/diamond/shared/skeleton";

interface DashboardKpi {
  physicalShortage: number;
  pipelineAdjusted: number;
  forecastRequirement: number;
  polishedStock: number;
  memoExposure: number;
  fantasySyncHealth: "HEALTHY" | "PARTIAL" | "FAILED" | "NOT_RUN";
  demandRunId: string | null;
  demandRunDate?: string | null;
}


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
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);

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
        <PageSkeleton kpiCount={6} sections={2} />
      ) : (
        <>

      {/* GROUP 1: Planning Need — from the latest demand calculation */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-rose-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Planning Need</h2>
          <span className="text-[10px] text-muted-foreground">— {kpi?.demandRunId ? "Latest demand calculation" : "No demand calculation has run"}</span>
        </div>
        {isLoading ? (
          <KpiGridSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <KpiCard label="Physical Shortage" value={kpi?.demandRunId ? kpi.physicalShortage : "—"} unit={kpi?.demandRunId ? "pcs" : undefined} intent="critical" icon={AlertTriangle} hint="Quantity still needed" sparkline={shortageSparkline} onClick={() => setView("analysis-inventory-position", "stockout")} />
            <KpiCard label="Pipeline-Adjusted" value={kpi?.demandRunId ? kpi.pipelineAdjusted : "—"} unit={kpi?.demandRunId ? "pcs" : undefined} intent="warning" icon={TrendingDown} hint="Still needed after work in progress" onClick={() => setView("analysis-inventory-position", "stockout")} />
            <KpiCard label="Forecast Signal" value={kpi?.demandRunId ? kpi.forecastRequirement : "—"} unit={kpi?.demandRunId ? "pcs" : undefined} intent="info" icon={TrendingUp} hint="Advisory. Not confirmed demand" sparkline={forecastSparkline} />
          </div>
        )}
      </div>

      {/* GROUP 2: Stock & Sync */}
      <div>
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="h-4 w-1 rounded-full bg-sky-500" />
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-foreground">Stock & Sync</h2>
          <span className="text-[10px] text-muted-foreground">— Polished stock, open memo and synchronization</span>
        </div>
        {isLoading ? (
          <KpiGridSkeleton count={3} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <KpiCard label="Polished Stock" value={kpi?.polishedStock ?? 0} unit="lots" intent="default" icon={Gem} hint="Polished lots in stock" onClick={() => setView("analysis-polished")} />
            <KpiCard label="Memo Exposure" value={fmtMoney(kpi?.memoExposure ?? 0)} intent="warning" icon={FileWarning} hint="Open memo value" sparkline={memoSparkline} onClick={() => setView("analysis-memo")} />
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

        </>
      )}
    </div>
  );
}
