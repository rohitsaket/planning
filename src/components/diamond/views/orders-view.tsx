"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { useGlobalFilter } from "@/stores/global-filter";
import { FileText, AlertTriangle, Clock, Boxes } from "lucide-react";

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
  // Global filter — /api/analysis/orders currently returns all orders; we append the
  // global filter params to the URL (forward-compat) AND apply the country/branch
  // filter client-side on the returned rows.
  const globalFilter = useGlobalFilter();
  const url = useMemo(() => {
    const base = "/api/analysis/orders";
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);
  const { data, isLoading } = useApi<OrdersResponse>(url);

  const filteredRows = useMemo(() => {
    const all = data?.rows ?? [];
    let r = all;
    if (globalFilter.country) r = r.filter((row) => row.country === globalFilter.country);
    if (globalFilter.branch) r = r.filter((row) => row.branch === globalFilter.branch);
    return r;
  }, [data, globalFilter.country, globalFilter.branch]);

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

  const totalOrders = filteredRows.length;
  const totalOrdered = filteredRows.reduce((s, r) => s + r.qtyOrdered, 0);
  const totalOutstanding = filteredRows.reduce((s, r) => s + r.qtyOutstanding, 0);
  const totalBackorder = filteredRows.reduce((s, r) => s + r.backorderQty, 0);
  const overdueCount = filteredRows.filter(isOverdue).length;
  // Real-data sparklines:
  // - Open Orders: count of orders per status (top 7 statuses by count)
  // - Overdue Orders: top 7 overdue orders by qtyOutstanding (overdue-volume proxy)
  // - Outstanding Qty: top 7 orders' qtyOutstanding
  // - Backorder Qty: top 7 orders' backorderQty
  const openOrdersSpark = useMemo(() => {
    if (filteredRows.length === 0) return [3, 5, 4, 6, 8, 7, 9]; // synthetic fallback
    const counts: Record<string, number> = {};
    filteredRows.forEach((r) => {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    });
    const values = Object.values(counts).sort((a, b) => b - a);
    const slice = values.slice(0, 7);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [filteredRows]);
  const overdueSpark = useMemo(() => {
    if (filteredRows.length === 0) return [2, 3, 4, 2, 5, 3, 4]; // synthetic fallback
    const overdue = filteredRows
      .filter(isOverdue)
      .map((r) => r.qtyOutstanding)
      .slice(0, 7);
    while (overdue.length < 7) overdue.push(overdue.length ? overdue[overdue.length - 1] : 0);
    return overdue;
  }, [filteredRows]);
  const outstandingSpark = useMemo(() => {
    const slice = filteredRows.slice(0, 7).map((r) => r.qtyOutstanding);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [filteredRows]);
  const backorderSpark = useMemo(() => {
    const slice = filteredRows.slice(0, 7).map((r) => r.backorderQty);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [filteredRows]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Order Analysis"
        subtitle="Sales orders with line-level quantities, outstanding balances and backorders"
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {globalFilter.hasActiveFilters() && (
              <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
                Filtered by: {[
                  globalFilter.country && `Country=${globalFilter.country}`,
                  globalFilter.branch && `Branch=${globalFilter.branch}`,
                  globalFilter.lab && `Lab=${globalFilter.lab}`,
                ].filter(Boolean).join(", ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {totalOrders} orders · {totalOrdered} qty · {totalOutstanding} outstanding · {totalBackorder} backorder · {overdueCount} overdue
            </span>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Open Orders" value={totalOrders} intent="info" hint="Active sales orders" icon={FileText} sparkline={openOrdersSpark} />
        <KpiCard label="Overdue Orders" value={overdueCount} intent="critical" hint="Required date past + outstanding > 0" icon={AlertTriangle} sparkline={overdueSpark} />
        <KpiCard label="Outstanding Qty" value={totalOutstanding} unit="pcs" intent="warning" hint="Σ qtyOutstanding" icon={Boxes} sparkline={outstandingSpark} />
        <KpiCard label="Backorder Qty" value={totalBackorder} unit="pcs" intent="default" hint="Σ backorderQty" icon={Clock} sparkline={backorderSpark} />
      </div>

      <Section title="Orders" description="Rows are tinted rose when required date is past and outstanding > 0">
        <DataTable<OrderRow>
          columns={columns}
          rows={filteredRows}
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
