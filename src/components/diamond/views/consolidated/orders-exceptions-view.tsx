"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { OrdersView } from "@/components/diamond/views/orders-view";
import { RequirementsMatrixView } from "@/components/diamond/views/requirements-matrix-view";
import { FileText, FileWarning, Star } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "orders", label: "Customer Orders", icon: <FileText className="h-3.5 w-3.5" />, permission: "orders.read", component: OrdersView },
  { id: "backorders", label: "Backorders", icon: <FileWarning className="h-3.5 w-3.5" />, permission: "requirement.read", component: RequirementsMatrixView },
  { id: "special", label: "Special Requirements", icon: <Star className="h-3.5 w-3.5" />, permission: "requirement.read", component: RequirementsMatrixView },
];

export function OrdersExceptionsView() {
  return (
    <TabbedHostView
      title="Orders and Exceptions"
      subtitle="Committed sales orders, customer backorders, special production requests, and priority order tracking"
      tabs={TABS}
      defaultTab="orders"
    />
  );
}
