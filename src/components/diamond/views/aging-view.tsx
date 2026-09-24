"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Boxes, Search } from "lucide-react";
import { BUCKET_LABELS } from "@/lib/analysis/bucket-vocabulary";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";

/**
 * STOCK AGING — current stock, and an honest statement that age cannot yet be derived.
 *
 * The page this replaces read a legacy seeded mirror and reported
 * `NOW() - lastUpdated` as inventory age, sorted into six hardcoded bands. That number
 * looked authoritative and was not: the timestamp records when a row was last written,
 * so a full synchronization would have reported the entire warehouse as new.
 *
 * Every figure here comes from the API as returned; this file performs no arithmetic and
 * shows no age.
 */

interface AgingLotRow {
  lotId: string;
  stoneName: string | null;
  bucketLabel: string;
  categoryLabel: string;
  lab: string | null;
  shape: string | null;
  confirmedQuantity: number | null;
  measuredWeight: number | null;
  country: string;
  branch: string;
  department: string | null;
  location: string | null;
  lastSourceUpdateIst: string | null;
  dataState: "CONFIRMED" | "REVIEW_REQUIRED";
}

interface AgingResponse {
  sourceDisclosure: SourceDisclosure | null;
  availability: "AVAILABLE" | "ANCHOR_NOT_CONFIRMED";
  unavailableMessage: string | null;
  unavailableDetail: string | null;
  bucketsMessage: string | null;
  rows: AgingLotRow[];
  paging: { page: number; pageSize: number; total: number; hasMore: boolean };
  totals: { currentLots: number; confirmedQuantity: number; lotsNeedingReview: number };
}

const PAGE_SIZE = 50;

export function AgingView() {
  const trace = useNavStore((s) => s.trace);
  const globalFilter = useGlobalFilter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  // A drill-down from the Aging Dashboard arrives in the typed `bucket` field of the nav
  // context. It used to be read from the generic `category` field, which carried a raw
  // `inventoryClass` value the API refused — so the filter never applied and the page
  // showed everything while claiming to show one bucket.
  const bucketFromNav = trace?.bucket ?? null;

  const url = useMemo(() => {
    const p = new URLSearchParams();
    if (bucketFromNav) p.set("bucket", bucketFromNav);
    // Country, branch and lab are real dimensions of a stock record, so all three apply.
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    if (appliedSearch) p.set("search", appliedSearch);
    p.set("page", String(page));
    p.set("pageSize", String(PAGE_SIZE));
    return `/api/analysis/aging?${p.toString()}`;
  }, [bucketFromNav, globalFilter.country, globalFilter.branch, globalFilter.lab, appliedSearch, page]);

  const { data, isLoading } = useApi<AgingResponse>(url);
  const ageUnavailable = data?.availability === "ANCHOR_NOT_CONFIRMED";

  const columns: Column<AgingLotRow>[] = [
    { key: "lotId", header: "Lot", width: "14rem", sticky: "left", cell: (r) => <span className="font-medium">{r.lotId}</span> },
    { key: "stoneName", header: "Stone", width: "10rem", cell: (r) => <span className="text-muted-foreground">{r.stoneName ?? "—"}</span> },
    { key: "bucketLabel", header: "Inventory bucket", width: "12rem", cell: (r) => <Badge variant="info">{r.bucketLabel}</Badge> },
    { key: "lab", header: "Lab", width: "6rem", cell: (r) => <span className="text-muted-foreground">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", width: "8rem", cell: (r) => <span className="text-muted-foreground">{r.shape ?? "—"}</span> },
    {
      key: "confirmedQuantity", header: "Confirmed quantity (pcs)", align: "right",
      // Null is not zero: the source never established a quantity for this record.
      cell: (r) => r.confirmedQuantity === null
        ? <span className="text-muted-foreground">Not confirmed</span>
        : <NumberCell value={r.confirmedQuantity} />,
    },
    {
      key: "measuredWeight", header: "Measured weight (ct)", align: "right",
      cell: (r) => r.measuredWeight === null
        ? <span className="text-muted-foreground">Not confirmed</span>
        : <NumberCell value={r.measuredWeight} decimals={2} />,
    },
    { key: "country", header: "Country", width: "7rem", cell: (r) => <span className="text-muted-foreground">{r.country}</span> },
    { key: "branch", header: "Branch", width: "8rem", cell: (r) => <span className="text-muted-foreground">{r.branch}</span> },
    { key: "department", header: "Department", width: "12rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.department ?? "—"}</span> },
    { key: "location", header: "Location", width: "12rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.location ?? "—"}</span> },
    {
      // Named for what it is. It is not an aging start date and is not presented as one.
      key: "lastSourceUpdateIst", header: "Last reported by source", width: "12rem",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSourceUpdateIst ?? "—"}</span>,
    },
    {
      key: "dataState", header: "Data state", width: "10rem",
      cell: (r) => <Badge variant={r.dataState === "CONFIRMED" ? "success" : "warning"}>{r.dataState.replace(/_/g, " ")}</Badge>,
    },
  ];

  return (
    <div className="space-y-4 p-3">
      <PageHeader
        title="Stock Aging"
        subtitle={
          bucketFromNav
            ? `Current canonical stock — ${BUCKET_LABELS[bucketFromNav]}`
            : "Current canonical stock by bucket, category and location"
        }
      />
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />



      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {/* All three cover the complete filtered result, not the page on screen. */}
        <KpiCard label="Current lots" value={data?.totals.currentLots ?? 0} intent="info" icon={Boxes} hint="Records currently in stock, across all pages" />
        <KpiCard label="Confirmed quantity" value={data?.totals.confirmedQuantity ?? 0} unit="pcs" intent="success" hint="Pieces the source established, across all pages" />
        <KpiCard label="Needing review" value={data?.totals.lotsNeedingReview ?? 0} intent="warning" hint="Quantity or classification not confirmed, across all pages" />
      </div>

      <Section
        title="Current stock"
        description="Sold and non-current records are history and are excluded. Age is not shown because the aging date is not yet confirmed."
        actions={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search.trim()); setPage(1); } }}
                placeholder="Lot or stone…"
                className="h-8 w-48 pl-7 text-xs"
              />
            </div>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setAppliedSearch(search.trim()); setPage(1); }}>
              Apply
            </Button>
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No current stock matches the active filters."
          pagination={false}
          exportScope="current-page"
        />
        <ServerPagination
          page={data?.paging.page ?? 1}
          pageSize={data?.paging.pageSize ?? PAGE_SIZE}
          total={data?.paging.total ?? 0}
          hasMore={data?.paging.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="lots"
        />
      </Section>
    </div>
  );
}
