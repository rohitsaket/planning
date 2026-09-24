"use client";

import { useMemo, useState } from "react";
import { Download, Gem, Layers, Package, Rows3 } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, Column, DATA_TABLE_VIEWPORT_MAX_HEIGHT } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { useSalesFilters } from "@/stores/sales-analysis-filters";
import { cn } from "@/lib/utils";
import {
  CATEGORY_SORT_KEYS,
  RECORD_SORT_KEYS,
  SALES_DATA_STATE_LABELS,
  type CategorySalesRow,
  type CategorySortKey,
  type PagingMeta,
  type RecordSortKey,
  type SalesDataState,
  type SalesReadiness,
  type SortDirection,
  type SupportingRecordRow,
} from "@/lib/analytics/sales-history-contract";
import { SalesFilterBar } from "@/components/diamond/views/sales/sales-filter-bar";
import { SortControls } from "@/components/diamond/views/sales/sort-controls";
import { salesUrl, useSalesQuery } from "@/components/diamond/views/sales/use-sales-query";
import { useServerPage } from "@/components/diamond/views/sales/use-server-page";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

interface SummaryResponse {
  sourceDisclosure: SourceDisclosure | null;
  readiness: SalesReadiness;
  rows: CategorySalesRow[];
  paging: PagingMeta;
  totals: { confirmedQuantity: number; confirmedWeight: number; recordCount: number; categories: number };
}

interface RecordsResponse {
  rows: SupportingRecordRow[];
  paging: PagingMeta;
}

const CATEGORY_SORT_LABELS: Record<CategorySortKey, string> = {
  category: "Category",
  total90: "Confirmed quantity",
  latest30: "Latest 30D quantity",
  middle30: "Middle 30D quantity",
  previous30: "Previous 30D quantity",
  weight: "Confirmed weight",
  records: "Sale records",
  latestSaleDate: "Latest sale date",
};

const RECORD_SORT_LABELS: Record<RecordSortKey, string> = {
  docDate: "Document date",
  quantity: "Confirmed quantity",
  weight: "Measured weight",
  category: "Category",
};

const DATA_STATE_VARIANT: Record<SalesDataState, React.ComponentProps<typeof Badge>["variant"]> = {
  CONFIRMED: "success",
  REVIEW_REQUIRED: "warning",
  INSUFFICIENT_HISTORY: "neutral",
};

const PAGE_SIZE = 25;

/** IST business date of a stored UTC instant, for display only. */
const istDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : "—";

/**
 * Sales Analysis — confirmed historical sales by category, and the exact records behind
 * each aggregate.
 *
 * This page describes what was sold. It does not calculate manufacturing priorities,
 * reorder quantities or forecasts, and it never presents a row count as a piece quantity.
 */
export function SalesAnalysisView() {
  const { params } = useSalesQuery();
  const selectCategory = useSalesFilters((s) => s.selectCategory);
  const selectedCategory = useSalesFilters((s) => s.filters.categoryId);
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canExport = permissions.includes("sales.export");

  const [activeTab, setActiveTab] = useState<"summary" | "records">("summary");
  const [sort, setSort] = useState<{ key: CategorySortKey; dir: SortDirection }>({ key: "total90", dir: "desc" });
  const [recordSort, setRecordSort] = useState<{ key: RecordSortKey; dir: SortDirection }>({ key: "docDate", dir: "desc" });

  const query = params.toString();
  // Any change to the filters or the ordering invalidates the page cursor: staying on
  // page 7 of a different result set would show rows that do not belong to the request.
  const [page, setPage] = useServerPage(`${query}|${sort.key}|${sort.dir}`);
  const [recordPage, setRecordPage] = useServerPage(`${query}|${recordSort.key}|${recordSort.dir}`);

  const summaryUrl = useMemo(
    () => salesUrl("/api/analysis/sales", params, { sortKey: sort.key, sortDir: sort.dir, page, pageSize: PAGE_SIZE }),
    [params, sort.key, sort.dir, page],
  );
  const recordsUrl = useMemo(
    () => salesUrl("/api/analysis/sales/records", params, { sortKey: recordSort.key, sortDir: recordSort.dir, page: recordPage, pageSize: PAGE_SIZE }),
    [params, recordSort.key, recordSort.dir, recordPage],
  );

  const { data, isLoading, error } = useApi<SummaryResponse>(summaryUrl);
  const records = useApi<RecordsResponse>(recordsUrl);

  const readiness = data?.readiness;
  const approved = readiness?.snapshot.approvedWindowLayout ?? false;
  const windowLabel = readiness?.snapshot.windowDays ? `${readiness.snapshot.windowDays}D` : "window";
  const totals = data?.totals ?? { confirmedQuantity: 0, confirmedWeight: 0, recordCount: 0, categories: 0 };
  const showCustomer = permissions.includes("customers.read");

  const columns: Column<CategorySalesRow>[] = [
    { key: "categoryId", header: "Category", sticky: "left", cell: (r) => <span className="font-medium">{r.categoryId}</span> },
    { key: "lab", header: "Lab", cell: (r) => r.lab || "—" },
    { key: "shape", header: "Shape", cell: (r) => r.shape || "—" },
    { key: "weightBand", header: "Weight Band", cell: (r) => r.weightBand || "—" },
    ...(approved
      ? ([
          { key: "previous30Quantity", header: "Prev 30D Qty", align: "right", cell: (r) => <NumberCell value={r.previous30Quantity} /> },
          { key: "middle30Quantity", header: "Mid 30D Qty", align: "right", cell: (r) => <NumberCell value={r.middle30Quantity} /> },
          { key: "latest30Quantity", header: "Latest 30D Qty", align: "right", cell: (r) => <NumberCell value={r.latest30Quantity} intent="info" /> },
        ] as Column<CategorySalesRow>[])
      : []),
    {
      key: "total90Quantity", header: `Confirmed Qty (${windowLabel})`, align: "right",
      cell: (r) => <NumberCell value={r.total90Quantity} intent="success" />,
    },
    {
      key: "total90Weight", header: "Confirmed Weight (ct)", align: "right",
      cell: (r) => <NumberCell value={r.total90Weight} decimals={2} />,
    },
    { key: "recordCount", header: "Sale Records", align: "right", cell: (r) => <NumberCell value={r.recordCount} /> },
    { key: "latestSaleDate", header: "Latest Sale (IST)", cell: (r) => r.latestSaleDate ?? "—" },
    { key: "trend", header: "Trend", align: "center", cell: (r) => <Badge variant="default">{r.trend}</Badge> },
    {
      key: "dataState", header: "Data State", align: "center",
      cell: (r) => <Badge variant={DATA_STATE_VARIANT[r.dataState]}>{SALES_DATA_STATE_LABELS[r.dataState]}</Badge>,
    },
    {
      key: "trace", header: "Trace", align: "center",
      cell: (r) => (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] cursor-pointer"
          onClick={() => {
            selectCategory(r.categoryId);
            setActiveTab("records");
          }}
        >
          Records
        </Button>
      ),
    },
  ];

  const recordColumns: Column<SupportingRecordRow>[] = [
    { key: "recordId", header: "Sale Record", sticky: "left", cell: (r) => <span className="font-mono text-[10px]">{r.recordId.slice(0, 10)}</span> },
    { key: "lotId", header: "Lot", cell: (r) => r.lotId ?? "—" },
    { key: "docDate", header: "Document Date (IST)", cell: (r) => istDate(r.docDate) },
    { key: "lifecycle", header: "Lifecycle", cell: (r) => r.lifecycle },
    { key: "categoryId", header: "Category", cell: (r) => r.categoryId },
    { key: "confirmedQuantity", header: "Confirmed Qty", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "measuredWeight", header: "Measured Weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    { key: "country", header: "Country", cell: (r) => r.country ?? "—" },
    { key: "branch", header: "Branch", cell: (r) => r.branch ?? "—" },
    ...(showCustomer
      ? ([
          { key: "customerCode", header: "Customer Code", cell: (r) => r.customerCode ?? "—" },
          { key: "customerName", header: "Customer", cell: (r) => r.customerName ?? "—" },
        ] as Column<SupportingRecordRow>[])
      : []),
    { key: "sourceState", header: "Source", cell: (r) => r.sourceState },
    {
      key: "dataState", header: "Data State", align: "center",
      cell: (r) => <Badge variant={DATA_STATE_VARIANT[r.dataState]}>{SALES_DATA_STATE_LABELS[r.dataState]}</Badge>,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <SimulationBanner disclosure={data?.sourceDisclosure} />
      <PageHeader
        title="Sales Analysis"
        subtitle="Confirmed historical sales by Lab + Shape + Weight Band — quantity, carat weight and record count kept separate"
        actions={
          canExport && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-[11px] gap-1"
              disabled={!readiness?.snapshot.snapshotId}
              onClick={() => window.open(salesUrl("/api/analysis/sales/export", params, { sortKey: sort.key, sortDir: sort.dir }), "_blank", "noopener")}
            >
              <Download className="h-3 w-3" /> Export summary
            </Button>
          )
        }
        meta={<SalesFilterBar />}
      />

      {error && (
        <InfoBanner variant="critical">Sales history could not be loaded. {error.message}</InfoBanner>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Confirmed Quantity" value={totals.confirmedQuantity} unit="pcs" intent="success" hint={`Σ confirmed sale quantity in the ${windowLabel} snapshot`} icon={Package} />
        <KpiCard label="Confirmed Weight" value={totals.confirmedWeight.toFixed(2)} unit="ct" intent="default" hint="Σ measured carat weight — not a piece count" icon={Gem} />
        <KpiCard label="Sale Records" value={totals.recordCount} intent="info" hint="Contributing records — not a piece quantity" icon={Rows3} />
        <KpiCard label="Categories" value={totals.categories} intent="default" hint="Matching Lab + Shape + Weight Band categories" icon={Layers} />
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border bg-card/60 p-1 rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("summary")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer",
            activeTab === "summary"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Category Sales Summary</span>
          {data?.paging.total !== undefined && (
            <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", activeTab === "summary" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
              {data.paging.total}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("records")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer",
            activeTab === "records"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
          )}
        >
          <Rows3 className="h-3.5 w-3.5" />
          <span>Supporting Records</span>
          {selectedCategory && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono max-w-[140px] truncate">
              {selectedCategory}
            </span>
          )}
          {records.data?.paging.total !== undefined && (
            <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", activeTab === "records" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground")}>
              {records.data.paging.total}
            </span>
          )}
        </button>
      </div>

      {activeTab === "summary" && (
        <Section
          title="Category Sales Summary"
          description="Grouped by Lab + Shape + Weight Band. Filtering, sorting and paging all happen on the server."
          actions={<SortControls keys={CATEGORY_SORT_KEYS} labels={CATEGORY_SORT_LABELS} value={sort} onChange={setSort} label="Sort the category summary" />}
          bodyClassName="p-0"
        >
          <DataTable<CategorySalesRow>
            columns={columns}
            rows={data?.rows ?? []}
            loading={isLoading}
            emptyMessage={
              readiness?.state === "NOT_RUN"
                ? "No authoritative sales snapshot has completed, so there is no confirmed sales history to show."
                : "No confirmed sales match these filters."
            }
            maxHeight={DATA_TABLE_VIEWPORT_MAX_HEIGHT}
            enableColumnValueFilter={false}
          />
          <ServerPagination
            page={data?.paging.page ?? 1}
            pageSize={data?.paging.pageSize ?? PAGE_SIZE}
            total={data?.paging.total ?? 0}
            hasMore={data?.paging.hasMore ?? false}
            onPageChange={setPage}
            loading={isLoading}
            label="categories"
          />
        </Section>
      )}

      {activeTab === "records" && (
        <Section
          title="Supporting Records"
          description={
            selectedCategory
              ? `The exact confirmed sale records behind ${selectedCategory}.`
              : "The exact confirmed sale records behind the figures above. Choose Records on a category in the Summary tab to narrow this list."
          }
          actions={<SortControls keys={RECORD_SORT_KEYS} labels={RECORD_SORT_LABELS} value={recordSort} onChange={setRecordSort} label="Sort the supporting records" />}
          bodyClassName="p-0"
        >
          {records.error && <div className="p-3"><InfoBanner variant="critical">Supporting records could not be loaded. {records.error.message}</InfoBanner></div>}
          <DataTable<SupportingRecordRow>
            columns={recordColumns}
            rows={records.data?.rows ?? []}
            loading={records.isLoading}
            emptyMessage="No confirmed sale records match these filters."
            maxHeight={DATA_TABLE_VIEWPORT_MAX_HEIGHT}
            enableColumnValueFilter={false}
          />
          <ServerPagination
            page={records.data?.paging.page ?? 1}
            pageSize={records.data?.paging.pageSize ?? PAGE_SIZE}
            total={records.data?.paging.total ?? 0}
            hasMore={records.data?.paging.hasMore ?? false}
            onPageChange={setRecordPage}
            loading={records.isLoading}
            label="sale records"
          />
        </Section>
      )}
    </div>
  );
}
