"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { AgingView } from "@/components/diamond/views/aging-view";
import { AgingDashboardView } from "@/components/diamond/views/aging-dashboard-view";
import { ReorderSignalsView } from "@/components/diamond/views/reorder-signals-view";
import { TransferAnalyzerView } from "@/components/diamond/views/transfer-analyzer-view";
import { CalendarClock, LayoutDashboard, Star, ArrowLeftRight } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "aging", label: "Stock Aging", icon: <CalendarClock className="h-3.5 w-3.5" />, component: AgingView },
  { id: "dashboard", label: "Aging Dashboard", icon: <LayoutDashboard className="h-3.5 w-3.5" />, component: AgingDashboardView },
  { id: "reorder", label: "Reorder Signals", icon: <Star className="h-3.5 w-3.5" />, component: ReorderSignalsView },
  { id: "transfers", label: "Transfer Analyzer", icon: <ArrowLeftRight className="h-3.5 w-3.5" />, component: TransferAnalyzerView },
];

export function StockStrategyView() {
  return (
    <TabbedHostView
      title="Stock Strategy"
      subtitle="Strategic inventory optimization across aging buckets, repeat reorder signals, and inter-branch transfer recommendations"
      tabs={TABS}
      defaultTab="aging"
    />
  );
}
