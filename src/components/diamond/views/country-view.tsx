"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Boxes, Globe, Info, Package, Users } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * COUNTRY & BRANCH — what is known per location.
 *
 * The page this replaces reported a shortage, an excess and a transfer-candidate count
 * per country. None of those could be derived: the authoritative demand target is
 * calculated once per planning category for the whole business and carries no location.
 * They came from seeded demonstration tables instead, and directly contradicted the
 * Transfer Analyzer, which says on screen that a location-level shortage cannot be
 * computed from this data.
 *
 * What is shown now is two factual distributions, deliberately in two separate tables:
 * confirmed sales over the same 90-day snapshot as Customers & Orders, and current
 * inventory from the same shared summary as Stock Aging. One is history and the other is
 * a present position; they are never subtracted from one another.
 *
 * Every figure comes from the API as returned. This file performs no arithmetic.
 */

interface SalesRow {
  key: string;
  country: string;
  branch: string | null;
  confirmedQuantity: number;
  measuredWeight: number;
  saleRecordCount: number;
  /** Null without customers.read — never rendered as zero. */
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
    // Country, branch and lab are real dimensions of a sale record and a stock record, so
    // all three genuinely narrow what is shown here.
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
      // Null is not zero: without customers.read the figure is withheld, not absent.
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

  return (
    <div className="flex flex-col gap-3 p-3">
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
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />

      {/*
        Stated on every render, not only when a snapshot is missing. The demand target is
        calculated once per planning category for the whole business and carries no
        location, so a country-level shortage cannot be derived from it. Without this the
        two tables below read as a shortage analysis that simply has no shortage column.
      */}
      <InfoBanner variant="warning">
        <div className="space-y-1">
          <span className="flex items-center gap-2 font-semibold">
            <Info className="h-4 w-4" />
            {data?.geographicDemandMessage ??
              "Demand is not currently calculated by country or branch, so geographic shortage, excess and transfer recommendations are unavailable."}
          </span>
          <div className="text-xs">{data?.geographicDemandDetail}</div>
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

      <Section
        title="Confirmed sales by country"
        description="What actually sold in the snapshot window, attributed to the location on the canonical lot record. This is history, not a target."
      >
        {sales?.rows.truncated && (
          <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
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
          maxHeight="420px"
        />
      </Section>

      <Section
        title="Confirmed sales by branch"
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
          maxHeight="420px"
        />
      </Section>

      <Section
        title="Current inventory by location"
        description="Where stock sits today, from the same bucket definition as Stock Aging. A present position, not a comparison against the sales above."
      >
        {data?.inventory.locations.truncated && (
          <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
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
          maxHeight="420px"
        />
      </Section>
    </div>
  );
}
