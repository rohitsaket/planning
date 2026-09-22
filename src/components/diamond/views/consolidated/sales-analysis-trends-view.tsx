"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { TrendingUp, Activity } from "lucide-react";

// Sidebar module "Sales Analysis & Trends" (view id `analysis-sales`).
// The two former Analysis pages are composed unchanged as tabs. Only the active tab is
// mounted, so only its query runs; each tab keeps its own API (/api/analysis/sales and
// /api/analysis/sales/trend) and its own local controls (dimension vs. group-by), while
// the shared country / branch / lab / window filters come from the global filter bar.
// Deep links: #analysis-sales?tab=analysis | #analysis-sales?tab=trends.
// The legacy id `analysis-sales-trends` is redirected to the trends tab by the nav store.
export const SALES_ANALYSIS_TABS: HostTabItem[] = [
  { id: "analysis", label: "Sales Analysis", icon: <TrendingUp className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesAnalysisView },
  { id: "trends", label: "Sales Trends", icon: <Activity className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesTrendsView },
];

export const SALES_ANALYSIS_DEFAULT_TAB = "analysis";

export function SalesAnalysisTrendsView() {
  return (
    <TabbedHostView
      title="Sales Analysis & Trends"
      subtitle="Confirmed invoice lots by dimension, and descriptive 30-day trend windows"
      tabs={SALES_ANALYSIS_TABS}
      defaultTab={SALES_ANALYSIS_DEFAULT_TAB}
    />
  );
}
