"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { NumberCell, EmptyState, Metric } from "@/components/diamond/shared/empty-state";
import { useNavStore } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import {
  ListOrdered,
  Gem,
  Layers,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { TableSkeleton } from "@/components/diamond/shared/skeleton";

interface QueueRow {
  id: string;
  requirementCode: string;
  type: string;
  customerName: string | null;
  country: string | null;
  branch: string | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  requiredQty: number;
  remainingUnplanned: number;
  requiredBy: string | null;
  requirementPriority: string | null;
  priorityReason: string | null;
}

interface RoughRow {
  id: string;
  fantasyRoughId: string | null;
  kapan: string | null;
  packet: string | null;
  stoneName: string | null;
  signer: string | null;
  stoneType: string | null;
  roughWeight: number;
  country: string | null;
  branch: string | null;
  fantasyStatus: string | null;
  planningEligible: boolean;
}

interface PlanOption {
  id: string;
  optionCode: string;
  optionNumber: number;
  expectedPieces: number;
  expectedTotalWeight: number;
  yieldPct: number;
  matchingRequiredPieces: number;
  requirementCoverage: number;
  coveragePct: number;
  potentialExcess: number;
  validationWarnings: string | null;
  selected: boolean;
  approvalStatus: string | null;
  pieces: Array<{
    pieceCode: string;
    expectedShape: string | null;
    expectedWeight: number;
    expectedCategory: string | null;
  }>;
}

interface PlanCase {
  id: string;
  caseCode: string;
  status: string;
  planner: string;
  planningDate: string;
  options: PlanOption[];
}

interface WorkbenchResponse {
  leftQueue: QueueRow[];
  centerRough: RoughRow[];
  rightPlan: PlanCase[] | null;
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

function WarningsCell({ value }: { value: string | null }) {
  if (!value) return null;
  let parsed: string[] = [];
  try {
    const j = JSON.parse(value);
    if (Array.isArray(j)) parsed = j.map((s) => String(s));
    else if (typeof j === "string") parsed = [j];
    else parsed = [JSON.stringify(j)];
  } catch {
    parsed = [value];
  }
  if (parsed.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.map((w, i) => (
        <Badge key={i} variant="warning">{w}</Badge>
      ))}
    </div>
  );
}

export function PlanningWorkbenchView() {
  const setView = useNavStore((s) => s.setView);
  const [selectedRoughId, setSelectedRoughId] = useState<string | null>(null);

  const url = useMemo(
    () => `/api/planning/workbench${selectedRoughId ? `?roughId=${encodeURIComponent(selectedRoughId)}` : ""}`,
    [selectedRoughId]
  );
  const { data, isLoading } = useApi<WorkbenchResponse>(url);

  const leftQueue = data?.leftQueue ?? [];
  const centerRough = data?.centerRough ?? [];
  const rightPlan = data?.rightPlan ?? null;
  const selectedRough = centerRough.find((r) => r.id === selectedRoughId) ?? null;

  // Columns for left queue (compact)
  const queueCols: Column<QueueRow>[] = [
    {
      key: "requirementCode",
      header: "Req",
      width: "100px",
      sticky: "left",
      cell: (r) => <span className="font-medium">{r.requirementCode}</span>,
    },
    {
      key: "shape",
      header: "Shape",
      width: "70px",
      cell: (r) => r.shape ?? "—",
    },
    {
      key: "weightBand",
      header: "Band",
      width: "90px",
      cell: (r) => <span className="text-[10px]">{r.weightBand ?? "—"}</span>,
    },
    {
      key: "customerName",
      header: "Customer",
      width: "120px",
      cell: (r) => <span className="truncate">{r.customerName ?? "—"}</span>,
    },
    {
      key: "remainingUnplanned",
      header: "Rem",
      width: "60px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.remainingUnplanned,
      cell: (r) => <NumberCell value={r.remainingUnplanned} intent="critical" />,
    },
    {
      key: "requirementPriority",
      header: "Pri",
      align: "center",
      width: "70px",
      cell: (r) => <Badge variant={r.requirementPriority === "CRITICAL" ? "critical" : r.requirementPriority === "HIGH" ? "high" : "default"}>{r.requirementPriority ?? "—"}</Badge>,
    },
  ];

  const roughCols: Column<RoughRow>[] = [
    {
      key: "stoneName",
      header: "Stone",
      width: "120px",
      sticky: "left",
      cell: (r) => <span className="font-medium truncate">{r.stoneName ?? "—"}</span>,
    },
    {
      key: "kapan",
      header: "Kapan",
      align: "center",
      width: "70px",
      cell: (r) => r.kapan ?? "—",
    },
    {
      key: "packet",
      header: "Pkt",
      align: "center",
      width: "60px",
      cell: (r) => r.packet ?? "—",
    },
    {
      key: "stoneType",
      header: "Type",
      align: "center",
      width: "60px",
      cell: (r) => (
        <Badge variant={r.stoneType === "BLUE" ? "info" : "default"}>{r.stoneType ?? "—"}</Badge>
      ),
    },
    {
      key: "roughWeight",
      header: "Wt",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.roughWeight,
      cell: (r) => <span className="tabular-nums">{r.roughWeight.toFixed(3)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Planning Workbench"
        subtitle="Three-panel layout · LEFT priority queue · CENTER available rough · RIGHT plan possibilities"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {leftQueue.length} priority requirements · {centerRough.length} available roughs ·{" "}
            {selectedRough ? `selected: ${selectedRough.stoneName}` : "no rough selected"}
          </span>
        }
      />

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            <ListOrdered className="h-3 w-3" /> LEFT — Queue Size
          </div>
          <div className="text-xl font-semibold tabular-nums">{leftQueue.length}</div>
          <p className="text-[10px] text-muted-foreground">Top 25 by priority & remaining</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            <Gem className="h-3 w-3" /> CENTER — Available Rough
          </div>
          <div className="text-xl font-semibold tabular-nums">{centerRough.length}</div>
          <p className="text-[10px] text-muted-foreground">Top 20 eligible AVAILABLE</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            <Layers className="h-3 w-3" /> RIGHT — Plan Cases
          </div>
          <div className="text-xl font-semibold tabular-nums">{rightPlan?.length ?? 0}</div>
          <p className="text-[10px] text-muted-foreground">Cases for selected rough</p>
        </div>
        <div className="rounded-md border border-border bg-card p-3">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            <ArrowRight className="h-3 w-3" /> Actions
          </div>
          <button
            onClick={() => setView("planning-reservations")}
            className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
          >
            Reserve a rough →
          </button>
        </div>
      </div>

      {/* Three-panel grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* LEFT panel */}
        <Section
          title="LEFT · Priority Requirement Queue"
          description="Top 25 by priority + remaining unplanned"
          bodyClassName="p-2"
          className="flex flex-col"
        >
          <div className="max-h-[600px] overflow-y-auto">
            {isLoading && !data ? (
              <TableSkeleton rows={5} cols={4} />
            ) : (
              <DataTable<QueueRow>
                columns={queueCols}
                rows={leftQueue}
                loading={isLoading}
                emptyMessage="No open requirements."
                maxHeight="560px"
                onRowClick={() => setView("requirements-matrix")}
                rowClassName={(r) =>
                  r.requirementPriority === "CRITICAL"
                    ? "bg-rose-50/40 dark:bg-rose-950/10"
                    : r.requirementPriority === "HIGH"
                    ? "bg-amber-50/40 dark:bg-amber-950/10"
                    : ""
                }
              />
            )}
          </div>
        </Section>

        {/* CENTER panel */}
        <Section
          title="CENTER · Available Rough"
          description="Top 20 AVAILABLE planning-eligible roughs · click to load plan possibilities"
          bodyClassName="p-2"
        >
          <div className="max-h-[600px] overflow-y-auto">
            {isLoading && !data ? (
              <TableSkeleton rows={5} cols={4} />
            ) : (
              <DataTable<RoughRow>
                columns={roughCols}
                rows={centerRough}
                loading={isLoading}
                emptyMessage="No available roughs."
                maxHeight="560px"
                onRowClick={(r) => setSelectedRoughId(r.id)}
                rowClassName={(r) =>
                  r.id === selectedRoughId
                    ? "bg-sky-100 dark:bg-sky-950/40 ring-1 ring-inset ring-sky-400"
                    : ""
                }
              />
            )}
          </div>
        </Section>

        {/* RIGHT panel */}
        <Section
          title="RIGHT · Plan Possibilities"
          description={
            selectedRough
              ? `${selectedRough.stoneName ?? selectedRough.fantasyRoughId ?? "—"} · ${selectedRough.roughWeight.toFixed(3)} ct`
              : "Select a rough from the center panel"
          }
          bodyClassName="p-2"
        >
          <div className="max-h-[600px] overflow-y-auto">
            {isLoading && !data ? (
              <TableSkeleton rows={5} cols={4} />
            ) : !selectedRoughId ? (
              <EmptyState
                title="No rough selected"
                message="Click a row in the center panel to load its plan possibilities."
                icon={<Gem className="h-5 w-5" />}
              />
            ) : !rightPlan || rightPlan.length === 0 ? (
              <EmptyState
                title="No plan cases for this rough"
                message="Import a workbook for this rough to seed plan cases & options."
                icon={<AlertTriangle className="h-5 w-5" />}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {rightPlan.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-2 bg-card">
                    {/* Case header */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-[11px] font-semibold">{c.caseCode}</span>
                      <StatusBadge status={c.status} />
                      <span className="text-[10px] text-muted-foreground">planner: {c.planner}</span>
                      <span className="text-[10px] text-muted-foreground">· {fmtDate(c.planningDate)}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">{c.options.length} option(s)</span>
                    </div>

                    {/* Options list */}
                    <div className="flex flex-col gap-1.5">
                      {c.options.map((o) => (
                        <div
                          key={o.id}
                          className={cn(
                            "rounded border p-2 text-[10px]",
                            o.selected
                              ? "border-sky-300 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/30"
                              : "border-border bg-muted/20"
                          )}
                        >
                          <div className="flex items-center gap-1 mb-1 flex-wrap">
                            <span className="font-medium text-[11px]">{o.optionCode}</span>
                            {o.selected && <Badge variant="info">SELECTED</Badge>}
                            {o.approvalStatus && <StatusBadge status={o.approvalStatus} />}
                          </div>

                          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                            <Metric label="Pieces" value={o.expectedPieces} intent="info" />
                            <Metric label="Total Wt" value={`${o.expectedTotalWeight.toFixed(3)}`} />
                            <Metric label="Yield %" value={`${o.yieldPct.toFixed(2)}%`} intent={o.yieldPct >= 35 ? "success" : "warning"} />
                            <Metric label="Cov %" value={`${o.coveragePct.toFixed(2)}%`} intent={o.coveragePct >= 100 ? "success" : "warning"} />
                            <Metric label="Match Req" value={o.matchingRequiredPieces} />
                            <Metric label="Excess" value={o.potentialExcess} intent={o.potentialExcess > 0 ? "warning" : "success"} />
                          </div>

                          {o.validationWarnings && (
                            <div className="mt-1.5">
                              <WarningsCell value={o.validationWarnings} />
                            </div>
                          )}

                          {/* Pieces list */}
                          {o.pieces.length > 0 && (
                            <div className="mt-1.5 rounded border border-border bg-background/60 overflow-hidden">
                              <div className="text-[9px] uppercase tracking-wide font-semibold text-muted-foreground bg-muted px-2 py-0.5 border-b border-border">
                                Pieces Breakdown ({o.pieces.length})
                              </div>
                              <table className="w-full text-[10px] border-collapse">
                                <thead className="bg-muted/40 text-[9px] uppercase text-muted-foreground border-b border-border/50">
                                  <tr>
                                    <th className="px-1.5 py-0.5 text-left border-r border-border/40">Code</th>
                                    <th className="px-1.5 py-0.5 text-left border-r border-border/40">Shape</th>
                                    <th className="px-1.5 py-0.5 text-right border-r border-border/40">Weight</th>
                                    <th className="px-1.5 py-0.5 text-left">Category</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.pieces.slice(0, 6).map((p, i) => (
                                    <tr key={i} className="border-b border-border/30 last:border-b-0 hover:bg-muted/30">
                                      <td className="px-1.5 py-0.5 font-mono border-r border-border/40">{p.pieceCode}</td>
                                      <td className="px-1.5 py-0.5 border-r border-border/40">{p.expectedShape ?? "—"}</td>
                                      <td className="px-1.5 py-0.5 text-right tabular-nums font-medium border-r border-border/40">{p.expectedWeight.toFixed(3)}</td>
                                      <td className="px-1.5 py-0.5 text-muted-foreground">{p.expectedCategory ?? "—"}</td>
                                    </tr>
                                  ))}
                                  {o.pieces.length > 6 && (
                                    <tr className="border-t border-border/30 bg-muted/10">
                                      <td colSpan={4} className="px-1.5 py-0.5 text-muted-foreground text-center">
                                        +{o.pieces.length - 6} more…
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <CheckCircle2 className="h-3 w-3" />
        Click a rough in the CENTER panel to populate the RIGHT panel with all draft / pending plan cases & their options.
      </div>
    </div>
  );
}
