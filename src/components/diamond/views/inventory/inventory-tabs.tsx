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
import { AlertTriangle, Database, FlaskConical, Info, Search } from "lucide-react";

/**
 * ANALYSIS INVENTORY — current canonical stock.
 *
 * Every figure is rendered exactly as the API returned it. This file contains no
 * business arithmetic and no status interpretation: the buckets come from the
 * centralized classification, already decided server-side.
 */

type ReadinessState =
  | "CURRENT" | "SIMULATED" | "STALE" | "INCOMPLETE" | "UNKNOWN"
  | "UNAVAILABLE" | "NOT_CONFIGURED" | "BLOCKED_BY_DATA_QUALITY";

interface PagingMeta { page: number; pageSize: number; total: number; hasMore: boolean }

interface ReadinessResponse {
  rows: Array<{ key: string; label: string; value: string; state: ReadinessState }>;
  isSimulated: boolean;
  sourceLabel: string;
  currentRecordCount: number;
  inventoryNewerThanDemandRun: boolean;
  demandRunAtIst: string | null;
}

interface PositionResponse {
  grouping: string;
  rows: Array<{
    groupKey: string; bucket: string | null; confirmedQuantity: number; measuredWeight: number;
    lotRecordCount: number; reviewRequiredCount: number; unconfirmedQuantityCount: number;
    lastSourceUpdateIst: string | null; shortageEligible: boolean;
  }>;
  totals: { confirmedQuantity: number; measuredWeight: number; lotRecordCount: number; reviewRequiredCount: number };
}

interface CategoriesResponse {
  rows: Array<{
    categoryId: string; lab: string; shape: string; weightBand: string;
    physicalAvailable: number; reserved: number; memo: number; wip: number;
    roughCount: number; roughQuantity: number; heldOrExcluded: number; reviewRequired: number;
    measuredWeight: number; lotRecordCount: number; lastSourceUpdateIst: string | null;
  }>;
  paging: PagingMeta;
}

interface LotsResponse {
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
  canonicalCurrent: number; polishedMirrorRows: number; roughMirrorRows: number; memoMirrorRows: number;
  presentInBoth: number; canonicalOnly: number; mirrorOnlyLegacySeed: number;
  classificationDisagreements: number; shadowProjectionCandidates: number;
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

/**
 * Source and freshness banners, shown above every tab so the state travels with the data.
 *
 * The readiness detail table it used to carry was removed as unnecessary on this page;
 * the underlying readiness section of the API is unchanged and still serves these two
 * facts — whether the source is simulated, and whether inventory has moved since the
 * last demand calculation.
 */
function SourceStateBanners({ scope }: { scope: string }) {
  const setView = useNavStore((s) => s.setView);
  const { data } = useApi<ReadinessResponse>(url(scope, { section: "readiness" }));

  return (
    <>
      {data?.isSimulated && (
        <InfoBanner variant="warning">
          <span className="flex items-center gap-2 font-semibold">
            <FlaskConical className="h-4 w-4" />
            Source: Fixture Simulation — this inventory is simulation output, not live Fantasy data.
          </span>
        </InfoBanner>
      )}

      {data?.inventoryNewerThanDemandRun && (
        <InfoBanner variant="warning">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Inventory has changed since the latest demand calculation
              {data.demandRunAtIst ? ` (${data.demandRunAtIst})` : ""}. Stored shortage figures have not been
              recomputed here.
            </span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setView("demand-overview")}>
              Open Demand Overview
            </Button>
          </div>
        </InfoBanner>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab: Position
// ---------------------------------------------------------------------------

const GROUPINGS = ["bucket", "country", "branch", "lab", "shape", "weightBand"] as const;

export function InventoryPositionTab() {
  const scope = useScope();
  const [grouping, setGrouping] = useState<(typeof GROUPINGS)[number]>("bucket");
  const { data, isLoading } = useApi<PositionResponse>(url(scope, { section: "position", grouping }));

  const columns: Column<PositionResponse["rows"][number]>[] = [
    {
      key: "groupKey", header: grouping === "bucket" ? "Inventory bucket" : grouping, width: "22rem",
      cell: (r) => (
        <span className="font-medium">
          {r.groupKey.replace(/_/g, " ")}
          {r.shortageEligible && <Badge variant="success" className="ml-2">may reduce shortage</Badge>}
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
    <div className="space-y-4">
      <SourceStateBanners scope={scope} />
      <Section
        title="Inventory position"
        description="Every current canonical record appears in exactly one bucket. Only physical available polished stock may reduce finished-stock shortage."
        actions={
          <div className="flex flex-wrap items-center gap-1">
            {GROUPINGS.map((g) => (
              <Button key={g} size="sm" variant={grouping === g ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => setGrouping(g)}>
                {g}
              </Button>
            ))}
          </div>
        }
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No current canonical inventory matches the active filters."
          pagination={false}
          exportScope="current-page"
        />
        {data && (
          <div className="border-t border-border bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
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
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<CategoriesResponse>(url(scope, { section: "categories", page, pageSize: PAGE_SIZE }));

  const columns: Column<CategoriesResponse["rows"][number]>[] = [
    {
      key: "categoryId", header: "Category (Lab | Shape | Weight Band)", width: "20rem",
      cell: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary hover:underline"
          // The canonical key is carried verbatim, so Heart opens Heart.
          onClick={() => setView("analysis-stockout")}
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
    <div className="space-y-4">
      <SourceStateBanners scope={scope} />
      <Section
        title="Category inventory"
        description="Current stock by canonical category. This page reports no target, shortage, excess, reorder or priority — those belong to Demand Overview, Stockout Risk and Excess Stock."
      >
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No category holds current canonical inventory under the active filters."
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
          label="categories"
        />
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
  const setView = useNavStore((s) => s.setView);
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
        <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => setView("manufacturing-traceability")}>
          {r.lotId}
        </button>
      ),
    },
    { key: "bucket", header: "Bucket", width: "16rem", cell: (r) => <Badge variant={r.bucket === "PHYSICAL_AVAILABLE_POLISHED" ? "success" : r.bucket === "REVIEW_REQUIRED" ? "warning" : "default"}>{r.bucket.replace(/_/g, " ")}</Badge> },
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
      key: "reviewCodes", header: "Review codes", width: "16rem",
      cell: (r) =>
        r.reviewCodes.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
          <button type="button" className="text-left text-xs text-primary hover:underline" onClick={() => setView("data-quality-issues")}>
            {r.reviewCodes.join(", ")}
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <SourceStateBanners scope={scope} />
      <Section
        title="Lot-level inventory"
        description="Current canonical records only. Sold, transferred and superseded versions are history and never appear here."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={bucket}
              onChange={(e) => { setBucket(e.target.value); setPage(1); }}
            >
              {BUCKET_FILTERS.map((b) => (
                <option key={b} value={b}>{b === "" ? "All buckets" : b.replace(/_/g, " ")}</option>
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
          emptyMessage="No current canonical lot matches the active filters."
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
        { label: "Synchronized canonical inventory (current)", value: data.canonicalCurrent, note: "The authoritative source for every figure on this page.", intent: "success" },
        { label: "Operational polished mirror rows", value: data.polishedMirrorRows, note: "Mirror table. May corroborate or restrict; never promotes stock.", intent: "default" },
        { label: "Operational rough mirror rows", value: data.roughMirrorRows, note: "Mirror table.", intent: "default" },
        { label: "Memo mirror rows", value: data.memoMirrorRows, note: "Mirror table.", intent: "default" },
        { label: "Present in both canonical and mirror", value: data.presentInBoth, note: "Lots the mirror and canonical storage agree exist.", intent: "default" },
        { label: "Canonical only", value: data.canonicalOnly, note: "Synchronized records with no operational mirror row.", intent: "default" },
        { label: "Mirror only — legacy seeded demo rows", value: data.mirrorOnlyLegacySeed, note: "Seeded demonstration records. Not synchronized, not authoritative, and excluded from every total above.", intent: "warning" },
        { label: "Classification disagreements", value: data.classificationDisagreements, note: "Lots where the mirror's planning class and the canonical classification differ.", intent: data.classificationDisagreements > 0 ? "critical" : "success" },
        { label: "Shadow projection candidates included", value: data.shadowProjectionCandidates === 0 ? 0 : data.shadowProjectionCandidates, note: "Shadow projection output is never authoritative and never appears in inventory.", intent: "success" },
      ]
    : [];

  const columns: Column<ReconRow>[] = [
    { key: "label", header: "Population", width: "24rem", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "value", header: "Records", align: "right", width: "9rem", cell: (r) => <NumberCell value={r.value} intent={r.intent === "default" ? undefined : r.intent} /> },
    { key: "note", header: "Meaning", cell: (r) => <span className="text-muted-foreground">{r.note}</span> },
  ];

  return (
    <div className="space-y-4">
      <SourceStateBanners scope={scope} />

      <InfoBanner variant="info">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4" />
          Legacy seeded mirror rows are demonstration data. They are listed here for comparison and are
          never merged into, or promoted onto, authoritative inventory.
        </span>
      </InfoBanner>

      <Section title="Canonical versus mirror reconciliation" description="How authoritative inventory compares with the operational mirrors and the legacy seed.">
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
