"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasyDepartmentsView } from "@/components/diamond/views/fantasy-departments-view";
import { FantasyLocationsView } from "@/components/diamond/views/fantasy-locations-view";
import { Gem, Diamond, Boxes, Map } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "rough", label: "Rough Stock", icon: <Gem className="h-3.5 w-3.5" />, component: FantasyRoughView },
  { id: "polished", label: "Polished Stock", icon: <Diamond className="h-3.5 w-3.5" />, component: FantasyPolishedView },
  { id: "departments", label: "Departments", icon: <Boxes className="h-3.5 w-3.5" />, component: FantasyDepartmentsView },
  { id: "locations", label: "Locations", icon: <Map className="h-3.5 w-3.5" />, component: FantasyLocationsView },
];

export function FantasyLiveView() {
  return (
    <TabbedHostView
      title="Live Data"
      subtitle="Fantasy ERP authoritative live rough stock, polished stock, departments, and location masters"
      tabs={TABS}
      defaultTab="rough"
    />
  );
}
