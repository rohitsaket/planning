"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { PlanningCasesView } from "@/components/diamond/views/planning-cases-view";
import { PlanningWorkbenchView } from "@/components/diamond/views/planning-workbench-view";
import { PlanComparisonView } from "@/components/diamond/views/plan-comparison-view";
import { PlannedPiecesView } from "@/components/diamond/views/planned-pieces-view";
import { ReservationsView } from "@/components/diamond/views/reservations-view";
import { ClipboardList, Gem, LayoutDashboard, Layers, Scale } from "lucide-react";

// Plan Comparison and Rough Reservations were separate pages; they are tabs here, each
// still its own view over its own API and permission.
export const PLANNING_WORKBENCH_TABS: HostTabItem[] = [
  { id: "cases", label: "Cases", icon: <ClipboardList className="h-3.5 w-3.5" />, permission: "plan.read", component: PlanningCasesView },
  { id: "workbench", label: "Candidate Plans", icon: <LayoutDashboard className="h-3.5 w-3.5" />, permission: "plan.read", component: PlanningWorkbenchView },
  { id: "comparison", label: "Comparison", icon: <Scale className="h-3.5 w-3.5" />, permission: "plan.read", component: PlanComparisonView },
  { id: "pieces", label: "Planned Pieces", icon: <Layers className="h-3.5 w-3.5" />, permission: "plan.read", component: PlannedPiecesView },
  { id: "reservations", label: "Rough Reservations", icon: <Gem className="h-3.5 w-3.5" />, permission: "rough.read", component: ReservationsView },
];

export function PlanningWorkbenchHostView() {
  return (
    <TabbedHostView
      title="Planning Workbench"
      subtitle="Planning cases, candidate plans, comparison, planned pieces and rough reservations"
      tabs={PLANNING_WORKBENCH_TABS}
      defaultTab="cases"
    />
  );
}
