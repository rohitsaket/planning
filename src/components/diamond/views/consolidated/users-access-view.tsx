"use client";

import { TabbedHostView, HostTabItem } from "@/components/diamond/shared/tabbed-host-view";
import { UsersView } from "@/components/diamond/views/users-view";
import { AccessRequestsView } from "@/components/diamond/views/access-requests-view";
import { Users, UserPlus } from "lucide-react";

const TABS: HostTabItem[] = [
  { id: "users", label: "Users & Roles", icon: <Users className="h-3.5 w-3.5" />, permission: "user.read", component: UsersView },
  { id: "requests", label: "Access Requests", icon: <UserPlus className="h-3.5 w-3.5" />, permission: "access_request.review", component: AccessRequestsView },
];

export function UsersAccessView() {
  return (
    <TabbedHostView
      title="Users and Access"
      subtitle="Accounts, roles and the self-service registration approval queue, each governed by its own permission"
      tabs={TABS}
      defaultTab="users"
    />
  );
}
