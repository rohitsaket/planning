"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasySourceBadge } from "@/components/diamond/shared/fantasy-source-badge";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { OverallDataView } from "@/components/diamond/views/overall-data-view";
import { Boxes, HardDrive, RefreshCw } from "lucide-react";

export const FANTASY_DATA_TABS: HostTabItem[] = [
  { id: "current", label: "Current Data", icon: <Boxes className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasyPolishedView },
  { id: "integration", label: "Integration Status", icon: <RefreshCw className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasySyncView },
  { id: "history", label: "Historical Data", icon: <HardDrive className="h-3.5 w-3.5" />, permission: "overall.read", component: OverallDataView },
];

export function FantasyDataView() {
  return (
    <TabbedHostView
      title="Fantasy Data"
      subtitle="Current stock, synchronization status and the permanent lot history"
      tabs={FANTASY_DATA_TABS}
      defaultTab="current"
      meta={<FantasySourceBadge />}
    />
  );
}
