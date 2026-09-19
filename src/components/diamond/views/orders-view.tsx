"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";

interface OrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  requiredDate: string | null;
  promisedDate: string | null;
  status: string;
  priority: string;
  priorityReason: string | null;
  lines: number;
  qtyOrdered: number;
  qtyOutstanding: number;
  backorderQty: number;
  country: string;
  branch: string;
}

interface OrdersResponse {
  rows: OrderRow[];
}

const priorityVariant = (p: string): React.ComponentProps<typeof Badge>["variant"] => {
  switch (p) {
    case "CRITICAL": return "critical";
    case "HIGH": return "high";
    case "MEDIUM": return "medium";
    case "LOW": return "low";
    default: return "default";
  }
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function isOverdue(row: OrderRow): boolean {
  if (!row.requiredDate) return false;
  const req = new Date(row.requiredDate);
  if (Number.isNaN(req.getTime())) return false;
  return req.getTime() < Date.now() && row.qtyOutstanding > 0;
}

export function OrdersView() {
  const { data, isLoading } = useApi<OrdersResponse>("/api/analysis/orders");

  const columns: Column<OrderRow>[] = [
    {
      key: "orderNumber", header: "Order #", sortable: true, sortValue: (r) => r.orderNumber,
      cell: (r) => <span className="font-mono text-[11px]">{r.orderNumber}</span>,
      sticky: "left", width: "130px",
    },
    {
      key: "customerName", header: "Customer", sortable: true, sortValue: (r) => r.customerName,
      cell: (r) => <span className="font-medium">{r.customerName}</span>,
    },
    { key: "country", header: "Country", sortable: true, sortValue: (r) => r.country, cell: (r) => r.country, width: "80px" },
    { key: "branch", header: "Branch", sortable: true, sortValue: (r) => r.branch, cell: (r) => r.branch, width: "80px" },
    { key: "orderDate", header: "Order Date", sortable: true, sortValue: (r) => r.orderDate, align: "right", width: "100px",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.orderDate)}</span> },
    { key: "requiredDate", header: "Required", sortable: true, sortValue: (r) => r.requiredDate ?? "", align: "right", width: "100px",
      cell: (r) => (
        <span className={
          isOverdue(r) ? "tabular-nums text-rose-600 dark:text-rose-400 font-medium" : "tabular-nums text-muted-foreground"
        }>{formatDate(r.requiredDate)}</span>
      ) },
    { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, align: "center", width: "110px",
      cell: (r) => <StatusBadge status={r.status} /> },
    { key: "priority", header: "Priority", sortable: true, sortValue: (r) => r.priority, align: "center", width: "100px",
      cell: (r) => <Badge variant={priorityVariant(r.priority)}>{r.priority}</Badge> },
    { key: "lines", header: "Lines", sortable: true, sortValue: (r) => r.lines, align: "right", width: "70px",
      cell: (r) => <NumberCell value={r.lines} /> },
    { key: "qtyOrdered", header: "Qty Ordered", sortable: true, sortValue: (r) => r.qtyOrdered, align: "right", width: "100px",
      cell: (r) => <NumberCell value={r.qtyOrdered} /> },
    { key: "qtyOutstanding", header: "Outstanding", sortable: true, sortValue: (r) => r.qtyOutstanding, align: "right", width: "100px",
      cell: (r) => <NumberCell value={r.qtyOutstanding} intent={r.qtyOutstanding > 0 ? "warning" : undefined} /> },
    { key: "backorderQty", header: "Backorder", sortable: true, sortValue: (r) => r.backorderQty, align: "right", width: "100px",
      cell: (r) => <NumberCell value={r.backorderQty} intent={r.backorderQty > 0 ? "critical" : undefined} /> },
  ];

  const totalOrders = data?.rows.length ?? 0;
  const totalOrdered = (data?.rows ?? []).reduce((s, r) => s + r.qtyOrdered, 0);
  const totalOutstanding = (data?.rows ?? []).reduce((s, r) => s + r.qtyOutstanding, 0);
  const totalBackorder = (data?.rows ?? []).reduce((s, r) => s + r.backorderQty, 0);
  const overdueCount = (data?.rows ?? []).filter(isOverdue).length;

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Order Analysis"
        subtitle="Sales orders with line-level quantities, outstanding balances and backorders"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {totalOrders} orders · {totalOrdered} qty · {totalOutstanding} outstanding · {totalBackorder} backorder · {overdueCount} overdue
          </span>
        }
      />

      <Section title="Orders" description="Rows are tinted rose when required date is past and outstanding > 0">
        <DataTable<OrderRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No orders found."
          initialSortKey="orderDate"
          initialSortDir="desc"
          exportable
          exportFilename="orders.csv"
          searchable
          searchPlaceholder="Search order #, customer, country..."
          searchFn={(r, q) => `${r.orderNumber} ${r.customerName} ${r.country} ${r.branch} ${r.status}`.toLowerCase().includes(q.toLowerCase())}
          rowClassName={(r) => isOverdue(r) ? "bg-rose-50/50 dark:bg-rose-950/30" : ""}
          maxHeight="650px"
          pagination
          pageSize={50}
        />
      </Section>
    </div>
  );
}
