"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost, useApi } from "@/lib/api-client";
import { OneTimePassword } from "./add-user-dialog";
import { ACCESS_REQUESTS_URL, formatWhen } from "./shared";

interface AccessRequestRow {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  department: string | null;
  justification: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
}

interface AccessRequestsResponse {
  rows: AccessRequestRow[];
  hasMore: boolean;
  pendingCount: number;
  assignableRoles: Array<{ code: string; name: string }>;
}

const QUEUE_PAGE = 25;

export function AccessRequestQueue({ onDecided }: { onDecided: () => Promise<void> }) {
  const url = `${ACCESS_REQUESTS_URL}?status=PENDING&pageSize=${QUEUE_PAGE}`;
  const { data, isLoading, error, refetch } = useApi<AccessRequestsResponse>(url);
  const [active, setActive] = useState<AccessRequestRow | null>(null);
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const close = () => {
    setActive(null);
    setRole("");
    setNote("");
    setReason("");
    setFailure(null);
  };

  const decide = async (body: Record<string, unknown>) => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiPost<{ status: string; user?: { username: string }; temporaryPassword?: string }>(ACCESS_REQUESTS_URL, body);
      if (res.status === "APPROVED" && res.user && res.temporaryPassword) setIssued({ username: res.user.username, password: res.temporaryPassword });
      close();
      await Promise.all([refetch(), onDecided()]);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The decision was not saved.");
    } finally {
      setBusy(false);
    }
  };

  const rows = data?.rows ?? [];
  return (
    <section aria-labelledby="access-requests-heading" className="rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id="access-requests-heading" className="text-sm font-semibold">
          Access requests <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums">{data?.pendingCount ?? "…"} pending</span>
        </h2>
      </header>
      {isLoading ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">Access requests are unavailable.</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">No requests are waiting for review.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.displayName} <span className="font-mono text-muted-foreground">{r.username}</span>
                </p>
                <p className="truncate text-muted-foreground">{r.justification}</p>
              </div>
              <time className="hidden text-muted-foreground lg:block" dateTime={r.createdAt}>{formatWhen(r.createdAt)}</time>
              <Button size="sm" variant="outline" className="h-7" onClick={() => setActive(r)}>Review</Button>
            </li>
          ))}
          {data?.hasMore && <li className="px-3 py-2 text-[11px] text-muted-foreground">Showing the {QUEUE_PAGE} newest of {data.pendingCount} pending requests.</li>}
        </ul>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Review access request</DialogTitle>
            <DialogDescription>Approving creates the account with the role you choose and issues a temporary password.</DialogDescription>
          </DialogHeader>
          {active && (
            <div className="space-y-3 text-xs">
              <dl className="grid grid-cols-2 gap-2 rounded-md border border-border p-3">
                <div><dt className="text-muted-foreground">Username</dt><dd className="font-mono">{active.username}</dd></div>
                <div><dt className="text-muted-foreground">Name</dt><dd>{active.displayName}</dd></div>
                <div><dt className="text-muted-foreground">Email</dt><dd>{active.email ?? "—"}</dd></div>
                <div><dt className="text-muted-foreground">Department</dt><dd>{active.department ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-muted-foreground">Justification</dt><dd className="whitespace-pre-wrap">{active.justification}</dd></div>
              </dl>
              <label className="block space-y-1 font-medium">
                Role to assign
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">Choose a role</option>
                  {(data?.assignableRoles ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </label>
              <label className="block space-y-1 font-medium">
                Note (optional, with approval)
                <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
              </label>
              <label className="block space-y-1 font-medium">
                Reason (required to reject)
                <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </label>
              {failure && <p role="alert" className="text-red-600 dark:text-red-400">{failure}</p>}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
                <Button variant="destructive" size="sm" className="gap-1" disabled={busy || reason.trim().length < 5} onClick={() => decide({ op: "reject", id: active.id, reason: reason.trim() })}>
                  <X className="h-3.5 w-3.5" /> Reject
                </Button>
                <Button size="sm" className="gap-1" disabled={busy || !role} onClick={() => decide({ op: "approve", id: active.id, role, ...(note.trim() ? { note: note.trim() } : {}) })}>
                  <Check className="h-3.5 w-3.5" /> Approve
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Account created</DialogTitle>
          </DialogHeader>
          {issued && <OneTimePassword username={issued.username} password={issued.password} />}
          <DialogFooter>
            <Button size="sm" onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
