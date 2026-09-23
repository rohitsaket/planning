"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ArrowLeftRight, Boxes, Globe } from "lucide-react";

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
  recommendationsAvailable: boolean;
  unavailableMessage: string;
  unavailableDetail: string;
  prerequisites: string[];
  candidates: unknown[];
  distribution: {
    currentLots: number;
    byLocation: DistributionRow[];
    byBucket: DistributionRow[];
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

  const totalConfirmed = (data?.distribution.byLocation ?? []).reduce((s, r) => s + r.confirmedQuantity, 0);

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

      <InfoBanner variant="warning">
        <div className="space-y-1">
          <span className="flex items-center gap-2 font-semibold">
            <ArrowLeftRight className="h-4 w-4" />
            {data?.unavailableMessage ?? "Transfer recommendations are unavailable."}
          </span>
          <div className="text-xs">{data?.unavailableDetail}</div>
        </div>
      </InfoBanner>

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
        <KpiCard label="Locations" value={data?.distribution.byLocation.length ?? 0} intent="default" icon={Globe} hint="Country and branch combinations holding stock" />
      </div>

      <Section
        title="Current inventory distribution by location"
        description="Where current stock sits today. This is a factual distribution, not a transfer recommendation."
      >
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
