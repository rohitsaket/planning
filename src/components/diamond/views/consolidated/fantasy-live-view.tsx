"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { FantasyPolishedView } from "@/components/diamond/views/fantasy-polished-view";
import { FantasyDepartmentsView } from "@/components/diamond/views/fantasy-departments-view";
import { FantasyLocationsView } from "@/components/diamond/views/fantasy-locations-view";
import { useApi } from "@/lib/api-client";
import { FANTASY_SOURCE_STATE_LABELS, type FantasySourceStateSummary } from "@/lib/fantasy/source-state";
import { Gem, Diamond, Boxes, Map } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "rough", label: "Rough Stock", icon: <Gem className="h-3.5 w-3.5" />, permission: "rough.read", component: FantasyRoughView },
  { id: "polished", label: "Polished Stock", icon: <Diamond className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasyPolishedView },
  { id: "departments", label: "Departments", icon: <Boxes className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasyDepartmentsView },
  { id: "locations", label: "Locations", icon: <Map className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasyLocationsView },
];

export function FantasyLiveView() {
  // The source badge comes from the central source state rather than a fixed string, so
  // this page cannot keep claiming a live ERP connection while fixtures are running.
  const { data } = useApi<{ sourceState: FantasySourceStateSummary }>("/api/fantasy/sync");
  const sourceState = data?.sourceState;

  return (
    <TabbedHostView
      title="Fantasy Current Data"
      subtitle="Current rough stock, polished stock, department and location masters, as last synchronized from the configured data source"
      tabs={TABS}
      defaultTab="rough"
      meta={
        sourceState ? (
          <span
            className={
              sourceState.effectiveState === "LIVE_FANTASY"
                ? "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20"
                : "inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20"
            }
            title={sourceState.statusExplanation}
          >
            Source: {FANTASY_SOURCE_STATE_LABELS[sourceState.effectiveState]}
          </span>
        ) : null
      }
    />
  );
}
