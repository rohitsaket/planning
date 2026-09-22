"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { CustomersView } from "@/components/diamond/views/customers-view";
import { OrdersView } from "@/components/diamond/views/orders-view";
import { CountryView } from "@/components/diamond/views/country-view";
import { Users, ShoppingCart, Globe } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "customers", label: "Customers", icon: <Users className="h-3.5 w-3.5" />, permission: "customers.read", component: CustomersView },
  { id: "orders", label: "Orders", icon: <ShoppingCart className="h-3.5 w-3.5" />, permission: "orders.read", component: OrdersView },
  { id: "country", label: "Country & Branch", icon: <Globe className="h-3.5 w-3.5" />, permission: "analysis.read", component: CountryView },
];

export function CustomersOrdersView() {
  return (
    <TabbedHostView
      title="Customers and Orders"
      subtitle="Customer 360 profiles, active sales orders, delivery timelines, and geographic branch distributions"
      tabs={TABS}
      defaultTab="customers"
    />
  );
}
