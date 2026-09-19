"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { NumberCell, EmptyState } from "@/components/diamond/shared/empty-state";
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
import { useNavStore } from "@/stores/nav-store";
import { Filter, X, FileText, Layers, GitBranch } from "lucide-react";

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
  stoneType: string;
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
    stoneType: string;
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
  stoneType: string;
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
const STONE_TYPES = ["WHITE", "BLUE"];
const PLANNERS = [
  "planner.alice",
  "planner.bob",
  "planner.carol",
  "planner.dan",
  "planner.eva",
  "planner.frank",
  "system.import",
];

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
  let parsed: string[] = [];
  try {
    const j = JSON.parse(value);
    if (Array.isArray(j)) parsed = j.map((s) => String(s));
    else if (typeof j === "string") parsed = [j];
    else parsed = [JSON.stringify(j)];
  } catch {
    parsed = [value];
  }
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
  const [status, setStatus] = useState("");
  const [planner, setPlanner] = useState("");
  const [stoneType, setStoneType] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const qs = useMemo(() => {
    const parts: string[] = [];
    if (status) parts.push(`status=${encodeURIComponent(status)}`);
    if (planner) parts.push(`planner=${encodeURIComponent(planner)}`);
    if (stoneType) parts.push(`stoneType=${encodeURIComponent(stoneType)}`);
    return parts.length ? `?${parts.join("&")}` : "";
  }, [status, planner, stoneType]);

  const { data, isLoading } = useApi<{ rows: CaseRow[] }>(`/api/planning/cases${qs}`);
  const rows = data?.rows ?? [];

  const { data: detail, isLoading: detailLoading } = useApi<CaseDetail | null>(
    selectedId ? `/api/planning/cases/${selectedId}` : null
  );

  const totalCases = rows.length;
  const approved = rows.filter((r) => r.status === "APPROVED").length;
  const pending = rows.filter((r) =>
    ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING"].includes(r.status)
  ).length;
  const draft = rows.filter((r) => r.status === "DRAFT").length;

  const activeFilters = (status ? 1 : 0) + (planner ? 1 : 0) + (stoneType ? 1 : 0);
  const clearFilters = () => {
    setStatus("");
    setPlanner("");
    setStoneType("");
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
      width: "150px",
      cell: (r) => r.stoneName ?? "—",
    },
    {
      key: "kapan",
      header: "Kapan",
      width: "80px",
      cell: (r) => r.kapan ?? "—",
    },
    {
      key: "packet",
      header: "Packet",
      width: "70px",
      cell: (r) => r.packet ?? "—",
    },
    {
      key: "signer",
      header: "Signer",
      width: "70px",
      cell: (r) => r.signer ?? "—",
    },
    {
      key: "stoneType",
      header: "Type",
      width: "70px",
      cell: (r) => (
        <Badge variant={r.stoneType === "BLUE" ? "info" : "default"}>
          {r.stoneType}
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
      width: "90px",
      sortable: true,
      sortValue: (r) => r.planningDate,
      cell: (r) => fmtDate(r.planningDate),
    },
    {
      key: "status",
      header: "Status",
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
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Planning Cases"
        subtitle="All planning cases across statuses · drill into versions, options and pieces"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {totalCases} cases · {approved} approved · {pending} pending review · {draft} draft
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Cases" value={totalCases} unit="cases" intent="default" onClick={() => setView("planning-cases")} />
        <KpiCard label="Pending Review" value={pending} unit="cases" intent="warning" hint="READY_FOR_REVIEW + SELECTED + APPROVAL_PENDING" onClick={() => setView("planning-approval-queue")} />
        <KpiCard label="Approved" value={approved} unit="cases" intent="success" onClick={() => setView("planning-cases")} />
        <KpiCard label="Draft" value={draft} unit="cases" intent="info" onClick={() => setView("planning-workbench")} />
      </div>

      <Section
        title="Filters"
        description="status · planner · stoneType"
        bodyClassName="p-2"
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

          <Select value={stoneType || "ALL"} onValueChange={(v) => setStoneType(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Stone Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Stone Types</SelectItem>
              {STONE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <DataTable<CaseRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No planning cases match the current filters."
        maxHeight="600px"
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
        exportFilename="planning-cases.csv"
        pagination
        pageSize={25}
        onRowClick={(r) => setSelectedId(r.id)}
        initialSortKey="planningDate"
        initialSortDir="desc"
      />

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col gap-3 overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {detail?.caseCode ?? "Loading…"}
              {detail && <StatusBadge status={detail.status} />}
              {detail && <Badge variant="info">{detail.stoneType}</Badge>}
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
                  <table className="w-full text-[11px]">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-1 py-0.5 text-left">By</th>
                        <th className="px-1 py-0.5 text-left">Status</th>
                        <th className="px-1 py-0.5 text-left">Reserved At</th>
                        <th className="px-1 py-0.5 text-left">Released At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.reservations.map((r) => (
                        <tr key={r.id} className="border-t border-border/40">
                          <td className="px-1 py-0.5">{r.reservedBy}</td>
                          <td className="px-1 py-0.5"><StatusBadge status={r.status} /></td>
                          <td className="px-1 py-0.5">{fmtDate(r.reservedAt)}</td>
                          <td className="px-1 py-0.5">{fmtDate(r.releasedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* Versions */}
              <Section
                title={`Versions (${detail.versions.length})`}
                description="Each version contains planning options; each option lists pieces"
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
                            <div className="mt-2 max-h-32 overflow-y-auto rounded border border-border/60 bg-background">
                              <table className="w-full text-[10px]">
                                <thead className="text-[9px] uppercase text-muted-foreground bg-muted/40 sticky top-0">
                                  <tr>
                                    <th className="px-1 py-0.5 text-left">Seq</th>
                                    <th className="px-1 py-0.5 text-left">Piece Code</th>
                                    <th className="px-1 py-0.5 text-left">Shape</th>
                                    <th className="px-1 py-0.5 text-right">Wt</th>
                                    <th className="px-1 py-0.5 text-left">Color/Clarity</th>
                                    <th className="px-1 py-0.5 text-left">Cat</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {o.pieces.map((p) => (
                                    <tr key={p.id} className="border-t border-border/40">
                                      <td className="px-1 py-0.5 tabular-nums">{p.sequence}</td>
                                      <td className="px-1 py-0.5">{p.pieceCode}</td>
                                      <td className="px-1 py-0.5">{p.expectedShape ?? "—"}</td>
                                      <td className="px-1 py-0.5 text-right tabular-nums">{p.expectedWeight.toFixed(3)}</td>
                                      <td className="px-1 py-0.5">{p.expectedColor ?? "—"} / {p.expectedClarity ?? "—"}</td>
                                      <td className="px-1 py-0.5">{p.expectedCategory ?? "—"}</td>
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
    </div>
  );
}
