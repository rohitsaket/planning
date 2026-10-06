"use client";

import { useMemo } from "react";
import { Globe } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { NumberCell } from "@/components/diamond/shared/empty-state";
import { isInventoryBucket } from "@/lib/analysis/bucket-vocabulary";

interface DistributionRow {
  key: string;
  label: string;
  lotCount: number;
  confirmedQuantity: number;
  lotsNeedingReview: number;
}

interface SummaryResponse {
  byBucket: DistributionRow[];
  byLocation: DistributionRow[];
  locations: { total: number; shown: number; limit: number; truncated: boolean };
}

export function AgingSummary() {
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
  const locations = data?.locations;

  const quantityColumns: Column<DistributionRow>[] = [
    { key: "lotCount", header: "Lot count", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];
  const bucketColumns: Column<DistributionRow>[] = [
    {
      key: "label", header: "Inventory bucket", width: "16rem", sticky: "left",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          onClick={() => openCategoryView("analysis-aging", { bucket: isInventoryBucket(r.key) ? r.key : null })}
          title={r.label}
        >
          {r.label}
        </button>
      ),
    },
    ...quantityColumns,
  ];
  const locationColumns: Column<DistributionRow>[] = [
    { key: "label", header: "Country / Branch", width: "16rem", sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    ...quantityColumns,
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Section title="Stock by inventory bucket" description="Select a bucket to list its stock below.">
        <DataTable columns={bucketColumns} rows={data?.byBucket ?? []} loading={isLoading} emptyMessage="No current stock matches the active filters." pagination={false} />
      </Section>
      <Section title="Stock by location" description="Where current stock sits today" actions={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}>
        {locations?.truncated && (
          <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
            Showing {locations.shown} of {locations.total} locations. The list is limited to {locations.limit}; narrow the filters to see the rest.
          </div>
        )}
        <DataTable columns={locationColumns} rows={data?.byLocation ?? []} loading={isLoading} emptyMessage="No current stock matches the active filters." pagination={false} />
      </Section>
    </div>
  );
}
