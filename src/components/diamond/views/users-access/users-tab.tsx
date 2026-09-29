"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/diamond/shared/badges";
import { useApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { useAccessFocusStore } from "@/stores/access-focus-store";
import { AccessRequestQueue } from "./access-request-queue";
import { AddUserDialog } from "./add-user-dialog";
import { UserDetailsPanel } from "./user-details-panel";
import {
  ROLES_URL,
  STATUS_LABEL,
  STATUS_VARIANT,
  USERS_URL,
  formatWhen,
  roleLabel,
  scopeSummary,
  useAccessRefresh,
  type RolesResponse,
  type UsersResponse,
} from "./shared";

const PAGE_SIZE = 50;

export function UsersTab() {
  const perms = useAuthStore((s) => s.user?.permissions ?? []);
  const canReadUsers = perms.includes("user.read");
  const canCreate = perms.includes("user.create");
  const canReview = perms.includes("access_request.review");
  const canReadRoles = perms.includes("role.read");
  const setView = useNavStore((s) => s.setView);
  const setFocusUserId = useAccessFocusStore((s) => s.setFocusUserId);
  const refresh = useAccessRefresh();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Search runs on the server across every account; typing settles before it is sent.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const usersUrl = canReadUsers ? `${USERS_URL}?page=${page}&pageSize=${PAGE_SIZE}${search ? `&q=${encodeURIComponent(search)}` : ""}` : null;
  const users = useApi<UsersResponse>(usersUrl, { placeholderData: (prev) => prev });
  const roles = useApi<RolesResponse>(canReadRoles ? ROLES_URL : null);

  const roleRows = roles.data?.roles ?? [];
  const roleName = (code: string) => roleLabel(code, roleRows);
  const rows = users.data?.rows ?? [];
  const selected = rows.find((u) => u.id === selectedId) ?? null;

  const manageAccess = (userId: string) => {
    setFocusUserId(userId);
    setSelectedId(null);
    setView("admin-users-access", "permissions");
  };

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      {canReview && <AccessRequestQueue onDecided={refresh} />}

      {canReadUsers ? (
        <section aria-labelledby="users-heading" className="rounded-lg border border-border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <h2 id="users-heading" className="text-sm font-semibold">
              Users <span className="ml-1 text-[11px] font-normal text-muted-foreground tabular-nums">{users.data ? `${users.data.total} ${search ? "matching" : "total"}` : ""}</span>
            </h2>
            <div className="relative ml-auto w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search users by name, username or email" placeholder="Search name, username or email" value={searchInput} maxLength={100} onChange={(e) => setSearchInput(e.target.value)} className="h-8 pl-7 text-xs" />
            </div>
            {canCreate && (
              <Button size="sm" className="h-8 gap-1" onClick={() => setAdding(true)} disabled={!roles.data}>
                <Plus className="h-3.5 w-3.5" /> Add user
              </Button>
            )}
          </header>

          {/* Positioned so the visually hidden "Actions" header stays inside the scroll area
              rather than stretching the page on narrow screens. */}
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Name</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Username / email</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Roles</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Scope</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Last sign-in</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold">Access</th>
                  <th scope="col" className="px-3 py-1.5 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.isLoading ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading users…</td></tr>
                ) : users.error ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Users could not be loaded.</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{search ? "No users match your search." : "No users yet."}</td></tr>
                ) : (
                  rows.map((u) => (
                    <tr key={u.id} className="h-row hover:bg-muted/30">
                      <td className="whitespace-nowrap px-3 py-1 font-medium">{u.name}</td>
                      <td className="whitespace-nowrap px-3 py-1">
                        <span className="font-mono">{u.username}</span>
                        {u.email && <span className="text-muted-foreground"> · {u.email}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1"><Badge variant={STATUS_VARIANT[u.displayStatus]}>{STATUS_LABEL[u.displayStatus]}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-1">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((code) => <Badge key={code} variant={code === "SUPER_ADMIN" ? "critical" : "default"}>{roleName(code)}</Badge>)}
                        </div>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-1 text-muted-foreground" title={scopeSummary(u.accessScope)}>{scopeSummary(u.accessScope)}</td>
                      <td className="whitespace-nowrap px-3 py-1 tabular-nums text-muted-foreground">{formatWhen(u.lastActive)}</td>
                      <td className="whitespace-nowrap px-3 py-1 tabular-nums">{u.permissionCount} permissions</td>
                      <td className="whitespace-nowrap px-3 py-1 text-right">
                        <Button size="sm" variant="outline" className="h-7" onClick={() => setSelectedId(u.id)} aria-label={`Details for ${u.name}`}>Details</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {users.data && users.data.totalPages > 1 && (
            <footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs">
              <span className="text-muted-foreground">Page {users.data.page} of {users.data.totalPages}</span>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="Next page" disabled={page >= users.data.totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
            </footer>
          )}
        </section>
      ) : (
        !canReview && <p className="text-xs text-muted-foreground">You do not have access to user accounts.</p>
      )}

      {roles.data && (
        <AddUserDialog
          open={adding}
          onOpenChange={setAdding}
          roles={roleRows}
          scopeOptions={users.data?.scopeOptions ?? null}
          onCreated={refresh}
        />
      )}

      {/* Keyed by account so edits in progress never carry over to another user. */}
      <UserDetailsPanel
        key={selected?.id ?? "none"}
        user={selected}
        onClose={() => setSelectedId(null)}
        roles={roleRows}
        catalog={roles.data?.catalog.permissions ?? null}
        canManageSuperAdmins={users.data?.canManageSuperAdmins ?? false}
        scopeOptions={users.data?.scopeOptions ?? null}
        onChanged={refresh}
        onManageAccess={manageAccess}
      />
    </div>
  );
}
