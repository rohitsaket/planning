"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { FantasyRoughView } from "@/components/diamond/views/fantasy-rough-view";
import { WipView } from "@/components/diamond/views/wip-view";
import { PolishedView } from "@/components/diamond/views/polished-view";
import { MemoView } from "@/components/diamond/views/memo-view";
import { SalesAnalysisView } from "@/components/diamond/views/sales-analysis-view";
import { Gem, Boxes, Diamond, FileText, Receipt } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "rough", label: "Rough", icon: <Gem className="h-3.5 w-3.5" />, permission: "fantasy.read", component: FantasyRoughView },
  { id: "wip", label: "WIP", icon: <Boxes className="h-3.5 w-3.5" />, permission: "analysis.read", component: WipView },
  { id: "polished", label: "Polished", icon: <Diamond className="h-3.5 w-3.5" />, permission: "analysis.read", component: PolishedView },
  { id: "memo", label: "Memo", icon: <FileText className="h-3.5 w-3.5" />, permission: "sales.read", component: MemoView },
  { id: "invoices", label: "Invoices", icon: <Receipt className="h-3.5 w-3.5" />, permission: "sales.read", component: SalesAnalysisView },
];

export function InventoryPositionView() {
  return (
    <TabbedHostView
      title="Inventory"
      subtitle="Complete stock pipeline across rough diamonds, manufacturing WIP, polished vault inventory, memo consignments, and sales invoices"
      tabs={TABS}
      defaultTab="rough"
    />
  );
}
