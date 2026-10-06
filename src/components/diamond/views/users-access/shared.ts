"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore, type SessionUser } from "@/stores/auth-store";

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";
export type DisplayStatus = AccountStatus | "INVITED";

export interface AccessScope {
  countries: string[];
  labs: string[];
  unrestricted: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  username: string;
  email: string;
  roles: string[];
  status: AccountStatus;
  displayStatus: DisplayStatus;
  lastActive: string | null;
  permissionCount: number;
  permissions: string[];
  createdAt: string;
  mustChangePassword: boolean;
  accessScope: AccessScope | null;
}

export interface ScopeOptions {
  countries: Array<{ code: string; name: string }>;
  labs: string[];
}

export interface UsersResponse {
  rows: UserRow[];
  total: number;
  page: number;
  totalPages: number;
  canManageScope: boolean;
  canManageSuperAdmins: boolean;
  canReadScope: boolean;
  scopeOptions: ScopeOptions | null;
}

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  version: number;
  permissions: string[];
  userCount: number;
  createdAt: string;
}

export interface PermissionMeta {
  id: string;
  label: string;
  area: string;
  capability: string;
  sensitive: boolean;
}

export interface RolesResponse {
  roles: RoleRow[];
  total: number;
  catalog: { areas: string[]; capabilities: string[]; permissions: PermissionMeta[] };
  canEditPermissions: boolean;
  canManageRoles: boolean;
}

export const SUPER_ADMIN_CODE = "SUPER_ADMIN";
export function roleLabel(code: string, roles: readonly RoleRow[]): string {
  if (code === SUPER_ADMIN_CODE) return "Super Admin";
  return roles.find((r) => r.code === code)?.name ?? code;
}

export const USERS_URL = "/api/admin/users";
export const ROLES_URL = "/api/admin/roles";
export const ACCESS_REQUESTS_URL = "/api/admin/access-requests";

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  INVITED: "Invited",
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DISABLED: "Disabled",
};

export const STATUS_VARIANT: Record<DisplayStatus, "info" | "success" | "warning" | "neutral"> = {
  INVITED: "info",
  ACTIVE: "success",
  SUSPENDED: "warning",
  DISABLED: "neutral",
};

export function scopeSummary(scope: AccessScope | null): string {
  if (!scope) return "Not visible";
  if (scope.unrestricted) return "All countries and labs";
  const part = (values: string[], all: string, label: string) => (values.length === 0 ? all : `${label}: ${values.join(", ")}`);
  return `${part(scope.countries, "All countries", "Countries")} · ${part(scope.labs, "All labs", "Labs")}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function useAccessRefresh() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  return async () => {
    await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/") });
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.ok) setUser((await res.json()).user as SessionUser);
    } catch {
      // The session is re-resolved on the next request regardless.
    }
  };
}
