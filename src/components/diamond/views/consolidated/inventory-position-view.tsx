"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import {
  InventoryCategoriesTab,
  InventoryLotsTab,
  InventoryPositionTab,
  InventoryReconciliationTab,
} from "@/components/diamond/views/inventory/inventory-tabs";
import { StockoutView } from "@/components/diamond/views/stockout-view";
import { ExcessView } from "@/components/diamond/views/excess-view";
import { AgingView } from "@/components/diamond/views/aging-view";
import { AlertTriangle, Boxes, CalendarClock, Diamond, Layers, Package, Scale } from "lucide-react";

/**
 * Analysis → Inventory.
 *
 * Every tab reads current canonical Fantasy records (`LotMasterRecord.isCurrent`) through
 * the centralized classification. The previous tabs read the legacy seeded mirrors —
 * `PolishedStone` (225 rows), `RoughStone` (60) and `MemoRecord` (35) — as though they
 * were synchronized inventory, and each tab defined its own bucket, so a lot could be
 * counted more than once. The Reconciliation tab compares those mirrors against canonical
 * stock instead.
 *
 * Stockout Risk, Excess Stock and Aging were separate pages; they are tabs here, each
 * still its own view over its own API. Aging carries the former Aging Dashboard's bucket
 * and location summary above the lot table.
 */
export const INVENTORY_TABS: HostTabItem[] = [
  { id: "position", label: "Position", icon: <Layers className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryPositionTab },
  { id: "categories", label: "Categories", icon: <Diamond className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryCategoriesTab },
  { id: "lots", label: "Lots", icon: <Boxes className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryLotsTab },
  { id: "reconciliation", label: "Reconciliation", icon: <Scale className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryReconciliationTab },
  { id: "stockout", label: "Stockout Risk", icon: <AlertTriangle className="h-3.5 w-3.5" />, permission: "analysis.read", component: StockoutView },
  { id: "excess", label: "Excess Stock", icon: <Package className="h-3.5 w-3.5" />, permission: "analysis.read", component: ExcessView },
  { id: "aging", label: "Aging", icon: <CalendarClock className="h-3.5 w-3.5" />, permission: "analysis.read", component: AgingView },
];

export function InventoryPositionView() {
  return (
    <TabbedHostView
      title="Inventory"
      subtitle="Current stock, stockout risk, excess and aging"
      tabs={INVENTORY_TABS}
      defaultTab="position"
    />
  );
}
