"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { DashboardView } from "@/components/diamond/views/dashboard-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { DemandHistoryView } from "@/components/diamond/views/demand-history-view";
import { Activity, ShoppingCart, TrendingUp, History } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "executive", label: "Executive Summary", icon: <Activity className="h-3.5 w-3.5" />, component: DashboardView },
  { id: "sales", label: "Sales Analysis", icon: <ShoppingCart className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesAnalysisView },
  { id: "trends", label: "Sales Trends", icon: <TrendingUp className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesTrendsView },
  { id: "history", label: "Demand History", icon: <History className="h-3.5 w-3.5" />, component: DemandHistoryView },
];

export function DemandOverviewView() {
  return (
    <TabbedHostView
      title="Demand Overview"
      subtitle="Historical sales run analysis, dimensional turnover, sales trends, and demand execution records"
      tabs={TABS}
      defaultTab="executive"
    />
  );
}
