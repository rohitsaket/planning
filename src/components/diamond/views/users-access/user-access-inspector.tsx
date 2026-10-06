"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/diamond/shared/badges";
import { STATUS_LABEL, STATUS_VARIANT, SUPER_ADMIN_CODE, scopeSummary, type PermissionMeta, type RoleRow, type UserRow } from "./shared";

export function UserAccessInspector({
  user,
  roles,
  catalog,
  areas,
  onClose,
  onSelectRole,
}: {
  user: UserRow;
  roles: RoleRow[];
  catalog: PermissionMeta[];
  areas: string[];
  onClose: () => void;
  onSelectRole: (roleId: string) => void;
}) {
  const userRoles = roles.filter((r) => user.roles.includes(r.code));
  const holdsSuperAdmin = user.roles.includes(SUPER_ADMIN_CODE);
  const grantedBy = (permissionId: string) => {
    const names = userRoles.filter((r) => r.status === "ACTIVE" && r.permissions.includes(permissionId)).map((r) => r.name);
    return names.length === 0 && holdsSuperAdmin ? ["Super Admin"] : names;
  };
  const held = catalog.filter((p) => user.permissions.includes(p.id));
  const withheld = catalog.filter((p) => p.sensitive && p.capability === "Approve" && !user.permissions.includes(p.id));

  const restrictions: string[] = [];
  if (user.status !== "ACTIVE") restrictions.push(`The account is ${STATUS_LABEL[user.status].toLowerCase()}: none of this access applies until it is reactivated.`);
  if (user.mustChangePassword) restrictions.push("Until the user sets their own password, a session can only change the password or sign out.");
  if (userRoles.some((r) => r.status === "INACTIVE")) restrictions.push("A retired role on this account grants nothing.");
  if (withheld.length > 0) restrictions.push(`Approvals are never implied by other access. Not held: ${withheld.map((p) => p.label).join(", ")}.`);

  return (
    <section aria-labelledby="inspector-heading" className="rounded-lg border border-border bg-card">
      <header className="flex items-start gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 id="inspector-heading" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Access of {user.name}
            <Badge variant={STATUS_VARIANT[user.displayStatus]}>{STATUS_LABEL[user.displayStatus]}</Badge>
          </h2>
          <p className="text-[11px] text-muted-foreground">{user.username} · {scopeSummary(user.accessScope)}</p>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Close access inspector" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
      </header>
      <div className="space-y-3 p-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Roles:</span>
          {holdsSuperAdmin && <span className="rounded-md border border-border px-2 py-0.5 font-medium" title="Managed on the server">Super Admin</span>}
          {userRoles.length === 0 && !holdsSuperAdmin && <span className="text-muted-foreground">none</span>}
          {userRoles.map((r) => (
            <button key={r.id} type="button" onClick={() => onSelectRole(r.id)} className="rounded-md border border-border px-2 py-0.5 font-medium hover:bg-muted" title="Open this role in the editor">
              {r.name}
            </button>
          ))}
        </div>
        {restrictions.length > 0 && (
          <ul className="list-disc space-y-1 pl-4 text-amber-800 dark:text-amber-300">
            {restrictions.map((t) => <li key={t}>{t}</li>)}
          </ul>
        )}
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {areas.map((area) => {
            const items = held.filter((p) => p.area === area);
            if (items.length === 0) return null;
            return (
              <div key={area}>
                <p className="font-semibold">{area}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {items.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                      <span>{p.label}</span>
                      <span className="text-muted-foreground">Granted by: {grantedBy(p.id).join(", ") || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {held.length === 0 && <p className="text-muted-foreground">This account has no permissions.</p>}
        </div>
      </div>
    </section>
  );
}
