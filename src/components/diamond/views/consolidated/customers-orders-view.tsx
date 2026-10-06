"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { CustomerSalesView } from "@/components/diamond/views/customers-orders/customer-sales-view";
import { OrderSourceView } from "@/components/diamond/views/customers-orders/order-source-view";
import { CountryView } from "@/components/diamond/views/country-view";
import { Users, ShoppingCart, Globe } from "lucide-react";

/**
 * Customers and Orders.
 *
 * The Customers tab reports confirmed sales from the authoritative 90-day snapshot — the
 * same snapshot Sales Analysis reads, so the two agree by construction rather than by
 * coincidence.
 *
 * The Orders tab reports that Fantasy supplies no order entity. The previous tab showed
 * seeded demonstration orders as though they were synchronized data. Those rows are kept as
 * history only: the Requirements section that last displayed them is retired, and order
 * workflows are out of scope.
 */
const TABS: HostTabItem[] = [
  { id: "customers", label: "Customers", icon: <Users className="h-3.5 w-3.5" />, permission: "customers.read", component: CustomerSalesView },
  { id: "orders", label: "Orders", icon: <ShoppingCart className="h-3.5 w-3.5" />, permission: "orders.read", component: OrderSourceView },
  { id: "country", label: "Country & Branch", icon: <Globe className="h-3.5 w-3.5" />, permission: "analysis.read", component: CountryView },
];

export function CustomersOrdersView() {
  return (
    <TabbedHostView
      title="Customers and Orders"
      subtitle="Confirmed customer sales and order status"
      tabs={TABS}
      defaultTab="customers"
    />
  );
}
