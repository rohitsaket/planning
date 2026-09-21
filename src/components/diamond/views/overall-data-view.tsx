"use client";

import { useState } from "react";
import { useApi, apiFetch } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge, Pill } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  HardDrive,
  Download,
  History,
  Search,
  FlaskConical,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Boxes,
  Gem,
  Building,
  MapPin,
  Tag,
} from "lucide-react";
import { toast } from "sonner";

interface OverallLotItem {
  id: string;
  lotId: string;
  sourceRecordId?: string | null;
  sourceType: string;
  entityType: string;
  currentStatus: string;
  previousStatus: string | null;
  statusEffectiveDateIST: string;
  docDateIST: string;
  quantity: number;
  shape: string;
  shapeNormalized: string;
  weight: number;
  color: string | null;
  clarity: string | null;
  labNormalized: string | null;
  certificate: string | null;
  treatment: string | null;
  saleTotalUsd: number | null;
  customerCode: string | null;
  customerName: string | null;
  departmentName: string | null;
  locationName: string | null;
  country: string;
  branch: string;
  roughOrPolished: string;
  wipStage: string | null;
  parentRoughId: string | null;
  kapan: string | null;
  stoneName: string | null;
  isCurrent: boolean;
  removalReason: string | null;
  removedFromLiveAtIST: string;
  firstSeenAtIST: string;
  lastSeenAtIST: string;
  currentVersion: number;
  versionCount: number;
  lastSyncBatchId: string;
  checkpoint: number;
  isSimulated: boolean;
}

interface OverallDataResponse {
  sourceMode: string;
  isSimulated: boolean;
  summary: {
    total: number;
    active: number;
    historical: number;
    sold: number;
    removedUnknown: number;
  };
  rows: OverallLotItem[];
}

interface LotTimelineResponse {
  sourceMode: string;
  isSimulated: boolean;
  lot: OverallLotItem;
  timeline: Array<{
    id: string;
    version: number;
    status: string;
    docDateIST: string;
    statusEffectiveDateIST: string;
    shape: string;
    weight: number;
    color: string | null;
    clarity: string | null;
    labNormalized: string | null;
    saleTotalUsd: number | null;
    customerName: string | null;
    departmentName: string | null;
    locationName: string | null;
    country: string;
    branch: string;
    wipStage: string | null;
    isCurrent: boolean;
    removalReason: string | null;
    changeReason: string | null;
    syncBatchId: string;
    checkpoint: number;
    isSimulated: boolean;
    recordedAtIST: string;
  }>;
}

export function OverallDataView() {
  const [filterMode, setFilterMode] = useState<"all" | "current" | "historical">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);

  const queryUrl = `/api/fantasy/overall?isCurrent=${
    filterMode === "current" ? "true" : filterMode === "historical" ? "false" : "all"
  }${searchQuery.trim() ? `&q=${encodeURIComponent(searchQuery.trim())}` : ""}`;

  const { data, isLoading, refetch } = useApi<OverallDataResponse>(queryUrl);
  const { data: detailData, isLoading: detailLoading } = useApi<LotTimelineResponse>(
    selectedLotId ? `/api/fantasy/overall/${encodeURIComponent(selectedLotId)}` : null
  );

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  const handleExport = async () => {
    try {
      window.open(
        `/api/fantasy/overall/export?isCurrent=${
          filterMode === "current" ? "true" : filterMode === "historical" ? "false" : "all"
        }`,
        "_blank"
      );
      toast.success("Export initiated", { description: "Overall Data CSV export download started." });
    } catch {
      toast.error("Export failed", { description: "Failed to download Overall Data export." });
    }
  };

  const columns: Column<OverallLotItem>[] = [
    {
      key: "lotId",
      header: "Lot ID",
      sortable: true,
      sortValue: (r) => r.lotId,
      cell: (r) => (
        <button
          type="button"
          onClick={() => setSelectedLotId(r.lotId)}
          className="font-medium text-primary hover:underline flex items-center gap-1.5 text-left"
        >
          <HardDrive className="h-3 w-3 text-muted-foreground" />
          <span>{r.lotId}</span>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      sortable: true,
      sortValue: (r) => r.currentStatus,
      cell: (r) => (
        <div className="flex items-center justify-center gap-1.5">
          <StatusBadge status={r.currentStatus} />
          {r.isCurrent ? (
            <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
              Live
            </span>
          ) : (
            <span className="text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground font-medium">
              Archived
            </span>
          )}
        </div>
      ),
    },
    {
      key: "spec",
      header: "Shape / Weight",
      sortable: true,
      sortValue: (r) => r.weight,
      cell: (r) => (
        <div className="flex flex-col text-xs">
          <span className="font-medium">{r.shapeNormalized}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">{r.weight} ct</span>
        </div>
      ),
    },
    {
      key: "grading",
      header: "Color / Clarity / Lab",
      cell: (r) => (
        <div className="text-xs text-muted-foreground">
          {r.color || "—"} / {r.clarity || "—"} · <span className="text-foreground">{r.labNormalized || "—"}</span>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location / Dept",
      cell: (r) => (
        <div className="flex flex-col text-xs">
          <span className="truncate max-w-[140px]">{r.locationName || r.branch}</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">{r.departmentName || r.country}</span>
        </div>
      ),
    },
    {
      key: "commercial",
      header: "Customer / Value",
      cell: (r) => (
        <div className="flex flex-col text-xs">
          <span className="truncate max-w-[140px]">{r.customerName || "—"}</span>
          {r.saleTotalUsd ? (
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
              ${r.saleTotalUsd.toLocaleString()}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: "removalReason",
      header: "Removal / Disappearance",
      align: "center",
      cell: (r) => {
        if (r.isCurrent) return <span className="text-xs text-muted-foreground">—</span>;
        if (r.removalReason === "SOURCE_DISAPPEARANCE_UNKNOWN") {
          return (
            <Pill className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" /> Disappeared (Unknown)
            </Pill>
          );
        }
        if (r.removalReason === "EXPLICIT_SALE") {
          return (
            <Pill className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px]">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Explicit Sale
            </Pill>
          );
        }
        return (
          <span className="text-xs text-muted-foreground font-mono">
            {r.removalReason || "REMOVED"}
          </span>
        );
      },
    },
    {
      key: "versions",
      header: "Versions",
      align: "center",
      sortable: true,
      sortValue: (r) => r.versionCount,
      cell: (r) => (
        <button
          type="button"
          onClick={() => setSelectedLotId(r.lotId)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted/70 hover:bg-muted text-foreground transition-colors"
        >
          <History className="h-3 w-3 text-muted-foreground" />
          <span>v{r.currentVersion} ({r.versionCount})</span>
        </button>
      ),
    },
    {
      key: "lastSeen",
      header: "Last Seen (IST)",
      sortable: true,
      sortValue: (r) => r.lastSeenAtIST,
      cell: (r) => <span className="text-xs text-muted-foreground">{r.lastSeenAtIST}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Overall Data"
        subtitle="Authoritative permanent current and historical Lot records retained across all Fantasy sync batches"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> Export Historical Archive (CSV)
            </Button>
          </div>
        }
      />

      {/* Prominent Simulation Banner */}
      <InfoBanner variant="warning">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div>
            <strong className="font-semibold text-amber-700 dark:text-amber-300">SIMULATION MODE:</strong>{" "}
            <span>
              Overall Data is currently populated via deterministic Fantasy fixture synchronization batches. Historical states,
              explicit sales, and unknown feed disappearances are preserved permanently with mathematical audit lineage.
            </span>
          </div>
        </div>
      </InfoBanner>

      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <KpiCard
          label="Total Lots Retained"
          value={summary?.total ?? 0}
          intent="default"
          hint="All lots ever synchronized"
        />
        <KpiCard
          label="Active Live Stock"
          value={summary?.active ?? 0}
          intent="success"
          hint="Currently in physical/memo stock"
        />
        <KpiCard
          label="Historical / Archived"
          value={summary?.historical ?? 0}
          intent="info"
          hint="Sold, transferred, or completed"
        />
        <KpiCard
          label="Explicit Invoiced Sales"
          value={summary?.sold ?? 0}
          intent="success"
          hint="Confirmed invoice sale events"
        />
        <KpiCard
          label="Unknown Feed Disappearances"
          value={summary?.removedUnknown ?? 0}
          intent={summary && summary.removedUnknown > 0 ? "warning" : "default"}
          hint="Disappeared without sale invoice"
        />
      </div>

      {/* Table & Filtering Section */}
      <Section title="Master Lot Repository" description="Permanent searchable record index with complete immutable version histories">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 bg-muted/40 p-1 rounded-md border border-border">
            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`px-3 py-1 text-xs rounded-sm font-medium transition-colors ${
                filterMode === "all" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Lots ({summary?.total ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("current")}
              className={`px-3 py-1 text-xs rounded-sm font-medium transition-colors ${
                filterMode === "current" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Live Current ({summary?.active ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("historical")}
              className={`px-3 py-1 text-xs rounded-sm font-medium transition-colors ${
                filterMode === "historical" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Historical Only ({summary?.historical ?? 0})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Lot ID, Certificate, Customer..."
              className="h-8 pl-8 text-xs bg-muted/40 border-border/70"
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No lot records found matching the selected filters."
          maxHeight="540px"
          initialSortKey="lotId"
          initialSortDir="asc"
        />
      </Section>

      {/* Historical Timeline Drawer / Dialog */}
      <Dialog open={!!selectedLotId} onOpenChange={(open) => !open && setSelectedLotId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-5 w-5 text-primary" />
              <span>Lot History & State Timeline: {selectedLotId}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Complete chronological audit trail of state changes, location transfers, and synchronization checkpoints.
            </DialogDescription>
          </DialogHeader>

          {detailLoading && (
            <div className="p-8 text-center text-xs text-muted-foreground">Loading historical timeline...</div>
          )}

          {detailData && (
            <div className="space-y-4 pt-2">
              {/* Current Master Summary Box */}
              <div className="rounded-lg border border-border bg-card p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-foreground">{detailData.lot.lotId}</span>
                    <StatusBadge status={detailData.lot.currentStatus} />
                    {detailData.lot.isCurrent ? (
                      <Badge variant="success">Active Live</Badge>
                    ) : (
                      <Badge variant="neutral">Historical Record</Badge>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Batch: {detailData.lot.lastSyncBatchId}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/50 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">Shape & Weight:</span>{" "}
                    <strong>{detailData.lot.shapeNormalized} {detailData.lot.weight}ct</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Color / Clarity:</span>{" "}
                    <strong>{detailData.lot.color || "—"} / {detailData.lot.clarity || "—"}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Lab Certificate:</span>{" "}
                    <strong>{detailData.lot.labNormalized || "—"} {detailData.lot.certificate || ""}</strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Current Version:</span>{" "}
                    <strong>v{detailData.lot.currentVersion}</strong>
                  </div>
                  {detailData.lot.sourceRecordId && (
                    <div>
                      <span className="text-muted-foreground">Source Rec ID:</span>{" "}
                      <strong className="font-mono">{detailData.lot.sourceRecordId}</strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Version Timeline */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  State Mutation History ({detailData.timeline.length} versions)
                </h4>

                <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {detailData.timeline.map((item) => (
                    <div key={item.id} className="relative group">
                      <div className="absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-primary bg-background group-hover:bg-primary transition-colors" />
                      <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <strong className="font-semibold text-foreground">Version {item.version}</strong>
                            <StatusBadge status={item.status} />
                            <span className="text-[10px] text-muted-foreground">({item.changeReason || "SYNC_UPDATE"})</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground">{item.recordedAtIST}</span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground pt-1">
                          <div>
                            <span>Effective Date:</span> <strong className="text-foreground">{item.statusEffectiveDateIST}</strong>
                          </div>
                          <div>
                            <span>Location:</span> <strong className="text-foreground">{item.locationName || item.branch}</strong>
                          </div>
                          <div>
                            <span>Department:</span> <strong className="text-foreground">{item.departmentName || item.country}</strong>
                          </div>
                          {item.customerName && (
                            <div>
                              <span>Customer:</span> <strong className="text-foreground">{item.customerName}</strong>
                            </div>
                          )}
                          {item.saleTotalUsd && (
                            <div>
                              <span>Sale Total:</span> <strong className="text-emerald-600 dark:text-emerald-400">${item.saleTotalUsd.toLocaleString()}</strong>
                            </div>
                          )}
                          {item.removalReason && (
                            <div>
                              <span>Removal Reason:</span> <strong className="text-amber-600 dark:text-amber-400">{item.removalReason}</strong>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
