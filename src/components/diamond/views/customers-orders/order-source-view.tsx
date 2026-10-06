"use client";

import { useApi } from "@/lib/api-client";
import { EmptyState } from "@/components/diamond/shared/empty-state";
import { ShoppingCart } from "lucide-react";

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
