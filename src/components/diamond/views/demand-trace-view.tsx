"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useNavStore } from "@/stores/nav-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { resolveCategorySelection } from "@/lib/demand/demand-category-selection";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  FANTASY_SOURCE_STATE_LABELS,
  type FantasyEffectiveSourceState,
} from "@/lib/fantasy/source-state";
import {
  Layers, AlertTriangle, Package, Boxes, Target, ShieldCheck, Lock,
  ShoppingCart, Archive, FileText, Factory, ClipboardCheck, Ban, Search,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Safe response contract — business results only. The API deliberately does not
// send calculation steps, formulas, rule identifiers or source-table details, so
// there is nothing of that kind to model here.
// ---------------------------------------------------------------------------
interface CategoryResult {
  category: string;
  label: string;
  lab: string;
  shape: string;
  weightBand: string;
  status: string;
  businessStatus: {
    code: string;
    label: string;
    intent: "critical" | "warning" | "success" | "info" | "neutral";
  };
  sales90d: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  /** null when this result was produced without manufacturing coverage available. */
  wipCoverage: number | null;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  excessStock: number;
}

interface SupportingRecord {
  id: string;
  recordType: string;
  businessId: string;
  inclusionStatus: "INCLUDED" | "EXCLUDED";
  reason: string | null;
  docDate: string | null;
  quantity: number;
  weight: number | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  manufacturingStage: string | null;
  customerName: string | null;
  saleValue: number | null;
}

interface DemandResultDetailsResponse {
  hasEverRun: boolean;
  /** True when a specific run was requested by id and that run does not exist. */
  runUnavailable?: boolean;
  status: string;
  statusLabel: string;
  runId: string | null;
  calculatedAt: string | null;
  calculatedAtIst: string | null;
  businessDateIst: string | null;
  windowDays: number;
  sourceMode: FantasyEffectiveSourceState;
  isSimulated: boolean;
  recordsConsidered: {
    sales: number;
    inventory: number;
    manufacturing: number;
    approvedPlanPieces: number;
    excluded: number;
  };
  wipCoverage: { available: boolean; appliedInRun: boolean; message: string };
  canViewSupportingRecords: boolean;
  categories: CategoryResult[];
  selectedCategory: CategoryResult | null;
  selectedCategoryUnavailable?: boolean;
  supportingRecords: {
    recordType: string | null;
    rows: SupportingRecord[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  } | null;
  summary: {
    totalCategories: number;
    totalShortage: number;
    totalExcess: number;
    categoriesWithShortage: number;
    categoriesWithExcess: number;
  };
}

const RECORD_TABS = [
  { id: "CONFIRMED_SALE", label: "Confirmed Sales", icon: ShoppingCart },
  { id: "AVAILABLE_STOCK", label: "Available Stock", icon: Archive },
  { id: "MEMO_STOCK", label: "Memo Stock", icon: FileText },
  { id: "RESERVED_OR_BLOCKED", label: "Reserved or Blocked", icon: Lock },
  { id: "MANUFACTURING_COVERAGE", label: "Manufacturing Coverage", icon: Factory },
  { id: "APPROVED_PLAN_COVERAGE", label: "Approved Plan Coverage", icon: ClipboardCheck },
  { id: "EXCLUDED", label: "Excluded Records", icon: Ban },
] as const;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/**
 * Business-safe load failure text. Server errors are already sanitized, but this
 * page shows a fixed message and keeps only the support reference, so no backend
 * detail can reach the screen through an error path.
 */
/**
 * Request key for one page of supporting records. Returns null when records must not
 * be fetched at all, so an unauthorized or unselected state issues no request.
 */
function buildRecordsUrl(input: {
  category: string | null;
  canViewSupportingRecords: boolean;
  runId: string | null;
  recordType: string;
  page: number;
}): string | null {
  if (!input.category || !input.canViewSupportingRecords) return null;
  const params = new URLSearchParams();
  if (input.runId) params.set("runId", input.runId);
  params.set("category", input.category);
  params.set("recordType", input.recordType);
  params.set("page", String(input.page));
  params.set("pageSize", "50");
  return `/api/analysis/demand-trace?${params.toString()}`;
}

function safeErrorText(error: unknown, fallback: string): string {
  const ref = error instanceof Error ? error.message.match(/\(ref ([a-z0-9]+)\)/i) : null;
  return ref ? `${fallback} Reference ${ref[1]}.` : fallback;
}

export function DemandTraceView() {
  // The URL is the only carrier of the selected run and category, so the selection survives
  // remount, refresh, bookmarking and Back/Forward instead of living in component state.
  const trace = useNavStore((s) => s.trace);
  const setTraceCategory = useNavStore((s) => s.setTraceCategory);
  const clearTraceCategory = useNavStore((s) => s.clearTraceCategory);

  const [recordTab, setRecordTab] = useState<string>("CONFIRMED_SALE");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const requestedRunId = trace?.runId ?? null;
  const contextMalformed = trace?.malformed === true;
  // An unusable parameter is never used to pick a category; it is reported instead.
  const requestedCategory = contextMalformed ? null : trace?.category ?? null;

  // Category summaries. Keyed on the run only, so changing category never refetches this list
  // and never blanks the page while a record page loads.
  const summaryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (requestedRunId) params.set("runId", requestedRunId);
    const qs = params.toString();
    return qs ? `/api/analysis/demand-trace?${qs}` : "/api/analysis/demand-trace";
  }, [requestedRunId]);

  const { data, isLoading, error } = useApi<DemandResultDetailsResponse>(summaryUrl);

  const categories = data?.categories ?? [];
  const summary = data?.summary;
  const wipUnavailable = data?.wipCoverage && !data.wipCoverage.available;
  const runUnavailable = data?.runUnavailable === true;

  // Exact match on the canonical backend key. A key that is not part of this run resolves to
  // the unavailable state; it is never replaced by another category.
  const selection = resolveCategorySelection(categories, requestedCategory, {
    malformed: contextMalformed,
    runLoaded: data?.hasEverRun === true,
  });
  const selected = selection.state === "SELECTED" ? selection.category : null;
  const categoryUnavailable = selection.state === "UNAVAILABLE";

  // Supporting records are a second request under their own key. They are only fetched for the
  // selected category, and only when the caller may receive them.
  const recordsUrl = buildRecordsUrl({
    category: selected?.category ?? null,
    canViewSupportingRecords: data?.canViewSupportingRecords ?? false,
    runId: data?.runId ?? null,
    recordType: recordTab,
    page,
  });

  const { data: recordsData, isLoading: recordsLoading } =
    useApi<DemandResultDetailsResponse>(recordsUrl);
  // Records are read only from the response for the current key, so a page belonging to a
  // different category or run can never render as the current one.
  const supportingRecords = recordsData?.supportingRecords ?? null;

  // A different category or record type is a different record set: start at page one.
  const recordKey = `${selected?.category ?? ""}|${recordTab}`;
  const [lastRecordKey, setLastRecordKey] = useState(recordKey);
  if (recordKey !== lastRecordKey) {
    setLastRecordKey(recordKey);
    setPage(1);
  }

  const globalFilter = useGlobalFilter();
  const filteredCategories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return categories.filter((c) => {
      if (globalFilter.lab) {
        if (globalFilter.lab === "Non-Cert") {
          if (c.lab !== "Non-Cert" && c.lab) return false;
        } else if (globalFilter.lab === "Other") {
          if (c.lab === "GIA" || c.lab === "Non-Cert") return false;
        } else if (c.lab.toUpperCase() !== (globalFilter.lab as string).toUpperCase()) {
          return false;
        }
      }
      if (q && !c.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [categories, search, globalFilter.lab]);

  const recordColumns: Column<SupportingRecord>[] = [
    {
      key: "businessId",
      header: "Lot",
      sortable: true,
      sortValue: (r) => r.businessId,
      cell: (r) => <span className="font-mono text-[11px]">{r.businessId}</span>,
      sticky: "left",
    },
    {
      key: "inclusionStatus",
      header: "Counted",
      align: "center",
      cell: (r) => (
        <Badge variant={r.inclusionStatus === "INCLUDED" ? "success" : "neutral"}>
          {r.inclusionStatus === "INCLUDED" ? "Counted" : "Not counted"}
        </Badge>
      ),
    },
    { key: "docDate", header: "Date", align: "center", sortable: true, sortValue: (r) => r.docDate ?? "", cell: (r) => <span className="tabular-nums text-[11px] text-muted-foreground">{formatDate(r.docDate)}</span> },
    { key: "quantity", header: "Qty", align: "right", sortable: true, sortValue: (r) => r.quantity, cell: (r) => <NumberCell value={r.quantity} /> },
    { key: "weight", header: "Carats", align: "right", sortable: true, sortValue: (r) => r.weight ?? 0, cell: (r) => (r.weight === null ? <span className="text-muted-foreground">—</span> : <NumberCell value={r.weight} />) },
    { key: "lab", header: "Lab", align: "center", cell: (r) => <span className="text-[11px]">{r.lab ?? "—"}</span> },
    { key: "shape", header: "Shape", align: "center", cell: (r) => <span className="text-[11px]">{r.shape ?? "—"}</span> },
    { key: "weightBand", header: "Weight Band", align: "center", cell: (r) => <span className="text-[11px]">{r.weightBand ?? "—"}</span> },
    { key: "manufacturingStage", header: "Stage", align: "center", cell: (r) => <span className="text-[11px]">{r.manufacturingStage ?? "—"}</span> },
    { key: "customerName", header: "Customer", cell: (r) => <span className="text-[11px]">{r.customerName ?? "—"}</span> },
    { key: "reason", header: "Reason", cell: (r) => <span className="text-[10px] text-muted-foreground">{r.reason ?? "—"}</span> },
  ];

  // ------------------------------------------------------------------ rendering
  if (error) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <PageHeader
          title="Demand Result Details"
          subtitle="Review the final demand position and the business records contributing to it."
        />
        <EmptyState
          title="Demand result details could not be loaded"
          message={safeErrorText(error, "Please try again. If the problem continues, contact support.")}
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Demand Result Details"
        subtitle="Review the final demand position and the business records contributing to it."
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={data?.sourceMode === "LIVE_FANTASY" ? "success" : "warning"}>
              {FANTASY_SOURCE_STATE_LABELS[data?.sourceMode ?? "NOT_CONFIGURED"]}
            </Badge>
            {data?.hasEverRun && <Badge variant="info">{data.statusLabel}</Badge>}
            {data?.calculatedAtIst && (
              <span className="text-[10px] text-muted-foreground">
                Last calculated: <span className="tabular-nums font-medium text-foreground">{data.calculatedAtIst}</span>
              </span>
            )}
            {data?.businessDateIst && (
              <span className="text-[10px] text-muted-foreground">Business date: {data.businessDateIst}</span>
            )}
          </div>
        }
      />

      {/* The shared page header renders no subtitle, so the page states its purpose here. */}
      <p className="-mt-1 text-[11px] text-muted-foreground">
        Review the final demand position and the business records contributing to it.
      </p>

      {wipUnavailable && <InfoBanner variant="warning">{data!.wipCoverage.message}</InfoBanner>}

      {isLoading && !data ? (
        <KpiGridSkeleton count={5} />
      ) : runUnavailable ? (
        <EmptyState
          title="Demand run unavailable"
          message="The selected demand run is unavailable. Open Demand Result Details from the Analysis section to review the latest available result."
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      ) : !data?.hasEverRun ? (
        <EmptyState
          title="No demand calculation available"
          message="No demand result has been produced yet. Once a calculation has been run, its results and the records behind them appear here."
          icon={<Target className="h-6 w-6" />}
        />
      ) : (
        <>
          {/* Overall position */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
            <KpiCard label="Categories" value={summary?.totalCategories ?? 0} unit="cats" intent="info" icon={Layers} hint="Planning categories in this result" />
            <KpiCard label="Total Shortage" value={summary?.totalShortage ?? 0} unit="pcs" intent="critical" icon={AlertTriangle} hint="Pieces short across all categories" />
            <KpiCard label="Total Excess" value={summary?.totalExcess ?? 0} unit="pcs" intent="warning" icon={Package} hint="Stock above the current target" />
            <KpiCard label="Categories Short" value={summary?.categoriesWithShortage ?? 0} unit="cats" intent="critical" icon={Boxes} hint="Categories with a shortage" />
            <KpiCard label="Categories in Excess" value={summary?.categoriesWithExcess ?? 0} unit="cats" intent="warning" icon={Target} hint="Categories holding stock above target" />
          </div>

          {/* Category selection */}
          <Section
            title="Category Result"
            description="Choose a category to review its demand position."
            actions={
              <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                <div className="relative w-full sm:w-[170px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter categories…"
                    className="h-8 pl-7 text-xs"
                  />
                </div>
                <Select value={selected?.category ?? ""} onValueChange={(v) => setTraceCategory(v)}>
                  <SelectTrigger size="sm" className="h-8 w-full sm:w-[300px] text-xs">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {filteredCategories.map((c) => (
                      <SelectItem key={c.category} value={c.category} className="text-xs">
                        <span>{c.label}</span>
                        {c.remainingUnplanned > 0 && (
                          <span className="ml-2 text-[9px] text-rose-600 dark:text-rose-400 font-semibold">
                            {c.remainingUnplanned} to plan
                          </span>
                        )}
                      </SelectItem>
                    ))}
                    {filteredCategories.length === 0 && (
                      <div className="px-3 py-2 text-[10px] text-muted-foreground">No categories match this filter</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            }
          >
            {categoryUnavailable ? (
              <div className="flex flex-col items-center gap-2">
                <EmptyState
                  title="Category unavailable"
                  message="The selected category is unavailable for this demand run."
                  icon={<AlertTriangle className="h-6 w-6" />}
                />
                <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={clearTraceCategory}>
                  Select another category
                </Button>
              </div>
            ) : !selected ? (
              <EmptyState
                title="Select a category to review its demand result."
                message="Pick a lab, shape and weight band combination above to see its demand position and the records behind it."
                icon={<Target className="h-6 w-6" />}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border bg-muted/30 px-3 py-2">
                  <span className="text-xs font-semibold text-foreground">{selected.label}</span>
                  <Badge variant={selected.businessStatus.intent === "neutral" ? "neutral" : selected.businessStatus.intent}>
                    {selected.businessStatus.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
                  <KpiCard label="Confirmed Sales" value={selected.sales90d} unit="pcs" intent="info" icon={ShoppingCart} hint={`Confirmed sales during the last ${data.windowDays} days`} />
                  <KpiCard label="Target Quantity" value={selected.roundedTarget} unit="pcs" intent="default" icon={Target} hint="Target stock for this category" />
                  <KpiCard label="Available Stock" value={selected.availableStock} unit="pcs" intent="success" icon={Archive} hint="Stock currently available for planning" />
                  <KpiCard label="Memo Stock" value={selected.memoQty} unit="pcs" intent="warning" icon={FileText} hint="Memo stock shown separately" />
                  <KpiCard label="Reserved / Blocked" value={selected.reservedQty + selected.blockedQty} unit="pcs" intent="warning" icon={Lock} hint="Stock held and not available for planning" />
                  <KpiCard label="Physical Shortage" value={selected.physicalShortage} unit="pcs" intent={selected.physicalShortage > 0 ? "critical" : "success"} icon={AlertTriangle} hint="Pieces still short after available stock" />
                  <KpiCard
                    label="Manufacturing Coverage"
                    value={selected.wipCoverage === null ? "UNAVAILABLE" : selected.wipCoverage}
                    unit={selected.wipCoverage === null ? undefined : "pcs"}
                    intent={selected.wipCoverage === null ? "warning" : "info"}
                    icon={Factory}
                    hint={selected.wipCoverage === null ? "Manufacturing coverage is unavailable for this result" : "Matching manufacturing coverage"}
                  />
                  <KpiCard label="Pipeline Requirement" value={selected.pipelineNeed} unit="pcs" intent={selected.pipelineNeed > 0 ? "warning" : "success"} icon={Boxes} hint="Pieces still required after manufacturing coverage" />
                  <KpiCard label="Approved Plan Coverage" value={selected.approvedPlanCoverage} unit="pcs" intent="success" icon={ClipboardCheck} hint="Coverage from approved plans" />
                  <KpiCard label="Remaining to Plan" value={selected.remainingUnplanned} unit="pcs" intent={selected.remainingUnplanned > 0 ? "critical" : "success"} icon={ShieldCheck} hint="Pieces that still require planning" />
                  <KpiCard label="Excess Stock" value={selected.excessStock} unit="pcs" intent={selected.excessStock > 0 ? "warning" : "default"} icon={Package} hint="Stock above the current target" />
                </div>
              </div>
            )}
          </Section>

          {/* Supporting business records */}
          {selected && (
            <Section
              title="Supporting Records"
              description="The business records that contributed to this category result."
            >
              {!data.canViewSupportingRecords ? (
                <div className="flex items-center gap-2 px-3 py-6 text-[11px] text-muted-foreground">
                  <Lock className="h-3.5 w-3.5" />
                  You do not have permission to view supporting records.
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 overflow-x-auto">
                    {RECORD_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const active = recordTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setRecordTab(tab.id)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs whitespace-nowrap transition-all cursor-pointer",
                            active
                              ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] border border-[#F5DCD0]/70 dark:border-[#3A302A] font-bold shadow-2xs"
                              : "bg-background text-muted-foreground border border-border hover:text-foreground hover:bg-muted/60",
                          )}
                        >
                          <Icon className={cn("h-3 w-3", active ? "text-[#F9733E]" : "text-muted-foreground")} />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <DataTable<SupportingRecord>
                    columns={recordColumns}
                    rows={supportingRecords?.rows ?? []}
                    loading={recordsLoading}
                    emptyMessage="No records of this type contributed to the selected category."
                    maxHeight="420px"
                    exportable
                    exportPermission="demand.export"
                    exportFilename="demand-supporting-records.csv"
                    exportScope="current-page"
                  />
                  <ServerPagination
                    page={supportingRecords?.page ?? 1}
                    pageSize={supportingRecords?.pageSize ?? 50}
                    total={supportingRecords?.total ?? 0}
                    hasMore={supportingRecords?.hasMore ?? false}
                    onPageChange={setPage}
                    loading={recordsLoading}
                    label="records"
                  />
                </>
              )}
            </Section>
          )}

          {/* Run coverage — business volumes only */}
          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground leading-relaxed">
            This result reviewed {data.recordsConsidered.sales.toLocaleString()} confirmed sales records,{" "}
            {data.recordsConsidered.inventory.toLocaleString()} inventory records,{" "}
            {data.recordsConsidered.manufacturing.toLocaleString()} manufacturing records and{" "}
            {data.recordsConsidered.approvedPlanPieces.toLocaleString()} approved plan pieces.{" "}
            {data.recordsConsidered.excluded > 0
              ? `${data.recordsConsidered.excluded.toLocaleString()} records were excluded and are listed under Excluded Records with their business reason.`
              : "No records were excluded."}
          </div>
        </>
      )}
    </div>
  );
}
