"use client";

import { useState, useMemo } from "react";
import { useApi, apiFetch } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Money, NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { useGlobalFilter } from "@/stores/global-filter";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Users, MapPin, Award, Activity, Package, Gem, DollarSign,
  TrendingUp, FileText, FileWarning, Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";

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
  /** Totals across every matching customer, independent of the current page. */
  summary: {
    customers: number;
    pieces: number;
    carats: number;
    totalValue: number;
    memoExposure: number;
    openOrders: number;
  };
  sort: string;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface TimelineMonthly {
  month: string;
  pieces: number;
  carats: number;
  value: number;
}

interface TimelineResponse {
  customerId: string;
  customerName: string;
  customerCode: string;
  totalRecords: number;
  monthly: TimelineMonthly[];
  preferences: {
    shapes: { name: string; count: number }[];
    weightBands: { name: string; count: number }[];
    labs: { name: string; count: number }[];
    colors: { name: string; count: number }[];
    clarities: { name: string; count: number }[];
  };
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

function formatMonthLabel(month: string): string {
  // "2025-01" -> "Jan '25"
  const [y, m] = month.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mi = Math.max(0, Math.min(11, parseInt(m, 10) - 1));
  const yy = y.slice(2);
  return `${monthNames[mi]} '${yy}`;
}

function PreferencesBlock({
  title,
  items,
}: {
  title: string;
  items: { name: string; count: number }[];
}) {
  if (!items || items.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
        <p className="text-[11px] text-muted-foreground/60">No data</p>
      </div>
    );
  }
  const maxCount = items[0].count;
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">{title}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => {
          const intensity = maxCount > 0 ? it.count / maxCount : 0;
          const tone =
            intensity > 0.66 ? "info" :
            intensity > 0.33 ? "warning" :
            "neutral";
          return (
            <Badge key={it.name} variant={tone} className="gap-1">
              <span className="font-medium">{it.name}</span>
              <span className="text-[9px] opacity-70 tabular-nums">×{it.count}</span>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

function CustomerDetailDialog({
  customer,
  onClose,
}: {
  customer: CustomerRow | null;
  onClose: () => void;
}) {
  const { data: timeline, isLoading } = useQuery<TimelineResponse>({
    queryKey: ["customer-timeline", customer?.id],
    queryFn: () => apiFetch<TimelineResponse>(`/api/analysis/customers/${customer!.id}/timeline`),
    enabled: !!customer,
    staleTime: 30_000,
  });

  if (!customer) return null;

  // Sparkline = last 7 monthly pieces
  const piecesSparkline = (timeline?.monthly ?? [])
    .slice(-7)
    .map((m) => m.pieces);
  const valueSparkline = (timeline?.monthly ?? [])
    .slice(-7)
    .map((m) => m.value);

  const monthlyData = (timeline?.monthly ?? []).map((m) => ({
    ...m,
    label: formatMonthLabel(m.month),
  }));

  const hasTrendData = monthlyData.some((m) => m.pieces > 0);
  const prefs = timeline?.preferences;

  return (
    <Dialog open={!!customer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span>{customer.name}</span>
            <span className="text-[10px] font-mono text-muted-foreground">({customer.customerCode})</span>
            <Badge variant={priorityVariant(customer.businessPriority)}>{customer.businessPriority}</Badge>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            Customer 360 — buying profile, trends, preferences, and memo exposure
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* 1. Header identity row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] rounded-md border border-border bg-muted/20 p-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Country:</span>
              <span className="font-medium">{customer.country}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Branch:</span>
              <span className="font-medium">{customer.branch}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Award className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Owner:</span>
              <span className="font-medium">{customer.accountOwner}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Last Buy:</span>
              <span className="font-medium tabular-nums">{formatDate(customer.lastPurchase)}</span>
            </div>
          </div>

          {/* 2. KPI grid (6 cards) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <KpiCard
              label="Total Pieces"
              value={customer.pieces}
              unit="pcs"
              intent="info"
              icon={Package}
              hint="Invoice lots · 365D"
              sparkline={piecesSparkline}
            />
            <KpiCard
              label="Total Carats"
              value={customer.carats.toFixed(2)}
              unit="ct"
              intent="success"
              icon={Gem}
              hint="Sum of weights"
            />
            <KpiCard
              label="Total Value"
              value={customer.totalValue}
              icon={DollarSign}
              intent="default"
              hint="Invoice USD"
              sparkline={valueSparkline}
            />
            <KpiCard
              label="Avg $/ct"
              value={customer.avgPerCt}
              icon={TrendingUp}
              intent="info"
              hint="Value / carats"
            />
            <KpiCard
              label="Open Orders"
              value={customer.openOrders}
              intent={customer.openOrders > 0 ? "warning" : "default"}
              icon={FileText}
              hint="OPEN + PARTIAL orders"
            />
            <KpiCard
              label="Memo Exposure"
              value={customer.memoExposure}
              icon={FileWarning}
              intent={customer.memoExposure > 0 ? "critical" : "default"}
              hint="OPEN memo value"
            />
          </div>

          {/* 3. Buying trends chart */}
          <div className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <h3 className="text-xs font-semibold tracking-wide text-foreground">Buying Trends — Last 12 Months</h3>
                <p className="text-[10px] text-muted-foreground">Pieces (bar) + value (area) · monthly aggregates</p>
              </div>
              <Badge variant="neutral" className="gap-1">
                <Sparkles className="h-2.5 w-2.5" />
                {timeline?.totalRecords ?? 0} records
              </Badge>
            </div>
            {isLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="h-4 w-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              </div>
            ) : !hasTrendData ? (
              <InfoBanner variant="warning">
                No invoice records in the trailing 12 months — buying trend chart is unavailable for this customer.
              </InfoBanner>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="valueAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={40} />
                    <YAxis yAxisId="left" tick={{ fontSize: 9 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 9 }} />
                    <Area
                      yAxisId="right"
                      type="monotone"
                      dataKey="value"
                      name="Value USD"
                      stroke="#10b981"
                      fill="url(#valueAreaGrad)"
                      strokeWidth={1.5}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="pieces"
                      name="Pieces"
                      fill="#3b82f6"
                      radius={[2, 2, 0, 0]}
                      barSize={14}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* 4. Customer preferences (2-col grid) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <PreferencesBlock title="Top Shapes" items={prefs?.shapes ?? []} />
            <PreferencesBlock title="Top Weight Bands" items={prefs?.weightBands ?? []} />
            <PreferencesBlock title="Top Labs" items={prefs?.labs ?? []} />
            <PreferencesBlock title="Top Colors" items={prefs?.colors ?? []} />
            <PreferencesBlock title="Top Clarities" items={prefs?.clarities ?? []} />
            <div className="rounded-md border border-border bg-muted/20 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">Profile Summary</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {timeline && timeline.totalRecords > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{timeline.totalRecords}</span> invoice records over the trailing 365 days,
                    spanning <span className="font-medium text-foreground">{prefs?.shapes?.length ?? 0}</span> shapes,
                    <span className="font-medium text-foreground"> {prefs?.weightBands?.length ?? 0}</span> weight bands, and
                    <span className="font-medium text-foreground"> {prefs?.labs?.length ?? 0}</span> lab classes.
                  </>
                ) : (
                  <>No invoice records in the trailing 12 months — preference profile is unavailable.</>
                )}
              </p>
            </div>
          </div>

          {/* 5. Priority reason InfoBanner */}
          <InfoBanner variant={customer.businessPriority === "PLATINUM" ? "success" : customer.businessPriority === "GOLD" ? "warning" : "info"}>
            <div className="flex items-center gap-2">
              <Award className="h-3 w-3 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] uppercase tracking-wide opacity-70">Priority: {customer.businessPriority}</p>
                <p className="text-[11px] font-medium">{customer.priorityReason ?? "No explicit reason recorded."}</p>
              </div>
            </div>
          </InfoBanner>

          {/* 6. Memo exposure callout */}
          {customer.memoExposure > 0 && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-900/60 p-3">
              <div className="flex items-start gap-2">
                <FileWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300 font-semibold">Memo Exposure Callout</p>
                    <span className="text-base font-bold tabular-nums text-amber-800 dark:text-amber-200">
                      <Money value={customer.memoExposure} />
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80 mt-1 leading-relaxed">
                    Open memo stock assigned to this customer. Memo does NOT reduce shortage — it represents inventory held off-balance-sheet at the customer site, with separate credit & return-risk implications.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CustomersView() {
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  // Filtering, ranking and paging all happen on the server; this page holds one page
  // of customers and the totals below describe the whole filtered set.
  const globalFilter = useGlobalFilter();
  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (globalFilter.country) params.set("country", globalFilter.country);
    if (globalFilter.branch) params.set("branch", globalFilter.branch);
    if (globalFilter.lab) params.set("lab", globalFilter.lab);
    if (search.trim()) params.set("q", search.trim());
    params.set("page", String(page));
    params.set("pageSize", "50");
    return `/api/analysis/customers?${params.toString()}`;
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, search, page]);
  const { data, isLoading } = useApi<CustomersResponse>(url);

  // A changed filter or search is a different result set: restart at page one.
  const filterKey = `${globalFilter.country ?? ""}|${globalFilter.branch ?? ""}|${globalFilter.lab ?? ""}|${search}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const filteredRows = data?.rows ?? [];

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

  // Totals come from the server and cover every matching customer, not just this page.
  const totalCustomers = data?.summary.customers ?? 0;
  const totalPieces = data?.summary.pieces ?? 0;
  const totalValue = data?.summary.totalValue ?? 0;
  const totalCaratsAll = data?.summary.carats ?? 0;
  const totalMemo = data?.summary.memoExposure ?? 0;

  // Real-data sparklines: derive 7 points from the top 7 customers (by totalValue).
  // Each KPI's sparkline uses the corresponding field of those top customers.
  const top7Customers = useMemo(() => {
    return [...filteredRows]
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 7);
  }, [filteredRows]);

  const customersCountSpark = useMemo(() => {
    if (top7Customers.length === 0) return undefined; // no data yet — draw no sparkline
    const slice = top7Customers.map((r) => r.pieces);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [top7Customers]);

  const totalValueSpark = useMemo(() => {
    if (top7Customers.length === 0) return undefined; // no data yet — draw no sparkline
    const slice = top7Customers.map((r) => r.totalValue);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [top7Customers]);

  const totalCaratsSpark = useMemo(() => {
    if (top7Customers.length === 0) return undefined; // no data yet — draw no sparkline
    const slice = top7Customers.map((r) => r.carats);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [top7Customers]);

  const memoExposureSpark = useMemo(() => {
    if (top7Customers.length === 0) return undefined; // no data yet — draw no sparkline
    const slice = top7Customers.map((r) => r.memoExposure);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [top7Customers]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Customer 360"
        subtitle="Sales, memo exposure, open orders & priority classification over the trailing 365 days"
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
            <span className="text-[10px] text-muted-foreground">{totalCustomers} customers · {totalPieces} pcs · ${(totalValue / 1000).toFixed(1)}K · ${(totalMemo / 1000).toFixed(1)}K memo</span>
          </div>
        }
      />

      {/* KPI grid — real-data sparklines derived from the top 7 customers (by value) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard
          label="Total Customers"
          value={totalCustomers}
          unit="accts"
          intent="info"
          hint="Active customer accounts"
          icon={Users}
          sparkline={customersCountSpark}
        />
        <KpiCard
          label="Total Value"
          value={`$${(totalValue / 1000).toFixed(1)}K`}
          intent="success"
          hint="Sum of invoice totals · 365D"
          icon={DollarSign}
          sparkline={totalValueSpark}
        />
        <KpiCard
          label="Total Carats"
          value={totalCaratsAll.toFixed(2)}
          unit="ct"
          intent="default"
          hint="Sum of weights · 365D"
          icon={Gem}
          sparkline={totalCaratsSpark}
        />
        <KpiCard
          label="Memo Exposure"
          value={`$${(totalMemo / 1000).toFixed(1)}K`}
          intent={totalMemo > 0 ? "warning" : "default"}
          hint="Open memo value at customer sites"
          icon={FileWarning}
          sparkline={memoExposureSpark}
        />
      </div>

      <Section title="Customers" description="Click any row to inspect priority reason and buying profile">
        <DataTable<CustomerRow>
          columns={columns}
          rows={filteredRows}
          loading={isLoading}
          emptyMessage="No customer data available."
          onRowClick={(r) => setSelected(r)}
          rowClassName={(r) => r.openOrders > 0 ? "bg-sky-50/40 dark:bg-sky-950/20" : ""}
          initialSortKey="totalValue"
          initialSortDir="desc"
          exportable
          exportPermission="customers.export"
          exportFilename="customers.csv"
          excelExportable
          excelExportFilename="customers.xlsx"
          exportScope="current-page"
          toolbar={
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name (server-side)…"
              className="h-7 w-52 rounded-md border border-border bg-background/90 px-2 text-xs"
            />
          }
          maxHeight="600px"
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

      <CustomerDetailDialog customer={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
