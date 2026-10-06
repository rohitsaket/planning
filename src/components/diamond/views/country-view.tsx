"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Boxes, Globe, Info, Package, Users } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";
import { cn } from "@/lib/utils";

interface SalesRow {
  key: string;
  country: string;
  branch: string | null;
  confirmedQuantity: number;
  measuredWeight: number;
  saleRecordCount: number;
  distinctCustomers: number | null;
  latestSaleDateIst: string | null;
}

interface InventoryRow {
  key: string;
  label: string;
  lotCount: number;
  confirmedQuantity: number;
  lotsNeedingReview: number;
}

interface CountryResponse {
  sourceDisclosure: SourceDisclosure | null;
  geographicDemandAvailable: boolean;
  geographicDemandMessage: string;
  geographicDemandDetail: string;
  customerIdentityVisible: boolean;
  sales: {
    available: boolean;
    unavailableMessage: string | null;
    snapshot: {
      runId: string;
      windowDays: number;
      businessDateIst: string;
      periodLabel: string;
      isSimulated: boolean;
    } | null;
    byCountry: SalesRow[];
    byBranch: SalesRow[];
    totals: { confirmedQuantity: number; measuredWeight: number; saleRecordCount: number; countries: number };
    rows: { countriesShown: number; branchesShown: number; limit: number; truncated: boolean };
  };
  inventory: {
    currentLots: number;
    byLocation: InventoryRow[];
    locations: { total: number; shown: number; limit: number; truncated: boolean };
  };
}

export function CountryView() {
  const globalFilter = useGlobalFilter();

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    const q = p.toString();
    return q ? `/api/analysis/countries?${q}` : "/api/analysis/countries";
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);

  const { data, isLoading } = useApi<CountryResponse>(url);

  const sales = data?.sales;
  const identityVisible = data?.customerIdentityVisible ?? false;

  const salesColumns: Column<SalesRow>[] = [
    {
      key: "country", header: "Country", sortable: true, sortValue: (r) => r.country,
      cell: (r) => <span className="font-medium">{r.country}</span>, sticky: "left", width: "140px",
    },
    {
      key: "confirmedQuantity", header: "Sold quantity (pcs)", sortable: true,
      sortValue: (r) => r.confirmedQuantity, align: "right",
      cell: (r) => <NumberCell value={r.confirmedQuantity} />,
    },
    {
      key: "measuredWeight", header: "Sold weight (ct)", sortable: true,
      sortValue: (r) => r.measuredWeight, align: "right",
      cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} />,
    },
    {
      key: "saleRecordCount", header: "Sale records", sortable: true,
      sortValue: (r) => r.saleRecordCount, align: "right",
      cell: (r) => <NumberCell value={r.saleRecordCount} />,
    },
    {
      key: "distinctCustomers", header: "Customers", sortable: true,
      sortValue: (r) => r.distinctCustomers ?? -1, align: "right",
      exportValue: (r) => (r.distinctCustomers === null ? "WITHHELD" : r.distinctCustomers),
      cell: (r) => r.distinctCustomers === null
        ? <span className="text-[10px] font-mono text-muted-foreground">WITHHELD</span>
        : <NumberCell value={r.distinctCustomers} />,
    },
    {
      key: "latestSaleDateIst", header: "Latest sale (IST)", width: "12rem",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.latestSaleDateIst ?? "—"}</span>,
    },
  ];

  const branchColumns: Column<SalesRow>[] = [
    {
      key: "branch", header: "Country / Branch", sticky: "left", width: "16rem",
      sortable: true, sortValue: (r) => `${r.country}/${r.branch ?? ""}`,
      cell: (r) => <span className="font-medium">{r.country} / {r.branch ?? "—"}</span>,
    },
    ...salesColumns.slice(1),
  ];

  const inventoryColumns: Column<InventoryRow>[] = [
    { key: "label", header: "Country / Branch", width: "16rem", sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "lotCount", header: "Current lots", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];

  const [activeTab, setActiveTab] = useState<"country" | "branch" | "inventory">("country");

  const renderTabs = (active: "country" | "branch" | "inventory") => (
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
        <span>Sales by Country</span>
        {sales?.byCountry !== undefined && (
          <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "country" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
            {sales.byCountry.length}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("branch")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "branch"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>Sales by Branch</span>
        {sales?.byBranch !== undefined && (
          <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "branch" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
            {sales.byBranch.length}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("inventory")}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer",
          active === "inventory"
            ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
        )}
      >
        <span>Inventory by Location</span>
        {data?.inventory.byLocation !== undefined && (
          <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", active === "inventory" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
            {data.inventory.byLocation.length}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <div className="flex-shrink-0 flex flex-col gap-section">
        <PageHeader
          title="Country / Branch Analysis"
          subtitle="Confirmed sales and current inventory, by location"
          meta={
            sales?.snapshot ? (
              <span className="text-[10px] text-muted-foreground">
                Sales snapshot: {sales.snapshot.periodLabel}
                {sales.snapshot.isSimulated ? " · fixture simulation" : ""}
              </span>
            ) : undefined
          }
        />
        <SimulationBanner disclosure={data?.sourceDisclosure} />

        <InfoBanner variant="warning">
          <div className="space-y-1">
            <span className="flex items-center gap-2 font-semibold">
              <Info className="h-4 w-4" />
              {data?.geographicDemandMessage ??
                "Demand is not currently calculated by country or branch."}
            </span>
          </div>
        </InfoBanner>

        {sales && !sales.available && sales.unavailableMessage && (
          <InfoBanner variant="warning">{sales.unavailableMessage}</InfoBanner>
        )}

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <KpiCard label="Countries with sales" value={sales?.totals.countries ?? 0} intent="info" icon={Globe} hint="In the confirmed sales snapshot" />
          <KpiCard label="Sold quantity" value={sales?.totals.confirmedQuantity ?? 0} unit="pcs" intent="success" icon={Package} hint="Confirmed sales in the snapshot window" />
          <KpiCard label="Sale records" value={sales?.totals.saleRecordCount ?? 0} intent="default" icon={Users} hint="Individual confirmed sale records" />
          <KpiCard label="Current lots" value={data?.inventory.currentLots ?? 0} intent="info" icon={Boxes} hint="Records currently in stock" />
        </div>
      </div>

      <div className="flex flex-col gap-section">
        {activeTab === "country" && (
          <Section
            title={renderTabs("country")}
            description="Confirmed sales in the snapshot window, by country"
          >
            {sales?.rows.truncated && (
              <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground flex-shrink-0">
                The list is limited to {sales.rows.limit} rows; narrow the filters to see the rest.
              </div>
            )}
            <DataTable<SalesRow>
              columns={salesColumns}
              rows={sales?.byCountry ?? []}
              loading={isLoading}
              emptyMessage="No confirmed sales in the snapshot window match the active filters."
              initialSortKey="confirmedQuantity"
              initialSortDir="desc"
              exportable
              exportPermission="analysis.export"
              exportFilename="sales-by-country.csv"
              searchable
              searchPlaceholder="Search country..."
              searchFn={(r, q) => r.country.toLowerCase().includes(q.toLowerCase())}
              pagination
              pageSize={25}
            />
          </Section>
        )}

        {activeTab === "branch" && (
          <Section
            title={renderTabs("branch")}
            description={
              identityVisible
                ? "The same sales, broken down by branch."
                : "The same sales, broken down by branch. Customer counts are withheld without customer access."
            }
          >
            <DataTable<SalesRow>
              columns={branchColumns}
              rows={sales?.byBranch ?? []}
              loading={isLoading}
              emptyMessage="No confirmed sales in the snapshot window match the active filters."
              initialSortKey="confirmedQuantity"
              initialSortDir="desc"
              exportable
              exportPermission="analysis.export"
              exportFilename="sales-by-branch.csv"
              pagination
              pageSize={25}
            />
          </Section>
        )}

        {activeTab === "inventory" && (
          <Section
            title={renderTabs("inventory")}
            description="Where current stock sits today"
          >
            {data?.inventory.locations.truncated && (
              <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground flex-shrink-0">
                Showing {data.inventory.locations.shown} of {data.inventory.locations.total} locations. The list is
                limited to {data.inventory.locations.limit}; narrow the filters to see the rest.
              </div>
            )}
            <DataTable<InventoryRow>
              columns={inventoryColumns}
              rows={data?.inventory.byLocation ?? []}
              loading={isLoading}
              emptyMessage="No current stock matches the active filters."
              exportable
              exportPermission="analysis.export"
              exportFilename="inventory-by-location.csv"
              pagination
              pageSize={25}
            />
          </Section>
        )}
      </div>
    </div>
  );
}
