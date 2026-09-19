# Task 2-B — Plan Replan Action UI

**Agent:** full-stack-developer (Replan Action UI)
**Task ID:** 2-B
**Scope:** Add Plan Replan action to two existing view components (`approval-queue-view.tsx`, `planning-cases-view.tsx`) using the new `POST /api/planning/cases/{id}/replan` endpoint.

## Files modified

| File | Change |
|---|---|
| `src/app/layout.tsx` | Mounted Sonner `<Toaster />` (position="top-right", richColors, closeButton) so `toast.success/error` from sonner actually displays. Coexists with the existing radix `<Toaster />`. |
| `src/components/diamond/views/approval-queue-view.tsx` | Added Replan button (amber/warning outline, RefreshCw icon) in the sticky-right actions column next to Approve/Reject; added a `replanMutation` (useMutation + useQueryClient) POSTing `{ reason, actor }` to `/api/planning/cases/{id}/replan`; added a compact max-w-md Replan Dialog with reason Textarea (min 5 chars, placeholder "e.g., Actual output missed target category; yield below threshold"), live char counter, Cancel + amber Confirm Replan buttons; added an InfoBanner (variant="warning") above the DataTable with the verbatim "Replanning preserves historical planning evidence…" hint; updated the "How approval works" Section to document the third action. |
| `src/components/diamond/views/planning-cases-view.tsx` | Added a "Mark for Replan" button at the top of the detail Sheet content (inside an amber-bordered "Plan versioning" action bar showing `current v{N} · status {S}`), with the verbatim "Replanning preserves historical planning evidence…" InfoBanner hint directly below the button; added a `replanMutation` (useMutation + useQueryClient); added a compact max-w-md Replan Dialog with reason Textarea + char counter, Cancel + amber Confirm Replan buttons. |

## API contract (confirmed via curl)

`POST /api/planning/cases/{id}/replan` body `{ reason: string, actor: string }`:

- Validates: reason must be >= 5 chars (else 400 `{"error":"Reason (min 5 chars) required"}`), actor required (else 400 `{"error":"actor required"}`)
- Bumps `currentVersion` by 1, sets status `REPLAN_REQUIRED`, creates new `PlanVersion` in `DRAFT` status, writes `AuditLog` (action `PLAN_REPLAN`, before/after JSON, reason, timestamp)
- Returns `{ id, caseCode, status:"REPLAN_REQUIRED", currentVersion:<incremented>, auditLogged:true }`

End-to-end test results:
```
POST .../replan {"reason":"Actual output missed target category; yield below threshold","actor":"planner.user"}
→ {"id":"cmu8bftun01idnkhel4vg4d9a","caseCode":"PC-00003","status":"REPLAN_REQUIRED","currentVersion":2,"auditLogged":true}

POST .../replan {"reason":"hi","actor":"planner.user"}        → 400 {"error":"Reason (min 5 chars) required"}
POST .../replan {"reason":"valid reason here","actor":""}     → 400 {"error":"actor required"}
```

## Mutation pattern (used in both views)

```ts
const replanMutation = useMutation({
  mutationFn: async (vars: { caseId: string; reason: string; actor: string }) =>
    apiPost<{ id: string; caseCode: string; status: string; currentVersion: number; auditLogged: boolean }>(
      `/api/planning/cases/${vars.caseId}/replan`,
      { reason: vars.reason, actor: vars.actor }
    ),
  onSuccess: (data) => {
    toast.success("Marked for replan — new version created, audit logged");
    qc.invalidateQueries({ queryKey: ["/api/planning/approvals"] });
    qc.invalidateQueries({ queryKey: ["/api/planning/cases"] });
    qc.invalidateQueries({ queryKey: [`/api/planning/cases/${data.id}`] });
    // close dialog + clear reason
  },
  onError: (e: unknown) => toast.error(`Replan failed: ${(e as Error).message}`),
});
```

## Styling notes

- Replan / Mark for Replan button: `variant="outline"` with `className="h-7 text-xs text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/40"`
- Confirm Replan button: amber solid (`bg-amber-500 hover:bg-amber-600 ...`)
- Dialog: `max-w-md`, compact (`text-xs`), live char counter (amber < 5 chars, emerald >= 5 chars)
- InfoBanner: `variant="warning"` (amber)
- Spinner: small `border-2 border-amber-600 border-t-transparent rounded-full animate-spin` while mutation is pending

## Verification

- `bun run lint` → exits 0, no errors, no warnings
- dev.log → `✓ Compiled in 152ms` / `✓ Compiled in 226ms` (clean compile, no runtime errors)
- API end-to-end curl test → version increment + status change + validation errors all confirmed

## Latent issue fixed as a side effect

The Sonner `<Toaster />` was not mounted anywhere in the app, so existing `toast.success/error` calls in `feature-flags-view.tsx`, `business-rules-view.tsx`, `dashboard-view.tsx`, and `fantasy-sync-view.tsx` were silently no-op. Mounting it in `layout.tsx` fixes those too — no behavior change for the existing radix `useToast`-based toasts in `approval-queue-view.tsx` (Approve/Reject) since that uses a separate toaster.
