"use client";

import { useState } from "react";
import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { DashboardView } from "@/components/diamond/views/dashboard-view";
import { ExecutiveAnalysisView } from "@/components/diamond/views/executive-analysis-view";
import { BarChart3, LayoutDashboard, RefreshCw, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { useApi, apiPost } from "@/lib/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const OVERVIEW_TABS: HostTabItem[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-3.5 w-3.5" />, permission: "analysis.read", component: DashboardView },
  { id: "analysis", label: "Analysis", icon: <BarChart3 className="h-3.5 w-3.5" />, permission: "analysis.read", component: ExecutiveAnalysisView },
];

export function OverviewView() {
  const qc = useQueryClient();
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canRunDemand = perms.includes("demand.run");
  const [runningDemand, setRunningDemand] = useState(false);

  const { data: kpi } = useApi<{ demandRunDate?: string | null }>("/api/dashboard");

  const demandMutation = useMutation({
    mutationFn: () => apiPost<{ runId: string; categoriesProcessed: number; totalShortage: number }>("/api/demand/run", {}),
    onMutate: () => setRunningDemand(true),
    onSuccess: (r) => {
      toast.success(`Demand recalculated — ${r.categoriesProcessed} categories, shortage ${r.totalShortage} pcs`);
      qc.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" && (q.queryKey[0].startsWith("/api/dashboard") || q.queryKey[0].startsWith("/api/analysis/executive")),
      });
    },
    onError: (e) => toast.error(`Demand run failed: ${(e as Error).message}`),
    onSettled: () => setRunningDemand(false),
  });

  return (
    <TabbedHostView
      title="Overview"
      subtitle="Operational dashboard and executive analysis"
      tabs={OVERVIEW_TABS}
      defaultTab="overview"
      actions={
        <div className="flex items-center gap-2">
          {kpi?.demandRunDate && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Last demand run: {new Date(kpi.demandRunDate).toLocaleString()}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px] gap-1.5 cursor-pointer font-semibold shadow-2xs border-border/80"
            onClick={() => demandMutation.mutate()}
            disabled={runningDemand || !canRunDemand}
          >
            {runningDemand ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-[#EA580C]" />}
            {runningDemand ? "Recalculating..." : "Run Demand Calc"}
          </Button>
        </div>
      }
    />
  );
}
