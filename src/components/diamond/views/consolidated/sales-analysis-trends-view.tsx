"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { TrendingUp, Activity } from "lucide-react";

// Sidebar module "Sales Analysis & Trends" (view id `analysis-sales`).
// Two tabs over one authoritative sales snapshot: what sold and in which category
// (/api/analysis/sales, /api/analysis/sales/records), and how activity moved between
// periods (/api/analysis/sales/trend, /movement, /contribution). Only the active tab is
// mounted, so only its queries run.
// Country / branch / lab come from the global filter bar; the page-level filters and the
// selected category are shared by both tabs so a drill-down survives a tab switch.
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
      subtitle="Confirmed historical sales from the authoritative sales snapshot — quantity, carat weight and record count kept separate"
      tabs={SALES_ANALYSIS_TABS}
      defaultTab={SALES_ANALYSIS_DEFAULT_TAB}
    />
  );
}
