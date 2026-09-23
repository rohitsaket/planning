"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Star, AlertTriangle, TrendingUp, Clock, Users } from "lucide-react";

interface ReorderSignal {
  customerId: string;
  customerCode: string;
  customerName: string;
  country: string;
  businessPriority: string | null;
  totalOrders: number;
  lastPurchaseDate: string | null;
  avgIntervalDays: number | null;
  typicalCategories: string[];
  likelyReorderWindow: string | null;
  likelyReorderDate: string | null;
  daysSinceLastPurchase: number | null;
  confidence: number;
  signal: "PREDICTED_SOON" | "PREDICTED_LATER" | "INSUFFICIENT_DATA" | "DORMANT";
}

const signalVariant: Record<string, "critical" | "warning" | "info" | "neutral"> = {
  PREDICTED_SOON: "critical",
  PREDICTED_LATER: "warning",
  INSUFFICIENT_DATA: "info",
  DORMANT: "neutral",
};

const signalIntent: Record<string, "critical" | "warning" | "info" | "default"> = {
  PREDICTED_SOON: "critical",
  PREDICTED_LATER: "warning",
  INSUFFICIENT_DATA: "info",
  DORMANT: "default",
};

interface ReorderSignalsResponse {
  rows: ReorderSignal[];
  /** Counts across every customer in scope, not only the visible page. */
  summary: {
    customers: number;
    predictedSoon: number;
    predictedLater: number;
    insufficientData: number;
    dormant: number;
    avgConfidence: number;
  };
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  advisory: boolean;
  advisoryNotice: string;
}

export function ReorderSignalsView() {
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return `/api/analysis/reorder-signals?${params.toString()}`;
  }, [globalFilter.country, globalFilter.branch, page]);
  const { data, isLoading } = useApi<ReorderSignalsResponse>(url);

  const filterKey = `${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const rows = data?.rows ?? [];
  const predictedSoon = data?.summary.predictedSoon ?? 0;
  const predictedLater = data?.summary.predictedLater ?? 0;
  const insufficient = data?.summary.insufficientData ?? 0;
  const avgConfidence = data?.summary.avgConfidence ?? 0;

  const columns: Column<ReorderSignal>[] = [
    {
      key: "signal",
      header: "Signal",
      align: "center",
      sortable: true,
      sortValue: (r) => r.signal,
      cell: (r) => <Badge variant={signalVariant[r.signal]}>{r.signal.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "customerName",
      header: "Customer",
      sortable: true,
      sortValue: (r) => r.customerName,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-xs">{r.customerName}</span>
          <span className="text-[10px] text-muted-foreground">{r.customerCode} · {r.country}</span>
        </div>
      ),
    },
    {
      key: "businessPriority",
      header: "Priority",
      align: "center",
      cell: (r) => r.businessPriority ? <Badge variant={r.businessPriority === "Strategic" ? "critical" : r.businessPriority === "Key" ? "warning" : "neutral"}>{r.businessPriority}</Badge> : <span className="text-muted-foreground/50">—</span>,
    },
    {
      key: "totalOrders",
      header: "Orders",
      align: "right",
      sortable: true,
      sortValue: (r) => r.totalOrders,
      cell: (r) => <NumberCell value={r.totalOrders} />,
    },
    {
      key: "avgIntervalDays",
      header: "Avg Interval",
      align: "right",
      sortable: true,
      sortValue: (r) => r.avgIntervalDays ?? 0,
      cell: (r) => r.avgIntervalDays ? <span className="tabular-nums">{r.avgIntervalDays}d</span> : <span className="text-muted-foreground/50">—</span>,
    },
    {
      key: "daysSinceLastPurchase",
      header: "Since Last",
      align: "right",
      sortable: true,
      sortValue: (r) => r.daysSinceLastPurchase ?? 0,
      cell: (r) => r.daysSinceLastPurchase !== null ? <span className="tabular-nums">{r.daysSinceLastPurchase}d</span> : <span className="text-muted-foreground/50">—</span>,
    },
    {
      key: "likelyReorderWindow",
      header: "Likely Reorder",
      align: "center",
      cell: (r) => r.likelyReorderWindow ? <span className="font-medium text-xs">{r.likelyReorderWindow}</span> : <span className="text-muted-foreground/50">—</span>,
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "center",
      sortable: true,
      sortValue: (r) => r.confidence,
      cell: (r) => (
        <div className="flex items-center gap-1.5 justify-center">
          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${r.confidence >= 0.7 ? "bg-emerald-500" : r.confidence >= 0.5 ? "bg-amber-500" : "bg-rose-500"}`}
              style={{ width: `${r.confidence * 100}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{Math.round(r.confidence * 100)}%</span>
        </div>
      ),
    },
    {
      key: "typicalCategories",
      header: "Typical Categories",
      cell: (r) => (
        <div className="flex flex-wrap gap-1 max-w-xs">
          {r.typicalCategories.length === 0 ? <span className="text-muted-foreground/50 text-[10px]">—</span> :
            r.typicalCategories.map((c, i) => <Badge key={i} variant="neutral" className="text-[9px]">{c}</Badge>)}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Customer Reorder Signals"
        subtitle="Advisory prediction of likely customer reorder windows based on historical repeat-interval analysis"
        meta={<Badge variant="warning">PREDICTION — NOT confirmed demand</Badge>}
      />

      <InfoBanner variant="warning">
        <strong>PREDICTION ONLY.</strong> Customer reorder signals are advisory. Never convert a prediction into a confirmed order without business approval. Typical repeat interval is computed from historical invoice dates per customer; confidence reflects interval consistency (lower variance = higher confidence).
      </InfoBanner>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Predicted Soon" value={predictedSoon} unit="customers" intent="critical" icon={AlertTriangle} hint="Reorder expected within 14 days or overdue" />
        <KpiCard label="Predicted Later" value={predictedLater} unit="customers" intent="warning" icon={Clock} hint="Reorder expected in 15-45 days" />
        <KpiCard label="Insufficient Data" value={insufficient} unit="customers" intent="info" icon={Users} hint="Fewer than 2 historical intervals" />
        <KpiCard label="Avg Confidence" value={`${(avgConfidence * 100).toFixed(0)}%`} intent={avgConfidence >= 0.6 ? "success" : "warning"} icon={TrendingUp} hint="Across all customers with predictions" />
      </div>

      <Section title="Customer Reorder Predictions" description="Sorted by signal urgency — PREDICTED_SOON first">
        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No customer data available."
          maxHeight="600px"
          searchable
          searchPlaceholder="Search customer..."
          searchFn={(r, q) => r.customerName.toLowerCase().includes(q.toLowerCase()) || r.customerCode.toLowerCase().includes(q.toLowerCase())}
          exportable
          exportPermission="analysis.export"
          exportFilename="customer-reorder-signals.csv"
          exportScope="current-page"
          initialSortKey="signal"
        />
        <ServerPagination
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 50}
          total={data?.total ?? 0}
          hasMore={data?.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="customers"
        />
      </Section>
    </div>
  );
}
