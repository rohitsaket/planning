"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Pencil,
  Loader2,
  Bookmark,
  Save,
  Trash2,
  Star,
} from "lucide-react";
import { useSavedViews, type SavedView } from "@/stores/saved-views";
import { useGlobalFilter } from "@/stores/global-filter";
import { TableSkeleton } from "@/components/diamond/shared/skeleton";

interface RequirementRow {
  id: string;
  requirementCode: string;
  type: string;
  status: string;
  customerName: string | null;
  orderNumber: string | null;
  country: string | null;
  branch: string | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  requiredQty: number;
  physicalStockQty: number;
  planningAvailableQty: number;
  memoQty: number;
  transferCoverage: number;
  wipCoverage: number;
  approvedPlanCoverage: number;
  actualCoverage: number;
  remainingUnplanned: number;
  forecastQty: number;
  requiredBy: string | null;
  ageDays: number;
  daysRemaining: number | null;
  daysOverdue: number;
  customerPriority: string | null;
  orderPriority: string | null;
  requirementPriority: string | null;
  priorityReason: string | null;
}

interface RequirementDetail {
  id: string;
  requirementCode: string;
  type: string;
  status: string;
  customerName: string | null;
  orderNumber: string | null;
  country: string | null;
  branch: string | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  colorGroup: string | null;
  clarityGroup: string | null;
  treatment: string | null;
  requiredQty: number;
  physicalStockQty: number;
  planningAvailableQty: number;
  memoQty: number;
  transferCoverage: number;
  wipCoverage: number;
  approvedPlanCoverage: number;
  actualCoverage: number;
  remainingUnplanned: number;
  forecastQty: number;
  requiredBy: string | null;
  ageDays: number;
  daysRemaining: number | null;
  daysOverdue: number;
  customerPriority: string | null;
  orderPriority: string | null;
  requirementPriority: string | null;
  priorityReason: string | null;
  sourceRecords: unknown;
  allocations: Array<{
    id: string;
    allocatedQty: number;
    allocatedBy: string;
    allocatedAt: string;
    status: string;
    planOptionCode: string | null;
  }>;
  fourNumbers: {
    physicalShortage: number;
    pipelineAdjusted: number;
    planningAdjusted: number;
    forecastRequirement: number;
  };
}

const TYPES = [
  "SALES_ORDER",
  "MEMO",
  "FORECAST",
  "STOCKOUT_REPLENISHMENT",
  "SPECIAL",
  "BACKORDER",
];
const STATUSES = [
  "OPEN",
  "PARTIALLY_COVERED",
  "FULLY_PLANNED",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "IN_MANUFACTURING",
  "EXPIRED",
  "CANCELLED",
];
const COUNTRIES = ["USA", "India", "Belgium", "Israel", "HongKong", "UAE", "Botswana"];
const PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "LOW", "WATCH"];

function priorityVariant(
  v: string | null
): "default" | "critical" | "high" | "low" | "neutral" {
  if (!v) return "default";
  if (v === "CRITICAL") return "critical";
  if (v === "HIGH") return "high";
  if (v === "LOW") return "low";
  if (v === "WATCH") return "neutral";
  return "default";
}

function PriorityBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={priorityVariant(value)}>{value}</Badge>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

export function RequirementsMatrixView() {
  const qc = useQueryClient();
  // Global filter (country/lab/branch/windowDays) is sourced from the GlobalFilterBar
  // mounted in the AppShell. The global filter is ADDITIVE to local filters — local
  // country takes precedence over the global country so users can drill down further
  // within an already-filtered view.
  const globalFilter = useGlobalFilter();
  const [filters, setFilters] = useState({
    type: "",
    status: "",
    country: "",
    priority: "",
    q: "",
  });
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Requirement Priority Override form state
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [newPriority, setNewPriority] = useState<string>("NORMAL");
  const [overrideReason, setOverrideReason] = useState<string>("");

  // Saved Views state
  const { views: savedViews, addView, removeView } = useSavedViews();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  const applySavedView = (sv: SavedView) => {
    setFilters({
      type: sv.filters.type ?? "",
      status: sv.filters.status ?? "",
      country: sv.filters.country ?? "",
      priority: sv.filters.priority ?? "",
      q: sv.filters.search ?? "",
    });
    setPage(1);
    toast.success(`Applied saved view "${sv.name}"`);
  };

  const handleSaveView = () => {
    if (newViewName.trim().length < 3) {
      toast.error("View name must be at least 3 characters");
      return;
    }
    addView(newViewName.trim(), {
      type: filters.type || null,
      status: filters.status || null,
      country: filters.country || null,
      priority: filters.priority || null,
      search: filters.q || "",
    });
    toast.success(`Saved view "${newViewName.trim()}"`);
    setNewViewName("");
    setShowSaveDialog(false);
  };

  const qs = useMemo(() => {
    const parts: string[] = [`page=${page}`, `pageSize=${pageSize}`];
    if (filters.type) parts.push(`type=${encodeURIComponent(filters.type)}`);
    if (filters.status) parts.push(`status=${encodeURIComponent(filters.status)}`);
    // Country: local takes precedence over global — only append global country when the
    // local country selector has not been used.
    if (filters.country) {
      parts.push(`country=${encodeURIComponent(filters.country)}`);
    } else if (globalFilter.country) {
      parts.push(`country=${encodeURIComponent(globalFilter.country)}`);
    }
    if (filters.priority) parts.push(`priority=${encodeURIComponent(filters.priority)}`);
    if (filters.q) parts.push(`q=${encodeURIComponent(filters.q)}`);
    // Global-only filters (additive — no local equivalent in the matrix toolbar).
    if (globalFilter.branch) parts.push(`branch=${encodeURIComponent(globalFilter.branch)}`);
    if (globalFilter.lab) parts.push(`lab=${encodeURIComponent(globalFilter.lab)}`);
    return parts.join("&");
  }, [filters, page, globalFilter.country, globalFilter.branch, globalFilter.lab]);

  const url = `/api/requirements?${qs}`;
  const { data, isLoading } = useApi<{
    data: RequirementRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(url);

  const { data: detail, isLoading: detailLoading } = useApi<RequirementDetail | null>(
    selectedId ? `/api/requirements/${selectedId}` : null
  );

  // Requirement Priority Override mutation
  const overrideMutation = useMutation({
    mutationFn: async (vars: { id: string; priority: string; reason: string }) =>
      apiPost<{
        id: string;
        requirementCode: string;
        requirementPriority: string;
        priorityReason: string;
        auditLogged: true;
      }>(`/api/requirements/${vars.id}/priority`, {
        priority: vars.priority,
        reason: vars.reason,
      }),
    onSuccess: (_data, vars) => {
      toast.success("Priority overridden — audit logged");
      // Invalidate the matrix list query (current page+filters) and the detail query so they refetch.
      qc.invalidateQueries({ queryKey: [url] });
      qc.invalidateQueries({ queryKey: [`/api/requirements/${vars.id}`] });
      // Reset form
      setShowOverrideForm(false);
      setOverrideReason("");
      setNewPriority("NORMAL");
    },
    onError: (e: Error) => {
      toast.error(`Override failed: ${e.message}`);
    },
  });

  const resetOverrideForm = () => {
    setShowOverrideForm(false);
    setOverrideReason("");
    setNewPriority("NORMAL");
  };

  const openOverrideForm = () => {
    setNewPriority(detail?.requirementPriority ?? "NORMAL");
    setOverrideReason("");
    setShowOverrideForm(true);
  };

  const applyOverride = () => {
    if (!detail) return;
    const reason = overrideReason.trim();
    if (!newPriority || reason.length < 5) return;
    overrideMutation.mutate({ id: detail.id, priority: newPriority, reason });
  };

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const resetPage = () => setPage(1);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    resetPage();
  };

  const clearFilters = () => {
    setFilters({ type: "", status: "", country: "", priority: "", q: "" });
    resetPage();
  };

  const activeFilters = Object.values(filters).filter(Boolean).length;

  const columns: Column<RequirementRow>[] = [
    {
      key: "requirementCode",
      header: "Req. Code",
      width: "150px",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.requirementCode,
      cell: (r) => (
        <span className="font-medium text-foreground">{r.requirementCode}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      align: "center",
      width: "120px",
      cell: (r) => <Badge variant="info">{r.type.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      width: "120px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "customerName",
      header: "Customer",
      width: "140px",
      cell: (r) => (
        <span className="truncate">{r.customerName ?? "—"}</span>
      ),
    },
    {
      key: "orderNumber",
      header: "Order #",
      align: "center",
      width: "120px",
      cell: (r) => r.orderNumber ?? "—",
    },
    {
      key: "country",
      header: "Country",
      align: "center",
      width: "90px",
      cell: (r) => r.country ?? "—",
    },
    {
      key: "branch",
      header: "Branch",
      align: "center",
      width: "90px",
      cell: (r) => r.branch ?? "—",
    },
    {
      key: "lab",
      header: "Lab",
      align: "center",
      width: "80px",
      cell: (r) => r.lab ?? "—",
    },
    {
      key: "shape",
      header: "Shape",
      align: "center",
      width: "90px",
      cell: (r) => r.shape ?? "—",
    },
    {
      key: "weightBand",
      header: "Wt Band",
      align: "center",
      width: "110px",
      cell: (r) => r.weightBand ?? "—",
    },
    {
      key: "requiredQty",
      header: "Req Qty",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.requiredQty,
      cell: (r) => <NumberCell value={r.requiredQty} intent="info" />,
    },
    {
      key: "physicalStockQty",
      header: "Phys Stock",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.physicalStockQty,
      cell: (r) => <NumberCell value={r.physicalStockQty} />,
    },
    {
      key: "planningAvailableQty",
      header: "Plan Avail",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.planningAvailableQty} />,
    },
    {
      key: "memoQty",
      header: "Memo",
      width: "60px",
      align: "right",
      cell: (r) => <NumberCell value={r.memoQty} intent="warning" />,
    },
    {
      key: "transferCoverage",
      header: "Trans Cov",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.transferCoverage} />,
    },
    {
      key: "wipCoverage",
      header: "WIP Cov",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.wipCoverage} intent="info" />,
    },
    {
      key: "approvedPlanCoverage",
      header: "Plan Cov",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.approvedPlanCoverage} intent="success" />,
    },
    {
      key: "actualCoverage",
      header: "Act Cov",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.actualCoverage} />,
    },
    {
      key: "remainingUnplanned",
      header: "Rem Unpl",
      width: "75px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.remainingUnplanned,
      cell: (r) => (
        <NumberCell
          value={r.remainingUnplanned}
          intent={r.remainingUnplanned > 0 ? "critical" : "success"}
        />
      ),
    },
    {
      key: "forecastQty",
      header: "Forecast",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.forecastQty} intent="info" />,
    },
    {
      key: "requiredBy",
      header: "Req By",
      align: "center",
      width: "90px",
      cell: (r) => fmtDate(r.requiredBy),
    },
    {
      key: "ageDays",
      header: "Age",
      width: "60px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.ageDays,
      cell: (r) => <NumberCell value={r.ageDays} />,
    },
    {
      key: "daysRemaining",
      header: "Days Rem",
      width: "70px",
      align: "right",
      cell: (r) => <NumberCell value={r.daysRemaining} />,
    },
    {
      key: "daysOverdue",
      header: "Days Over",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.daysOverdue,
      cell: (r) => (
        <NumberCell value={r.daysOverdue} intent={r.daysOverdue > 0 ? "critical" : "default"} />
      ),
    },
    {
      key: "customerPriority",
      header: "Cust Pri",
      align: "center",
      width: "80px",
      sticky: "left",
      cell: (r) => <PriorityBadge value={r.customerPriority} />,
    },
    {
      key: "orderPriority",
      header: "Ord Pri",
      align: "center",
      width: "80px",
      sticky: "left",
      cell: (r) => <PriorityBadge value={r.orderPriority} />,
    },
    {
      key: "requirementPriority",
      header: "Req Pri",
      align: "center",
      width: "80px",
      sticky: "left",
      cell: (r) => <PriorityBadge value={r.requirementPriority} />,
    },
    {
      key: "priorityReason",
      header: "Reason",
      width: "200px",
      cell: (r) => (
        <span className="text-muted-foreground truncate block max-w-[180px]" title={r.priorityReason ?? ""}>
          {r.priorityReason ?? "—"}
        </span>
      ),
    },
  ];

  // KPIs from current page (approximate)
  const totalRemaining = rows.reduce((s, r) => s + r.remainingUnplanned, 0);
  const totalOverdue = rows.filter((r) => r.daysOverdue > 0).length;
  const totalCritical = rows.filter((r) => r.requirementPriority === "CRITICAL").length;

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Requirements Matrix"
        subtitle="High-density enterprise requirement grid · Physical Shortage → Pipeline-Adjusted → Plan Coverage → Remaining Unplanned · Filter, search and drill down to four-number evidence"
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            {globalFilter.hasActiveFilters() && (
              <span className="text-[10px] text-sky-600 dark:text-sky-400 font-medium">
                Filtered by: {[
                  globalFilter.country && !filters.country && `Country=${globalFilter.country}`,
                  globalFilter.branch && `Branch=${globalFilter.branch}`,
                  globalFilter.lab && `Lab=${globalFilter.lab}`,
                ].filter(Boolean).join(", ")}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">
              {total.toLocaleString()} total · Page {page} / {totalPages}
            </span>
          </div>
        }
      />

      {/* KPI strip for current page */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Page Rows" value={rows.length} unit="reqs" intent="default" />
        <KpiCard
          label="Remaining Unplanned (page)"
          value={totalRemaining}
          unit="pcs"
          intent="critical"
          hint="Sum of remainingUnplanned on current page"
        />
        <KpiCard label="Overdue Rows" value={totalOverdue} unit="reqs" intent="warning" />
        <KpiCard label="Critical Rows" value={totalCritical} unit="reqs" intent="critical" />
      </div>

      {/* Filter row */}
      <Section
        title="Filters"
        description="Type, status, country, priority and free-text search"
        bodyClassName="p-2"
        actions={
          <div className="flex items-center gap-1">
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowSaveDialog(true)}>
                <Save className="h-3 w-3 mr-1" /> Save View
              </Button>
            )}
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearFilters}>
                <X className="h-3 w-3 mr-1" /> Clear ({activeFilters})
              </Button>
            )}
          </div>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={filters.type || "ALL"} onValueChange={(v) => updateFilter("type", v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Types</SelectItem>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.status || "ALL"} onValueChange={(v) => updateFilter("status", v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.country || "ALL"} onValueChange={(v) => updateFilter("country", v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Countries</SelectItem>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.priority || "ALL"}
            onValueChange={(v) => updateFilter("priority", v === "ALL" ? "" : v)}
          >
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Priorities</SelectItem>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(e) => updateFilter("q", e.target.value)}
              placeholder="Search requirement code…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>
      </Section>

      {/* Saved Views bar — persisted to localStorage */}
      {savedViews.length > 0 && (
        <Section title="Saved Views" description="Click to apply · persisted in browser localStorage" bodyClassName="p-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Bookmark className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            {savedViews.map((sv) => {
              const activeCount = [sv.filters.type, sv.filters.status, sv.filters.country, sv.filters.priority, sv.filters.search].filter(Boolean).length;
              return (
                <div key={sv.id} className="inline-flex items-center gap-1 group">
                  <button
                    onClick={() => applySavedView(sv)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-card hover:bg-primary/5 hover:border-primary/40 transition-colors text-xs"
                    title={`Filters: ${activeCount} active\nType: ${sv.filters.type || "any"}\nStatus: ${sv.filters.status || "any"}\nCountry: ${sv.filters.country || "any"}\nPriority: ${sv.filters.priority || "any"}\nSearch: ${sv.filters.search || "none"}`}
                  >
                    <Star className="h-3 w-3 text-amber-500" />
                    <span className="font-medium">{sv.name}</span>
                    <Badge variant="neutral" className="text-[9px]">{activeCount}</Badge>
                  </button>
                  <button
                    onClick={() => { removeView(sv.id); toast.success(`Deleted saved view "${sv.name}"`); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40"
                    title="Delete saved view"
                  >
                    <Trash2 className="h-3 w-3 text-rose-500" />
                  </button>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Save View Dialog */}
      {showSaveDialog && (
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Save Current View</DialogTitle>
              <DialogDescription>
                Save the current filter combination with a name for quick access. Saved views are stored in your browser localStorage.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label htmlFor="view-name" className="text-xs">View Name</Label>
                <Input
                  id="view-name"
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  placeholder="e.g., Critical US Backorders"
                  className="mt-1 text-xs"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveView(); }}
                />
                <p className="text-[10px] text-muted-foreground mt-1">Min 3 characters</p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
                <p className="font-medium mb-1">Current filters being saved:</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>Type: <span className="text-foreground font-medium">{filters.type || "any"}</span></li>
                  <li>Status: <span className="text-foreground font-medium">{filters.status || "any"}</span></li>
                  <li>Country: <span className="text-foreground font-medium">{filters.country || "any"}</span></li>
                  <li>Priority: <span className="text-foreground font-medium">{filters.priority || "any"}</span></li>
                  <li>Search: <span className="text-foreground font-medium">{filters.q || "none"}</span></li>
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button size="sm" className="h-8 text-xs" onClick={handleSaveView} disabled={newViewName.trim().length < 3}>
                <Save className="h-3 w-3 mr-1" /> Save View
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Main table */}
      {isLoading && !data ? (
        <TableSkeleton rows={10} cols={8} />
      ) : (
        <DataTable<RequirementRow>
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No requirements match the current filters."
          maxHeight="640px"
          onRowClick={(r) => setSelectedId(r.id)}
          rowClassName={(r) => (r.remainingUnplanned > 0 ? "bg-rose-50/40 dark:bg-rose-950/10" : "")}
          exportable
          exportPermission="requirement.export"
          exportFilename={`requirements-page-${page}.csv`}
          excelExportable
          excelExportFilename={`requirements-page-${page}.xlsx`}
          pdfExportable
          pdfExportFilename={`requirements-page-${page}`}
        />
      )}

      {/* Server-side pagination */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3 w-3 mr-1" /> Prev
          </Button>
          <span>
            Page {page} / {totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </div>

      {/* Detail dialog */}
      <Dialog
        open={!!selectedId}
        onOpenChange={(o) => {
          if (!o) {
            setSelectedId(null);
            resetOverrideForm();
          }
        }}
      >
        <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <span>{detail?.requirementCode ?? "Loading…"}</span>
              {detail && <StatusBadge status={detail.status} />}
              {detail && <Badge variant="info">{detail.type.replace(/_/g, " ")}</Badge>}
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              Four confirmed requirement numbers + source records + allocations. Each number drills down to its evidence.
            </DialogDescription>
          </DialogHeader>

          {detailLoading || !detail ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <div className="inline-flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                Loading requirement detail…
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 4 numbers grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <KpiCard
                  label="1 · Physical Shortage"
                  value={detail.fourNumbers.physicalShortage}
                  unit="pcs"
                  intent="critical"
                  hint="MAX(0, RequiredQty − PlanningAvailableQty)"
                />
                <KpiCard
                  label="2 · Pipeline-Adjusted"
                  value={detail.fourNumbers.pipelineAdjusted}
                  unit="pcs"
                  intent="warning"
                  hint="MAX(0, PhysicalShortage − WIP Coverage)"
                />
                <KpiCard
                  label="3 · Planning-Adjusted"
                  value={detail.fourNumbers.planningAdjusted}
                  unit="pcs"
                  intent="info"
                  hint="MAX(0, PipelineAdjusted − ApprovedPlanCoverage)"
                />
                <KpiCard
                  label="4 · Forecast Signal"
                  value={detail.fourNumbers.forecastRequirement}
                  unit="pcs"
                  intent="default"
                  hint="Advisory — NOT confirmed demand"
                />
              </div>

              {/* Requirement Priority Override */}
              <div className="rounded-md border border-border bg-muted/20 p-2.5 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Current Requirement Priority
                    </span>
                    <PriorityBadge value={detail.requirementPriority} />
                    {detail.priorityReason ? (
                      <span
                        className="text-[11px] text-muted-foreground truncate max-w-[320px]"
                        title={detail.priorityReason}
                      >
                        {detail.priorityReason}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/70 italic">
                        no reason recorded
                      </span>
                    )}
                  </div>
                  {!showOverrideForm && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={openOverrideForm}
                    >
                      <Pencil className="h-3 w-3 mr-1" /> Override Priority
                    </Button>
                  )}
                </div>

                {showOverrideForm && (
                  <div className="flex flex-col gap-2 mt-1 pt-2 border-t border-border/60">
                    <InfoBanner variant="warning">
                      Manual override is audit-logged. OPEN rule BR-CUST-PRI-001 — customer
                      priority scoring formula is OPEN; this manual classification is
                      business-owned.
                    </InfoBanner>

                    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-2">
                      <div className="flex flex-col gap-1">
                        <Label
                          htmlFor="override-priority"
                          className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          New Priority
                        </Label>
                        <Select value={newPriority} onValueChange={setNewPriority}>
                          <SelectTrigger id="override-priority" size="sm" className="h-8 text-xs">
                            <SelectValue placeholder="Select priority" />
                          </SelectTrigger>
                          <SelectContent>
                            {PRIORITIES.map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label
                          htmlFor="override-reason"
                          className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        >
                          Reason{" "}
                          <span className="text-rose-600 dark:text-rose-400">*</span>{" "}
                          (min 5 chars, required for audit)
                        </Label>
                        <Textarea
                          id="override-reason"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="e.g. VIP customer escalation per sales director request"
                          className="min-h-[60px] text-xs"
                          aria-invalid={
                            overrideReason.length > 0 && overrideReason.trim().length < 5
                          }
                        />
                        <span className="text-[10px] text-muted-foreground">
                          {overrideReason.trim().length} / 5+ chars
                          {overrideReason.length > 0 &&
                            overrideReason.trim().length < 5 &&
                            " — reason too short"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={resetOverrideForm}
                        disabled={overrideMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        disabled={
                          overrideMutation.isPending ||
                          !newPriority ||
                          overrideReason.trim().length < 5
                        }
                        onClick={applyOverride}
                      >
                        {overrideMutation.isPending ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Applying…
                          </>
                        ) : (
                          "Apply Override"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Quantities breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <DataPair label="Required Qty" value={detail.requiredQty} />
                <DataPair label="Physical Stock" value={detail.physicalStockQty} />
                <DataPair label="Planning Available" value={detail.planningAvailableQty} />
                <DataPair label="Memo Qty" value={detail.memoQty} />
                <DataPair label="Transfer Coverage" value={detail.transferCoverage} />
                <DataPair label="WIP Coverage" value={detail.wipCoverage} />
                <DataPair label="Approved Plan Coverage" value={detail.approvedPlanCoverage} />
                <DataPair label="Actual Coverage" value={detail.actualCoverage} />
              </div>

              {/* Context */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[11px] rounded-md border border-border bg-muted/30 p-2">
                <DataPair label="Customer" value={detail.customerName ?? "—"} />
                <DataPair label="Order #" value={detail.orderNumber ?? "—"} />
                <DataPair label="Country / Branch" value={`${detail.country ?? "—"} / ${detail.branch ?? "—"}`} />
                <DataPair label="Shape" value={detail.shape ?? "—"} />
                <DataPair label="Weight Band" value={detail.weightBand ?? "—"} />
                <DataPair label="Lab" value={detail.lab ?? "—"} />
                <DataPair label="Color / Clarity" value={`${detail.colorGroup ?? "—"} / ${detail.clarityGroup ?? "—"}`} />
                <DataPair label="Treatment" value={detail.treatment ?? "—"} />
                <DataPair label="Required By" value={fmtDate(detail.requiredBy)} />
                <DataPair label="Age / Days Remaining / Days Overdue" value={`${detail.ageDays} / ${detail.daysRemaining ?? "—"} / ${detail.daysOverdue}`} />
                <DataPair label="Customer Priority" value={detail.customerPriority ?? "—"} />
                <DataPair label="Order Priority" value={detail.orderPriority ?? "—"} />
                <DataPair label="Requirement Priority" value={detail.requirementPriority ?? "—"} />
                <DataPair label="Priority Reason" value={detail.priorityReason ?? "—"} />
              </div>

              {/* Allocations */}
              <div className="rounded-md border border-border overflow-hidden">
                <div className="px-2.5 py-1.5 border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Plan Allocations ({detail.allocations.length})
                </div>
                {detail.allocations.length === 0 ? (
                  <div className="px-3 py-3 text-[11px] text-muted-foreground">No allocations yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="bg-muted text-[10px] uppercase text-muted-foreground border-b border-border">
                        <tr>
                          <th className="px-2 py-1 text-left border-r border-border/40">Option Code</th>
                          <th className="px-2 py-1 text-right border-r border-border/40">Allocated Qty</th>
                          <th className="px-2 py-1 text-left border-r border-border/40">By</th>
                          <th className="px-2 py-1 text-left border-r border-border/40">At</th>
                          <th className="px-2 py-1 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.allocations.map((a) => (
                          <tr key={a.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                            <td className="px-2 py-1 font-medium border-r border-border/40">{a.planOptionCode ?? "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-semibold border-r border-border/40">{a.allocatedQty}</td>
                            <td className="px-2 py-1 border-r border-border/40">{a.allocatedBy}</td>
                            <td className="px-2 py-1 border-r border-border/40">{fmtDate(a.allocatedAt)}</td>
                            <td className="px-2 py-1 text-center"><StatusBadge status={a.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Source records */}
              <div className="rounded-md border border-border overflow-hidden">
                <div className="px-2 py-1.5 border-b border-border bg-muted/40 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Source Records (JSON)
                </div>
                <pre className="text-[10px] leading-relaxed p-2 overflow-x-auto max-h-48 bg-muted/20">
                  {JSON.stringify(detail.sourceRecords, null, 2)}
                </pre>
              </div>

              <InfoBanner variant="info">
                Four numbers are computed via deterministic formulas with decimal-safe round-half-up. Each step is auditable.
              </InfoBanner>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DataPair({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
