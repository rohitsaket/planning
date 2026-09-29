"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { NumberCell, Money, InfoBanner } from "@/components/diamond/shared/empty-state";
import { StatusBadge } from "@/components/diamond/shared/badges";
import { useGlobalFilter } from "@/stores/global-filter";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { FileText, DollarSign, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MemoAggRow {
  dimension: string;
  qty: number;
  value: number;
  avgAge: number;
}

interface MemoRow {
  id: string;
  lotId: string;
  memoDate: string;
  customerName: string;
  country: string;
  branch: string;
  shape: string;
  weight: number;
  lab: string | null;
  color: string | null;
  clarity: string | null;
  treatment: string | null;
  memoValueUsd: number;
  status: string;
  memoAgeDays: number | null;
}

interface MemoAgeBuckets { "0-30": number; "31-60": number; "61-90": number; "91-180": number; "180+": number; }

interface MemoResponse {
  totalQty: number;
  totalValue: number;
  byCountry: MemoAggRow[];
  byCustomer: MemoAggRow[];
  ageBuckets: MemoAgeBuckets;
  rows: MemoRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function MemoView() {
  // The memo API applies country/branch/lab filters, aggregates over the whole
  // filtered set in PostgreSQL, and pages the detail rows. Nothing is re-filtered
  // or re-aggregated in the browser.
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return `/api/analysis/memo?${params.toString()}`;
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, page]);
  const { data, isLoading } = useApi<MemoResponse>(url);

  const filterKey = `${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}|${globalFilter.lab ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const filteredRows = data?.rows ?? [];
  const filteredByCountry = data?.byCountry ?? [];
  const filteredByCustomer = data?.byCustomer ?? [];
  const filteredTotalQty = data?.totalQty ?? 0;
  const filteredTotalValue = data?.totalValue ?? 0;
  const filteredAgeBuckets = data?.ageBuckets ?? { "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "180+": 0 };

  const ageChartData = data
    ? ([
        { name: "0-30", qty: filteredAgeBuckets["0-30"] },
        { name: "31-60", qty: filteredAgeBuckets["31-60"] },
        { name: "61-90", qty: filteredAgeBuckets["61-90"] },
        { name: "91-180", qty: filteredAgeBuckets["91-180"] },
        { name: "180+", qty: filteredAgeBuckets["180+"] },
      ])
    : [];
  const aggColumns: Column<MemoAggRow>[] = [
    {
      key: "dimension", header: "Group", sortable: true, sortValue: (r) => r.dimension,
      cell: (r) => <span className="font-medium">{r.dimension}</span>, sticky: "left",
    },
    { key: "qty", header: "Qty", sortable: true, sortValue: (r) => r.qty, align: "right",
      cell: (r) => <NumberCell value={r.qty} /> },
    { key: "value", header: "Value", sortable: true, sortValue: (r) => r.value, align: "right",
      cell: (r) => <Money value={r.value} /> },
    { key: "avgAge", header: "Avg Age (days)", sortable: true, sortValue: (r) => r.avgAge, align: "right",
      cell: (r) => <NumberCell value={r.avgAge} intent={r.avgAge > 90 ? "warning" : undefined} /> },
  ];

  const detailColumns: Column<MemoRow>[] = [
    { key: "lotId", header: "Lot ID", sortable: true, sortValue: (r) => r.lotId,
      cell: (r) => <span className="font-mono text-[11px]">{r.lotId}</span>, sticky: "left", width: "130px" },
    { key: "memoDate", header: "Memo Date", sortable: true, sortValue: (r) => r.memoDate, align: "right", width: "100px",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.memoDate)}</span> },
    { key: "customerName", header: "Customer", sortable: true, sortValue: (r) => r.customerName,
      cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { key: "country", header: "Country", align: "center", sortable: true, sortValue: (r) => r.country, cell: (r) => r.country, width: "80px" },
    { key: "branch", header: "Branch", align: "center", sortable: true, sortValue: (r) => r.branch, cell: (r) => r.branch, width: "80px" },
    { key: "shape", header: "Shape", align: "center", sortable: true, sortValue: (r) => r.shape, cell: (r) => r.shape, width: "80px" },
    { key: "weight", header: "Weight", sortable: true, sortValue: (r) => r.weight, align: "right", width: "80px",
      cell: (r) => <NumberCell value={r.weight} /> },
    { key: "lab", header: "Lab", align: "center", sortable: true, sortValue: (r) => r.lab ?? "", width: "80px",
      cell: (r) => <span className="text-muted-foreground">{r.lab ?? "Non-Cert"}</span> },
    { key: "color", header: "Color", align: "center", sortable: true, sortValue: (r) => r.color ?? "", width: "70px",
      cell: (r) => r.color ?? <span className="text-muted-foreground">—</span> },
    { key: "clarity", header: "Clarity", align: "center", sortable: true, sortValue: (r) => r.clarity ?? "", width: "80px",
      cell: (r) => r.clarity ?? <span className="text-muted-foreground">—</span> },
    { key: "treatment", header: "Treatment", align: "center", sortable: true, sortValue: (r) => r.treatment ?? "", width: "90px",
      cell: (r) => r.treatment ?? <span className="text-muted-foreground">—</span> },
    { key: "memoValueUsd", header: "Memo Value", sortable: true, sortValue: (r) => r.memoValueUsd, align: "right", width: "100px",
      cell: (r) => <Money value={r.memoValueUsd} /> },
    { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, align: "center", width: "90px",
      cell: (r) => <StatusBadge status={r.status} /> },
    { key: "memoAgeDays", header: "Age (days)", sortable: true, sortValue: (r) => r.memoAgeDays ?? 0, align: "right", width: "90px",
      cell: (r) => {
        const a = r.memoAgeDays ?? 0;
        return <NumberCell value={a} intent={a > 90 ? "critical" : a > 30 ? "warning" : undefined} />;
      } },
  ];

  const [activeTab, setActiveTab] = useState<"country" | "customer" | "detail" | "aging">("country");

  const renderTabs = (active: "country" | "customer" | "detail" | "aging") => (
    <div className="flex items-center gap-1.5 p-0.5 rounded-lg border border-border/80 bg-muted/40 backdrop-blur-md shadow-2xs">
      <button
        type="button"
        onClick={() => setActiveTab("country")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "country"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>By Country</span>
        <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "country" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
          {filteredByCountry.length}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("customer")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "customer"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>By Customer</span>
        <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "customer" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
          {filteredByCustomer.length}
        </span>
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("detail")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "detail"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>Memo Lots</span>
        {data?.total !== undefined && (
          <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "detail" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
            {data.total}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("aging")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "aging"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>Age Buckets</span>
        <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "aging" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
          {ageChartData.length}
        </span>
      </button>
    </div>
  );

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y flex-1 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 flex flex-col gap-section">
        <PageHeader
          title="Memo Analysis"
          subtitle="Stock on consignment — pieces, value and age by country and customer"
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
              <span className="text-[10px] text-muted-foreground">{(data?.total ?? 0).toLocaleString()} memo lots across {filteredByCountry.length} countries</span>
            </div>
          }
        />

        <InfoBanner variant="warning">
          Memo stock does not reduce shortage.
        </InfoBanner>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <KpiCard label="Total Qty" value={filteredTotalQty} unit="pcs" intent="info" hint="All memo lots" icon={FileText} />
          <KpiCard label="Total Value" value={`$${(filteredTotalValue / 1000).toFixed(1)}K`} intent="warning" hint="Memo exposure at cost" icon={DollarSign} />
          <KpiCard label="Avg Age" value={
            filteredRows.length > 0
              ? Math.round(filteredRows.reduce((s, r) => s + (r.memoAgeDays ?? 0), 0) / filteredRows.length)
              : 0
          } unit="days" intent="default" hint="Average age, this page" icon={Clock} />
          <KpiCard label="Aged > 90D" value={
            filteredAgeBuckets["91-180"] + filteredAgeBuckets["180+"]
          } unit="pcs" intent="critical" hint="Memos needing follow-up" icon={AlertTriangle} />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {activeTab === "country" && (
          <Section
            title={renderTabs("country")}
            description="Memo qty, value and avg age per country"
            className="flex-1 min-h-0 flex flex-col"
          >
            <DataTable<MemoAggRow>
              columns={aggColumns}
              rows={filteredByCountry}
              loading={isLoading}
              emptyMessage="No memo data by country."
              initialSortKey="value"
              initialSortDir="desc"
              exportable
              exportPermission="sales.export"
              exportFilename="memo-by-country.csv"
              pagination
              pageSize={25}
            />
          </Section>
        )}

        {activeTab === "customer" && (
          <Section
            title={renderTabs("customer")}
            description="Memo qty, value and avg age per customer"
            className="flex-1 min-h-0 flex flex-col"
          >
            <DataTable<MemoAggRow>
              columns={aggColumns}
              rows={filteredByCustomer}
              loading={isLoading}
              emptyMessage="No memo data by customer."
              initialSortKey="value"
              initialSortDir="desc"
              exportable
              exportPermission="sales.export"
              exportFilename="memo-by-customer.csv"
              pagination
              pageSize={25}
            />
          </Section>
        )}

        {activeTab === "detail" && (
          <Section
            title={renderTabs("detail")}
            description="Memo lots with stone details and age"
            className="flex-1 min-h-0 flex flex-col"
          >
            <DataTable<MemoRow>
              columns={detailColumns}
              rows={filteredRows}
              loading={isLoading}
              emptyMessage="No memo lots found."
              initialSortKey="memoAgeDays"
              initialSortDir="desc"
              exportable
              exportPermission="sales.export"
              exportFilename="memos.csv"
              searchable
              searchPlaceholder="Search lot, customer, country, shape..."
              searchFn={(r, q) => `${r.lotId} ${r.customerName} ${r.country} ${r.branch} ${r.shape} ${r.lab ?? ""}`.toLowerCase().includes(q.toLowerCase())}
              exportScope="current-page"
            />
            <div className="flex-shrink-0">
              <ServerPagination
                page={data?.page ?? 1}
                pageSize={data?.pageSize ?? 50}
                total={data?.total ?? 0}
                hasMore={data?.hasMore ?? false}
                onPageChange={setPage}
                loading={isLoading}
                label="memo lots"
              />
            </div>
          </Section>
        )}

        {activeTab === "aging" && (
          <Section
            title={renderTabs("aging")}
            description="Memo count by age"
            className="flex-1 min-h-0 flex flex-col"
          >
            <div className="flex-1 min-h-[260px] p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ageChartData} margin={{ top: 12, right: 16, bottom: 12, left: 0 }}>
                  <defs>
                    <linearGradient id="memoAgeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA580C" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#EA580C" stopOpacity={0.3} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="qty" name="Qty" fill="url(#memoAgeGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
