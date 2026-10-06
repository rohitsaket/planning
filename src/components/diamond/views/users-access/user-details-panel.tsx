"use client";

import { useMemo, useState } from "react";
import { KeyRound, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/diamond/shared/badges";
import { apiPost, useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { RolePicker, ScopePicker, scopeChoiceValid } from "./access-pickers";
import { OneTimePassword } from "./add-user-dialog";
import {
  STATUS_LABEL,
  STATUS_VARIANT,
  USERS_URL,
  formatWhen,
  roleLabel,
  scopeSummary,
  type PermissionMeta,
  type RoleRow,
  type ScopeOptions,
  type UserRow,
} from "./shared";

interface HistoryEntry {
  action: "USER_CREATED" | "USER_ROLE_CHANGE" | "USER_ACCESS_SCOPE_CHANGE" | "USER_STATUS_CHANGE" | "USER_PASSWORD_RESET";
  actor: string;
  at: string;
  before: { roles?: string[]; status?: string; countries?: string[]; labs?: string[] } | null;
  after: { roles?: string[]; status?: string; countries?: string[]; labs?: string[] } | null;
  reason: string | null;
}

const HISTORY_LABEL: Record<HistoryEntry["action"], string> = {
  USER_CREATED: "Account created",
  USER_ROLE_CHANGE: "Roles changed",
  USER_ACCESS_SCOPE_CHANGE: "Scope changed",
  USER_STATUS_CHANGE: "Status changed",
  USER_PASSWORD_RESET: "Password reset",
};

function describeChange(entry: HistoryEntry, roleName: (code: string) => string): string {
  const list = (v?: string[]) => (v && v.length ? v.join(", ") : "all");
  switch (entry.action) {
    case "USER_ROLE_CHANGE":
      return `${(entry.before?.roles ?? []).map(roleName).join(", ") || "none"} → ${(entry.after?.roles ?? []).map(roleName).join(", ") || "none"}`;
    case "USER_ACCESS_SCOPE_CHANGE":
      return `Countries ${list(entry.before?.countries)} → ${list(entry.after?.countries)}; labs ${list(entry.before?.labs)} → ${list(entry.after?.labs)}`;
    case "USER_STATUS_CHANGE":
      return `${entry.before?.status ?? "?"} → ${entry.after?.status ?? "?"}`;
    case "USER_CREATED":
      return entry.after?.roles?.length ? `With ${entry.after.roles.map(roleName).join(", ")}` : "";
    default:
      return "Must choose a new password at next sign-in";
  }
}

export function UserDetailsPanel({
  user,
  onClose,
  roles,
  catalog,
  canManageSuperAdmins,
  scopeOptions,
  onChanged,
  onManageAccess,
}: {
  user: UserRow | null;
  onClose: () => void;
  roles: RoleRow[];
  catalog: PermissionMeta[] | null;
  canManageSuperAdmins: boolean;
  scopeOptions: ScopeOptions | null;
  onChanged: () => Promise<void>;
  onManageAccess: (userId: string) => void;
}) {
  const session = useAuthStore((s) => s.user);
  const perms = session?.permissions ?? [];
  const isSelf = !!user && user.id === session?.id;
  const holdsSuperAdmin = !!user && user.roles.includes("SUPER_ADMIN");
  const mayTouch = !holdsSuperAdmin || canManageSuperAdmins;
  const canAssignRoles = perms.includes("user.roles.assign") && !holdsSuperAdmin && !isSelf;
  const canManageStatus = perms.includes("user.status.manage") && mayTouch && !isSelf;
  const canResetPassword = perms.includes("user.password.reset") && mayTouch;
  const canEditProfile = perms.includes("user.update") && mayTouch;
  const canSetScope = !!scopeOptions && mayTouch && !isSelf;

  const [editing, setEditing] = useState<null | "roles" | "scope" | "profile">(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [scopeDraft, setScopeDraft] = useState({ countries: [] as string[], labs: [] as string[] });
  const [scopeReason, setScopeReason] = useState("");
  const [profileDraft, setProfileDraft] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [issued, setIssued] = useState<string | null>(null);

  const history = useApi<{ rows: HistoryEntry[]; hasMore: boolean }>(user ? `${USERS_URL}/${encodeURIComponent(user.id)}/history?pageSize=20` : null);
  const roleName = (code: string) => roleLabel(code, roles);

  const grouped = useMemo(() => {
    if (!user || !catalog) return null;
    const byArea = new Map<string, PermissionMeta[]>();
    for (const meta of catalog) if (user.permissions.includes(meta.id)) byArea.set(meta.area, [...(byArea.get(meta.area) ?? []), meta]);
    return [...byArea.entries()];
  }, [user, catalog]);

  if (!user) return <Sheet open={false} />;

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await apiPost<{ temporaryPassword?: string | null }>(USERS_URL, body);
      if (res.temporaryPassword) setIssued(res.temporaryPassword);
      setEditing(null);
      setMessage({ kind: "ok", text: done });
      await onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "The change was not saved." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            {user.name}
            <Badge variant={STATUS_VARIANT[user.displayStatus]}>{STATUS_LABEL[user.displayStatus]}</Badge>
          </SheetTitle>
          <SheetDescription>
            {user.username}
            {user.email ? ` · ${user.email}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 p-4 text-xs">
          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>
              {message.text}
            </p>
          )}
          {issued && <OneTimePassword username={user.username} password={issued} />}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <dt className="text-muted-foreground">Last sign-in</dt>
            <dd>{formatWhen(user.lastActive)}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatWhen(user.createdAt)}</dd>
          </dl>

          {editing === "profile" ? (
            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Profile</h3>
              <Input aria-label="Full name" value={profileDraft.name} maxLength={100} onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })} />
              <Input aria-label="Email" type="email" value={profileDraft.email} maxLength={200} onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })} />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !profileDraft.name.trim()} onClick={() => run({ op: "update", id: user.id, displayName: profileDraft.name.trim(), email: profileDraft.email.trim() }, "Profile saved.")}>Save</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </section>
          ) : (
            canEditProfile && (
              <Button size="sm" variant="outline" onClick={() => { setProfileDraft({ name: user.name, email: user.email }); setEditing("profile"); }}>
                Edit name or email
              </Button>
            )
          )}

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Roles</h3>
              {canAssignRoles && editing !== "roles" && (
                <Button size="sm" variant="outline" onClick={() => { setRoleDraft(user.roles); setEditing("roles"); }}>Change roles</Button>
              )}
            </div>
            {editing === "roles" ? (
              <>
                <RolePicker idPrefix={`details-${user.id}`} roles={roles} value={roleDraft} onChange={setRoleDraft} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || roleDraft.length === 0} onClick={() => run({ op: "setRoles", id: user.id, roles: roleDraft }, "Roles saved. They apply on the user's next request.")}>Save roles</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {user.roles.map((code) => (
                  <Badge key={code} variant={code === "SUPER_ADMIN" ? "critical" : "default"}>{roleName(code)}</Badge>
                ))}
              </div>
            )}
            {isSelf && <p className="text-[11px] text-muted-foreground">You cannot change your own roles, scope or status.</p>}
            {holdsSuperAdmin && !isSelf && <p className="text-[11px] text-muted-foreground">Super Admin access is managed on the server.</p>}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Country and lab scope</h3>
              {canSetScope && editing !== "scope" && user.accessScope && (
                <Button size="sm" variant="outline" onClick={() => { setScopeDraft({ countries: user.accessScope!.countries, labs: user.accessScope!.labs }); setScopeReason(""); setEditing("scope"); }}>Change scope</Button>
              )}
            </div>
            {editing === "scope" && scopeOptions ? (
              <>
                <ScopePicker idPrefix={`details-${user.id}`} options={scopeOptions} value={scopeDraft} onChange={setScopeDraft} />
                <Input aria-label="Reason for the scope change" placeholder="Reason (required)" value={scopeReason} maxLength={500} onChange={(e) => setScopeReason(e.target.value)} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || !scopeReason.trim() || !scopeChoiceValid(session?.accessScope, scopeDraft)}
                    onClick={() => run({ op: "setScope", id: user.id, countries: scopeDraft.countries, labs: scopeDraft.labs, reason: scopeReason.trim() }, "Scope saved. It applies on the user's next request.")}
                  >
                    Save scope
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </>
            ) : (
              <p>{scopeSummary(user.accessScope)}</p>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Effective permissions ({user.permissionCount})</h3>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => onManageAccess(user.id)}>
                <ShieldCheck className="h-3.5 w-3.5" /> Manage access
              </Button>
            </div>
            {grouped ? (
              grouped.length === 0 ? (
                <p className="text-muted-foreground">No permissions.</p>
              ) : (
                <ul className="space-y-1.5">
                  {grouped.map(([area, items]) => (
                    <li key={area}>
                      <span className="font-medium">{area}:</span> <span className="text-muted-foreground">{items.map((m) => m.label).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <p className="text-muted-foreground">Permission names are shown to readers of roles.</p>
            )}
          </section>

          {(canManageStatus || canResetPassword) && (
            <section className="flex flex-wrap gap-2 border-t border-border pt-4">
              {canManageStatus && user.status === "ACTIVE" && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => run({ op: "setStatus", id: user.id, status: "SUSPENDED" }, "Account suspended and signed out.")}>
                  <UserX className="h-3.5 w-3.5" /> Suspend
                </Button>
              )}
              {canManageStatus && user.status !== "ACTIVE" && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => run({ op: "setStatus", id: user.id, status: "ACTIVE" }, "Account reactivated.")}>
                  <UserCheck className="h-3.5 w-3.5" /> Reactivate
                </Button>
              )}
              {canManageStatus && user.status !== "DISABLED" && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => run({ op: "setStatus", id: user.id, status: "DISABLED" }, "Account disabled. Its history is kept.")}>
                  Disable
                </Button>
              )}
              {canResetPassword && (
                <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => run({ op: "resetPassword", id: user.id }, "Temporary password issued; existing sessions were signed out.")}>
                  <KeyRound className="h-3.5 w-3.5" /> Reset password
                </Button>
              )}
            </section>
          )}

          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Access history</h3>
            {history.isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : history.error ? (
              <p className="text-muted-foreground">History is unavailable.</p>
            ) : (history.data?.rows.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">No recorded access changes.</p>
            ) : (
              <ol className="space-y-2">
                {history.data!.rows.map((entry, i) => (
                  <li key={`${entry.at}-${i}`} className="rounded-md border border-border/70 px-2.5 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{HISTORY_LABEL[entry.action]}</span>
                      <time className="text-muted-foreground" dateTime={entry.at}>{formatWhen(entry.at)}</time>
                    </div>
                    <p className="text-muted-foreground">{describeChange(entry, roleName)}</p>
                    <p className="text-[11px] text-muted-foreground">
                      By {entry.actor}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </li>
                ))}
                {history.data!.hasMore && <li className="text-[11px] text-muted-foreground">Showing the 20 most recent changes. The full record is in the audit log.</li>}
              </ol>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
