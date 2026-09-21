"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { PlanVsActualView } from "@/components/diamond/views/plan-vs-actual-view";
import { FantasySyncView } from "@/components/diamond/views/fantasy-sync-view";
import { Scale, ClipboardCheck } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "plan-vs-actual", label: "Plan vs Actual", icon: <Scale className="h-3.5 w-3.5" />, component: PlanVsActualView },
  { id: "reconciliation", label: "Sync Reconciliation", icon: <ClipboardCheck className="h-3.5 w-3.5" />, component: FantasySyncView },
];

export function EvaluationReconciliationView() {
  return (
    <TabbedHostView
      title="Plan vs Actual"
      subtitle="Comprehensive planned yield vs actual output variance, stone recovery rates, and system reconciliation"
      tabs={TABS}
      defaultTab="plan-vs-actual"
    />
  );
}
