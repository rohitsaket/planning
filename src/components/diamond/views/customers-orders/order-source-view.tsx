"use client";

import { useApi } from "@/lib/api-client";
import { EmptyState } from "@/components/diamond/shared/empty-state";
import { ShoppingCart } from "lucide-react";

/**
 * ORDERS — one honest unavailable state.
 *
 * Fantasy supplies no order entity, so there is nothing to report. The previous version
 * said so three times over: a banner, a nine-row table naming every field that cannot be
 * derived and why, a second empty state, and a panel disclosing how many seeded rows sit
 * in the database. That is engineering evidence — it belongs in the service tests that
 * assert seeded rows stay out of operational reporting, not on an operator's screen.
 *
 * What remains is the state itself and what to do about it. No zeros are shown, because
 * an absent source is not an empty order book.
 */

interface OrderAvailabilityResponse {
  available: boolean;
}

export function OrderSourceView() {
  const { data, isLoading } = useApi<OrderAvailabilityResponse>("/api/analysis/customers-orders/orders");

  return (
    <div className="p-4">
      <EmptyState
        title={isLoading ? "Checking order data…" : data?.available ? "Order data is available." : "Order data is not configured."}
        message={isLoading || data?.available ? undefined : "Configure an approved order source to use this section."}
        icon={<ShoppingCart className="h-5 w-5" />}
      />
    </div>
  );
}
