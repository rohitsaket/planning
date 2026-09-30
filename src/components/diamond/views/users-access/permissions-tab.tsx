"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, RotateCcw, Search, ShieldAlert } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/diamond/shared/badges";
import { cn } from "@/lib/utils";
import { apiPost, useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useAccessFocusStore } from "@/stores/access-focus-store";
import { PermissionEditor } from "./permission-editor";
import { UserAccessInspector } from "./user-access-inspector";
import { ApprovalPolicySection } from "./approval-policy-section";
import { BOUNDED_REGION_MAX_HEIGHT } from "@/components/diamond/shared/density";
import { ROLES_URL, USERS_URL, useAccessRefresh, type PermissionMeta, type RoleRow, type RolesResponse, type UsersResponse } from "./shared";

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((v) => b.has(v));

// The tab opens for role readers and for approval-policy readers; each part is shown only to
// holders of its own permission, and each API refuses anyone else.
export function PermissionsTab() {
  const perms = useAuthStore((s) => s.user?.permissions) ?? [];
  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {perms.includes("approval_policy.read") && <ApprovalPolicySection canManage={perms.includes("approval_policy.manage")} />}
      {perms.includes("role.read") && <RolePermissions />}
    </div>
  );
}

function RolePermissions() {
  const session = useAuthStore((s) => s.user);
  const perms = session?.permissions ?? [];
  const canReadUsers = perms.includes("user.read");
  const refresh = useAccessRefresh();
  const focusUserId = useAccessFocusStore((s) => s.focusUserId);
  const setFocusUserId = useAccessFocusStore((s) => s.setFocusUserId);

  const rolesQ = useApi<RolesResponse>(ROLES_URL);
  const roles = useMemo(() => rolesQ.data?.roles ?? [], [rolesQ.data]);
  const catalog = rolesQ.data?.catalog;
  // What this caller may do, as the server reports it. The server decides again on save.
  const canEditPermissions = rolesQ.data?.canEditPermissions ?? false;
  const canManageRoles = rolesQ.data?.canManageRoles ?? false;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;
  const baseline = useMemo(() => new Set(selected?.permissions ?? []), [selected]);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [draftFor, setDraftFor] = useState<string | null>(null);
  // A new draft whenever another role, or a newer version of this one, is shown. Adjusted
  // during render, so the editor never paints a draft that belongs to another role.
  const draftKey = selected ? `${selected.id}:${selected.version}` : null;
  if (draftKey !== draftFor) {
    setDraftFor(draftKey);
    setDraft(new Set(baseline));
  }

  const editable = !!selected && canEditPermissions;
  const dirty = editable && !sameSet(draft, baseline);

  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState<null | { copyFrom: RoleRow | null }>(null);
  const [renaming, setRenaming] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectRole = (id: string) => {
    if (id === selected?.id) return;
    if (dirty) setPendingRoleId(id);
    else {
      setSelectedId(id);
      setNotice(null);
    }
  };

  // Which roles the signed-in user holds, to say whether a change alters their own access.
  const selfQ = useApi<UsersResponse>(canReadUsers && session ? `${USERS_URL}?id=${encodeURIComponent(session.id)}` : null);
  const ownRoles = selfQ.data?.rows[0]?.roles ?? (session ? [session.role] : []);

  const focusQ = useApi<UsersResponse>(canReadUsers && focusUserId ? `${USERS_URL}?id=${encodeURIComponent(focusUserId)}` : null);
  const focusUser = focusQ.data?.rows[0] ?? null;

  if (rolesQ.isLoading) return <p className="text-xs text-muted-foreground">Loading roles…</p>;
  if (rolesQ.error || !catalog) return <p className="text-xs text-muted-foreground">Roles could not be loaded.</p>;

  const added = catalog.permissions.filter((p) => draft.has(p.id) && !baseline.has(p.id));
  const removed = catalog.permissions.filter((p) => !draft.has(p.id) && baseline.has(p.id));

  return (
    <div className="flex flex-col gap-section">
      {canReadUsers && <UserPicker onPick={(id) => setFocusUserId(id)} />}
      {focusUser && (
        <UserAccessInspector user={focusUser} roles={roles} catalog={catalog.permissions} areas={catalog.areas} onClose={() => setFocusUserId(null)} onSelectRole={selectRole} />
      )}

      <div className="grid gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside aria-label="Roles" className="hidden rounded-lg border border-border bg-card xl:block">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">Roles</h2>
            {canManageRoles && (
              <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setCreating({ copyFrom: null })}>
                <Plus className="h-3.5 w-3.5" /> New role
              </Button>
            )}
          </div>
          <ul className="overflow-y-auto p-1.5" style={{ maxHeight: BOUNDED_REGION_MAX_HEIGHT }}>
            {roles.length === 0 && <li className="px-2.5 py-2 text-xs text-muted-foreground">No roles yet.</li>}
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={r.id === selected?.id ? "true" : undefined}
                  onClick={() => selectRole(r.id)}
                  className={cn("w-full rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted/60", r.id === selected?.id && "bg-[#FED7AA] text-[#7C2D12] dark:bg-[#272322] dark:text-[#FFEDD5]")}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    {r.name}
                    {r.status === "INACTIVE" && <span className="text-[10px] font-medium text-muted-foreground">Retired</span>}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {r.permissions.length} permissions · {r.userCount} {r.userCount === 1 ? "user" : "users"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-2 xl:hidden">
            <div className="flex-1 space-y-1 text-xs font-medium">
              <label htmlFor="role-editor-select">Role</label>
              <select id="role-editor-select" className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs" value={selected?.id ?? ""} onChange={(e) => selectRole(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.status === "INACTIVE" ? " (retired)" : ""} — {r.userCount} users
                  </option>
                ))}
              </select>
            </div>
            {canManageRoles && (
              <Button size="sm" variant="outline" className="h-9 gap-1" onClick={() => setCreating({ copyFrom: null })}>
                <Plus className="h-3.5 w-3.5" /> New role
              </Button>
            )}
          </div>

          {!selected && (
            <p className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-xs text-muted-foreground">
              No roles yet.{canManageRoles ? " Use New role to create the first one, then choose its permissions." : " A Super Admin creates roles here."}
            </p>
          )}
          {selected && (
            <section aria-labelledby="role-editor-heading" className="rounded-lg border border-border bg-card">
              <header className="space-y-1 border-b border-border px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="role-editor-heading" className="text-base font-semibold">{selected.name}</h2>
                  {selected.status === "INACTIVE" && <Badge variant="neutral">Retired</Badge>}
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    {canManageRoles && (
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setRenaming(true)}>
                        <Pencil className="h-3.5 w-3.5" /> Rename
                      </Button>
                    )}
                    {canManageRoles && canEditPermissions && (
                      <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => setCreating({ copyFrom: selected })}>
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </Button>
                    )}
                    {canManageRoles && (
                      <Button size="sm" variant="outline" className="h-7" onClick={() => setRetiring(true)}>
                        {selected.status === "INACTIVE" ? "Reactivate" : "Retire"}
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{selected.description || "No description."}</p>
                <p className="text-[11px] text-muted-foreground">
                  {selected.userCount} assigned {selected.userCount === 1 ? "user" : "users"} · {editable ? draft.size : selected.permissions.length} of {catalog.permissions.length} permissions
                </p>
                {!canEditPermissions && (
                  <p className="text-[11px] text-muted-foreground">Only a Super Admin can choose role permissions. You can view them here.</p>
                )}
                {notice && <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-400">{notice}</p>}
              </header>

              <div className="p-3">
                <PermissionEditor
                  areas={catalog.areas}
                  catalog={catalog.permissions}
                  selected={editable ? draft : baseline}
                  baseline={baseline}
                  onChange={setDraft}
                  readOnly={!editable}
                />
              </div>

              {editable && (
                <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-3 py-2 text-xs">
                  <span className={cn("font-medium", dirty ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                    {dirty ? `Unsaved changes: ${added.length} added, ${removed.length} removed` : "No unsaved changes"}
                  </span>
                  <Button size="sm" variant="outline" className="ml-auto h-8 gap-1" disabled={!dirty} onClick={() => setDraft(new Set(baseline))}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <Button size="sm" className="h-8" disabled={!dirty} onClick={() => setSaving(true)}>Review and save</Button>
                </footer>
              )}
            </section>
          )}
        </div>
      </div>

      {saving && selected && (
        <SaveDialog
          role={selected}
          added={added}
          removed={removed}
          permissions={[...draft]}
          ownAccessChanges={ownRoles.includes(selected.code)}
          onClose={() => setSaving(false)}
          onSaved={async (text) => {
            setSaving(false);
            setNotice(text);
            await refresh();
          }}
          onReload={async () => {
            setSaving(false);
            setDraftFor(null);
            await rolesQ.refetch();
          }}
        />
      )}

      {creating && (
        <CreateRoleDialog
          copyFrom={creating.copyFrom}
          onClose={() => setCreating(null)}
          onCreated={async (role) => {
            setCreating(null);
            await refresh();
            setSelectedId(role.id);
            setNotice(`Role ${role.name} created.`);
          }}
        />
      )}

      {renaming && selected && (
        <RenameRoleDialog
          role={selected}
          onClose={() => setRenaming(false)}
          onSaved={async () => {
            setRenaming(false);
            setNotice("Role details saved.");
            await refresh();
          }}
        />
      )}

      {retiring && selected && (
        <RetireRoleDialog
          role={selected}
          onClose={() => setRetiring(false)}
          onSaved={async (text) => {
            setRetiring(false);
            setNotice(text);
            await refresh();
          }}
        />
      )}

      <Dialog open={!!pendingRoleId} onOpenChange={(o) => !o && setPendingRoleId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Your changes to {selected?.name} have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRoleId(null)}>Keep editing</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setSelectedId(pendingRoleId);
                setPendingRoleId(null);
                setNotice(null);
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserPicker({ onPick }: { onPick: (userId: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 250);
    return () => clearTimeout(t);
  }, [input]);
  const results = useApi<UsersResponse>(query.length >= 2 ? `${USERS_URL}?q=${encodeURIComponent(query)}&pageSize=8` : null);
  return (
    <div className="relative max-w-md">
      <Search className="pointer-events-none absolute left-2 top-[18px] h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="Check a user's access" placeholder="Check a user's access — type a name or username" value={input} maxLength={100} onChange={(e) => setInput(e.target.value)} className="h-9 pl-7 text-xs" />
      {query.length >= 2 && (
        <ul className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover p-1 text-xs shadow-md">
          {results.isLoading && <li className="px-2 py-1.5 text-muted-foreground">Searching…</li>}
          {results.data?.rows.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">No users found.</li>}
          {results.data?.rows.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  onPick(u.id);
                  setInput("");
                  setQuery("");
                }}
              >
                <span className="font-medium">{u.name}</span> <span className="font-mono text-muted-foreground">{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PermissionList({ items, tone }: { items: PermissionMeta[]; tone: "added" | "removed" }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-semibold">{tone === "added" ? `Added (${items.length})` : `Removed (${items.length})`}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((p) => (
          <li key={p.id} className="flex flex-wrap gap-x-2">
            <span className={tone === "added" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>{tone === "added" ? "+" : "−"} {p.label}</span>
            <span className="text-muted-foreground">{p.area}</span>
            {p.sensitive && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">Sensitive</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SaveDialog({
  role,
  added,
  removed,
  permissions,
  ownAccessChanges,
  onClose,
  onSaved,
  onReload,
}: {
  role: RoleRow;
  added: PermissionMeta[];
  removed: PermissionMeta[];
  permissions: string[];
  ownAccessChanges: boolean;
  onClose: () => void;
  onSaved: (notice: string) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const sensitive = [...added, ...removed].filter((p) => p.sensitive);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiPost<{ changed: boolean; affectedUsers?: number }>(ROLES_URL, { op: "updateRole", id: role.id, version: role.version, permissions });
      await onSaved(
        res.changed
          ? `Saved. Access changed for ${res.affectedUsers ?? 0} assigned ${res.affectedUsers === 1 ? "user" : "users"}; it applies on their next request.`
          : "Nothing to save — the role already has these permissions.",
      );
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The role was not saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Save permissions for {role.name}</DialogTitle>
          <DialogDescription>Review the effect before saving. The change is recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-xs">
          <ul className="grid grid-cols-2 gap-2">
            <li className="rounded-md border border-border p-2"><span className="block text-[11px] text-muted-foreground">Assigned users affected</span><span className="text-base font-semibold tabular-nums">{role.userCount}</span></li>
            <li className="rounded-md border border-border p-2"><span className="block text-[11px] text-muted-foreground">Sensitive changes</span><span className="text-base font-semibold tabular-nums">{sensitive.length}</span></li>
          </ul>
          {ownAccessChanges && <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 font-medium text-amber-800 dark:text-amber-300">You hold this role: your own access changes too.</p>}
          <PermissionList items={added} tone="added" />
          <PermissionList items={removed} tone="removed" />
          {sensitive.length > 0 && (
            <label htmlFor="confirm-sensitive" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
              <Checkbox id="confirm-sensitive" checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} className="mt-0.5" />
              <span className="flex gap-1"><ShieldAlert className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" /> I have checked the {sensitive.length} sensitive {sensitive.length === 1 ? "change" : "changes"} and want to apply {sensitive.length === 1 ? "it" : "them"}.</span>
            </label>
          )}
          {failure && (
            <div role="alert" className="space-y-2 rounded-md border border-red-500/40 p-2 text-red-700 dark:text-red-400">
              <p>{failure}</p>
              <Button size="sm" variant="outline" onClick={() => void onReload()}>Reload the latest version</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Back to editing</Button>
          <Button onClick={() => void save()} disabled={busy || (sensitive.length > 0 && !confirmed)}>{busy ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateRoleDialog({ copyFrom, onClose, onCreated }: { copyFrom: RoleRow | null; onClose: () => void; onCreated: (role: RoleRow) => Promise<void> }) {
  const [code, setCode] = useState(copyFrom ? `${copyFrom.code}_COPY`.slice(0, 40) : "");
  const [name, setName] = useState(copyFrom ? `${copyFrom.name} (copy)`.slice(0, 100) : "");
  const [description, setDescription] = useState(copyFrom?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const normalizedCode = code.trim().toUpperCase();
  const valid = /^[A-Z0-9_]{2,40}$/.test(normalizedCode) && name.trim().length >= 2;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const res = await apiPost<{ role: RoleRow }>(ROLES_URL, {
        op: "createRole",
        code: normalizedCode,
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: copyFrom ? copyFrom.permissions : [],
      });
      await onCreated(res.role);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The role was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copyFrom ? `Copy ${copyFrom.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            {copyFrom ? `Starts with the ${copyFrom.permissions.length} permissions of ${copyFrom.name}.` : "Starts with no permissions. Choose them after creating it."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-xs">
          <label className="block space-y-1 font-medium">
            Name
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block space-y-1 font-medium">
            Code
            <Input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PLANNING_ANALYST" required />
            <span className="block font-normal text-muted-foreground">Uppercase letters, numbers and underscores. It cannot be changed later.</span>
          </label>
          <label className="block space-y-1 font-medium">
            Description (optional)
            <Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {failure && <p role="alert" className="text-red-600 dark:text-red-400">{failure}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!valid || busy}>{busy ? "Creating…" : "Create role"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameRoleDialog({ role, onClose, onSaved }: { role: RoleRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await apiPost(ROLES_URL, { op: "updateRole", id: role.id, version: role.version, name: name.trim(), description: description.trim() });
      await onSaved();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The role was not saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {role.name}</DialogTitle>
          <DialogDescription>Assigned users keep the role; only its name and description change.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 text-xs">
          <label className="block space-y-1 font-medium">
            Name
            <Input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="block space-y-1 font-medium">
            Description
            <Input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </label>
          {failure && <p role="alert" className="text-red-600 dark:text-red-400">{failure}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RetireRoleDialog({ role, onClose, onSaved }: { role: RoleRow; onClose: () => void; onSaved: (notice: string) => Promise<void> }) {
  const retiring = role.status !== "INACTIVE";
  const blocked = retiring && role.userCount > 0;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await apiPost(ROLES_URL, { op: "updateRole", id: role.id, version: role.version, status: retiring ? "INACTIVE" : "ACTIVE" });
      await onSaved(retiring ? `${role.name} retired. It stays in the audit history.` : `${role.name} reactivated.`);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : "The role was not changed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{retiring ? `Retire ${role.name}?` : `Reactivate ${role.name}?`}</DialogTitle>
          <DialogDescription>
            {retiring
              ? blocked
                ? `It is assigned to ${role.userCount} ${role.userCount === 1 ? "user" : "users"}. Move them to another role first.`
                : "A retired role cannot be assigned. Roles are never deleted, so their history stays readable."
              : "It can be assigned again."}
          </DialogDescription>
        </DialogHeader>
        {failure && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{failure}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={retiring ? "destructive" : "default"} disabled={busy || blocked} onClick={() => void submit()}>
            {retiring ? "Retire role" : "Reactivate role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
