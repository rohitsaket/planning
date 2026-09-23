"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import {
  InventoryCategoriesTab,
  InventoryLotsTab,
  InventoryPositionTab,
  InventoryReconciliationTab,
} from "@/components/diamond/views/inventory/inventory-tabs";
import { Boxes, Diamond, Layers, Scale } from "lucide-react";

/**
 * Analysis → Inventory.
 *
 * Every tab reads current canonical Fantasy records (`LotMasterRecord.isCurrent`) through
 * the centralized classification. The previous tabs read the legacy seeded mirrors —
 * `PolishedStone` (225 rows), `RoughStone` (60) and `MemoRecord` (35) — as though they
 * were synchronized inventory, and each tab defined its own bucket, so a lot could be
 * counted more than once.
 *
 * Those mirror-backed views still exist and are still reached from Fantasy Current Data
 * and Manufacturing Overview, which own them. This page no longer treats them as
 * authoritative; the Reconciliation tab compares them against canonical stock instead.
 */
const TABS: HostTabItem[] = [
  { id: "position", label: "Position", icon: <Layers className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryPositionTab },
  { id: "categories", label: "Categories", icon: <Diamond className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryCategoriesTab },
  { id: "lots", label: "Lots", icon: <Boxes className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryLotsTab },
  { id: "reconciliation", label: "Reconciliation", icon: <Scale className="h-3.5 w-3.5" />, permission: "analysis.read", component: InventoryReconciliationTab },
];

export function InventoryPositionView() {
  return (
    <TabbedHostView
      title="Inventory"
      subtitle="Current canonical Fantasy stock by classification bucket, category and lot"
      tabs={TABS}
      defaultTab="position"
    />
  );
}
