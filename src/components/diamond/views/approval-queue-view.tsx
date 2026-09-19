"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Check, X, MessageSquare, AlertTriangle } from "lucide-react";

interface ApprovalRow {
  id: string;
  caseCode: string;
  stoneName: string | null;
  stoneType: string;
  originalRoughWeight: number;
  planner: string;
  planningDate: string;
  status: string;
  selectedOptionCode: string | null;
  expectedPieces: number;
  yieldPct: number;
  coveragePct: number;
  matchingRequiredPieces: number;
  potentialExcess: number;
  validationWarnings: string | null;
  approvalComment: string | null;
}

interface ApiResponse {
  rows: ApprovalRow[];
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
      {parsed.slice(0, 2).map((w, i) => (
        <Badge key={i} variant="warning">{w}</Badge>
      ))}
      {parsed.length > 2 && (
        <Badge variant="neutral">+{parsed.length - 2}</Badge>
      )}
    </div>
  );
}

const APPROVER = "current.user";

export function ApprovalQueueView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, isLoading } = useApi<ApiResponse>("/api/planning/approvals");
  const rows = data?.rows ?? [];

  const pending = rows.filter((r) =>
    ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING"].includes(r.status)
  ).length;
  const replan = rows.filter((r) => r.status === "REPLAN_REQUIRED").length;
  const totalWarnings = rows.filter((r) => r.validationWarnings).length;

  const mutation = useMutation({
    mutationFn: async (body: { caseId: string; action: "approve" | "reject"; approver: string; comment: string }) =>
      apiPost<{ status: string; caseId: string }>("/api/planning/approvals", body),
    onSuccess: (data, vars) => {
      toast({
        title: vars.action === "approve" ? "Plan Approved" : "Plan Rejected",
        description: `${vars.caseId} → ${data.status}`,
      });
      qc.invalidateQueries({ queryKey: ["/api/planning/approvals"] });
      qc.invalidateQueries({ queryKey: ["/api/planning/cases"] });
      setActingId(null);
    },
    onError: (e: unknown) => {
      toast({
        title: "Action failed",
        description: (e as Error).message,
        variant: "destructive",
      });
      setActingId(null);
    },
  });

  const act = (row: ApprovalRow, action: "approve" | "reject") => {
    const comment =
      window.prompt(
        `${action === "approve" ? "Approve" : "Reject"} case ${row.caseCode} — comment (optional):`,
        row.approvalComment ?? ""
      ) ?? "";
    // If user hits Cancel on prompt, window.prompt returns null — treat as abort.
    if (comment === null && action === "approve") return;
    if (comment === null) return;
    setActingId(row.id);
    mutation.mutate({ caseId: row.id, action, approver: APPROVER, comment });
  };

  const columns: Column<ApprovalRow>[] = [
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
      key: "stoneType",
      header: "Type",
      width: "70px",
      cell: (r) => (
        <Badge variant={r.stoneType === "BLUE" ? "info" : "default"}>{r.stoneType}</Badge>
      ),
    },
    {
      key: "originalRoughWeight",
      header: "Orig Wt",
      width: "80px",
      align: "right",
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
      width: "140px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "selectedOptionCode",
      header: "Sel Opt",
      width: "90px",
      cell: (r) => r.selectedOptionCode ?? "—",
    },
    {
      key: "expectedPieces",
      header: "Pieces",
      width: "60px",
      align: "right",
      cell: (r) => <span className="tabular-nums font-medium">{r.expectedPieces}</span>,
    },
    {
      key: "yieldPct",
      header: "Yield %",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.yieldPct,
      cell: (r) => (
        <span
          className={
            r.yieldPct >= 35
              ? "tabular-nums text-emerald-600 dark:text-emerald-400"
              : "tabular-nums text-amber-600 dark:text-amber-400"
          }
        >
          {r.yieldPct.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "coveragePct",
      header: "Cov %",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.coveragePct,
      cell: (r) => (
        <span
          className={
            r.coveragePct >= 100
              ? "tabular-nums text-emerald-600 dark:text-emerald-400 font-medium"
              : r.coveragePct > 0
              ? "tabular-nums text-amber-600 dark:text-amber-400"
              : "tabular-nums text-muted-foreground"
          }
        >
          {r.coveragePct.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "matchingRequiredPieces",
      header: "Match",
      width: "60px",
      align: "right",
      cell: (r) => <span className="tabular-nums">{r.matchingRequiredPieces}</span>,
    },
    {
      key: "potentialExcess",
      header: "Excess",
      width: "60px",
      align: "right",
      cell: (r) => (
        <span
          className={
            r.potentialExcess > 0
              ? "tabular-nums text-amber-600 dark:text-amber-400"
              : "tabular-nums text-emerald-600 dark:text-emerald-400"
          }
        >
          {r.potentialExcess}
        </span>
      ),
    },
    {
      key: "validationWarnings",
      header: "Warnings",
      width: "180px",
      cell: (r) => <WarningsCell value={r.validationWarnings} />,
    },
    {
      key: "actions",
      header: "Actions",
      width: "180px",
      align: "center",
      sticky: "right",
      cell: (r) => (
        <div className="flex items-center justify-center gap-1">
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            disabled={mutation.isPending && actingId === r.id}
            onClick={() => act(r, "approve")}
          >
            {mutation.isPending && actingId === r.id ? (
              <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
            ) : (
              <Check className="h-3 w-3 mr-1" />
            )}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-900"
            disabled={mutation.isPending && actingId === r.id}
            onClick={() => act(r, "reject")}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Approval Queue"
        subtitle="Plans awaiting review · approve or reject with a comment · action is logged to the audit trail"
        meta={
          <span className="text-[10px] text-muted-foreground">
            approver: <code className="font-mono">{APPROVER}</code>
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Pending Review" value={pending} unit="cases" intent="warning" hint="READY_FOR_REVIEW + SELECTED + APPROVAL_PENDING" />
        <KpiCard label="Replan Required" value={replan} unit="cases" intent="critical" hint="Need revised plan from planner" />
        <KpiCard label="With Warnings" value={totalWarnings} unit="cases" intent="warning" hint="Validation warnings present" />
        <KpiCard label="Total in Queue" value={rows.length} unit="cases" intent="default" />
      </div>

      {totalWarnings > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-[11px]">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium text-amber-700 dark:text-amber-300">Heads up: </span>
            <span className="text-amber-800 dark:text-amber-200">
              {totalWarnings} case(s) in the queue carry validation warnings. Review them before approving — warnings are not blockers but indicate constraint checks (e.g. EMERALD 5STEP, weight band edge cases).
            </span>
          </div>
        </div>
      )}

      <DataTable<ApprovalRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No plans awaiting approval. New cases will appear here once planners submit them."
        maxHeight="600px"
        searchable
        searchPlaceholder="Search by case code, stone name, planner…"
        searchFn={(r, q) => {
          const s = q.toLowerCase();
          return (
            r.caseCode.toLowerCase().includes(s) ||
            (r.stoneName ?? "").toLowerCase().includes(s) ||
            r.planner.toLowerCase().includes(s)
          );
        }}
        exportable
        exportFilename="approval-queue.csv"
        initialSortKey="planningDate"
        initialSortDir="asc"
        rowClassName={(r) =>
          r.status === "REPLAN_REQUIRED"
            ? "bg-rose-50/40 dark:bg-rose-950/10"
            : ""
        }
      />

      <Section title="How approval works" bodyClassName="p-2">
        <ul className="text-[11px] space-y-1 text-muted-foreground">
          <li className="flex items-start gap-1">
            <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
            Click <span className="font-medium text-foreground">Approve</span> or <span className="font-medium text-foreground">Reject</span> on a row. A prompt will ask for an optional comment.
          </li>
          <li>The mutation POSTs <code className="font-mono">{`{ caseId, action, approver: "current.user", comment }`}</code> to <code className="font-mono">/api/planning/approvals</code>.</li>
          <li>On success, the queue and planning cases queries are invalidated (TanStack Query) and a toast confirms the action.</li>
          <li>Approved cases move to status <Badge variant="success">APPROVED</Badge>; rejected cases move to <Badge variant="critical">REJECTED</Badge> and an audit log row is written.</li>
        </ul>
      </Section>
    </div>
  );
}
