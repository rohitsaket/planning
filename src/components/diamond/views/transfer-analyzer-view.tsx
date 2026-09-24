"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ArrowLeftRight, Boxes, Globe } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * TRANSFER ANALYZER — the honest state of transfer analysis.
 *
 * A recommendation needs a location that is short and a location that holds a surplus of
 * the same category. The authoritative demand result has no country or branch dimension,
 * so neither question can be answered, and no amount of presentation changes that.
 *
 * The page this replaces produced transfer quantities anyway, by taking country demand
 * from a seeded `Requirement` table and availability from a seeded `PolishedStone`
 * mirror. The numbers looked like findings and were not.
 *
 * What remains is factual: where current stock actually sits. It is labelled
 * distribution, because that is what it is.
 */

interface DistributionRow {
  key: string;
  label: string;
  lotCount: number;
  confirmedQuantity: number;
  lotsNeedingReview: number;
}

interface TransferResponse {
  sourceDisclosure: SourceDisclosure | null;
  recommendationsAvailable: boolean;
  unavailableMessage: string;
  unavailableDetail: string;
  prerequisites: string[];
  candidates: unknown[];
  distribution: {
    currentLots: number;
    byLocation: DistributionRow[];
    byBucket: DistributionRow[];
    locations: { total: number; shown: number; limit: number; truncated: boolean };
  };
}

export function TransferAnalyzerView() {
  const globalFilter = useGlobalFilter();

  const url = useMemo(() => {
    const p = new URLSearchParams();
    // Country, branch and lab are real dimensions of a stock record, so all three
    // genuinely narrow the distribution shown below.
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    const q = p.toString();
    return q ? `/api/analysis/transfer-candidates?${q}` : "/api/analysis/transfer-candidates";
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);

  const { data, isLoading } = useApi<TransferResponse>(url);

  // Summed over the bucket distribution rather than the location list: every current
  // record is in exactly one bucket and the bucket vocabulary is closed, so that list is
  // always complete, while the location list is capped and may not be.
  const totalConfirmed = (data?.distribution.byBucket ?? []).reduce((s, r) => s + r.confirmedQuantity, 0);
  const locations = data?.distribution.locations;

  const locationColumns: Column<DistributionRow>[] = [
    { key: "label", header: "Country / Branch", width: "16rem", sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "lotCount", header: "Lot count", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];

  const bucketColumns: Column<DistributionRow>[] = [
    { key: "label", header: "Inventory bucket", width: "16rem", sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "lotCount", header: "Lot count", align: "right", cell: (r) => <NumberCell value={r.lotCount} /> },
    { key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} /> },
    { key: "lotsNeedingReview", header: "Needing review", align: "right", cell: (r) => <NumberCell value={r.lotsNeedingReview} zeroAsDash intent="warning" /> },
  ];

  return (
    <div className="space-y-4 p-3">
      <PageHeader
        title="Transfer Analyzer"
        subtitle="Whether an inter-location transfer recommendation can currently be made"
      />
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />



      <Section
        title="Transfer recommendations"
        description="No candidate is generated, because the information a recommendation needs does not exist yet."
      >
        <EmptyState
          title="UNAVAILABLE"
          message={data?.unavailableDetail ?? "Demand is not currently calculated by country or branch."}
          icon={<ArrowLeftRight className="h-5 w-5" />}
        />
        {data?.prerequisites && data.prerequisites.length > 0 && (
          <div className="border-t border-border px-4 py-3">
            <p className="mb-1.5 text-[11px] font-semibold text-foreground">Needed before recommendations become possible</p>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {data.prerequisites.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-muted-foreground/60">—</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <KpiCard label="Current lots" value={data?.distribution.currentLots ?? 0} intent="info" icon={Boxes} hint="Records currently in stock" />
        <KpiCard label="Confirmed quantity" value={totalConfirmed} unit="pcs" intent="success" hint="Pieces the source established" />
        <KpiCard label="Locations" value={locations?.total ?? 0} intent="default" icon={Globe} hint="Country and branch combinations holding stock" />
      </div>

      <Section
        title="Current inventory distribution by location"
        description="Where current stock sits today. This is a factual distribution, not a transfer recommendation."
      >
        {locations?.truncated && (
          <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
            Showing {locations.shown} of {locations.total} locations. The list is limited to{" "}
            {locations.limit}; narrow the filters to see the rest.
          </div>
        )}
        <DataTable
          columns={locationColumns}
          rows={data?.distribution.byLocation ?? []}
          loading={isLoading}
          emptyMessage="No current stock matches the active filters."
          pagination={false}
        />
      </Section>

      <Section
        title="Current inventory distribution by bucket"
        description="Memo, reserved and WIP are shown as their own buckets; none of them is available finished stock."
      >
        <DataTable
          columns={bucketColumns}
          rows={data?.distribution.byBucket ?? []}
          loading={isLoading}
          emptyMessage="No current stock matches the active filters."
          pagination={false}
        />
      </Section>
    </div>
  );
}
