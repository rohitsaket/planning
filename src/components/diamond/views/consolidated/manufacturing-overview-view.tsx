"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { FantasyDepartmentsView } from "@/components/diamond/views/fantasy-departments-view";
import { FantasyLocationsView } from "@/components/diamond/views/fantasy-locations-view";
import { WipView } from "@/components/diamond/views/wip-view";
import { Activity, Boxes, Map, Layers } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "tracking", label: "Production Tracking", icon: <Activity className="h-3.5 w-3.5" />, component: FantasySyncView },
  { id: "departments", label: "Department View", icon: <Boxes className="h-3.5 w-3.5" />, component: FantasyDepartmentsView },
  { id: "locations", label: "Location View", icon: <Map className="h-3.5 w-3.5" />, component: FantasyLocationsView },
  { id: "wip", label: "WIP Summary", icon: <Layers className="h-3.5 w-3.5" />, component: WipView },
];

export function ManufacturingOverviewView() {
  return (
    <TabbedHostView
      title="Manufacturing Overview"
      subtitle="Factory-floor stone progress, manufacturing department throughput, factory locations, and live WIP stages"
      tabs={TABS}
      defaultTab="tracking"
    />
  );
}
