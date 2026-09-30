"use client";

import { FilterBar } from "@/components/diamond/shared/density";
import { useAuthStore } from "@/stores/auth-store";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { NumberCell, EmptyState, InfoBanner } from "@/components/diamond/shared/empty-state";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNavStore } from "@/stores/nav-store";
import { Filter, X, FileText, Layers, GitBranch, RefreshCw } from "lucide-react";
import { parseValidationWarnings } from "@/lib/domain/validation-warnings";
import { packetTypeLabel, packetTypeName } from "@/lib/domain/packet-type";

interface CaseRow {
  id: string;
  caseCode: string;
  roughId: string;
  fantasyRoughId: string | null;
  stoneName: string | null;
  kapan: string | null;
  packet: string | null;
  signer: string | null;
  originalRoughWeight: number;
  packetType: string;
  planner: string;
  planningDate: string;
  status: string;
  currentVersion: number;
  selectedOptionCode: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  optionCount: number;
  expectedPieces: number;
  expectedYieldPct: number;
  requirementCoveragePct: number;
}

interface CaseDetail {
  id: string;
  caseCode: string;
  rough: {
    id: string;
    fantasyRoughId: string | null;
    kapan: string | null;
    packet: string | null;
    stoneName: string | null;
    signer: string | null;
    packetType: string;
    roughWeight: number;
    country: string | null;
    branch: string | null;
    fantasyStatus: string | null;
    planningEligible: boolean;
    planningStatus: string;
  } | null;
  stoneName: string | null;
  kapan: string | null;
  packet: string | null;
  originalRoughWeight: number;
  packetType: string;
  planner: string;
  planningDate: string;
  status: string;
  currentVersion: number;
  selectedOptionId: string | null;
  sourceFile: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalComment: string | null;
  requirementContext: unknown;
  reservations: Array<{
    id: string;
    status: string;
    reservedBy: string;
    reservedAt: string;
    releasedAt: string | null;
  }>;
  versions: Array<{
    id: string;
    versionNumber: number;
    status: string;
    reason: string | null;
    createdBy: string;
    createdAt: string;
    supersededAt: string | null;
    options: Array<{
      id: string;
      optionCode: string;
      optionNumber: number;
      expectedPieces: number;
      expectedTotalWeight: number;
      yieldPct: number;
      matchingRequiredPieces: number;
      requirementCoverage: number;
      coveragePct: number;
      nonRequiredPieces: number;
      expectedColor: string | null;
      expectedClarity: string | null;
      certificationIntent: string | null;
      potentialExcess: number;
      validationWarnings: string | null;
      selected: boolean;
      selectedBy: string | null;
      selectedAt: string | null;
      approvalStatus: string | null;
      approvedBy: string | null;
      approvedAt: string | null;
      pieces: Array<{
        id: string;
        pieceCode: string;
        sequence: number;
        expectedShape: string | null;
        expectedWeight: number;
        expectedColor: string | null;
        expectedClarity: string | null;
        expectedCategory: string | null;
        certificationIntent: string | null;
        fulfilled: boolean;
        actualPolishedLotId: string | null;
        fantasyChildId: string | null;
      }>;
    }>;
  }>;
}

const STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "SELECTED",
  "APPROVAL_PENDING",
  "APPROVED",
  "REJECTED",
  "REPLAN_REQUIRED",
  "RELEASED_TO_MANUFACTURING",
];
const PACKET_TYPES = ["WHITE", "BLUE"];
const PLANNERS = [
  "planner.alice",
  "planner.bob",
  "planner.carol",
  "planner.dan",
  "planner.eva",
  "planner.frank",
  "system.import",
];
const REPLAN_REASON_MIN = 5;

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

function WarningsCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const parsed = parseValidationWarnings(value);
  if (parsed.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.slice(0, 3).map((w, i) => (
        <Badge key={i} variant="warning">{w}</Badge>
      ))}
      {parsed.length > 3 && (
        <Badge variant="neutral">+{parsed.length - 3}</Badge>
      )}
    </div>
  );
}

export function PlanningCasesView() {
  const setView = useNavStore((s) => s.setView);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [planner, setPlanner] = useState("");
  const [packetType, setPacketType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [replanReason, setReplanReason] = useState("");

  const qs = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`status=${encodeURIComponent(status)}`);
    if (planner) parts.push(`planner=${encodeURIComponent(planner)}`);
    if (packetType) parts.push(`packetType=${encodeURIComponent(packetType)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  }, [status, planner, packetType]);

  const { data, isLoading } = useApi<{ rows: CaseRow[] }>(`/api/planning/cases${qs}`);
  const rows = data?.rows ?? [];

  const { data: detail, isLoading: detailLoading } = useApi<CaseDetail | null>(
    selectedId ? `/api/planning/cases/${selectedId}` : null
  );

  const replanMutation = useMutation({
    mutationFn: async (vars: { caseId: string; reason: string }) =>
      apiPost<{
        id: string;
        caseCode: string;
        status: string;
        currentVersion: number;
        auditLogged: boolean;
      }>(`/api/planning/cases/${vars.caseId}/replan`, {
        reason: vars.reason,
      }),
    onSuccess: (data) => {
      toast.success("Replanning requested. A new version was created.");
      qc.invalidateQueries({ queryKey: ["/api/planning/cases"] });
      qc.invalidateQueries({ queryKey: ["/api/planning/approvals"] });
      qc.invalidateQueries({ queryKey: [`/api/planning/cases/${data.id}`] });
      setReplanOpen(false);
      setReplanReason("");
    },
    onError: (e: unknown) => {
      toast.error(`Replan failed: ${(e as Error).message}`);
    },
  });

  const canReplan = useAuthStore((s) => !!s.user?.permissions.includes("plan.replan"));

  const openReplan = () => {
    if (!detail) return;
    setReplanReason("");
    setReplanOpen(true);
  };

  const cancelReplan = () => {
    setReplanOpen(false);
    setReplanReason("");
  };

  const confirmReplan = () => {
    if (!detail) return;
    const reason = replanReason.trim();
    if (reason.length < REPLAN_REASON_MIN) return;
    replanMutation.mutate({
      caseId: detail.id,
      reason,
    });
  };

  const totalCases = rows.length;
  const approved = rows.filter((r) => r.status === "APPROVED").length;
  const pending = rows.filter((r) =>
    ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING"].includes(r.status)
  ).length;
  const draft = rows.filter((r) => r.status === "DRAFT").length;

  const activeFilters = (status ? 1 : 0) + (planner ? 1 : 0) + (packetType ? 1 : 0);
  const clearFilters = () => {
    setStatus("");
    setPlanner("");
    setPacketType("");
  };

  const columns: Column<CaseRow>[] = [
    {
      key: "caseCode",
      header: "Case Code",
      width: "140px",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.caseCode,
      cell: (r) => <span className="font-medium">{r.caseCode}</span>,
    },
    {
      key: "stoneName",
      header: "Stone Name",
      align: "center",
      width: "150px",
      cell: (r) => r.stoneName ?? "—",
    },
    {
      key: "kapan",
      header: "Kapan",
      align: "center",
      width: "80px",
      cell: (r) => r.kapan ?? "—",
    },
    {
      key: "packet",
      header: "Packet",
      align: "center",
      width: "70px",
      cell: (r) => r.packet ?? "—",
    },
    {
      key: "signer",
      header: "Signer",
      align: "center",
      width: "70px",
      cell: (r) => r.signer ?? "—",
    },
    {
      key: "packetType",
      header: "Packet Type",
      align: "center",
      width: "70px",
      cell: (r) => (
        <Badge variant={r.packetType === "BLUE" ? "info" : "default"}>
          {packetTypeName(r.packetType)}
        </Badge>
      ),
    },
    {
      key: "originalRoughWeight",
      header: "Orig Wt",
      width: "80px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.originalRoughWeight,
      cell: (r) => <span className="tabular-nums">{r.originalRoughWeight.toFixed(3)}</span>,
    },
    {
      key: "planner",
      header: "Planner",
      width: "120px",
      cell: (r) => <span className="text-muted-foreground">{r.planner}</span>,
    },
    {
      key: "planningDate",
      header: "Plan Date",
      align: "center",
      width: "90px",
      sortable: true,
      sortValue: (r) => r.planningDate,
      cell: (r) => fmtDate(r.planningDate),
    },
    {
      key: "status",
      header: "Status",
      align: "center",
      width: "130px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "currentVersion",
      header: "Ver",
      width: "50px",
      align: "right",
      cell: (r) => <NumberCell value={r.currentVersion} />,
    },
    {
      key: "selectedOptionCode",
      header: "Sel Opt",
      align: "center",
      width: "90px",
      cell: (r) => r.selectedOptionCode ?? "—",
    },
    {
      key: "optionCount",
      header: "Opts",
      width: "50px",
      align: "right",
      cell: (r) => <NumberCell value={r.optionCount} />,
    },
    {
      key: "expectedPieces",
      header: "Pieces",
      width: "60px",
      align: "right",
      cell: (r) => <NumberCell value={r.expectedPieces} intent="info" />,
    },
    {
      key: "expectedYieldPct",
      header: "Yield %",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.expectedYieldPct,
      cell: (r) => (
        <span className="tabular-nums">{r.expectedYieldPct.toFixed(2)}%</span>
      ),
    },
    {
      key: "requirementCoveragePct",
      header: "Cov %",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.requirementCoveragePct,
      cell: (r) => (
        <span
          className={
            r.requirementCoveragePct >= 100
              ? "tabular-nums text-emerald-600 dark:text-emerald-400 font-medium"
              : r.requirementCoveragePct > 0
              ? "tabular-nums text-amber-600 dark:text-amber-400"
              : "tabular-nums text-muted-foreground"
          }
        >
          {r.requirementCoveragePct.toFixed(2)}%
        </span>
      ),
    },
  ];

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <PageHeader
        title="Planning Cases"
        subtitle="Planning cases, versions, options and pieces"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {totalCases} cases · {approved} approved · {pending} pending review · {draft} draft
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Cases" value={totalCases} unit="cases" intent="default" onClick={() => setView("planning-cases")} />
        <KpiCard label="Pending Review" value={pending} unit="cases" intent="warning" hint="Ready for review or awaiting approval" onClick={() => setView("planning-approval-queue")} />
        <KpiCard label="Approved" value={approved} unit="cases" intent="success" onClick={() => setView("planning-cases")} />
        <KpiCard label="Draft" value={draft} unit="cases" intent="info" onClick={() => setView("planning-workbench")} />
      </div>

      <FilterBar
        actions={
          activeFilters > 0 ? (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Clear ({activeFilters})
            </button>
          ) : null
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={status || "ALL"} onValueChange={(v) => setStatus(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[200px] text-xs">
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

          <Select value={planner || "ALL"} onValueChange={(v) => setPlanner(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="All Planners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Planners</SelectItem>
              {PLANNERS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={packetType || "ALL"} onValueChange={(v) => setPacketType(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Packet Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Packet Types</SelectItem>
              {PACKET_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {packetTypeLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FilterBar>

      <DataTable<CaseRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No planning cases match the current filters."
        searchable
        searchPlaceholder="Search by case code, stone name, kapan…"
        searchFn={(r, q) => {
          const s = q.toLowerCase();
          return (
            r.caseCode.toLowerCase().includes(s) ||
            (r.stoneName ?? "").toLowerCase().includes(s) ||
            (r.kapan ?? "").toLowerCase().includes(s) ||
            (r.fantasyRoughId ?? "").toLowerCase().includes(s)
          );
        }}
        exportable
        exportPermission="plan.export"
        exportFilename="planning-cases.csv"
        excelExportable
        excelExportFilename="planning-cases.xlsx"
        pdfExportable
        pdfExportFilename="planning-cases"
        pagination
        pageSize={25}
        onRowClick={(r) => setSelectedId(r.id)}
        initialSortKey="planningDate"
        initialSortDir="desc"
      />

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="max-w-3xl sm:max-w-3xl w-full flex flex-col gap-3 overflow-y-auto p-5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {detail?.caseCode ?? "Loading…"}
              {detail && <StatusBadge status={detail.status} />}
              {detail && <Badge variant="info">{packetTypeLabel(detail.packetType)}</Badge>}
            </SheetTitle>
            <SheetDescription className="text-[11px]">
              Versions, options, pieces, reservations and validation warnings.
            </SheetDescription>
          </SheetHeader>

          {detailLoading || !detail ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              <div className="inline-flex items-center gap-2">
                <div className="h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                Loading case detail…
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Replan action bar */}
              <div className="flex flex-col gap-2 rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 text-[11px]">
                    <RefreshCw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    <span className="font-medium text-amber-800 dark:text-amber-200">
                      Plan versioning
                    </span>
                    <span className="text-muted-foreground">Version {detail.currentVersion}</span>
                    <StatusBadge status={detail.status} />
                  </div>
                  {canReplan && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    disabled={replanMutation.isPending}
                    onClick={openReplan}
                    title="Request replanning"
                  >
                    {replanMutation.isPending ? (
                      <div className="h-3 w-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mr-1.5" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Request replanning
                  </Button>
                  )}
                </div>
              </div>

              {/* Rough info */}
              <Section title="Rough" bodyClassName="p-2">
                {detail.rough ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <div><span className="text-muted-foreground">Fantasy ID: </span>{detail.rough.fantasyRoughId ?? "—"}</div>
                    <div><span className="text-muted-foreground">Stone Name: </span>{detail.rough.stoneName ?? "—"}</div>
                    <div><span className="text-muted-foreground">Kapan/Packet: </span>{detail.rough.kapan ?? "—"} / {detail.rough.packet ?? "—"}</div>
                    <div><span className="text-muted-foreground">Signer: </span>{detail.rough.signer ?? "—"}</div>
                    <div><span className="text-muted-foreground">Weight: </span><span className="tabular-nums">{detail.rough.roughWeight.toFixed(3)} ct</span></div>
                    <div><span className="text-muted-foreground">Country/Branch: </span>{detail.rough.country ?? "—"} / {detail.rough.branch ?? "—"}</div>
                    <div><span className="text-muted-foreground">Fantasy Status: </span><Badge variant="neutral">{detail.rough.fantasyStatus ?? "—"}</Badge></div>
                    <div><span className="text-muted-foreground">Planning Status: </span><StatusBadge status={detail.rough.planningStatus} /></div>
                    <div><span className="text-muted-foreground">Eligible: </span>{detail.rough.planningEligible ? <Badge variant="success">YES</Badge> : <Badge variant="critical">NO</Badge>}</div>
                  </div>
                ) : (
                  <EmptyState title="Rough not linked" message="This case is not bound to a rough stone." />
                )}
              </Section>

              {/* Case header */}
              <Section title="Case Header" bodyClassName="p-2">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div><span className="text-muted-foreground">Case Code: </span>{detail.caseCode}</div>
                  <div><span className="text-muted-foreground">Planner: </span>{detail.planner}</div>
                  <div><span className="text-muted-foreground">Planning Date: </span>{fmtDate(detail.planningDate)}</div>
                  <div><span className="text-muted-foreground">Current Version: </span>{detail.currentVersion}</div>
                  <div><span className="text-muted-foreground">Source File: </span>{detail.sourceFile ?? "—"}</div>
                  <div><span className="text-muted-foreground">Original Wt: </span><span className="tabular-nums">{detail.originalRoughWeight.toFixed(3)} ct</span></div>
                  <div><span className="text-muted-foreground">Approved By: </span>{detail.approvedBy ?? "—"}</div>
                  <div><span className="text-muted-foreground">Approved At: </span>{fmtDate(detail.approvedAt)}</div>
                </div>
              </Section>

              {/* Reservations */}
              <Section title={`Reservations (${detail.reservations.length})`} bodyClassName="p-2">
                {detail.reservations.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">No reservations.</p>
                ) : (
                  <div className="overflow-x-auto rounded border border-border">
                    <table className="w-full text-[11px] border-collapse">
                      <thead className="text-[10px] uppercase text-muted-foreground bg-muted border-b border-border">
                        <tr>
                          <th className="px-2 py-1 text-left border-r border-border/40">By</th>
                          <th className="px-2 py-1 text-center border-r border-border/40">Status</th>
                          <th className="px-2 py-1 text-left border-r border-border/40">Reserved At</th>
                          <th className="px-2 py-1 text-left">Released At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.reservations.map((r) => (
                          <tr key={r.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                            <td className="px-2 py-1 border-r border-border/40">{r.reservedBy}</td>
                            <td className="px-2 py-1 text-center border-r border-border/40"><StatusBadge status={r.status} /></td>
                            <td className="px-2 py-1 border-r border-border/40">{fmtDate(r.reservedAt)}</td>
                            <td className="px-2 py-1">{fmtDate(r.releasedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>

              {/* Versions */}
              <Section
                title={`Versions (${detail.versions.length})`}
                bodyClassName="p-2"
              >
                <div className="flex flex-col gap-3">
                  {detail.versions.map((v) => (
                    <div key={v.id} className="rounded-md border border-border p-2 bg-muted/20">
                      <div className="flex items-center gap-2 mb-2">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[11px] font-medium">v{v.versionNumber}</span>
                        <StatusBadge status={v.status} />
                        <span className="text-[10px] text-muted-foreground">by {v.createdBy} · {fmtDate(v.createdAt)}</span>
                        {v.reason && <span className="text-[10px] text-muted-foreground">· {v.reason}</span>}
                      </div>

                      <div className="flex flex-col gap-2">
                        {v.options.map((o) => (
                          <div key={o.id} className={`rounded-md border p-2 ${o.selected ? "border-sky-300 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/30" : "border-border bg-card"}`}>
                            <div className="flex items-center gap-2 mb-1">
                              <Layers className="h-3 w-3 text-muted-foreground" />
                              <span className="text-[11px] font-medium">{o.optionCode}</span>
                              {o.selected && <Badge variant="info">SELECTED</Badge>}
                              {o.approvalStatus && <StatusBadge status={o.approvalStatus} />}
                              <span className="ml-auto text-[10px] text-muted-foreground">{o.pieces.length} pieces</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1 text-[10px]">
                              <div><span className="text-muted-foreground">Pieces: </span><span className="tabular-nums font-medium">{o.expectedPieces}</span></div>
                              <div><span className="text-muted-foreground">Wt: </span><span className="tabular-nums">{o.expectedTotalWeight.toFixed(3)}</span></div>
                              <div><span className="text-muted-foreground">Yield: </span><span className="tabular-nums">{o.yieldPct.toFixed(2)}%</span></div>
                              <div><span className="text-muted-foreground">Coverage: </span><span className="tabular-nums">{o.coveragePct.toFixed(2)}%</span></div>
                              <div><span className="text-muted-foreground">Match Req: </span><span className="tabular-nums">{o.matchingRequiredPieces}</span></div>
                              <div><span className="text-muted-foreground">Non-Req: </span><span className="tabular-nums">{o.nonRequiredPieces}</span></div>
                              <div><span className="text-muted-foreground">Excess: </span><span className="tabular-nums">{o.potentialExcess}</span></div>
                              <div><span className="text-muted-foreground">Color/Clarity: </span>{o.expectedColor ?? "—"} / {o.expectedClarity ?? "—"}</div>
                            </div>

                            {o.validationWarnings && (
                              <div className="mt-2 rounded border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-1.5">
                                <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mb-1">Validation Warnings</div>
                                <WarningsCell value={o.validationWarnings} />
                              </div>
                            )}

                            {/* Pieces list */}
                            <div className="mt-2 max-h-36 overflow-y-auto rounded border border-border bg-background">
                              <table className="w-full text-[10px] border-collapse">
                                <thead className="text-[9px] uppercase text-muted-foreground bg-muted sticky top-0 border-b border-border">
                                  <tr>
                                    <th className="px-1.5 py-0.5 text-center border-r border-border/40">Seq</th>
                                    <th className="px-1.5 py-0.5 text-left border-r border-border/40">Piece Code</th>
                                    <th className="px-1.5 py-0.5 text-left border-r border-border/40">Shape</th>
                                    <th className="px-1.5 py-0.5 text-right border-r border-border/40">Wt</th>
                                    <th className="px-1.5 py-0.5 text-left border-r border-border/40">Color/Clarity</th>
                                    <th className="px-1.5 py-0.5 text-left">Cat</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.pieces.map((p) => (
                                    <tr key={p.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                                      <td className="px-1.5 py-0.5 text-center tabular-nums border-r border-border/40">{p.sequence}</td>
                                      <td className="px-1.5 py-0.5 font-mono border-r border-border/40">{p.pieceCode}</td>
                                      <td className="px-1.5 py-0.5 border-r border-border/40">{p.expectedShape ?? "—"}</td>
                                      <td className="px-1.5 py-0.5 text-right tabular-nums font-medium border-r border-border/40">{p.expectedWeight.toFixed(3)}</td>
                                      <td className="px-1.5 py-0.5 border-r border-border/40">{p.expectedColor ?? "—"} / {p.expectedClarity ?? "—"}</td>
                                      <td className="px-1.5 py-0.5">{p.expectedCategory ?? "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Replan Dialog */}
      <Dialog
        open={replanOpen}
        onOpenChange={(o) => {
          if (!o) cancelReplan();
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Request replanning
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {detail && (
                <span>
                  Case <span className="font-medium text-foreground">{detail.caseCode}</span>
                  {" · "}{packetTypeLabel(detail.packetType)}
                  {" · "}v{detail.currentVersion}
                  {" · "}<StatusBadge status={detail.status} />
                  <br />
                </span>
              )}
              Replanning creates a new version and preserves the previous one.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="replan-reason" className="text-xs">
              Reason <span className="text-rose-600">*</span>
            </Label>
            <Textarea
              id="replan-reason"
              value={replanReason}
              onChange={(e) => setReplanReason(e.target.value)}
              placeholder="e.g., Actual output missed target category; yield below threshold"
              rows={4}
              className="text-xs resize-none"
              autoFocus
            />
            {replanReason.length > 0 && replanReason.trim().length < REPLAN_REASON_MIN && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">Enter at least {REPLAN_REASON_MIN} characters.</span>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={cancelReplan}
              disabled={replanMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs text-amber-700 dark:text-amber-200 bg-amber-500 hover:bg-amber-600 dark:bg-amber-700 dark:hover:bg-amber-600 border-amber-500 dark:border-amber-700"
              onClick={confirmReplan}
              disabled={
                replanMutation.isPending ||
                replanReason.trim().length < REPLAN_REASON_MIN
              }
            >
              {replanMutation.isPending ? (
                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Confirm Replan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
