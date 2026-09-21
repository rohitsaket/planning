"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, ShieldCheck, X } from "lucide-react";
import { useApi, apiPost } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { StatusBadge } from "@/components/diamond/shared/badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES } from "@/lib/auth/permissions";

interface RequestRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string | null;
  justification: string;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}
interface RequestData {
  rows: RequestRow[];
  pendingCount: number;
  hasMore: boolean;
}

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

export function AccessRequestsView() {
  const [status, setStatus] = useState("PENDING");
  const [active, setActive] = useState<RequestRow | null>(null);
  const [role, setRole] = useState<string>("VIEWER");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const url = `/api/admin/access-requests?status=${status}&pageSize=200`;
  const { data, isLoading } = useApi<RequestData>(url);
  const qc = useQueryClient();

  const close = () => {
    setActive(null);
    setNote("");
    setReason("");
    setRole("VIEWER");
  };

  const decide = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiPost<{ status: string; user?: { username: string }; temporaryPassword?: string }>("/api/admin/access-requests", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [url] });
      if (res.status === "APPROVED" && res.temporaryPassword && res.user) {
        // Shown exactly once — it is never stored in plaintext or retrievable later.
        setIssued({ username: res.user.username, password: res.temporaryPassword });
      } else {
        toast.success("Request rejected.");
      }
      close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const columns: Column<RequestRow>[] = useMemo(
    () => [
      { key: "username", header: "Username", cell: (r) => <span className="font-mono text-[11px] font-medium">{r.username}</span>, sortable: true, sortValue: (r) => r.username, sticky: "left" },
      { key: "displayName", header: "Name", cell: (r) => <span className="text-[11px]">{r.displayName}</span>, sortable: true, sortValue: (r) => r.displayName },
      { key: "email", header: "Email", cell: (r) => <span className="text-[11px]">{r.email ?? "—"}</span> },
      { key: "department", header: "Department", cell: (r) => <span className="text-[11px]">{r.department ?? "—"}</span> },
      { key: "justification", header: "Justification", cell: (r) => <span className="text-[11px] line-clamp-2">{r.justification}</span>, width: "320px" },
      { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} />, sortable: true, sortValue: (r) => r.status },
      { key: "createdAt", header: "Requested", cell: (r) => <span className="tabular-nums text-[10px]">{fmtDate(r.createdAt)}</span>, sortable: true, sortValue: (r) => r.createdAt },
      { key: "reviewedBy", header: "Reviewed By", cell: (r) => <span className="text-[10px]">{r.reviewedBy ?? "—"}</span> },
      { key: "reviewedAt", header: "Reviewed", cell: (r) => <span className="tabular-nums text-[10px]">{fmtDate(r.reviewedAt)}</span> },
      {
        key: "actions",
        header: "Review",
        sticky: "right",
        cell: (r) =>
          r.status === "PENDING" ? (
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setActive(r)}>
              Review
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground">{r.decisionNote ? r.decisionNote.slice(0, 40) : "—"}</span>
          ),
      },
    ],
    [],
  );

  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Access Requests"
        subtitle="Self-service registration queue — approval provisions the account and assigns the role"
        meta={<span className="text-[10px] text-muted-foreground">{rows.length} shown</span>}
        actions={
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger size="sm" className="h-8 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="APPROVED">Approved</SelectItem>
              <SelectItem value="REJECTED">Rejected</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <InfoBanner variant="warning">
        <strong className="font-semibold">A request is not an account.</strong> Submitting the form on the sign-in page creates no
        login and grants no permission. The role is chosen here, by you, at approval time — the applicant has no say in it.
      </InfoBanner>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Pending Review" value={data?.pendingCount ?? 0} intent={(data?.pendingCount ?? 0) > 0 ? "warning" : "success"} icon={ShieldCheck} hint="Awaiting an administrator decision" />
      </div>

      <Section title="Requests" bodyClassName="p-0">
        <DataTable columns={columns} rows={rows} loading={isLoading} emptyMessage="No access requests." maxHeight="620px" searchable searchFn={(r, q) => [r.username, r.displayName, r.email ?? "", r.department ?? "", r.justification].some((f) => f.toLowerCase().includes(q))} exportable exportFilename="access-requests" />
      </Section>

      {/* Review dialog */}
      <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Review access request</DialogTitle>
          </DialogHeader>
          {active && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 text-xs">
                <div><dt className="text-muted-foreground">Username</dt><dd className="font-mono font-medium">{active.username}</dd></div>
                <div><dt className="text-muted-foreground">Name</dt><dd>{active.displayName}</dd></div>
                <div><dt className="text-muted-foreground">Email</dt><dd>{active.email ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Department</dt><dd>{active.department ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Justification</dt><dd className="mt-1 whitespace-pre-wrap">{active.justification}</dd></div>
              </dl>

              <div className="space-y-2">
                <Label htmlFor="ar-role" className="text-xs">Role to assign on approval</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id="ar-role" size="sm" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Grants exactly the permissions of this role. Start least-privileged.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ar-note" className="text-xs">Note <span className="font-normal text-muted-foreground">(optional, approval)</span></Label>
                <Input id="ar-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="h-9 text-xs" placeholder="Context for the audit trail" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ar-reason" className="text-xs">Reason <span className="font-normal text-muted-foreground">(required to reject, min 5 chars)</span></Label>
                <Input id="ar-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="h-9 text-xs" placeholder="Why this request is refused" />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={close} disabled={decide.isPending}>Cancel</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={decide.isPending || reason.trim().length < 5}
                  onClick={() => decide.mutate({ op: "reject", id: active.id, reason: reason.trim() })}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Reject
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ op: "approve", id: active.id, role, ...(note.trim() ? { note: note.trim() } : {}) })}
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Approve as {role}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Temporary password — shown once, never retrievable again. */}
      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Account created</DialogTitle>
          </DialogHeader>
          {issued && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Hand this temporary password to <span className="font-mono font-medium text-foreground">{issued.username}</span> over a
                trusted channel. It is shown once and cannot be retrieved — issue a password reset if it is lost.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded border border-border bg-muted px-3 py-2 font-mono text-xs">{issued.password}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard?.writeText(issued.password).then(
                      () => toast.success("Copied."),
                      () => toast.error("Copy failed — select the text manually."),
                    );
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setIssued(null)}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
