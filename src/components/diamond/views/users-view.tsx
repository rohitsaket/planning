"use client";

import React, { useState, useMemo } from "react";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import {
  Users,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Plus,
  Trash2,
  Edit2,
  KeyRound,
  Lock,
  UserCheck,
  UserX,
  Search,
  Check,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Eye,
  Layers,
  Sparkles,
  RefreshCw,
  ExternalLink,
  Loader2,
  Sliders,
  CheckSquare,
  Square,
  UserCog,
  Globe,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  PERMISSIONS as SERVER_PERMISSIONS,
  ROLES as SERVER_ROLES,
  ROLE_PERMISSIONS as SERVER_ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from "@/lib/auth/permissions";
import { useApi, apiPost } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

// ---------------------------------------------------------------------------
// Permission Catalogue & Categorization
// ---------------------------------------------------------------------------
export interface PermissionMeta {
  code: Permission;
  name: string;
  category: string;
  description: string;
}

export const PERMISSION_METAS: PermissionMeta[] = [
  // Requirements
  { code: "requirement.read", name: "View Requirements", category: "Requirements", description: "View requirement rows and engine-computed demand lines." },
  { code: "requirement.create", name: "Create Requirements", category: "Requirements", description: "Create custom customer-driven requirement requests." },
  { code: "requirement.override", name: "Override Requirements", category: "Requirements", description: "Override engine-derived requirement quantities and parameters." },
  { code: "requirement.export", name: "Export Requirements", category: "Requirements", description: "Export requirements matrix datasets to CSV/Excel." },

  // Planning
  { code: "plan.read", name: "View Planning Cases", category: "Planning", description: "Read planning cases, versions, and generated cutting options." },
  { code: "plan.create", name: "Create Planning Case", category: "Planning", description: "Initialize planning cases and trigger yield solver." },
  { code: "plan.select", name: "Select Plan Option", category: "Planning", description: "Select the optimal commercial or yield plan option." },
  { code: "plan.approve", name: "Approve Plan Option", category: "Planning", description: "Formally approve plan for manufacturing release." },
  { code: "plan.replan", name: "Trigger Replan", category: "Planning", description: "Trigger replan cycle when manufacturing criteria change." },
  { code: "plan.export", name: "Export Planning Cases", category: "Planning", description: "Export planning cases and piece allocations." },

  // Rough Inventory
  { code: "rough.read", name: "View Rough Stock", category: "Rough Diamond", description: "Read rough diamond stock, parcels, and lot details." },
  { code: "rough.reserve", name: "Reserve Rough Stones", category: "Rough Diamond", description: "Soft-reserve rough stones against approved planning options." },

  // Commercial & Sales
  { code: "sales.read", name: "View Sales Analysis", category: "Commercial & Sales", description: "View historical sales records, invoices, and prices." },
  { code: "sales.export", name: "Export Sales Data", category: "Commercial & Sales", description: "Export historical sales and invoice datasets." },
  { code: "customers.read", name: "View Customer Accounts", category: "Commercial & Sales", description: "View customer profiles, preferences, and credit tiers." },
  { code: "customers.export", name: "Export Customer Accounts", category: "Commercial & Sales", description: "Export customer master data and contact records." },
  { code: "orders.read", name: "View Sales Orders", category: "Commercial & Sales", description: "View open sales orders and fulfillment pipelines." },
  { code: "orders.export", name: "Export Sales Orders", category: "Commercial & Sales", description: "Export sales orders and shipment logs." },

  // Demand & Forecast
  { code: "demand.run", name: "Execute Demand Run", category: "Demand & Forecast", description: "Execute demand engine calculation across historical windows." },
  { code: "demand.unlock", name: "Force-Unlock Demand Run", category: "Demand & Forecast", description: "Release stuck concurrency locks on demand calculation engine." },
  { code: "demand.trace", name: "Inspect Demand Trace", category: "Demand & Forecast", description: "Audit math and step-by-step lineage of requirement calculations." },
  { code: "demand.export", name: "Export Demand Results", category: "Demand & Forecast", description: "Export demand run matrices and lineage logs." },
  { code: "forecast.run", name: "Run Forecast Model", category: "Demand & Forecast", description: "Execute statistical baseline and trend forecast algorithms." },
  { code: "forecast.publish", name: "Publish Forecast", category: "Demand & Forecast", description: "Promote forecast outputs to drive production planning." },

  // Fantasy ERP
  { code: "fantasy.read", name: "View Fantasy ERP Live", category: "Fantasy ERP", description: "View synchronized Fantasy stock, locations, and departments." },
  { code: "fantasy.sync.run", name: "Trigger Fantasy Sync", category: "Fantasy ERP", description: "Trigger routine synchronization from Fantasy ERP source." },
  { code: "fantasy.sync.retry", name: "Retry Failed Sync", category: "Fantasy ERP", description: "Retry failed sync batches with monotonic checkpoints." },
  { code: "fantasy.sync.unlock", name: "Unlock Fantasy Sync", category: "Fantasy ERP", description: "Release stuck distributed mutex lock on Fantasy ingestion." },
  { code: "fantasy.export", name: "Export Fantasy Raw", category: "Fantasy ERP", description: "Export raw ingested Fantasy ERP snapshots." },
  { code: "overall.read", name: "View Overall Data", category: "Fantasy ERP", description: "View consolidated master inventory records across all branches." },
  { code: "overall.export", name: "Export Overall Data", category: "Fantasy ERP", description: "Export complete consolidated master inventory." },

  // Data Quality
  { code: "data_quality.read", name: "View Data Quality", category: "Data Quality", description: "Inspect data quality anomalies, unmapped values, and drift." },
  { code: "data_quality.manage", name: "Triage Data Issues", category: "Data Quality", description: "Resolve, quarantine, or ignore data quality anomalies." },
  { code: "data_quality.export", name: "Export Data Issues", category: "Data Quality", description: "Export anomaly logs and reconciliation reports." },

  // System Administration
  { code: "config.read", name: "View System Config", category: "System Administration", description: "Read system configuration, weight bands, and shape mappings." },
  { code: "config.export", name: "Export System Config", category: "System Administration", description: "Export system configurations and master mappings." },
  { code: "business_rule.read", name: "View Business Rules", category: "System Administration", description: "Read rule parameters and engine tolerances." },
  { code: "business_rule.manage", name: "Manage Business Rules", category: "System Administration", description: "Update business rule thresholds and engine equations." },
  { code: "feature_flag.read", name: "View Feature Flags", category: "System Administration", description: "Inspect current runtime feature toggles." },
  { code: "feature_flag.manage", name: "Manage Feature Flags", category: "System Administration", description: "Toggle experimental features and rollback switches." },
  { code: "notification.read", name: "Read Notifications", category: "System Administration", description: "Receive real-time system alerts and push notifications." },
  { code: "notification.manage", name: "Manage Notifications", category: "System Administration", description: "Mark notifications resolved and triage global alerts." },
  { code: "notification.broadcast", name: "Broadcast Notifications", category: "System Administration", description: "Send system-wide broadcast alerts to all connected users." },

  // Audit & Security
  { code: "audit.read", name: "Read Audit Logs", category: "Audit & Compliance", description: "Read operational and data-change audit history." },
  { code: "audit.export", name: "Export Audit Logs", category: "Audit & Compliance", description: "Export complete immutable audit logs for compliance." },
  { code: "security_audit.read", name: "Read Security Audit", category: "Audit & Compliance", description: "Inspect access control, login, and authorization event logs." },
  { code: "security_audit.export", name: "Export Security Audit", category: "Audit & Compliance", description: "Export security and privilege modification audits." },

  // Access Governance
  { code: "user.read", name: "Read User Directory", category: "Access Governance", description: "View user directory, roles, and access assignments." },
  { code: "user.create", name: "Create User Accounts", category: "Access Governance", description: "Provision new user accounts and assign initial roles." },
  { code: "user.update", name: "Update User Profiles", category: "Access Governance", description: "Modify user profile details and contact information." },
  { code: "user.status.manage", name: "Manage User Status", category: "Access Governance", description: "Activate, suspend, disable, or delete user accounts." },
  { code: "user.roles.assign", name: "Assign User Roles", category: "Access Governance", description: "Assign or modify roles and permissions for user accounts." },
  { code: "user.password.reset", name: "Reset User Password", category: "Access Governance", description: "Issue temporary passwords and force reset on next login." },
  { code: "user.sessions.read", name: "Inspect User Sessions", category: "Access Governance", description: "View active user sessions, IP addresses, and user agents." },
  { code: "user.sessions.revoke", name: "Revoke User Sessions", category: "Access Governance", description: "Forcefully terminate active sessions for any user." },
  { code: "user.super_admin.assign", name: "Assign Super Admin", category: "Access Governance", description: "Grant or revoke the protected Super Admin role." },
  { code: "access_request.review", name: "Review Access Requests", category: "Access Governance", description: "Approve or reject self-service registration requests." },
  { code: "role.read", name: "Read Roles & Policies", category: "Access Governance", description: "View RBAC roles, permission policies, and matrix." },
  { code: "role.manage", name: "Manage Custom Roles", category: "Access Governance", description: "Create, update, or delete custom RBAC roles." },
  { code: "role.permissions.assign", name: "Edit Role Permissions", category: "Access Governance", description: "Grant or revoke granular permissions on custom roles." },
];

const PERMISSION_MAP = new Map(PERMISSION_METAS.map((p) => [p.code, p]));

// Group permissions by category
const CATEGORIES = Array.from(new Set(PERMISSION_METAS.map((p) => p.category)));

interface UserRecord {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  roles: string[];
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  lastActive: string | null;
  permissionCount: number;
  permissions: Permission[];
  createdAt: string;
  mustChangePassword?: boolean;
  /**
   * Which countries and labs this account may read.
   *
   * Empty arrays mean unrestricted, which is not the same as no access. `null` means the
   * signed-in reader does not hold `user.scope.read` and the scope is withheld from them.
   */
  accessScope: { countries: string[]; labs: string[]; unrestricted: boolean } | null;
}

interface RoleRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: "ACTIVE" | "INACTIVE";
  permissions: Permission[];
  userCount: number;
  createdAt: string;
}

const roleBadgeVariant = (roleCode: string): "critical" | "warning" | "info" | "success" | "neutral" | "default" => {
  if (roleCode === "SUPER_ADMIN") return "critical";
  if (roleCode === "ADMIN") return "warning";
  if (roleCode.includes("MANAGER")) return "warning";
  if (roleCode.includes("VIEWER") || roleCode === "AUDITOR") return "neutral";
  if (roleCode === "FANTASY_INTEGRATION") return "info";
  return "default";
};

export function UsersView() {
  const currentUser = useAuthStore((st) => st.user);
  const userPermissions = currentUser?.permissions ?? [];
  const canReadUsers = userPermissions.includes("user.read");
  const canCreateUser = userPermissions.includes("user.create");
  const canUpdateUser = userPermissions.includes("user.update");
  const canManageStatus = userPermissions.includes("user.status.manage");
  const canAssignRoles = userPermissions.includes("user.roles.assign");
  // Deliberately separate from role assignment: an administrator who may hand out roles
  // does not thereby decide how much of the business an account can read. The server
  // makes the same decision again; hiding the control here is UX, not the boundary.
  const canAssignScope = userPermissions.includes("user.scope.assign");
  const canReadScope = userPermissions.includes("user.scope.read");
  const canResetPassword = userPermissions.includes("user.password.reset");
  const canManageRoles = userPermissions.includes("role.manage");
  const canAssignPermissions = userPermissions.includes("role.permissions.assign");
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN";

  const [activeTab, setActiveTab] = useState<"users" | "roles" | "matrix" | "catalog">("users");
  const [toastMessage, setToastMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Queries
  const usersQuery = useApi<{ rows: UserRecord[]; total: number; canManageScope: boolean; canReadScope: boolean }>(
    canReadUsers ? "/api/admin/users?pageSize=100" : null,
  );
  const rolesQuery = useApi<{ roles: RoleRecord[]; total: number }>("/api/admin/roles");

  const users = usersQuery.data?.rows ?? [];
  const roles = rolesQuery.data?.roles ?? [];

  const refreshData = async () => {
    await Promise.all([usersQuery.refetch(), rolesQuery.refetch()]);
  };

  const showToast = (type: "success" | "error", text: string) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 5000);
  };

  // ---------------------------------------------------------------------------
  // Modal States
  // ---------------------------------------------------------------------------
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    email: "",
    selectedRoles: ["VIEWER"] as string[],
    password: "",
  });

  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [editUserForm, setEditUserForm] = useState({ displayName: "", email: "" });

  const [assigningRolesUser, setAssigningRolesUser] = useState<UserRecord | null>(null);
  const [scopingUser, setScopingUser] = useState<UserRecord | null>(null);
  const [scopeForm, setScopeForm] = useState({ countries: "", labs: "", reason: "" });
  const [assignedRolesSelection, setAssignedRolesSelection] = useState<string[]>([]);

  const [inspectingUser, setInspectingUser] = useState<UserRecord | null>(null);
  const [permSearch, setPermSearch] = useState("");

  const [resettingPasswordUser, setResettingPasswordUser] = useState<UserRecord | null>(null);
  const [newPasswordValue, setNewPasswordValue] = useState("");
  const [copiedPassword, setCopiedPassword] = useState(false);

  const [deletingUser, setDeletingUser] = useState<UserRecord | null>(null);
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");

  // Role Modals
  const [isCreateRoleOpen, setIsCreateRoleOpen] = useState(false);
  const [newRoleForm, setNewRoleForm] = useState({
    code: "",
    name: "",
    description: "",
    selectedPermissions: [] as Permission[],
  });

  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [editRoleForm, setEditRoleForm] = useState({
    name: "",
    description: "",
    selectedPermissions: [] as Permission[],
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
  });

  const [deletingRole, setDeletingRole] = useState<RoleRecord | null>(null);

  // Matrix State
  const [matrixFilterCategory, setMatrixFilterCategory] = useState<string>("ALL");
  const [matrixSearch, setMatrixSearch] = useState("");
  const [matrixViewMode, setMatrixViewMode] = useState<"roles" | "users">("roles");
  const [updatingPermKey, setUpdatingPermKey] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers - User Management
  // ---------------------------------------------------------------------------
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost("/api/admin/users", {
        op: "create",
        username: newUser.username.trim().toLowerCase(),
        displayName: newUser.displayName.trim(),
        email: newUser.email.trim() || undefined,
        roles: newUser.selectedRoles,
        password: newUser.password,
      });
      showToast("success", `User '${newUser.username}' created successfully.`);
      setIsAddUserOpen(false);
      setNewUser({ username: "", displayName: "", email: "", selectedRoles: ["VIEWER"], password: "" });
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to create user.");
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await apiPost("/api/admin/users", {
        op: "update",
        id: editingUser.id,
        displayName: editUserForm.displayName.trim(),
        email: editUserForm.email.trim() || undefined,
      });
      showToast("success", `User '${editingUser.username}' updated.`);
      setEditingUser(null);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to update user.");
    }
  };

  const handleSaveAssignedRoles = async () => {
    if (!assigningRolesUser) return;
    try {
      await apiPost("/api/admin/users", {
        op: "setRoles",
        id: assigningRolesUser.id,
        roles: assignedRolesSelection,
      });
      showToast("success", `Updated roles for '${assigningRolesUser.username}'.`);
      setAssigningRolesUser(null);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to assign roles.");
    }
  };

  /**
   * Replaces an account's data scope with exactly what the form holds.
   *
   * An empty list is sent as an empty list, not omitted: it is the explicit grant of
   * unrestricted access to that dimension, and it is how a restriction is removed.
   */
  const handleSaveAccessScope = async () => {
    if (!scopingUser) return;
    const split = (value: string) =>
      value
        .split(/[\n,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    try {
      await apiPost("/api/admin/users", {
        op: "setScope",
        id: scopingUser.id,
        countries: split(scopeForm.countries),
        labs: split(scopeForm.labs),
        reason: scopeForm.reason.trim(),
      });
      showToast("success", `Updated data access scope for '${scopingUser.username}'.`);
      setScopingUser(null);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to update data access scope.");
    }
  };

  const handleToggleUserStatus = async (user: UserRecord) => {
    const nextStatus = user.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    try {
      await apiPost("/api/admin/users", {
        op: "setStatus",
        id: user.id,
        status: nextStatus,
      });
      showToast("success", `User '${user.username}' is now ${nextStatus}.`);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to update status.");
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingPasswordUser) return;
    try {
      await apiPost("/api/admin/users", {
        op: "resetPassword",
        id: resettingPasswordUser.id,
        password: newPasswordValue,
      });
      showToast("success", `Password reset for '${resettingPasswordUser.username}'.`);
      setResettingPasswordUser(null);
      setNewPasswordValue("");
      setCopiedPassword(false);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to reset password.");
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    try {
      await apiPost("/api/admin/users", {
        op: "delete",
        id: deletingUser.id,
      });
      showToast("success", `User '${deletingUser.username}' deleted successfully.`);
      setDeletingUser(null);
      setDeleteConfirmUsername("");
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to delete user.");
    }
  };

  // ---------------------------------------------------------------------------
  // Handlers - Role Management & Interactive Toggles
  // ---------------------------------------------------------------------------
  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost("/api/admin/roles", {
        op: "createRole",
        code: newRoleForm.code.trim().toUpperCase(),
        name: newRoleForm.name.trim(),
        description: newRoleForm.description.trim() || undefined,
        permissions: newRoleForm.selectedPermissions,
      });
      showToast("success", `Custom role '${newRoleForm.name}' created.`);
      setIsCreateRoleOpen(false);
      setNewRoleForm({ code: "", name: "", description: "", selectedPermissions: [] });
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to create custom role.");
    }
  };

  const handleUpdateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    try {
      await apiPost("/api/admin/roles", {
        op: "updateRole",
        id: editingRole.id,
        name: editRoleForm.name.trim(),
        description: editRoleForm.description.trim() || undefined,
        permissions: editRoleForm.selectedPermissions,
        status: editRoleForm.status,
      });
      showToast("success", `Role '${editingRole.name}' updated.`);
      setEditingRole(null);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to update role.");
    }
  };

  const handleDeleteRole = async () => {
    if (!deletingRole) return;
    try {
      await apiPost("/api/admin/roles", {
        op: "deleteRole",
        id: deletingRole.id,
      });
      showToast("success", `Role '${deletingRole.name}' deleted.`);
      setDeletingRole(null);
      await refreshData();
    } catch (err: any) {
      showToast("error", err.message || "Failed to delete role.");
    }
  };

  /**
   * Direct Toggle handler for Role x Permission Matrix cell
   */
  const handleToggleRolePermission = async (role: RoleRecord, permCode: Permission) => {
    if (!canAssignPermissions) {
      showToast("error", "You do not have authorization to edit role permissions ('role.permissions.assign').");
      return;
    }

    if (role.isSystem) {
      // Prompt user to clone the system role into a customizable custom role
      const permMeta = PERMISSION_MAP.get(permCode);
      const willHave = !role.permissions.includes(permCode);
      const initialPerms = willHave
        ? Array.from(new Set([...role.permissions, permCode]))
        : role.permissions.filter((p) => p !== permCode);

      setNewRoleForm({
        code: `${role.code}_CUSTOM`,
        name: `${role.name} (Custom)`,
        description: `Customized variant of standard ${role.name} role.`,
        selectedPermissions: initialPerms,
      });
      setIsCreateRoleOpen(true);
      showToast(
        "error",
        `'${role.name}' is a built-in system role (code-protected). We opened the custom role creator so you can customize and save your copy.`
      );
      return;
    }

    const key = `${role.id}-${permCode}`;
    setUpdatingPermKey(key);
    const hasPerm = role.permissions.includes(permCode);
    const updatedPerms = hasPerm
      ? role.permissions.filter((p) => p !== permCode)
      : Array.from(new Set([...role.permissions, permCode]));

    try {
      await apiPost("/api/admin/roles", {
        op: "setPermissions",
        id: role.id,
        permissions: updatedPerms,
      });
      const permName = PERMISSION_MAP.get(permCode)?.name || permCode;
      showToast(
        "success",
        `${hasPerm ? "Revoked" : "Granted"} '${permName}' on '${role.name}'.`
      );
      await rolesQuery.refetch();
    } catch (err: any) {
      showToast("error", err.message || "Failed to update permission.");
    } finally {
      setUpdatingPermKey(null);
    }
  };

  // Helper for generating random strong password
  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*";
    let pwd = "";
    for (let i = 0; i < 14; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return pwd;
  };

  // ---------------------------------------------------------------------------
  // User Table Columns
  // ---------------------------------------------------------------------------
  const userColumns: Column<UserRecord>[] = [
    {
      key: "name",
      header: "User",
      sticky: "left",
      sortable: true,
      cell: (r) => (
        <div className="flex items-center gap-2 py-0.5">
          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
            {r.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
              <span>{r.name}</span>
              {r.id === currentUser?.id && (
                <span className="text-[9px] bg-primary/10 text-primary px-1 rounded font-medium">You</span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono truncate">@{r.username}</div>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      cell: (r) => <span className="text-[11px] text-muted-foreground">{r.email || "—"}</span>,
    },
    {
      key: "roles",
      header: "Assigned Roles",
      cell: (r) => (
        <div className="flex flex-wrap gap-1 items-center">
          {r.roles.map((rc) => (
            <Badge key={rc} variant={roleBadgeVariant(rc)} className="text-[9.5px] py-0 px-1.5">
              {rc}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "permissionCount",
      header: "Effective Permissions",
      align: "center",
      sortable: true,
      cell: (r) => (
        <button
          type="button"
          onClick={() => {
            setInspectingUser(r);
            setPermSearch("");
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-muted/60 hover:bg-muted text-foreground border border-border/80 transition-colors"
          title="Click to inspect all effective permissions"
        >
          <Key className="h-3 w-3 text-primary" />
          <span>{r.permissionCount} perms</span>
          <Eye className="h-2.5 w-2.5 opacity-60 ml-0.5" />
        </button>
      ),
    },
    ...(canReadScope
      ? [
          {
            key: "accessScope",
            header: "Data Scope",
            align: "center" as const,
            cell: (r: UserRecord) => {
              // Unrestricted is stated, not left blank: a blank cell reads as missing data
              // rather than as the deliberate absence of a restriction.
              if (!r.accessScope) return <span className="text-[10px] text-muted-foreground">—</span>;
              if (r.accessScope.unrestricted) {
                return <span className="text-[10px] text-muted-foreground">All countries &amp; labs</span>;
              }
              const parts = [
                r.accessScope.countries.length ? r.accessScope.countries.join(", ") : "all countries",
                r.accessScope.labs.length ? r.accessScope.labs.join(", ") : "all labs",
              ];
              return (
                <Badge variant="warning" className="text-[9.5px] py-0 px-1.5">
                  {parts.join(" / ")}
                </Badge>
              );
            },
          },
        ]
      : []),
    {
      key: "status",
      header: "Status",
      align: "center",
      sortable: true,
      cell: (r) => (
        <Badge
          variant={r.status === "ACTIVE" ? "success" : r.status === "SUSPENDED" ? "warning" : "critical"}
          className="text-[10px]"
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "lastActive",
      header: "Last Active",
      align: "center",
      sortable: true,
      cell: (r) => (
        <span className="text-[10.5px] text-muted-foreground">
          {r.lastActive ? new Date(r.lastActive).toLocaleDateString() : "Never"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (r) => {
        const isSelf = r.id === currentUser?.id;
        return (
          <div className="flex items-center justify-end gap-1">
            {canAssignRoles && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                disabled={isSelf}
                title={isSelf ? "Cannot change your own roles" : "Assign roles & permissions"}
                onClick={() => {
                  setAssigningRolesUser(r);
                  setAssignedRolesSelection(r.roles);
                }}
              >
                <Shield className="h-3 w-3 mr-1 text-primary" /> Roles
              </Button>
            )}

            {canAssignScope && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                disabled={isSelf}
                title={isSelf ? "Cannot change your own data access scope" : "Set which countries and labs this account may read"}
                onClick={() => {
                  setScopingUser(r);
                  setScopeForm({
                    countries: (r.accessScope?.countries ?? []).join(", "),
                    labs: (r.accessScope?.labs ?? []).join(", "),
                    reason: "",
                  });
                }}
              >
                <Globe className="h-3 w-3 mr-1 text-primary" /> Scope
              </Button>
            )}

            {canUpdateUser && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Edit Details"
                onClick={() => {
                  setEditingUser(r);
                  setEditUserForm({ displayName: r.name, email: r.email });
                }}
              >
                <Edit2 className="h-3 w-3" />
              </Button>
            )}

            {canResetPassword && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Reset Password"
                onClick={() => {
                  const gen = generatePassword();
                  setResettingPasswordUser(r);
                  setNewPasswordValue(gen);
                  setCopiedPassword(false);
                }}
              >
                <KeyRound className="h-3 w-3 text-amber-500" />
              </Button>
            )}

            {canManageStatus && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={isSelf}
                title={isSelf ? "Cannot toggle your own status" : r.status === "ACTIVE" ? "Deactivate User" : "Activate User"}
                onClick={() => handleToggleUserStatus(r)}
              >
                {r.status === "ACTIVE" ? (
                  <UserX className="h-3 w-3 text-rose-500" />
                ) : (
                  <UserCheck className="h-3 w-3 text-emerald-500" />
                )}
              </Button>
            )}

            {canManageStatus && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-rose-500/70 hover:text-rose-600 hover:bg-rose-500/10"
                disabled={isSelf}
                title={isSelf ? "Cannot delete your own account" : "Delete User"}
                onClick={() => {
                  setDeletingUser(r);
                  setDeleteConfirmUsername("");
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // Matrix Computations
  // ---------------------------------------------------------------------------
  const filteredMatrixPermissions = useMemo(() => {
    return PERMISSION_METAS.filter((p) => {
      if (matrixFilterCategory !== "ALL" && p.category !== matrixFilterCategory) return false;
      if (matrixSearch.trim()) {
        const q = matrixSearch.toLowerCase();
        return (
          p.code.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [matrixFilterCategory, matrixSearch]);

  const matrixColumns: Column<RoleRecord>[] = useMemo(() => {
    return [
      {
        key: "name",
        header: "Role",
        sticky: "left",
        sortable: true,
        cell: (role) => (
          <div className="flex items-center justify-between gap-2 pr-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <Shield className={cn("h-3.5 w-3.5 shrink-0", role.isSystem ? "text-primary" : "text-amber-500")} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold truncate">{role.name}</span>
                  <Badge variant={role.isSystem ? "neutral" : "warning"} className="text-[9px] px-1 py-0">
                    {role.isSystem ? "System" : "Custom"}
                  </Badge>
                </div>
                <div className="text-[9.5px] text-muted-foreground font-mono truncate">
                  {role.code} · <span className="font-semibold text-foreground">{role.permissions.length}</span> perms
                </div>
              </div>
            </div>
            {role.isSystem && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 text-[9.5px] px-1.5 text-muted-foreground hover:text-primary opacity-70 hover:opacity-100 shrink-0"
                title="Clone standard system role into an editable custom role"
                onClick={() => {
                  setNewRoleForm({
                    code: `${role.code}_CUSTOM`,
                    name: `${role.name} (Custom)`,
                    description: `Customized variant of ${role.name}`,
                    selectedPermissions: [...role.permissions],
                  });
                  setIsCreateRoleOpen(true);
                }}
              >
                <Copy className="h-2.5 w-2.5 mr-1" /> Clone
              </Button>
            )}
          </div>
        ),
      },
      ...filteredMatrixPermissions.map((perm) => ({
        key: perm.code,
        header: perm.name,
        align: "center" as const,
        width: "74px",
        cell: (role: RoleRecord) => {
          const has = role.permissions.includes(perm.code);
          const key = `${role.id}-${perm.code}`;
          const isUpdating = updatingPermKey === key;

          if (role.isSystem) {
            return (
              <button
                type="button"
                onClick={() => handleToggleRolePermission(role, perm.code)}
                title={`System Role (${role.name}): Standard code template. Click to clone & toggle '${perm.name}' in a custom role.`}
                className="group relative inline-flex items-center justify-center p-1 rounded-md transition-all hover:bg-muted/80 cursor-pointer"
              >
                {has ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/10 text-primary border border-primary/20">
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/30 group-hover:text-muted-foreground/60">
                    <Minus className="h-3 w-3" />
                  </span>
                )}
                <Lock className="h-2 w-2 text-muted-foreground/50 absolute bottom-0 right-0" />
              </button>
            );
          }

          return (
            <button
              type="button"
              disabled={isUpdating || !canAssignPermissions}
              onClick={() => handleToggleRolePermission(role, perm.code)}
              title={`${role.name}: Click to ${has ? "REVOKE" : "GRANT"} '${perm.name}'`}
              className={cn(
                "inline-flex h-6 w-7 items-center justify-center rounded-md transition-all font-medium focus:outline-none focus:ring-1 focus:ring-primary shadow-2xs",
                has
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-rose-500/15 hover:text-rose-600 hover:border-rose-500/30"
                  : "bg-muted/30 text-muted-foreground/40 border border-transparent hover:bg-emerald-500/10 hover:text-emerald-600 hover:border-emerald-500/20",
                isUpdating && "opacity-60 cursor-wait"
              )}
            >
              {isUpdating ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : has ? (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              ) : (
                <Plus className="h-3 w-3 opacity-60" />
              )}
            </button>
          );
        },
      })),
    ];
  }, [filteredMatrixPermissions, updatingPermKey, canAssignPermissions]);

  const userMatrixColumns: Column<UserRecord>[] = useMemo(() => {
    return [
      {
        key: "name",
        header: "User Account",
        sticky: "left",
        sortable: true,
        cell: (u) => (
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs shrink-0">
              {u.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold truncate">{u.name}</span>
                <Badge
                  variant={u.status === "ACTIVE" ? "success" : "critical"}
                  className="text-[9px] px-1 py-0"
                >
                  {u.status}
                </Badge>
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono truncate">
                <span>@{u.username}</span>
                <span>·</span>
                <span className="text-primary font-sans font-medium">{u.roles.join(", ")}</span>
              </div>
            </div>
          </div>
        ),
      },
      ...filteredMatrixPermissions.map((perm) => ({
        key: perm.code,
        header: perm.name,
        align: "center" as const,
        width: "74px",
        cell: (u: UserRecord) => {
          const has = u.permissions.includes(perm.code);
          return (
            <div className="flex items-center justify-center">
              {has ? (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-medium"
                  title={`Active for ${u.name} via roles (${u.roles.join(", ")})`}
                >
                  <Check className="h-3 w-3" strokeWidth={2.5} />
                </span>
              ) : (
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/30"
                  title={`Not granted to ${u.name}`}
                >
                  <Minus className="h-3 w-3" />
                </span>
              )}
            </div>
          );
        },
      })),
      {
        key: "actions",
        header: "Assign Access",
        align: "right" as const,
        sticky: "right",
        cell: (u: UserRecord) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10.5px] px-2 text-primary hover:bg-primary/10 font-medium"
            onClick={() => {
              setAssigningRolesUser(u);
              setAssignedRolesSelection(u.roles);
            }}
          >
            <Shield className="h-3 w-3 mr-1" /> Edit Roles
          </Button>
        ),
      },
    ];
  }, [filteredMatrixPermissions]);

  // Total active security admins
  const activeAdminsCount = users.filter(
    (u) =>
      u.status === "ACTIVE" &&
      (u.roles.includes("SUPER_ADMIN") || u.roles.includes("ADMIN") || u.permissions.includes("user.roles.assign"))
  ).length;

  return (
    <div className="flex flex-col gap-3 p-3 max-w-[1700px] mx-auto w-full">
      <PageHeader
        title="User & Access Governance"
        subtitle="Complete Role-Based Access Control (RBAC), user lifecycle management, and granular permission authority"
        meta={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={refreshData}
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </Button>
            {canCreateUser && (
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground font-medium"
                onClick={() => setIsAddUserOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add User
              </Button>
            )}
          </div>
        }
      />

      {toastMessage && (
        <div
          className={cn(
            "flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium border animate-in fade-in slide-in-from-top-2",
            toastMessage.type === "success"
              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400"
              : "bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400"
          )}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Registered Users"
          value={users.length}
          icon={Users}
          intent="default"
          subtitle={`${users.filter((u) => u.status === "ACTIVE").length} Active Accounts`}
          trendLabel="IdP & Local Directory"
        />
        <KpiCard
          label="Active Security Admins"
          value={activeAdminsCount}
          icon={ShieldCheck}
          intent={activeAdminsCount > 1 ? "success" : "warning"}
          subtitle="Holding user & role authorities"
          trendLabel="Protected admin floor ≥ 1"
        />
        <KpiCard
          label="RBAC Roles Defined"
          value={roles.length}
          icon={Layers}
          intent="info"
          subtitle={`${roles.filter((r) => !r.isSystem).length} Custom Roles`}
          trendLabel="Code-defined & Database"
        />
        <KpiCard
          label="Granular Permissions"
          value={PERMISSION_METAS.length}
          icon={Key}
          intent="default"
          subtitle="Enforced on server per API"
          trendLabel="Zero-trust backend gate"
        />
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-border/80 pb-1">
        <button
          type="button"
          onClick={() => setActiveTab("users")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5",
            activeTab === "users"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          <Users className="h-3.5 w-3.5" /> User Directory
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-background/20 font-mono">
            {users.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("roles")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5",
            activeTab === "roles"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          <Layers className="h-3.5 w-3.5" /> Roles & Policies
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-background/20 font-mono">
            {roles.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("matrix")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5",
            activeTab === "matrix"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          <Shield className="h-3.5 w-3.5" /> Permission Matrix
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("catalog")}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5",
            activeTab === "catalog"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          )}
        >
          <Key className="h-3.5 w-3.5" /> Permission Catalog
        </button>
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* TAB 1: USERS DIRECTORY */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === "users" && (
        <Section
          title="Active User Directory"
          description="Manage application users, assign individual or multiple roles, and audit effective authority."
          actions={
            canCreateUser && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => setIsAddUserOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Add User
              </Button>
            )
          }
        >
          {users.length === 0 ? (
            <EmptyState
              title="No Users Registered"
              message="No users found in database directory. Create a new user to grant platform access."
              icon={<Users className="h-8 w-8 text-muted-foreground" />}
            />
          ) : (
            <DataTable
              columns={userColumns}
              rows={users}
              searchable
              searchPlaceholder="Search by name, username, email..."
              searchFn={(r, q) =>
                r.name.toLowerCase().includes(q.toLowerCase()) ||
                r.username.toLowerCase().includes(q.toLowerCase()) ||
                r.email.toLowerCase().includes(q.toLowerCase()) ||
                r.roles.some((role) => role.toLowerCase().includes(q.toLowerCase()))
              }
              maxHeight="580px"
              pagination
              pageSize={15}
            />
          )}
        </Section>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 2: ROLES & PERMISSIONS */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === "roles" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">RBAC Role Definitions</h3>
              <p className="text-xs text-muted-foreground">
                System roles are built into application code; custom roles can be created and tailored with custom permissions.
              </p>
            </div>
            {canManageRoles && (
              <Button
                variant="default"
                size="sm"
                className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground font-medium"
                onClick={() => setIsCreateRoleOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" /> Create Custom Role
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {roles.map((r) => (
              <div
                key={r.code}
                className={cn(
                  "p-3.5 rounded-lg border bg-card transition-all flex flex-col justify-between gap-3 shadow-xs",
                  r.isSystem ? "border-border/80" : "border-amber-500/40 bg-amber-500/[0.02]"
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Shield className={cn("h-4 w-4 shrink-0", r.isSystem ? "text-primary" : "text-amber-500")} />
                      <span className="font-semibold text-xs text-foreground truncate">{r.name}</span>
                    </div>
                    <Badge variant={r.isSystem ? "neutral" : "warning"} className="text-[9.5px]">
                      {r.isSystem ? "System" : "Custom"}
                    </Badge>
                  </div>

                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                    {r.description || "No description provided."}
                  </p>
                </div>

                <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">{r.permissions.length} perms</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground">{r.userCount} assigned</span>
                  </div>

                  <div className="flex items-center gap-1">
                    {!r.isSystem && canAssignPermissions && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10.5px] px-2 text-primary hover:text-primary hover:bg-primary/10"
                        onClick={() => {
                          setEditingRole(r);
                          setEditRoleForm({
                            name: r.name,
                            description: r.description || "",
                            selectedPermissions: r.permissions,
                            status: r.status,
                          });
                        }}
                      >
                        <Edit2 className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    )}

                    {!r.isSystem && canManageRoles && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-rose-500/70 hover:text-rose-600 hover:bg-rose-500/10"
                        disabled={r.userCount > 0}
                        title={r.userCount > 0 ? "Cannot delete role while users are assigned" : "Delete Role"}
                        onClick={() => setDeletingRole(r)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 3: INTERACTIVE PERMISSION MATRIX */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === "matrix" && (
        <Section
          title={matrixViewMode === "roles" ? "Interactive Role × Permission Matrix" : "User Access Matrix & Audit"}
          description={
            matrixViewMode === "roles"
              ? "Directly toggle individual page & action permissions for custom roles. Click any cell to grant or revoke."
              : "Cross-reference all registered user accounts against effective system permissions."
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {/* Matrix View Mode Switcher */}
              <div className="flex items-center p-0.5 rounded-lg bg-muted/60 border border-border/80">
                <button
                  type="button"
                  onClick={() => setMatrixViewMode("roles")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5",
                    matrixViewMode === "roles"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Shield className="h-3 w-3 text-primary" /> Roles Mode
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixViewMode("users")}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5",
                    matrixViewMode === "users"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Users className="h-3 w-3 text-primary" /> Users Mode
                </button>
              </div>

              <div className="relative">
                <Search className="h-3 w-3 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                <Input
                  value={matrixSearch}
                  onChange={(e) => setMatrixSearch(e.target.value)}
                  placeholder="Filter permissions..."
                  className="h-7 pl-6 text-xs w-44 bg-muted/30"
                />
              </div>

              <select
                value={matrixFilterCategory}
                onChange={(e) => setMatrixFilterCategory(e.target.value)}
                className="h-7 text-xs bg-muted/40 border border-border rounded px-2 text-foreground font-medium"
              >
                <option value="ALL">All Categories ({PERMISSION_METAS.length})</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          {/* Helpful Guidance Banner */}
          <div className="mb-2 p-2.5 rounded-lg bg-muted/30 border border-border/80 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary shrink-0" />
              <span className="text-muted-foreground">
                {matrixViewMode === "roles" ? (
                  <>
                    <strong className="text-foreground">Interactive Toggles:</strong> Click any cell on a{" "}
                    <span className="text-amber-500 font-semibold">Custom Role</span> to toggle that permission ON or OFF instantly.{" "}
                    <span className="text-muted-foreground">(System roles are code-defined; click to clone & customize).</span>
                  </>
                ) : (
                  <>
                    <strong className="text-foreground">User Effective Authority:</strong> Shows all active permissions resolved from each user's assigned roles. Click <strong>Edit Roles</strong> on any user to adjust access.
                  </>
                )}
              </span>
            </div>

            <div className="flex items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                  <Check className="h-2.5 w-2.5" />
                </span>
                <span className="text-muted-foreground">Granted</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-muted/40 text-muted-foreground/40">
                  <Minus className="h-2.5 w-2.5" />
                </span>
                <span className="text-muted-foreground">Not Granted</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-primary/10 text-primary border border-primary/20">
                  <Lock className="h-2.5 w-2.5" />
                </span>
                <span className="text-muted-foreground">System Template</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            {matrixViewMode === "roles" ? (
              <DataTable
                columns={matrixColumns}
                rows={roles}
                searchable={false}
                maxHeight="580px"
                exportable
                exportPermission="role.read"
                exportFilename="rbac-role-permission-matrix.csv"
              />
            ) : (
              <DataTable
                columns={userMatrixColumns}
                rows={users}
                searchable={false}
                maxHeight="580px"
                exportable
                exportPermission="user.read"
                exportFilename="rbac-user-permission-matrix.csv"
              />
            )}
          </div>
        </Section>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* TAB 4: PERMISSION CATALOG */}
      {/* --------------------------------------------------------------------- */}
      {activeTab === "catalog" && (
        <Section
          title="Granular Permission Dictionary"
          description="Complete reference of all permission codes enforced across API routes, mutations, and views."
        >
          <div className="space-y-4">
            {CATEGORIES.map((cat) => {
              const perms = PERMISSION_METAS.filter((p) => p.category === cat);
              return (
                <div key={cat} className="space-y-1.5">
                  <div className="flex items-center gap-2 border-b border-border pb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-primary">
                      {cat}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      ({perms.length} permissions)
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {perms.map((p) => (
                      <div
                        key={p.code}
                        className="p-2.5 rounded-lg border border-border/80 bg-card hover:border-primary/40 transition-colors space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-xs text-foreground">{p.name}</span>
                          <span className="text-[9.5px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                            {p.code}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          {p.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: ADD USER */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={isAddUserOpen} onOpenChange={setIsAddUserOpen}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-primary" /> Provision New User Account
            </DialogTitle>
            <DialogDescription className="text-xs">
              Create a new user with initial role assignments and credentials.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateUser} className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-foreground">Username *</label>
              <Input
                required
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder="e.g. john.doe"
                className="h-8 text-xs font-mono mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Full Display Name *</label>
              <Input
                required
                value={newUser.displayName}
                onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                placeholder="e.g. John Doe"
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Email Address (Optional)</label>
              <Input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder="john.doe@diamondplanning.com"
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Initial Roles *</label>
              <div className="max-h-36 overflow-y-auto border rounded-md p-1.5 mt-1 space-y-1 bg-muted/20">
                {roles.map((r) => {
                  if (r.code === "SUPER_ADMIN" && !isSuperAdmin) return null;
                  const isChecked = newUser.selectedRoles.includes(r.code);
                  return (
                    <label
                      key={r.code}
                      className={cn(
                        "flex items-center justify-between p-1.5 rounded text-xs cursor-pointer select-none transition-colors",
                        isChecked ? "bg-primary/10 text-foreground font-medium" : "hover:bg-muted/60 text-muted-foreground"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setNewUser({ ...newUser, selectedRoles: [...newUser.selectedRoles, r.code] });
                            } else {
                              if (newUser.selectedRoles.length > 1) {
                                setNewUser({
                                  ...newUser,
                                  selectedRoles: newUser.selectedRoles.filter((c) => c !== r.code),
                                });
                              }
                            }
                          }}
                          className="h-3.5 w-3.5"
                        />
                        <span className="truncate">{r.name}</span>
                      </div>
                      <span className="text-[10px] font-mono opacity-70">({r.permissions.length} perms)</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">Initial Password *</label>
                <button
                  type="button"
                  onClick={() => setNewUser({ ...newUser, password: generatePassword() })}
                  className="text-[10.5px] text-primary hover:underline"
                >
                  Generate Strong
                </button>
              </div>
              <Input
                required
                type="text"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder="Min 8 characters"
                className="h-8 text-xs font-mono mt-1"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsAddUserOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-primary text-primary-foreground font-medium">
                Create Account
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: EDIT USER DETAILS */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Edit2 className="h-4 w-4 text-primary" /> Edit User Profile
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update user display name and contact email for @{editingUser?.username}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateUser} className="space-y-3 pt-1">
            <div>
              <label className="text-xs font-semibold text-foreground">Display Name *</label>
              <Input
                required
                value={editUserForm.displayName}
                onChange={(e) => setEditUserForm({ ...editUserForm, displayName: e.target.value })}
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Email Address</label>
              <Input
                type="email"
                value={editUserForm.email}
                onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })}
                className="h-8 text-xs mt-1"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingUser(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-primary text-primary-foreground font-medium">
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: ASSIGN ROLES TO USER */}
      {/* --------------------------------------------------------------------- */}
      {/* Data access scope — which countries and labs an account may read. */}
      <Dialog open={!!scopingUser} onOpenChange={(open) => !open && setScopingUser(null)}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Globe className="h-4 w-4 text-primary" /> Data Access Scope: {scopingUser?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Which countries and labs this account may read across Analysis. Leave a field empty to
              grant unrestricted access to that dimension. A value removed here is revoked, and the
              change takes effect on the account&apos;s next request.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
              {scopingUser?.accessScope?.unrestricted
                ? "This account currently has unrestricted access to every country and lab."
                : `Currently limited to ${[
                    (scopingUser?.accessScope?.countries.length ?? 0) > 0
                      ? `countries ${scopingUser?.accessScope?.countries.join(", ")}`
                      : "all countries",
                    (scopingUser?.accessScope?.labs.length ?? 0) > 0
                      ? `labs ${scopingUser?.accessScope?.labs.join(", ")}`
                      : "all labs",
                  ].join(" and ")}.`}
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold">Countries</label>
              <Input
                value={scopeForm.countries}
                onChange={(e) => setScopeForm({ ...scopeForm, countries: e.target.value })}
                placeholder="IN, HK — or leave empty for all countries"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Comma separated, matched exactly against the country stored on each record.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold">Labs</label>
              <Input
                value={scopeForm.labs}
                onChange={(e) => setScopeForm({ ...scopeForm, labs: e.target.value })}
                placeholder="GIA, IGI — or leave empty for all labs"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold">Reason</label>
              <Input
                value={scopeForm.reason}
                onChange={(e) => setScopeForm({ ...scopeForm, reason: e.target.value })}
                placeholder="Why this account's access is being changed"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Recorded in the security audit trail with the previous and new scope.
              </p>
            </div>

            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-muted-foreground">
              Some figures cannot be narrowed by country: the demand result is calculated once per
              planning category for the whole business and carries no location. Pages built on it say
              so on screen rather than implying a country-level number.
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setScopingUser(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={!scopeForm.reason.trim()}
              onClick={handleSaveAccessScope}
            >
              Save Scope
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assigningRolesUser} onOpenChange={(open) => !open && setAssigningRolesUser(null)}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <UserCog className="h-4 w-4 text-primary" /> Assign Roles & Access: {assigningRolesUser?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Toggle roles below. The user automatically receives the combined authority of all active roles.
            </DialogDescription>
          </DialogHeader>

          {/* Real-time live calculation badge */}
          <div className="flex items-center justify-between p-2 rounded-md bg-muted/40 border text-xs">
            <span className="text-muted-foreground font-medium">Effective Access Granted:</span>
            <Badge variant="success" className="font-mono text-[10.5px]">
              {(() => {
                const s = new Set<string>();
                for (const c of assignedRolesSelection) {
                  const r = roles.find((x) => x.code === c);
                  if (r) r.permissions.forEach((p) => s.add(p));
                }
                return `${s.size} of ${PERMISSION_METAS.length} permissions`;
              })()}
            </Badge>
          </div>

          <div className="max-h-60 overflow-y-auto border rounded-md p-1.5 space-y-1 bg-muted/10 my-1">
            {roles.map((r) => {
              if (r.code === "SUPER_ADMIN" && !isSuperAdmin) return null;
              const isChecked = assignedRolesSelection.includes(r.code);
              return (
                <div
                  key={r.code}
                  onClick={() => {
                    if (isChecked) {
                      if (assignedRolesSelection.length > 1) {
                        setAssignedRolesSelection(assignedRolesSelection.filter((c) => c !== r.code));
                      } else {
                        showToast("error", "A user must have at least one assigned role.");
                      }
                    } else {
                      setAssignedRolesSelection([...assignedRolesSelection, r.code]);
                    }
                  }}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-md text-xs cursor-pointer select-none transition-all border",
                    isChecked
                      ? "bg-primary/10 border-primary/30 text-foreground font-medium shadow-2xs"
                      : "border-transparent hover:bg-muted/60 text-muted-foreground"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <Shield className={cn("h-3.5 w-3.5 shrink-0", r.isSystem ? "text-primary" : "text-amber-500")} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold truncate">{r.name}</span>
                        <Badge variant={r.isSystem ? "neutral" : "warning"} className="text-[9px] px-1 py-0">
                          {r.isSystem ? "System" : "Custom"}
                        </Badge>
                      </div>
                      <div className="text-[10px] font-mono text-muted-foreground">{r.code}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {r.permissions.length} perms
                    </span>
                    <Switch
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setAssignedRolesSelection([...assignedRolesSelection, r.code]);
                        } else {
                          if (assignedRolesSelection.length > 1) {
                            setAssignedRolesSelection(assignedRolesSelection.filter((c) => c !== r.code));
                          } else {
                            showToast("error", "A user must have at least one assigned role.");
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAssigningRolesUser(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-primary text-primary-foreground font-medium"
              onClick={handleSaveAssignedRoles}
            >
              Apply Roles & Permissions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: INSPECT EFFECTIVE PERMISSIONS */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!inspectingUser} onOpenChange={(open) => !open && setInspectingUser(null)}>
        <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Key className="h-4 w-4 text-primary" /> Effective Permissions for {inspectingUser?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Assigned Roles:{" "}
              {inspectingUser?.roles.map((rc) => (
                <Badge key={rc} variant={roleBadgeVariant(rc)} className="mx-0.5 text-[9.5px]">
                  {rc}
                </Badge>
              ))}
              {" "}· Total Granted: {inspectingUser?.permissions.length} permissions
            </DialogDescription>
          </DialogHeader>

          <div className="relative my-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={permSearch}
              onChange={(e) => setPermSearch(e.target.value)}
              placeholder="Search user permissions..."
              className="h-8 pl-8 text-xs bg-muted/20"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {CATEGORIES.map((cat) => {
              const catPerms = PERMISSION_METAS.filter((p) => {
                if (p.category !== cat) return false;
                if (!inspectingUser?.permissions.includes(p.code)) return false;
                if (permSearch.trim()) {
                  const q = permSearch.toLowerCase();
                  return (
                    p.code.toLowerCase().includes(q) ||
                    p.name.toLowerCase().includes(q) ||
                    p.description.toLowerCase().includes(q)
                  );
                }
                return true;
              });

              if (catPerms.length === 0) return null;

              return (
                <div key={cat} className="space-y-1.5">
                  <div className="text-[11px] font-bold text-primary uppercase tracking-wide border-b border-border/80 pb-0.5">
                    {cat} ({catPerms.length})
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                    {catPerms.map((p) => (
                      <div
                        key={p.code}
                        className="p-2 rounded border border-emerald-500/20 bg-emerald-500/[0.03] space-y-0.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-foreground">{p.name}</span>
                          <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                        </div>
                        <div className="font-mono text-[9.5px] text-muted-foreground">{p.code}</div>
                        <div className="text-[10px] text-muted-foreground leading-snug">{p.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="pt-2 border-t">
            <Button type="button" variant="outline" size="sm" onClick={() => setInspectingUser(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: RESET PASSWORD */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!resettingPasswordUser} onOpenChange={(open) => !open && setResettingPasswordUser(null)}>
        <DialogContent className="max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <KeyRound className="h-4 w-4 text-amber-500" /> Reset Password for @{resettingPasswordUser?.username}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Generate or type a temporary password. All existing sessions for this user will be revoked immediately.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleResetPassword} className="space-y-3 pt-1">
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">Temporary Password</label>
                <button
                  type="button"
                  onClick={() => setNewPasswordValue(generatePassword())}
                  className="text-[10.5px] text-primary hover:underline"
                >
                  Generate Another
                </button>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Input
                  required
                  value={newPasswordValue}
                  onChange={(e) => setNewPasswordValue(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2"
                  title="Copy password"
                  onClick={() => {
                    navigator.clipboard.writeText(newPasswordValue);
                    setCopiedPassword(true);
                    setTimeout(() => setCopiedPassword(false), 2000);
                  }}
                >
                  {copiedPassword ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setResettingPasswordUser(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white font-medium">
                Reset & Revoke Sessions
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: DELETE USER */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent className="max-w-md sm:max-w-md border-rose-500/30">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Permanently Delete User Account
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete <strong className="text-foreground">@{deletingUser?.username}</strong>?
              This action terminates all sessions, removes role assignments, and permanently removes the account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">
              To confirm, type <strong className="text-foreground">{deletingUser?.username}</strong> below:
            </p>
            <Input
              value={deleteConfirmUsername}
              onChange={(e) => setDeleteConfirmUsername(e.target.value)}
              placeholder={deletingUser?.username}
              className="h-8 text-xs font-mono"
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDeletingUser(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleteConfirmUsername !== deletingUser?.username}
              onClick={handleDeleteUser}
            >
              Confirm Permanent Deletion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: CREATE CUSTOM ROLE */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={isCreateRoleOpen} onOpenChange={setIsCreateRoleOpen}>
        <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-primary" /> Create Custom RBAC Role
            </DialogTitle>
            <DialogDescription className="text-xs">
              Define a new custom role and grant specific granular permissions across system categories.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRole} className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-foreground">Role Code *</label>
                <Input
                  required
                  value={newRoleForm.code}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, code: e.target.value.toUpperCase() })}
                  placeholder="e.g. REGIONAL_PLANNER_LEAD"
                  className="h-8 text-xs font-mono mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground">Display Name *</label>
                <Input
                  required
                  value={newRoleForm.name}
                  onChange={(e) => setNewRoleForm({ ...newRoleForm, name: e.target.value })}
                  placeholder="e.g. Regional Planner Lead"
                  className="h-8 text-xs mt-1"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                value={newRoleForm.description}
                onChange={(e) => setNewRoleForm({ ...newRoleForm, description: e.target.value })}
                placeholder="Responsibilities and access scope..."
                className="h-8 text-xs mt-1"
              />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">
                  Permissions Granted ({newRoleForm.selectedPermissions.length} of {PERMISSION_METAS.length})
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setNewRoleForm({
                        ...newRoleForm,
                        selectedPermissions: PERMISSION_METAS.map((p) => p.code),
                      })
                    }
                    className="text-primary hover:underline text-[11px]"
                  >
                    Select All
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setNewRoleForm({ ...newRoleForm, selectedPermissions: [] })}
                    className="text-muted-foreground hover:text-foreground text-[11px]"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {CATEGORIES.map((cat) => {
                  const catPerms = PERMISSION_METAS.filter((p) => p.category === cat);
                  const allSelected = catPerms.every((p) => newRoleForm.selectedPermissions.includes(p.code));

                  return (
                    <div key={cat} className="p-2 border rounded-md bg-muted/10 space-y-1.5">
                      <div className="flex items-center justify-between border-b pb-1">
                        <span className="text-xs font-bold text-primary">{cat}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (allSelected) {
                              const removeCodes = new Set(catPerms.map((p) => p.code));
                              setNewRoleForm({
                                ...newRoleForm,
                                selectedPermissions: newRoleForm.selectedPermissions.filter((c) => !removeCodes.has(c)),
                              });
                            } else {
                              const addCodes = catPerms.map((p) => p.code);
                              setNewRoleForm({
                                ...newRoleForm,
                                selectedPermissions: Array.from(new Set([...newRoleForm.selectedPermissions, ...addCodes])),
                              });
                            }
                          }}
                          className="text-[10px] text-primary hover:underline font-medium"
                        >
                          {allSelected ? "Deselect Category" : "Select Category"}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                        {catPerms.map((p) => {
                          const isChecked = newRoleForm.selectedPermissions.includes(p.code);
                          return (
                            <label
                              key={p.code}
                              className={cn(
                                "flex items-start gap-2 p-1 rounded text-xs cursor-pointer select-none transition-colors",
                                isChecked ? "text-foreground font-medium" : "text-muted-foreground opacity-70"
                              )}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setNewRoleForm({
                                      ...newRoleForm,
                                      selectedPermissions: [...newRoleForm.selectedPermissions, p.code],
                                    });
                                  } else {
                                    setNewRoleForm({
                                      ...newRoleForm,
                                      selectedPermissions: newRoleForm.selectedPermissions.filter((c) => c !== p.code),
                                    });
                                  }
                                }}
                                className="h-3.5 w-3.5 mt-0.5"
                              />
                              <div className="min-w-0">
                                <div className="text-[11px] truncate">{p.name}</div>
                                <div className="text-[9px] font-mono text-muted-foreground">{p.code}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2 border-t">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateRoleOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-primary text-primary-foreground font-medium">
                Create Role
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: EDIT CUSTOM ROLE */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!editingRole} onOpenChange={(open) => !open && setEditingRole(null)}>
        <DialogContent className="max-w-4xl sm:max-w-4xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <Edit2 className="h-4 w-4 text-primary" /> Edit Role: {editingRole?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Code: <strong className="font-mono text-foreground">{editingRole?.code}</strong> · Modify role name, description, and permissions.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateRole} className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div>
              <label className="text-xs font-semibold text-foreground">Display Name *</label>
              <Input
                required
                value={editRoleForm.name}
                onChange={(e) => setEditRoleForm({ ...editRoleForm, name: e.target.value })}
                className="h-8 text-xs mt-1"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                value={editRoleForm.description}
                onChange={(e) => setEditRoleForm({ ...editRoleForm, description: e.target.value })}
                className="h-8 text-xs mt-1"
              />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-foreground">
                  Permissions ({editRoleForm.selectedPermissions.length} of {PERMISSION_METAS.length})
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setEditRoleForm({
                        ...editRoleForm,
                        selectedPermissions: PERMISSION_METAS.map((p) => p.code),
                      })
                    }
                    className="text-primary hover:underline text-[11px]"
                  >
                    Select All
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => setEditRoleForm({ ...editRoleForm, selectedPermissions: [] })}
                    className="text-muted-foreground hover:text-foreground text-[11px]"
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {CATEGORIES.map((cat) => {
                  const catPerms = PERMISSION_METAS.filter((p) => p.category === cat);
                  const allSelected = catPerms.every((p) => editRoleForm.selectedPermissions.includes(p.code));

                  return (
                    <div key={cat} className="p-2 border rounded-md bg-muted/10 space-y-1.5">
                      <div className="flex items-center justify-between border-b pb-1">
                        <span className="text-xs font-bold text-primary">{cat}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (allSelected) {
                              const removeCodes = new Set(catPerms.map((p) => p.code));
                              setEditRoleForm({
                                ...editRoleForm,
                                selectedPermissions: editRoleForm.selectedPermissions.filter((c) => !removeCodes.has(c)),
                              });
                            } else {
                              const addCodes = catPerms.map((p) => p.code);
                              setEditRoleForm({
                                ...editRoleForm,
                                selectedPermissions: Array.from(new Set([...editRoleForm.selectedPermissions, ...addCodes])),
                              });
                            }
                          }}
                          className="text-[10px] text-primary hover:underline font-medium"
                        >
                          {allSelected ? "Deselect Category" : "Select Category"}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                        {catPerms.map((p) => {
                          const isChecked = editRoleForm.selectedPermissions.includes(p.code);
                          return (
                            <label
                              key={p.code}
                              className={cn(
                                "flex items-start gap-2 p-1 rounded text-xs cursor-pointer select-none transition-colors",
                                isChecked ? "text-foreground font-medium" : "text-muted-foreground opacity-70"
                              )}
                            >
                              <Checkbox
                                checked={isChecked}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setEditRoleForm({
                                      ...editRoleForm,
                                      selectedPermissions: [...editRoleForm.selectedPermissions, p.code],
                                    });
                                  } else {
                                    setEditRoleForm({
                                      ...editRoleForm,
                                      selectedPermissions: editRoleForm.selectedPermissions.filter((c) => c !== p.code),
                                    });
                                  }
                                }}
                                className="h-3.5 w-3.5 mt-0.5"
                              />
                              <div className="min-w-0">
                                <div className="text-[11px] truncate">{p.name}</div>
                                <div className="text-[9px] font-mono text-muted-foreground">{p.code}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-2 border-t">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingRole(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-primary text-primary-foreground font-medium">
                Save Role Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --------------------------------------------------------------------- */}
      {/* DIALOG: DELETE ROLE */}
      {/* --------------------------------------------------------------------- */}
      <Dialog open={!!deletingRole} onOpenChange={(open) => !open && setDeletingRole(null)}>
        <DialogContent className="max-w-md sm:max-w-md border-rose-500/30">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" /> Delete Custom Role
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to delete custom role <strong className="text-foreground">{deletingRole?.name}</strong>?
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setDeletingRole(null)}>
              Cancel
            </Button>
            <Button type="button" size="sm" variant="destructive" onClick={handleDeleteRole}>
              Delete Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
