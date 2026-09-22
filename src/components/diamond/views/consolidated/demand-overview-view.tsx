"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { DemandCalculationOverview } from "@/components/diamond/views/demand-calculation-overview";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { SalesTrendsView } from "@/components/diamond/views/sales-trends-view";
import { DemandHistoryView } from "@/components/diamond/views/demand-history-view";
import { Calculator, ShoppingCart, TrendingUp, History } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "calculation", label: "Demand & Categories", icon: <Calculator className="h-3.5 w-3.5" />, permission: "analysis.read", component: DemandCalculationOverview },
  { id: "sales", label: "Sales Analysis", icon: <ShoppingCart className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesAnalysisView },
  { id: "trends", label: "Sales Trends", icon: <TrendingUp className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesTrendsView },
  { id: "history", label: "Demand History", icon: <History className="h-3.5 w-3.5" />, component: DemandHistoryView },
];

export function DemandOverviewView() {
  return (
    <TabbedHostView
      title="Demand Overview"
      subtitle="Authoritative 90-day demand calculation, planning categories, physical shortage, WIP coverage, and run history"
      tabs={TABS}
      defaultTab="calculation"
    />
  );
}
