"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useAuthStore } from "@/stores/auth-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { Section } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Info, Search, X } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * CUSTOMERS — who bought, during the authoritative 90-day window.
 *
 * Every figure is read from the API exactly as returned; this file performs no business
 * arithmetic. Confirmed quantity, measured weight and sale-record count are three
 * separate columns because they are three different facts — a record count is not a
 * piece count.
 */

interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

interface CustomerRow {
  customerKey: string;
  customerCode: string | null;
  customerName: string | null;
  identitySource: "CANONICAL_CUSTOMER_ID" | "CUSTOMER_CODE" | "MISSING";
  country: string | null;
  branch: string | null;
  confirmedQuantity: number;
  measuredWeight: number;
  saleRecordCount: number;
  distinctCategories: number;
  latestSaleDate: string | null;
  previous30Quantity: number;
  middle30Quantity: number;
  latest30Quantity: number;
  trend: string;
  dataState: "CONFIRMED" | "IDENTITY_MISSING" | "INSUFFICIENT_HISTORY";
}

interface CustomersResponse {
  sourceDisclosure: SourceDisclosure | null;
  available: boolean;
  unavailableReason: string | null;
  rows: CustomerRow[];
  paging: PagingMeta;
  totals: { confirmedQuantity: number; measuredWeight: number; saleRecordCount: number; customers: number };
  windows: Array<{ key: string; label: string; startDate: string; endDate: string }>;
  businessDateIst: string;
  activeFilters: Array<{ key: string; value: string }>;
}

interface DetailResponse {
  available: boolean;
  customerKey: string;
  customerCode: string | null;
  customerName: string | null;
  identitySource: string;
  categories: Array<{ categoryId: string; lab: string; shape: string; weightBand: string; confirmedQuantity: number; measuredWeight: number; saleRecordCount: number }>;
  periods: Array<{ key: string; label: string; startDate: string; endDate: string; confirmedQuantity: number }>;
  records: Array<{ recordId: string; lotId: string; categoryId: string; docDateIst: string | null; confirmedQuantity: number; measuredWeight: number; country: string | null; branch: string | null }>;
  recordPaging: PagingMeta;
  businessDateIst: string;
  sourceDisclosure: SourceDisclosure | null;
  isSimulated: boolean;
  exclusionCodes: Array<{ code: string; count: number }>;
}

/**
 * Where these figures come from, in one line.
 *
 * This replaced a twelve-row CHECK / VALUE / STATE table that read as a backend
 * verification report: it repeated the source three ways, restated the same identity
 * count as three rows, and carried order-source rows that have nothing to do with
 * customer sales. What a reader actually needs is the provenance, the period and the
 * cutoff — plus a warning when, and only when, something is wrong.
 */
const PAGE_SIZE = 25;
const DATA_STATE_LABEL: Record<string, string> = { CONFIRMED: "Confirmed", IDENTITY_MISSING: "Customer ID missing", INSUFFICIENT_HISTORY: "Limited history" };

import { cn } from "@/lib/utils";

export function CustomerSalesView() {
  const setView = useNavStore((s) => s.setView);
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState(PAGE_SIZE);
  const [activeDetailTab, setActiveDetailTab] = useState<"categories" | "records">("categories");

  const scope = useMemo(() => {
    const p = new URLSearchParams();
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    if (appliedSearch) p.set("customerSearch", appliedSearch);
    return p.toString();
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab, appliedSearch]);

  const qs = (extra: Record<string, string | number>) => {
    const p = new URLSearchParams(scope);
    for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
    return `/api/analysis/customers-orders?${p.toString()}`;
  };

  const customers = useApi<CustomersResponse>(qs({ section: "customers", page, pageSize }));
  const detail = useApi<DetailResponse>(
    selected ? qs({ section: "customer-detail", customerKey: selected, page: detailPage, pageSize: detailPageSize }) : "",
  );

  const applySearch = () => { setAppliedSearch(search.trim()); setPage(1); };

  const customerColumns: Column<CustomerRow>[] = [
    {
      key: "customerCode", header: "Customer", width: "16rem",
      cell: (r) =>
        r.identitySource === "MISSING" ? (
          // Never merged by name: unidentified records are one explicit bucket.
          <span className="italic text-muted-foreground">Unidentified customer</span>
        ) : (
          <button
            type="button"
            className="text-left font-medium text-primary hover:underline cursor-pointer"
            onClick={() => { setSelected(r.customerKey); setDetailPage(1); }}
          >
            {r.customerCode}
            {r.customerName && <span className="block text-xs font-normal text-muted-foreground">{r.customerName}</span>}
          </button>
        ),
    },
    { key: "country", header: "Country", width: "8rem", cell: (r) => <span className="text-muted-foreground">{r.country ?? "—"}</span> },
    { key: "branch", header: "Branch", width: "9rem", cell: (r) => <span className="text-muted-foreground">{r.branch ?? "—"}</span> },
    { key: "confirmedQuantity", header: "Confirmed qty (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} intent="success" /> },
    { key: "measuredWeight", header: "Measured weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    // Deliberately adjacent to, and distinct from, the quantity column above.
    { key: "saleRecordCount", header: "Sale records", align: "right", cell: (r) => <NumberCell value={r.saleRecordCount} /> },
    { key: "distinctCategories", header: "Categories", align: "right", cell: (r) => <NumberCell value={r.distinctCategories} /> },
    { key: "previous30Quantity", header: "Prev 30D", align: "right", cell: (r) => <NumberCell value={r.previous30Quantity} zeroAsDash /> },
    { key: "middle30Quantity", header: "Mid 30D", align: "right", cell: (r) => <NumberCell value={r.middle30Quantity} zeroAsDash /> },
    { key: "latest30Quantity", header: "Latest 30D", align: "right", cell: (r) => <NumberCell value={r.latest30Quantity} zeroAsDash /> },
    { key: "latestSaleDate", header: "Latest sale", width: "9rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.latestSaleDate ?? "—"}</span> },
    { key: "trend", header: "Trend", width: "8rem", cell: (r) => <Badge variant="default">{r.trend}</Badge> },
    {
      key: "dataState", header: "Data state", width: "11rem",
      cell: (r) => (
        <Badge variant={r.dataState === "CONFIRMED" ? "success" : r.dataState === "IDENTITY_MISSING" ? "warning" : "default"}>
          {DATA_STATE_LABEL[r.dataState] ?? r.dataState.replace(/_/g, " ").toLowerCase()}
        </Badge>
      ),
    },
  ];

  const categoryColumns: Column<DetailResponse["categories"][number]>[] = [
    {
      key: "categoryId", header: "Category", width: "18rem",
      cell: (r) => (
        <button
          type="button"
          className="text-left text-primary hover:underline cursor-pointer"
          // The canonical key is carried verbatim, so Heart opens Heart.
          onClick={() => setView("analysis-sales", "analysis")}
          title={r.categoryId}
        >
          {[r.lab, r.shape, r.weightBand].filter(Boolean).join(" | ")}
        </button>
      ),
    },
    { key: "confirmedQuantity", header: "Confirmed qty (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "measuredWeight", header: "Measured weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    { key: "saleRecordCount", header: "Sale records", align: "right", cell: (r) => <NumberCell value={r.saleRecordCount} /> },
  ];

  const recordColumns: Column<DetailResponse["records"][number]>[] = [
    { key: "docDateIst", header: "Sale date (IST)", width: "10rem", cell: (r) => <span className="text-xs">{r.docDateIst ?? "—"}</span> },
    { key: "categoryId", header: "Category", cell: (r) => <span className="text-xs text-muted-foreground">{r.categoryId}</span> },
    { key: "confirmedQuantity", header: "Qty (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "measuredWeight", header: "Weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    { key: "country", header: "Country", width: "8rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.country ?? "—"}</span> },
    { key: "branch", header: "Branch", width: "9rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.branch ?? "—"}</span> },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={customers.data?.sourceDisclosure} />

      {!selected ? (
        <Section
          title="Customers"
          description={
            customers.data?.available
              ? `Confirmed sales for the 90 days ending ${customers.data.businessDateIst} (IST)`
              : "Customer activity comes from a completed 90-day sales snapshot."
          }
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
                  placeholder="Customer code or name…"
                  className="h-8 w-60 pl-7 text-xs"
                />
              </div>
              <Button size="sm" variant="outline" className="h-8 cursor-pointer" onClick={applySearch}>Apply</Button>
            </div>
          }
        >
          {customers.data && !customers.data.available ? (
            <EmptyState
              title="NOT RUN"
              message="No sales snapshot yet. Customer activity is unavailable."
              icon={<Info className="h-5 w-5" />}
            />
          ) : (
            <div className="flex flex-col gap-section">
              <DataTable
                columns={customerColumns}
                rows={customers.data?.rows ?? []}
                loading={customers.isLoading}
                emptyMessage="No customer generated a confirmed sale under the active filters."
                pagination={false}
                exportScope="current-page"
              />
              <div className="flex-shrink-0">
                <ServerPagination
                  page={customers.data?.paging.page ?? 1}
                  pageSize={customers.data?.paging.pageSize ?? PAGE_SIZE}
                  total={customers.data?.paging.total ?? 0}
                  hasMore={customers.data?.paging.hasMore ?? false}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
                  loading={customers.isLoading}
                  label="customers"
                />
                {customers.data && (
                  <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                    Totals across every matching customer — confirmed {customers.data.totals.confirmedQuantity} pcs ·{" "}
                    {customers.data.totals.measuredWeight} ct · {customers.data.totals.saleRecordCount} sale records ·{" "}
                    {customers.data.totals.customers} customers
                  </div>
                )}
              </div>
            </div>
          )}
        </Section>
      ) : (
        <Section
          title="Customer detail"
          description={
            detail.data
              ? `${detail.data.customerCode ?? "Unidentified"}${detail.data.customerName ? ` — ${detail.data.customerName}` : ""} · snapshot business date ${detail.data.businessDateIst} (IST)`
              : "Loading…"
          }
          actions={
            <Button size="sm" variant="outline" className="h-7 gap-1 cursor-pointer" onClick={() => setSelected(null)}>
              <X className="h-3.5 w-3.5" /> Back to Customers
            </Button>
          }
        >
          <div className="flex flex-col gap-2">
            {detail.data?.periods && (
              <div className="flex flex-wrap gap-2 px-3 pb-1 text-[11px] flex-shrink-0">
                {detail.data.periods.map((p) => (
                  <Badge key={p.key} variant="info">
                    {p.label} ({p.startDate} … {p.endDate}): {p.confirmedQuantity} pcs
                  </Badge>
                ))}
              </div>
            )}

            {/* Segmented Sub-Tab Switcher inside Customer Detail */}
            <div className="flex items-center gap-1.5 p-1 rounded-full border border-border/80 bg-muted/40 backdrop-blur-md shadow-2xs w-fit flex-shrink-0">
              <button
                type="button"
                onClick={() => setActiveDetailTab("categories")}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                  activeDetailTab === "categories"
                    ? "bg-[#EA580C] text-white shadow-xs dark:bg-[#EA580C] dark:text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Category Contribution ({detail.data?.categories.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveDetailTab("records")}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs font-semibold transition-all cursor-pointer",
                  activeDetailTab === "records"
                    ? "bg-[#EA580C] text-white shadow-xs dark:bg-[#EA580C] dark:text-white"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Confirmed Sale Records ({detail.data?.recordPaging.total ?? 0})
              </button>
            </div>

            <div className="flex flex-col gap-section">
              {activeDetailTab === "categories" && (
                <DataTable
                  columns={categoryColumns}
                  rows={detail.data?.categories ?? []}
                  loading={detail.isLoading}
                  emptyMessage="No category contribution for this customer."
                  pagination={false}
                />
              )}

              {activeDetailTab === "records" && (
                <div className="flex flex-col gap-section">
                  <DataTable
                    columns={recordColumns}
                    rows={detail.data?.records ?? []}
                    loading={detail.isLoading}
                    emptyMessage="No confirmed sale records for this customer."
                    pagination={false}
                  />
                  <div className="flex-shrink-0">
                    <ServerPagination
                      page={detail.data?.recordPaging.page ?? 1}
                      pageSize={detail.data?.recordPaging.pageSize ?? PAGE_SIZE}
                      total={detail.data?.recordPaging.total ?? 0}
                      hasMore={detail.data?.recordPaging.hasMore ?? false}
                      onPageChange={setDetailPage}
                      onPageSizeChange={(s) => { setDetailPageSize(s); setDetailPage(1); }}
                      loading={detail.isLoading}
                      label="sale records"
                    />
                  </div>
                </div>
              )}
            </div>

            {detail.data && detail.data.exclusionCodes.length > 0 && (
              <div className="flex-shrink-0">
                <InfoBanner variant="info">
                  Excluded records for this customer:{" "}
                  {detail.data.exclusionCodes.reduce((sum, e) => sum + e.count, 0).toLocaleString()}.
                </InfoBanner>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}
