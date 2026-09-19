"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Money, NumberCell } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Users, MapPin, Award, Activity } from "lucide-react";

interface CustomerRow {
  id: string;
  customerCode: string;
  name: string;
  country: string;
  branch: string;
  accountOwner: string;
  businessPriority: string;
  priorityReason: string | null;
  pieces: number;
  carats: number;
  totalValue: number;
  avgPerCt: number;
  openOrders: number;
  memoExposure: number;
  lastPurchase: string | null;
}

interface CustomersResponse {
  rows: CustomerRow[];
}

const priorityVariant = (p: string): React.ComponentProps<typeof Badge>["variant"] => {
  switch (p) {
    case "PLATINUM": return "info";
    case "GOLD": return "warning";
    case "SILVER": return "neutral";
    case "BRONZE": return "default";
    default: return "default";
  }
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function CustomersView() {
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const { data, isLoading } = useApi<CustomersResponse>("/api/analysis/customers");

  const columns: Column<CustomerRow>[] = [
    {
      key: "customerCode", header: "Code", sortable: true, sortValue: (r) => r.customerCode,
      cell: (r) => <span className="font-mono text-[11px] text-muted-foreground">{r.customerCode}</span>,
      sticky: "left", width: "120px",
    },
    {
      key: "name", header: "Customer", sortable: true, sortValue: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    { key: "country", header: "Country", sortable: true, sortValue: (r) => r.country, cell: (r) => r.country, width: "90px" },
    { key: "branch", header: "Branch", sortable: true, sortValue: (r) => r.branch, cell: (r) => r.branch, width: "90px" },
    { key: "accountOwner", header: "Account Owner", sortable: true, sortValue: (r) => r.accountOwner, cell: (r) => r.accountOwner, width: "120px" },
    {
      key: "businessPriority", header: "Priority", sortable: true, sortValue: (r) => r.businessPriority,
      align: "center", width: "100px",
      cell: (r) => <Badge variant={priorityVariant(r.businessPriority)}>{r.businessPriority}</Badge>,
    },
    { key: "pieces", header: "Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right", width: "80px",
      cell: (r) => <NumberCell value={r.pieces} /> },
    { key: "carats", header: "Carats", sortable: true, sortValue: (r) => r.carats, align: "right", width: "80px",
      cell: (r) => <NumberCell value={r.carats} /> },
    { key: "totalValue", header: "Total Value", sortable: true, sortValue: (r) => r.totalValue, align: "right", width: "100px",
      cell: (r) => <Money value={r.totalValue} /> },
    { key: "avgPerCt", header: "Avg $/ct", sortable: true, sortValue: (r) => r.avgPerCt, align: "right", width: "90px",
      cell: (r) => <Money value={r.avgPerCt} /> },
    { key: "openOrders", header: "Open Orders", sortable: true, sortValue: (r) => r.openOrders, align: "right", width: "90px",
      cell: (r) => <NumberCell value={r.openOrders} intent={r.openOrders > 0 ? "info" : undefined} /> },
    { key: "memoExposure", header: "Memo Exposure", sortable: true, sortValue: (r) => r.memoExposure, align: "right", width: "110px",
      cell: (r) => <Money value={r.memoExposure} /> },
    { key: "lastPurchase", header: "Last Purchase", sortable: true, sortValue: (r) => r.lastPurchase ?? "", align: "right", width: "110px",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.lastPurchase)}</span> },
  ];

  const totalPieces = (data?.rows ?? []).reduce((s, r) => s + r.pieces, 0);
  const totalValue = (data?.rows ?? []).reduce((s, r) => s + r.totalValue, 0);
  const totalMemo = (data?.rows ?? []).reduce((s, r) => s + r.memoExposure, 0);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Customer 360"
        subtitle="Sales, memo exposure, open orders & priority classification over the trailing 365 days"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} customers · {totalPieces} pcs · ${(totalValue / 1000).toFixed(1)}K · ${(totalMemo / 1000).toFixed(1)}K memo</span>}
      />

      <Section title="Customers" description="Click any row to inspect priority reason and buying profile">
        <DataTable<CustomerRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No customer data available."
          onRowClick={(r) => setSelected(r)}
          rowClassName={(r) => r.openOrders > 0 ? "bg-sky-50/40 dark:bg-sky-950/20" : ""}
          initialSortKey="totalValue"
          initialSortDir="desc"
          exportable
          exportFilename="customers.csv"
          searchable
          searchPlaceholder="Search code, name, country..."
          searchFn={(r, q) => `${r.customerCode} ${r.name} ${r.country} ${r.branch} ${r.accountOwner}`.toLowerCase().includes(q.toLowerCase())}
          maxHeight="600px"
        />
      </Section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              {selected?.name}
              <span className="text-[10px] font-mono text-muted-foreground">({selected?.customerCode})</span>
              {selected && (
                <Badge variant={priorityVariant(selected.businessPriority)}>{selected.businessPriority}</Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Customer 360 — buying profile and memo exposure
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="flex flex-col gap-3">
              {/* Identity */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Country:</span><span className="font-medium">{selected.country}</span></div>
                <div className="flex items-center gap-1"><MapPin className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Branch:</span><span className="font-medium">{selected.branch}</span></div>
                <div className="flex items-center gap-1"><Award className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Owner:</span><span className="font-medium">{selected.accountOwner}</span></div>
                <div className="flex items-center gap-1"><Activity className="h-3 w-3 text-muted-foreground" /><span className="text-muted-foreground">Last Buy:</span><span className="font-medium tabular-nums">{formatDate(selected.lastPurchase)}</span></div>
              </div>

              {/* Priority reason */}
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Priority Reason</p>
                <p className="text-xs">{selected.priorityReason ?? "No explicit reason recorded."}</p>
              </div>

              {/* Buying breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Pieces</p>
                  <p className="text-sm font-semibold tabular-nums">{selected.pieces}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Carats</p>
                  <p className="text-sm font-semibold tabular-nums">{selected.carats.toFixed(2)}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Total Value</p>
                  <p className="text-sm font-semibold tabular-nums"><Money value={selected.totalValue} /></p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Avg $/ct</p>
                  <p className="text-sm font-semibold tabular-nums"><Money value={selected.avgPerCt} /></p>
                </div>
                <div className="rounded-md border border-sky-300/50 bg-sky-50/40 dark:bg-sky-950/20 p-3">
                  <p className="text-[10px] uppercase text-muted-foreground">Open Orders</p>
                  <p className="text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300">{selected.openOrders}</p>
                </div>
                <div className="rounded-md border border-amber-300/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 col-span-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Memo Exposure</p>
                  <p className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300"><Money value={selected.memoExposure} /></p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Memo does NOT reduce shortage — separate decision context.</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
