"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { TrendingUp, Activity } from "lucide-react";

export const SALES_ANALYSIS_TABS: HostTabItem[] = [
  { id: "analysis", label: "Sales Analysis", icon: <TrendingUp className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesAnalysisView },
  { id: "trends", label: "Sales Trends", icon: <Activity className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesTrendsView },
];

export const SALES_ANALYSIS_DEFAULT_TAB = "analysis";

export function SalesAnalysisTrendsView() {
  return (
    <TabbedHostView
      title="Sales & Trends"
      subtitle="Confirmed sales by category and period"
      tabs={SALES_ANALYSIS_TABS}
      defaultTab={SALES_ANALYSIS_DEFAULT_TAB}
    />
  );
}
