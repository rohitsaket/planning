"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { UsersTab } from "@/components/diamond/views/users-access/users-tab";
import { PermissionsTab } from "@/components/diamond/views/users-access/permissions-tab";
import { KeyRound, Users } from "lucide-react";

// Two tabs only. Users holds accounts and the access-request review queue; Permissions holds
// roles, what each role may do, and the per-user access inspector.
export const USERS_ACCESS_TABS: HostTabItem[] = [
  { id: "users", label: "Users", icon: <Users className="h-3.5 w-3.5" />, permission: ["user.read", "access_request.review"], component: UsersTab },
  { id: "permissions", label: "Permissions", icon: <KeyRound className="h-3.5 w-3.5" />, permission: "role.read", component: PermissionsTab },
];

export function UsersAccessView() {
  return (
    <TabbedHostView
      title="Users & Access"
      subtitle="Accounts, roles and permissions"
      tabs={USERS_ACCESS_TABS}
      defaultTab="users"
    />
  );
}
