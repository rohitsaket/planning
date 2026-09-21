"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { PlanningCasesView } from "@/components/diamond/views/planning-cases-view";
import { PlanningWorkbenchView } from "@/components/diamond/views/planning-workbench-view";
import { PlannedPiecesView } from "@/components/diamond/views/planned-pieces-view";
import { ClipboardList, LayoutDashboard, Layers } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "cases", label: "Planning Cases", icon: <ClipboardList className="h-3.5 w-3.5" />, component: PlanningCasesView },
  { id: "workbench", label: "Planning Workbench", icon: <LayoutDashboard className="h-3.5 w-3.5" />, component: PlanningWorkbenchView },
  { id: "pieces", label: "Planned Pieces", icon: <Layers className="h-3.5 w-3.5" />, component: PlannedPiecesView },
];

export function PlanningWorkbenchHostView() {
  return (
    <TabbedHostView
      title="Planning Workbench"
      subtitle="Rough diamond planning cases, multi-option evaluation, yield yield trade-offs, and planned pieces"
      tabs={TABS}
      defaultTab="cases"
    />
  );
}
