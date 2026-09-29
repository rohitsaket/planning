"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi, apiPost } from "@/lib/api-client";
import { PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast as sonnerToast } from "sonner";
import { Check, X, AlertTriangle, RefreshCw } from "lucide-react";
import { parseValidationWarnings } from "@/lib/domain/validation-warnings";
import { packetTypeLabel, packetTypeName } from "@/lib/domain/packet-type";

interface ApprovalRow {
  id: string;
  caseCode: string;
  stoneName: string | null;
  packetType: string;
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
  const parsed = parseValidationWarnings(value);
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

const REPLAN_REASON_MIN = 5;

export function ApprovalQueueView() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [actingId, setActingId] = useState<string | null>(null);
  const [replanTarget, setReplanTarget] = useState<ApprovalRow | null>(null);
  const [replanReason, setReplanReason] = useState("");
  const canApprove = useAuthStore((s) => !!s.user?.permissions.includes("plan.approve"));
  const canReplan = useAuthStore((s) => !!s.user?.permissions.includes("plan.replan"));

  const { data, isLoading } = useApi<ApiResponse>("/api/planning/approvals");
  const rows = data?.rows ?? [];

  const pending = rows.filter((r) =>
    ["READY_FOR_REVIEW", "SELECTED", "APPROVAL_PENDING"].includes(r.status)
  ).length;
  const replan = rows.filter((r) => r.status === "REPLAN_REQUIRED").length;
  const totalWarnings = rows.filter((r) => r.validationWarnings).length;

  const mutation = useMutation({
    mutationFn: async (body: { caseId: string; action: "approve" | "reject"; comment: string }) =>
      apiPost<{ status: string; caseId: string }>("/api/planning/approvals", body),
    onSuccess: (data, vars) => {
      toast({
        title: vars.action === "approve" ? "Plan Approved" : "Plan Rejected",
        description: vars.action === "approve" ? "The plan was approved." : "The plan was rejected.",
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
      sonnerToast.success("Marked for replan — new version created, audit logged");
      qc.invalidateQueries({ queryKey: ["/api/planning/approvals"] });
      qc.invalidateQueries({ queryKey: ["/api/planning/cases"] });
      qc.invalidateQueries({ queryKey: [`/api/planning/cases/${data.id}`] });
      setReplanTarget(null);
      setReplanReason("");
    },
    onError: (e: unknown) => {
      sonnerToast.error(`Replan failed: ${(e as Error).message}`);
    },
  });

  const openReplan = (row: ApprovalRow) => {
    setReplanTarget(row);
    setReplanReason("");
  };

  const cancelReplan = () => {
    setReplanTarget(null);
    setReplanReason("");
  };

  const confirmReplan = () => {
    if (!replanTarget) return;
    const reason = replanReason.trim();
    if (reason.length < REPLAN_REASON_MIN) return;
    replanMutation.mutate({
      caseId: replanTarget.id,
      reason,
    });
  };

  const act = (row: ApprovalRow, action: "approve" | "reject") => {
    const comment =
      window.prompt(
        `${action === "approve" ? "Approve this plan" : "Reject this plan"} (${row.caseCode}). Comment (optional):`,
        row.approvalComment ?? ""
      ) ?? "";
    // If user hits Cancel on prompt, window.prompt returns null — treat as abort.
    if (comment === null && action === "approve") return;
    if (comment === null) return;
    setActingId(row.id);
    mutation.mutate({ caseId: row.id, action, comment });
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
      align: "center",
      width: "150px",
      cell: (r) => r.stoneName ?? "—",
    },
    {
      key: "packetType",
      header: "Packet Type",
      align: "center",
      width: "70px",
      cell: (r) => (
        <Badge variant={r.packetType === "BLUE" ? "info" : "default"}>{packetTypeName(r.packetType)}</Badge>
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
      width: "140px",
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "selectedOptionCode",
      header: "Sel Opt",
      align: "center",
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
      width: "250px",
      align: "center",
      sticky: "right",
      cell: (r) => {
        const acting =
          (mutation.isPending && actingId === r.id) ||
          (replanMutation.isPending && replanTarget?.id === r.id);
        if (!canApprove && !canReplan) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center justify-center gap-1">
            {canApprove && (
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              disabled={acting}
              onClick={() => act(r, "approve")}
              title="Approve this plan"
            >
              {mutation.isPending && actingId === r.id ? (
                <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin mr-1" />
              ) : (
                <Check className="h-3 w-3 mr-1" />
              )}
              Approve
            </Button>
            )}
            {canApprove && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-900"
              disabled={acting}
              onClick={() => act(r, "reject")}
              title="Reject this plan"
            >
              <X className="h-3 w-3 mr-1" />
              Reject
            </Button>
            )}
            {canReplan && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              disabled={acting}
              onClick={() => openReplan(r)}
              title="Request replanning"
            >
              {replanMutation.isPending && replanTarget?.id === r.id ? (
                <div className="h-3 w-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Replan
            </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Approval Queue"
        subtitle="Plans awaiting review"
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Pending Review" value={pending} unit="cases" intent="warning" hint="Ready for review or awaiting approval" />
        <KpiCard label="Replan Required" value={replan} unit="cases" intent="critical" hint="Need revised plan from planner" />
        <KpiCard label="With Warnings" value={totalWarnings} unit="cases" intent="warning" hint="Validation warnings present" />
        <KpiCard label="Total in Queue" value={rows.length} unit="cases" intent="default" />
      </div>

      {totalWarnings > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 px-3 py-2 text-[11px]">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div>
            <span className="text-amber-800 dark:text-amber-200">
              {totalWarnings} case(s) have validation warnings. Review them before approving.
            </span>
          </div>
        </div>
      )}

      <DataTable<ApprovalRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No plans awaiting approval."
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
        exportPermission="plan.export"
        exportFilename="approval-queue.csv"
        initialSortKey="planningDate"
        initialSortDir="asc"
        pagination
        pageSize={25}
        rowClassName={(r) =>
          r.status === "REPLAN_REQUIRED"
            ? "bg-rose-50/40 dark:bg-rose-950/10"
            : ""
        }
      />

      {/* Replan Dialog */}
      <Dialog
        open={!!replanTarget}
        onOpenChange={(o) => {
          if (!o) cancelReplan();
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <RefreshCw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Request replanning
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              {replanTarget && (
                <span>
                  Case <span className="font-medium text-foreground">{replanTarget.caseCode}</span>
                  {" · "}{packetTypeLabel(replanTarget.packetType)}
                  {" · "}<StatusBadge status={replanTarget.status} />
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
