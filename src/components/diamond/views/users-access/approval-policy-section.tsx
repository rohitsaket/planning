"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/diamond/shared/badges";
import { apiPost, useApi } from "@/lib/api-client";
import type { ApprovalPolicy } from "@/lib/planning/approval-policy";

const POLICY_URL = "/api/admin/approval-policy";

/**
 * The plan approval policy. The approval route enforces it on the server; this only shows
 * the state and, for holders of approval_policy.manage, changes it with a recorded reason.
 */
export function ApprovalPolicySection({ canManage }: { canManage: boolean }) {
  const { data, isLoading, error } = useApi<ApprovalPolicy>(POLICY_URL);
  const [changing, setChanging] = useState(false);
  const required = data?.requireSeparateApprover;

  return (
    <section aria-labelledby="approval-policy-title" className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h2 id="approval-policy-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
            Approval Policy
          </h2>
          <p className="mt-1 text-xs font-medium">Require a different user to approve a plan</p>
          <p className="text-xs text-muted-foreground">
            Separation of duties: the planner of a case cannot approve or reject their own plan, so every approved plan has
            been checked by a second person.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
          {error && <span className="text-xs text-muted-foreground">Policy could not be loaded.</span>}
          {data && (
            <Badge variant={required ? "success" : "warning"}>
              {required ? "On — a separate approver is required" : "Off — planners may approve their own plans"}
            </Badge>
          )}
          {data && canManage && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setChanging(true)}>
              {required ? "Turn off" : "Turn on"}
            </Button>
          )}
        </div>
      </div>
      {changing && data && <ChangePolicyDialog next={!data.requireSeparateApprover} onClose={() => setChanging(false)} />}
    </section>
  );
}

function ChangePolicyDialog({ next, onClose }: { next: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError("Give a reason of at least 5 characters.");
      return;
    }
    setSaving(true);
    try {
      await apiPost(POLICY_URL, { requireSeparateApprover: next, reason: reason.trim() });
      await qc.invalidateQueries({ queryKey: [POLICY_URL] });
      toast.success(next ? "A separate approver is now required." : "Planners may now approve their own plans.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The policy could not be changed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{next ? "Require a separate approver?" : "Let planners approve their own plans?"}</DialogTitle>
          <DialogDescription>
            {next
              ? "The planner of a case will no longer be able to approve or reject it."
              : "Separation of duties will be switched off: a planner will be able to approve or reject their own plan."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-xs">
          <label className="block space-y-1 font-medium">
            Reason (recorded in the Audit Log)
            <Input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error} />
          </label>
          {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving}>{next ? "Turn on" : "Turn off"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
