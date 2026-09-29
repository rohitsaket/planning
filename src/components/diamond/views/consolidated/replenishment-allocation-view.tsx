"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { RefreshCw, Workflow } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "replenishment", label: "Stock Replenishment", icon: <RefreshCw className="h-3.5 w-3.5" />, permission: "requirement.read", component: RequirementsMatrixView },
  { id: "allocation", label: "Piece Allocation", icon: <Workflow className="h-3.5 w-3.5" />, permission: "requirement.read", component: RequirementsMatrixView },
];

export function ReplenishmentAllocationView() {
  return (
    <TabbedHostView
      title="Replenishment & Allocation"
      subtitle="Replenishment targets, coverage and allocations"
      tabs={TABS}
      defaultTab="replenishment"
    />
  );
}
