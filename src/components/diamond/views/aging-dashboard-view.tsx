"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Boxes, Globe } from "lucide-react";
import { isInventoryBucket } from "@/lib/analysis/bucket-vocabulary";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * AGING DASHBOARD — the management view of current stock.
 *
 * It reads the same service as Stock Aging and holds no aging arithmetic of its own.
 * The page it replaces carried a second copy of `NOW() - lastUpdated` and a second copy
 * of six hardcoded age bands, so the two pages were independent calculations that could
 * disagree — over a legacy mirror, using a timestamp that does not mean age.
 *
 * Because the aging date is unconfirmed, this groups by what is actually known — bucket
 * and location — rather than by age bands that do not exist. It does not report
 * "healthy" or zero aged inventory, because it has no basis for either.
 */

interface DistributionRow {
  key: string;
  label: string;
  lotCount: number;
  confirmedQuantity: number;
  lotsNeedingReview: number;
}

interface SummaryResponse {
  sourceDisclosure: SourceDisclosure | null;
  availability: "AVAILABLE" | "ANCHOR_NOT_CONFIRMED";
  unavailableMessage: string | null;
  unavailableDetail: string | null;
  bucketsMessage: string | null;
  currentLots: number;
  byBucket: DistributionRow[];
  byLocation: DistributionRow[];
  locations: { total: number; shown: number; limit: number; truncated: boolean };
}

export function AgingDashboardView() {
  const openCategoryView = useNavStore((s) => s.openCategoryView);
  const globalFilter = useGlobalFilter();

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    const q = p.toString();
    return q ? `/api/analysis/aging-dashboard?${q}` : "/api/analysis/aging-dashboard";
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);

  const { data, isLoading } = useApi<SummaryResponse>(url);
  const ageUnavailable = data?.availability === "ANCHOR_NOT_CONFIRMED";

  // Summed over the bucket distribution, which the service aggregates across the whole
  // filtered result — every current record is in exactly one bucket, so these are totals
  // for all of it and not for a page of it.
  const totalConfirmed = (data?.byBucket ?? []).reduce((s, r) => s + r.confirmedQuantity, 0);
  const totalReview = (data?.byBucket ?? []).reduce((s, r) => s + r.lotsNeedingReview, 0);
  const locations = data?.locations;

  const bucketColumns: Column<DistributionRow>[] = [
    {
      key: "label", header: "Inventory bucket", width: "16rem", sticky: "left",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          // The derived bucket key is carried in the typed bucket field, which is the
          // vocabulary Stock Aging and its API accept. It used to travel in the generic
          // `category` field as a raw `inventoryClass` value, which the page could not
          // read and the API rejected, so every drill-down opened an unfiltered list.
          onClick={() => openCategoryView("analysis-aging", { bucket: isInventoryBucket(r.key) ? r.key : null })}
          title={r.label}
        >
          {r.label}
        </button>
      ),
    },
    { key: "lotCount", header: "Lot count", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];

  const locationColumns: Column<DistributionRow>[] = [
    { key: "label", header: "Country / Branch", width: "16rem", sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "lotCount", header: "Lot count", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];

  return (
    <div className="space-y-4 p-3">
      <PageHeader
        title="Aging Dashboard"
        subtitle="Current canonical stock grouped by inventory bucket and location"
        actions={
          <Button size="sm" variant="outline" className="h-8" onClick={() => openCategoryView("analysis-aging", {})}>
            Open Stock Aging
          </Button>
        }
      />
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />



      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <KpiCard label="Current lots" value={data?.currentLots ?? 0} intent="info" icon={Boxes} hint="Records currently in stock" />
        <KpiCard label="Confirmed quantity" value={totalConfirmed} unit="pcs" intent="success" hint="Pieces the source established" />
        <KpiCard label="Needing review" value={totalReview} intent="warning" hint="Quantity or classification not confirmed" />
      </div>

      <Section
        title="Stock by inventory bucket"
        description="Select a bucket to open Stock Aging with that bucket applied."
      >
        <DataTable
          columns={bucketColumns}
          rows={data?.byBucket ?? []}
          loading={isLoading}
          emptyMessage="No current stock matches the active filters."
          pagination={false}
        />
      </Section>

      <Section
        title="Stock by location"
        description="Factual distribution of current stock. It is not a transfer recommendation."
        actions={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
      >
        {locations?.truncated && (
          <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
            Showing {locations.shown} of {locations.total} locations. The list is limited to{" "}
            {locations.limit}; narrow the filters to see the rest.
          </div>
        )}
        <DataTable
          columns={locationColumns}
          rows={data?.byLocation ?? []}
          loading={isLoading}
          emptyMessage="No current stock matches the active filters."
          pagination={false}
        />
      </Section>
    </div>
  );
}
