"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { UsersView } from "@/components/diamond/views/users-view";
import { AccessRequestsView } from "@/components/diamond/views/access-requests-view";
import { Users, UserPlus } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "users", label: "Users & Roles", icon: <Users className="h-3.5 w-3.5" />, permission: "user.manage", component: UsersView },
  { id: "requests", label: "Access Requests", icon: <UserPlus className="h-3.5 w-3.5" />, permission: "user.manage", component: AccessRequestsView },
];

export function UsersAccessView() {
  return (
    <TabbedHostView
      title="Users and Access"
      subtitle="Enterprise role-based access control, user accounts, and self-service registration approval queue"
      tabs={TABS}
      defaultTab="users"
    />
  );
}
