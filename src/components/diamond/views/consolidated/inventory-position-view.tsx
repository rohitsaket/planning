"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { PolishedView } from "@/components/diamond/views/polished-view";
import { MemoView } from "@/components/diamond/views/memo-view";
import { WipView } from "@/components/diamond/views/wip-view";
import { StockoutView } from "@/components/diamond/views/stockout-view";
import { ExcessView } from "@/components/diamond/views/excess-view";
import { Gem, FileText, Boxes, AlertTriangle, Package } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "polished", label: "Polished Inventory", icon: <Gem className="h-3.5 w-3.5" />, component: PolishedView },
  { id: "memo", label: "Memo Exposure", icon: <FileText className="h-3.5 w-3.5" />, permission: "sales.read", component: MemoView },
  { id: "wip", label: "WIP Inventory", icon: <Boxes className="h-3.5 w-3.5" />, component: WipView },
  { id: "stockout", label: "Stockout Risk", icon: <AlertTriangle className="h-3.5 w-3.5" />, component: StockoutView },
  { id: "excess", label: "Excess Stock", icon: <Package className="h-3.5 w-3.5" />, component: ExcessView },
];

export function InventoryPositionView() {
  return (
    <TabbedHostView
      title="Inventory Position"
      subtitle="Complete stock posture across available polished inventory, memo consignments, manufacturing WIP, and exposure metrics"
      tabs={TABS}
      defaultTab="polished"
    />
  );
}
