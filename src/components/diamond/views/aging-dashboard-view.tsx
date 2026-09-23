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
  availability: "AVAILABLE" | "ANCHOR_NOT_CONFIRMED";
  unavailableMessage: string | null;
  unavailableDetail: string | null;
  bucketsMessage: string | null;
  currentLots: number;
  byBucket: DistributionRow[];
  byLocation: DistributionRow[];
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

  const totalConfirmed = (data?.byBucket ?? []).reduce((s, r) => s + r.confirmedQuantity, 0);
  const totalReview = (data?.byBucket ?? []).reduce((s, r) => s + r.lotsNeedingReview, 0);

  const bucketColumns: Column<DistributionRow>[] = [
    {
      key: "label", header: "Inventory bucket", width: "16rem", sticky: "left",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          // The exact bucket key is carried verbatim into Stock Aging, so the drill-down
          // opens the rows this line summarizes rather than an unfiltered list.
          onClick={() => openCategoryView("analysis-aging", { category: r.key })}
          title={r.key}
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
          <Button size="sm" variant="outline" className="h-8" onClick={() => openCategoryView("analysis-aging", { category: "" })}>
            Open Stock Aging
          </Button>
        }
      />

      {ageUnavailable && (
        <InfoBanner variant="warning">
          <div className="space-y-1">
            <span className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {data?.unavailableMessage}
            </span>
            <div className="text-xs">{data?.unavailableDetail}</div>
            <div className="text-xs text-muted-foreground">{data?.bucketsMessage}</div>
          </div>
        </InfoBanner>
      )}

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
