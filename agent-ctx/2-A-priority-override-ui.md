# Task 2-A — Requirement Priority Override UI

## Goal
Enhance `/home/z/my-project/src/components/diamond/views/requirements-matrix-view.tsx` to add a Requirement Priority Override workflow UI inside the existing requirement detail dialog.

## API Contract
- `POST /api/requirements/{id}/priority`
- Body: `{ priority: "CRITICAL"|"HIGH"|"NORMAL"|"LOW"|"WATCH", reason: string (>=5 chars), actor: string }`
- Returns: `{ id, requirementCode, requirementPriority, priorityReason, auditLogged: true }`
- Server-side: writes AuditLog with before/after, prefixes priorityReason with `[MANUAL OVERRIDE by {actor}]`

## Changes to `requirements-matrix-view.tsx`

### Imports added
- `useMutation, useQueryClient` from `@tanstack/react-query`
- `toast` from `sonner` (already used in feature-flags-view & business-rules-view)
- `apiPost` from `@/lib/api-client`
- `Textarea` from `@/components/ui/textarea`
- `Label` from `@/components/ui/label`
- Icons: `Pencil`, `Loader2` from `lucide-react`

### State added (inside `RequirementsMatrixView`)
- `qc = useQueryClient()`
- `showOverrideForm: boolean` (default false)
- `newPriority: string` (default "NORMAL")
- `overrideReason: string` (default "")

### Mutation
```ts
overrideMutation = useMutation({
  mutationFn: vars => apiPost(`/api/requirements/${vars.id}/priority`, {
    priority: vars.priority, reason: vars.reason, actor: "planner.user"
  }),
  onSuccess: (_data, vars) => {
    toast.success("Priority overridden — audit logged");
    qc.invalidateQueries({ queryKey: [url] });              // matrix list (current page+filters)
    qc.invalidateQueries({ queryKey: [`/api/requirements/${vars.id}`] }); // detail
    setShowOverrideForm(false); setOverrideReason(""); setNewPriority("NORMAL");
  },
  onError: (e: Error) => toast.error(`Override failed: ${e.message}`),
});
```

### Helpers
- `resetOverrideForm()` — closes form, clears reason, resets priority to NORMAL
- `openOverrideForm()` — opens form, pre-seeds `newPriority` with current `detail.requirementPriority`
- `applyOverride()` — trims reason, guards on `>=5` chars + non-empty priority, calls `overrideMutation.mutate`

### Dialog `onOpenChange`
Now also calls `resetOverrideForm()` on close so reopening a fresh row starts clean.

### New UI block (inside `DialogContent`, between the 4-numbers grid and the Quantities breakdown)
- A bordered container with light `bg-muted/20` showing:
  - Header row: "Current Requirement Priority" label + `PriorityBadge` + the existing `priorityReason` (truncated, title-tooltipped) OR an italic "no reason recorded" placeholder
  - "Override Priority" outline button (small `h-7 text-xs`, Pencil icon) — toggles `showOverrideForm`
  - When `showOverrideForm === true`:
    - `InfoBanner variant="warning"` with verbatim text: "Manual override is audit-logged. OPEN rule BR-CUST-PRI-001 — customer priority scoring formula is OPEN; this manual classification is business-owned."
    - 2-column grid: `Select` for `newPriority` (5 PRIORITIES) + `Textarea` for `overrideReason` (with char counter and `aria-invalid` styling when too short)
    - Footer: Cancel ghost button + "Apply Override" default button (disabled while pending or when reason < 5 chars). Apply button shows `Loader2` spinner + "Applying…" label while mutation is in-flight.

## Verification
- `cd /home/z/my-project && bun run lint` → exit 0, no errors
- Dev server compiles cleanly (verified via dev.log)
- Pattern matches `approval-queue-view.tsx` mutation style (useMutation + useQueryClient + sonner toast) but uses `sonner` directly instead of the radix `useToast` hook (consistent with feature-flags-view & business-rules-view, which also use sonner for one-shot success/error toasts)
