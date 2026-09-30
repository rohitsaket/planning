"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { Section } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Database, Info, Search } from "lucide-react";
import { SimulationBanner } from "@/components/diamond/shared/simulation-banner";
import type { SourceDisclosure } from "@/lib/analysis/source-disclosure";
import { bucketLabel } from "@/lib/analysis/bucket-vocabulary";

/**
 * ANALYSIS INVENTORY — current canonical stock.
 *
 * Every figure is rendered exactly as the API returned it. This file contains no
 * business arithmetic and no status interpretation: the buckets come from the
 * centralized classification, already decided server-side.
 */

interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

interface PositionResponse {
  sourceDisclosure: SourceDisclosure | null;
  grouping: string;
  rows: Array<{
    groupKey: string; bucket: string | null; confirmedQuantity: number; measuredWeight: number;
    lotRecordCount: number; reviewRequiredCount: number; unconfirmedQuantityCount: number;
    lastSourceUpdateIst: string | null; shortageEligible: boolean;
  }>;
  totals: { confirmedQuantity: number; measuredWeight: number; lotRecordCount: number; reviewRequiredCount: number };
}

interface CategoriesResponse {
  sourceDisclosure: SourceDisclosure | null;
  rows: Array<{
    categoryId: string; lab: string; shape: string; weightBand: string;
    physicalAvailable: number; reserved: number; memo: number; wip: number;
    roughCount: number; roughQuantity: number; heldOrExcluded: number; reviewRequired: number;
    measuredWeight: number; lotRecordCount: number; lastSourceUpdateIst: string | null;
  }>;
  paging: PagingMeta;
}

interface LotsResponse {
  sourceDisclosure: SourceDisclosure | null;
  rows: Array<{
    lotId: string; sourceRecordId: string | null; stockType: string; lifecycle: string | null;
    bucket: string; classificationState: string | null; holdState: string | null;
    planningEligible: boolean | null; lab: string; shape: string; weightBand: string;
    confirmedQuantity: number | null; measuredWeight: number | null; country: string; branch: string;
    department: string | null; location: string | null; firstSeenIst: string | null;
    lastSeenIst: string | null; sourceUpdatedIst: string | null; isSimulated: boolean;
    reviewCodes: string[];
  }>;
  paging: PagingMeta;
}

interface ReconciliationResponse {
  sourceDisclosure: SourceDisclosure | null;
  canonicalCurrent: number; polishedMirrorRows: number; roughMirrorRows: number; memoMirrorRows: number;
  presentInBoth: number; canonicalOnly: number; mirrorOnlyLegacySeed: number;
  classificationDisagreements: number;
}

const PAGE_SIZE = 25;

/** Query string shared by every tab, so all four read the same scope. */
function useScope() {
  const globalFilter = useGlobalFilter();
  return useMemo(() => {
    const p = new URLSearchParams();
    if (globalFilter.country) p.set("country", globalFilter.country);
    if (globalFilter.branch) p.set("branch", globalFilter.branch);
    if (globalFilter.lab) p.set("lab", globalFilter.lab);
    return p.toString();
  }, [globalFilter.country, globalFilter.branch, globalFilter.lab]);
}

function url(scope: string, extra: Record<string, string | number>): string {
  const p = new URLSearchParams(scope);
  for (const [k, v] of Object.entries(extra)) if (v !== "") p.set(k, String(v));
  return `/api/analysis/inventory?${p.toString()}`;
}



// ---------------------------------------------------------------------------
// Tab: Position
// ---------------------------------------------------------------------------

const GROUPINGS = ["bucket", "country", "branch", "lab", "shape", "weightBand"] as const;
const GROUPING_LABEL: Record<(typeof GROUPINGS)[number], string> = {
  bucket: "Bucket",
  country: "Country",
  branch: "Branch",
  lab: "Lab",
  shape: "Shape",
  weightBand: "Weight band",
};

export function InventoryPositionTab() {
  const scope = useScope();
  const [grouping, setGrouping] = useState<(typeof GROUPINGS)[number]>("bucket");
  const { data, isLoading } = useApi<PositionResponse>(url(scope, { section: "position", grouping }));

  const columns: Column<PositionResponse["rows"][number]>[] = [
    {
      key: "groupKey", header: grouping === "bucket" ? "Inventory bucket" : GROUPING_LABEL[grouping], width: "22rem",
      cell: (r) => (
        <span className="font-medium">
          {grouping === "bucket" ? bucketLabel(r.groupKey) : r.groupKey}
          {r.shortageEligible && <Badge variant="success" className="ml-2">Counts as available</Badge>}
        </span>
      ),
    },
    { key: "confirmedQuantity", header: "Confirmed qty (pcs)", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} intent={r.shortageEligible ? "success" : "default"} /> },
    { key: "measuredWeight", header: "Measured weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    // Adjacent to, and distinct from, the quantity column.
    { key: "lotRecordCount", header: "Lot records", align: "right", cell: (r) => <NumberCell value={r.lotRecordCount} /> },
    { key: "reviewRequiredCount", header: "Review required", align: "right", cell: (r) => <NumberCell value={r.reviewRequiredCount} intent={r.reviewRequiredCount > 0 ? "warning" : "default"} zeroAsDash /> },
    { key: "unconfirmedQuantityCount", header: "Unconfirmed qty", align: "right", cell: (r) => <NumberCell value={r.unconfirmedQuantityCount} intent={r.unconfirmedQuantityCount > 0 ? "warning" : "default"} zeroAsDash /> },
    { key: "lastSourceUpdateIst", header: "Last source update", width: "13rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSourceUpdateIst ?? "Unknown"}</span> },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />
      <Section
        title="Inventory position"
        description="Current stock by bucket"
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {GROUPINGS.map((g) => (
              <Button key={g} size="sm" variant={grouping === g ? "default" : "outline"} className="h-7 px-2 text-xs cursor-pointer" onClick={() => setGrouping(g)}>
                {GROUPING_LABEL[g]}
              </Button>
            ))}
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No current inventory matches the active filters."
          pagination={false}
          exportScope="current-page"
        />
        {data && (
          <div className="flex-shrink-0 border-t border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
            Totals across every matching record — {data.totals.confirmedQuantity} pcs · {data.totals.measuredWeight} ct ·{" "}
            {data.totals.lotRecordCount} lot records · {data.totals.reviewRequiredCount} review required
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Categories
// ---------------------------------------------------------------------------

export function InventoryCategoriesTab() {
  const scope = useScope();
  const setView = useNavStore((s) => s.setView);
  const openCategoryView = useNavStore((s) => s.openCategoryView);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<CategoriesResponse>(url(scope, { section: "categories", page, pageSize: PAGE_SIZE }));

  const columns: Column<CategoriesResponse["rows"][number]>[] = [
    {
      key: "categoryId", header: "Category (Lab | Shape | Weight Band)", width: "20rem",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          // The canonical key is carried verbatim, so Heart opens Heart. `setView` drops
          // row context, which is why this link previously opened Stockout Risk with no
          // category selected at all.
          onClick={() => openCategoryView("analysis-stockout", { category: r.categoryId })}
          title={r.categoryId}
        >
          {[r.lab, r.shape, r.weightBand].filter(Boolean).join(" | ")}
        </button>
      ),
    },
    { key: "physicalAvailable", header: "Physical available", align: "right", cell: (r) => <NumberCell value={r.physicalAvailable} intent="success" /> },
    { key: "reserved", header: "Reserved", align: "right", cell: (r) => <NumberCell value={r.reserved} zeroAsDash /> },
    { key: "memo", header: "Memo", align: "right", cell: (r) => <NumberCell value={r.memo} zeroAsDash /> },
    { key: "wip", header: "WIP", align: "right", cell: (r) => <NumberCell value={r.wip} zeroAsDash /> },
    // Rough is reported as its own count and quantity — never folded into a polished figure.
    { key: "roughCount", header: "Rough lots", align: "right", cell: (r) => <NumberCell value={r.roughCount} zeroAsDash /> },
    { key: "roughQuantity", header: "Rough qty", align: "right", cell: (r) => <NumberCell value={r.roughQuantity} zeroAsDash /> },
    { key: "heldOrExcluded", header: "Held / excluded", align: "right", cell: (r) => <NumberCell value={r.heldOrExcluded} intent={r.heldOrExcluded > 0 ? "warning" : "default"} zeroAsDash /> },
    { key: "reviewRequired", header: "Review", align: "right", cell: (r) => <NumberCell value={r.reviewRequired} intent={r.reviewRequired > 0 ? "warning" : "default"} zeroAsDash /> },
    { key: "measuredWeight", header: "Measured weight (ct)", align: "right", cell: (r) => <NumberCell value={r.measuredWeight} decimals={2} /> },
    { key: "lotRecordCount", header: "Lot records", align: "right", cell: (r) => <NumberCell value={r.lotRecordCount} /> },
    {
      key: "trace", header: "Trace", width: "7rem",
      cell: (r) => (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setView("analysis-excess")} title={r.categoryId}>
          Trace
        </Button>
      ),
    },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />
      <Section
        title="Category inventory"
        description="Current stock by category"
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No category has current stock under the active filters."
          pagination={false}
          exportScope="current-page"
        />
        <div className="flex-shrink-0">
          <ServerPagination
            page={data?.paging.page ?? 1}
            pageSize={data?.paging.pageSize ?? PAGE_SIZE}
            total={data?.paging.total ?? 0}
            hasMore={data?.paging.hasMore ?? false}
            onPageChange={setPage}
            loading={isLoading}
            label="categories"
          />
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Lots
// ---------------------------------------------------------------------------

const BUCKET_FILTERS = [
  "", "PHYSICAL_AVAILABLE_POLISHED", "RESERVED_POLISHED", "MEMO_POLISHED",
  "MANUFACTURING_WIP", "ROUGH_AVAILABLE", "HELD_OR_EXCLUDED", "REVIEW_REQUIRED",
] as const;

export function InventoryLotsTab() {
  const scope = useScope();
  const [page, setPage] = useState(1);
  const [bucket, setBucket] = useState<string>("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const { data, isLoading } = useApi<LotsResponse>(
    url(scope, { section: "lots", page, pageSize: PAGE_SIZE, bucket, search: appliedSearch }),
  );

  const columns: Column<LotsResponse["rows"][number]>[] = [
    {
      key: "lotId", header: "Lot", width: "12rem",
      cell: (r) => (
        <span className="font-medium">{r.lotId}</span>
      ),
    },
    { key: "bucket", header: "Bucket", width: "16rem", cell: (r) => <Badge variant={r.bucket === "PHYSICAL_AVAILABLE_POLISHED" ? "success" : r.bucket === "REVIEW_REQUIRED" ? "warning" : "default"}>{bucketLabel(r.bucket)}</Badge> },
    { key: "stockType", header: "Type", width: "7rem", cell: (r) => <span className="text-xs">{r.stockType}</span> },
    { key: "lifecycle", header: "Lifecycle", width: "11rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.lifecycle ?? "—"}</span> },
    { key: "holdState", header: "Hold", width: "8rem", cell: (r) => <span className="text-xs">{r.holdState ?? "—"}</span> },
    { key: "classificationState", header: "Classification", width: "10rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.classificationState ?? "—"}</span> },
    {
      key: "planningEligible", header: "Planning eligible", width: "9rem",
      // A factual classification output, not an instruction.
      cell: (r) => <span className="text-xs text-muted-foreground">{r.planningEligible === null ? "—" : r.planningEligible ? "Yes" : "No"}</span>,
    },
    { key: "lab", header: "Lab", width: "7rem", cell: (r) => <span className="text-xs">{r.lab || "—"}</span> },
    { key: "shape", header: "Shape", width: "9rem", cell: (r) => <span className="text-xs">{r.shape || "—"}</span> },
    { key: "weightBand", header: "Weight band", width: "9rem", cell: (r) => <span className="text-xs">{r.weightBand || "—"}</span> },
    {
      key: "confirmedQuantity", header: "Qty (pcs)", align: "right",
      // Null means the quantity could not be confirmed — never silently rendered as 1.
      cell: (r) => (r.confirmedQuantity === null ? <span className="text-xs italic text-muted-foreground">Unconfirmed</span> : <NumberCell value={r.confirmedQuantity} />),
    },
    {
      key: "measuredWeight", header: "Measured weight (ct)", align: "right",
      cell: (r) => (r.measuredWeight === null ? <span className="text-xs italic text-muted-foreground">Unavailable</span> : <NumberCell value={r.measuredWeight} decimals={2} />),
    },
    { key: "country", header: "Country", width: "8rem", cell: (r) => <span className="text-xs">{r.country}</span> },
    { key: "branch", header: "Branch", width: "9rem", cell: (r) => <span className="text-xs">{r.branch}</span> },
    { key: "department", header: "Department", width: "11rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.department ?? "—"}</span> },
    { key: "location", header: "Location", width: "11rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.location ?? "—"}</span> },
    { key: "lastSeenIst", header: "Last seen", width: "13rem", cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSeenIst ?? "—"}</span> },
    {
      key: "reviewCodes", header: "Review", width: "10rem",
      cell: (r) =>
        r.reviewCodes.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
          <span className="text-xs text-amber-700 dark:text-amber-400" title={r.reviewCodes.join(", ")}>Needs review ({r.reviewCodes.length})</span>
        ),
    },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />
      <Section
        title="Lot-level inventory"
        description="Current lots only"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={bucket}
              onChange={(e) => { setBucket(e.target.value); setPage(1); }}
            >
              {BUCKET_FILTERS.map((b) => (
                <option key={b} value={b}>{b === "" ? "All buckets" : bucketLabel(b)}</option>
              ))}
            </select>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setAppliedSearch(search.trim()); setPage(1); } }}
                placeholder="Lot or stone name…"
                className="h-8 w-52 pl-7 text-xs"
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
          emptyMessage="No current lot matches the active filters."
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

// ---------------------------------------------------------------------------
// Tab: Reconciliation
// ---------------------------------------------------------------------------

interface ReconRow { label: string; value: number; note: string; intent: "default" | "warning" | "critical" | "success" }

export function InventoryReconciliationTab() {
  const scope = useScope();
  const { data, isLoading } = useApi<ReconciliationResponse>(url(scope, { section: "reconciliation" }));

  const rows: ReconRow[] = data
    ? [
        { label: "Current inventory", value: data.canonicalCurrent, note: "Synchronized current lots.", intent: "default" },
        { label: "Polished records (operational)", value: data.polishedMirrorRows, note: "Operational polished records.", intent: "default" },
        { label: "Rough records (operational)", value: data.roughMirrorRows, note: "Operational rough records.", intent: "default" },
        { label: "Memo records", value: data.memoMirrorRows, note: "Operational memo records.", intent: "default" },
        { label: "Matched records", value: data.presentInBoth, note: "Lots found in both.", intent: "default" },
        { label: "Inventory only", value: data.canonicalOnly, note: "Not in operational records.", intent: "default" },
        { label: "Demo records (excluded)", value: data.mirrorOnlyLegacySeed, note: "Demo data, not counted.", intent: data.mirrorOnlyLegacySeed > 0 ? "warning" : "default" },
        { label: "Classification disagreements", value: data.classificationDisagreements, note: "Lots with conflicting classification.", intent: data.classificationDisagreements > 0 ? "critical" : "default" },
      ]
    : [];

  const columns: Column<ReconRow>[] = [
    { key: "label", header: "Population", width: "24rem", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "value", header: "Records", align: "right", width: "9rem", cell: (r) => <NumberCell value={r.value} intent={r.intent === "default" ? undefined : r.intent} /> },
    { key: "note", header: "Meaning", cell: (r) => <span className="text-muted-foreground">{r.note}</span> },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {/* Persistent and unmistakable while fixture data is on screen. */}
      <SimulationBanner disclosure={data?.sourceDisclosure} />
      <div className="flex-shrink-0">
        <InfoBanner variant="info">
          <span className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            Demo records are shown for comparison only and are not counted in inventory.
          </span>
        </InfoBanner>
      </div>

      <Section title="Inventory reconciliation" description="Inventory compared with operational records">
        {!isLoading && !data ? (
          <EmptyState title="UNAVAILABLE" message="Reconciliation could not be computed." icon={<Database className="h-5 w-5" />} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyMessage="Reconciliation is unavailable."
            pagination={false}
            enableColumnFilter={false}
            enableColumnValueFilter={false}
          />
        )}
      </Section>
    </div>
  );
}
