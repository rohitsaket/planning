"use client";

import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { Section } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Database } from "lucide-react";

/**
 * ORDERS — the honest state of the order source.
 *
 * Fantasy supplies no order entity. Rather than filling this tab with seeded
 * demonstration rows and calling them synchronized data, it states that plainly and
 * lists exactly which fields cannot be derived and why.
 *
 * The seeded `SalesOrder` rows are acknowledged as existing, with their count, so nobody
 * concludes the data is missing from the database — only that it is not an authoritative
 * Fantasy source.
 */

interface OrderSourceResponse {
  available: boolean;
  unavailableReason: string | null;
  orderSource: {
    state: string;
    reasonCode: string;
    message: string;
    seededOrderCount: number;
    seededOrderLineCount: number;
    fieldsAvailable: string[];
    fieldsUnavailable: string[];
  };
  rows: unknown[];
}

interface FieldRow { field: string; state: "UNAVAILABLE" | "AVAILABLE"; reason: string }

/**
 * Why each order field cannot be derived.
 *
 * Every entry names the missing confirmation rather than a workaround, because each of
 * these could be guessed from a Fantasy column and each guess would be wrong in a way
 * that looks right on screen.
 */
const FIELD_REASONS: Record<string, string> = {
  ORDER_IDENTITY: "Fantasy supplies no order number. A document or allocation account ID is not an order.",
  REQUESTED_QUANTITY: "No requested quantity is supplied; Qty describes the stone record, not a demand.",
  FULFILLED_QUANTITY: "No fulfilment is reported against any order.",
  REMAINING_QUANTITY: "Cannot be derived without a confirmed requested and fulfilled quantity.",
  REQUIRED_DATE: "No required or promised date is supplied. Doc Date is the record's own date.",
  FULFILMENT_STATUS: "No order lifecycle is supplied, so open, partial and fulfilled cannot be distinguished.",
  BACKORDER_STATE: "Not supplied. Inferring it from insufficient stock is an unconfirmed business rule.",
  CANCELLATION: "No cancellation event is supplied.",
  CUSTOMER_OWNERSHIP: "No confirmed link from an order to a customer exists.",
};

export function OrderSourceView() {
  const setView = useNavStore((s) => s.setView);
  const { data, isLoading } = useApi<OrderSourceResponse>("/api/analysis/customers-orders?section=orders");

  const src = data?.orderSource;
  const fieldRows: FieldRow[] = [
    ...(src?.fieldsAvailable ?? []).map((f) => ({ field: f, state: "AVAILABLE" as const, reason: "Supplied by the source." })),
    ...(src?.fieldsUnavailable ?? []).map((f) => ({
      field: f,
      state: "UNAVAILABLE" as const,
      reason: FIELD_REASONS[f] ?? "Not supplied by the source.",
    })),
  ];

  const columns: Column<FieldRow>[] = [
    { key: "field", header: "Order field", width: "16rem", cell: (r) => <span className="font-medium">{r.field.replace(/_/g, " ")}</span> },
    {
      key: "state", header: "State", width: "11rem",
      cell: (r) => <Badge variant={r.state === "AVAILABLE" ? "success" : "critical"}>{r.state}</Badge>,
    },
    { key: "reason", header: "Why", cell: (r) => <span className="text-muted-foreground">{r.reason}</span> },
  ];

  return (
    <div className="space-y-4">
      <InfoBanner variant="critical">
        <span className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" />
          ORDER SOURCE NOT CONFIGURED
        </span>
        <div className="mt-1 text-xs">{src?.message}</div>
      </InfoBanner>

      <Section
        title="Order source"
        description="Which order fields an authoritative source would have to supply, and which of them Fantasy currently supplies."
      >
        <DataTable
          columns={columns}
          rows={fieldRows}
          loading={isLoading}
          emptyMessage="Order source state is unavailable."
          pagination={false}
          enableColumnFilter={false}
          enableColumnValueFilter={false}
        />
      </Section>

      <Section
        title="Open orders"
        description="No authoritative order source is configured, so no open order, backorder or fulfilment figure is reported."
      >
        <EmptyState
          title="UNAVAILABLE"
          message="Open orders and backorders cannot be reported until Fantasy supplies a confirmed order entity and lifecycle, or another authoritative order source is approved."
          icon={<Database className="h-5 w-5" />}
        />
      </Section>

      {src && src.seededOrderCount > 0 && (
        <Section
          title="Seeded demonstration records"
          description="Disclosed so the figures above are not mistaken for missing data."
        >
          <InfoBanner variant="info">
            <div className="space-y-1">
              <div>
                The database holds <strong>{src.seededOrderCount}</strong> seeded order records and{" "}
                <strong>{src.seededOrderLineCount}</strong> seeded order lines. They were created by the
                demonstration seed, carry no source mode, no simulation flag and no synchronization
                linkage, and no Fantasy path writes them.
              </div>
              <div>
                They are therefore <strong>not</strong> shown as order data on this page. They remain in the
                database and are untouched.
              </div>
            </div>
          </InfoBanner>
          <div className="px-3 pb-3">
            <Button size="sm" variant="outline" className="h-7" onClick={() => setView("fantasy-sync")}>
              Review Fantasy source state
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}
