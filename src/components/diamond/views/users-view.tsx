"use client";

import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Check, Minus, Shield, KeySquare, Lock, Users, ShieldCheck, Key } from "lucide-react";

// ---------------------------------------------------------------------------
// RBAC reference model — 15 roles × 13 permissions
// ---------------------------------------------------------------------------
interface RoleDef { code: string; label: string; }
interface PermissionDef {
  code: string;
  name: string;
  description: string;
  category: "Requirements" | "Planning" | "Rough" | "Forecast" | "Fantasy" | "Admin" | "Audit";
}

const ROLES: RoleDef[] = [
  { code: "SUPER_ADMIN", label: "Super Admin" },
  { code: "ADMIN", label: "Admin" },
  { code: "ANALYSIS_MANAGER", label: "Analysis Manager" },
  { code: "DATA_ANALYST", label: "Data Analyst" },
  { code: "DATA_SCIENTIST", label: "Data Scientist" },
  { code: "PLANNING_MANAGER", label: "Planning Manager" },
  { code: "PLANNER", label: "Planner" },
  { code: "PLANNING_VIEWER", label: "Planning Viewer" },
  { code: "MFG_MANAGER", label: "Manufacturing Manager" },
  { code: "MFG_VIEWER", label: "Manufacturing Viewer" },
  { code: "SALES_MANAGER", label: "Sales Manager" },
  { code: "SALES_VIEWER", label: "Sales Viewer" },
  { code: "FANTASY_INTEGRATION", label: "Fantasy Integration Service" },
  { code: "AUDITOR", label: "Auditor" },
  { code: "VIEWER", label: "Viewer" },
];

const PERMISSIONS: PermissionDef[] = [
  { code: "requirement.read", name: "View Requirements", description: "Read requirement rows computed by the planning engine — view-only access to the requirements matrix.", category: "Requirements" },
  { code: "requirement.create", name: "Create Requirements", description: "Create new requirement rows (e.g., customer-driven overrides against forecast baseline).", category: "Requirements" },
  { code: "requirement.override", name: "Override Requirements", description: "Override computed requirement values — manual adjustments to engine-derived quantities.", category: "Requirements" },
  { code: "plan.create", name: "Create Planning Case", description: "Create a planning case and generate plan options via the planning engine.", category: "Planning" },
  { code: "plan.select", name: "Select Plan Option", description: "Select a plan option (subject to OPEN rule BR-PLAN-SEL-001 — yield ≠ best commercial plan).", category: "Planning" },
  { code: "plan.approve", name: "Approve Plan Option", description: "Approve a plan option to release it to manufacturing workflow.", category: "Planning" },
  { code: "plan.replan", name: "Trigger Replan", description: "Trigger a replan cycle when conditions change or a plan is rejected.", category: "Planning" },
  { code: "rough.reserve", name: "Reserve Rough Stones", description: "Soft-reserve rough stones against approved plan options before manufacturing release.", category: "Rough" },
  { code: "forecast.run", name: "Run Forecast", description: "Execute demand forecast runs (statistical baseline + memo reduction).", category: "Forecast" },
  { code: "forecast.publish", name: "Publish Forecast", description: "Publish a forecast model so its outputs feed the planning engine.", category: "Forecast" },
  { code: "fantasy.sync", name: "Trigger Fantasy Sync", description: "Trigger a Fantasy ERP synchronization cycle (inventory + sales + memo + master data).", category: "Fantasy" },
  { code: "business_rule.manage", name: "Manage Business Rules", description: "Manage business rules and feature flags — engine-level config (Super Admin only).", category: "Admin" },
  { code: "audit.read", name: "Read Audit Log", description: "Read the audit log — every privileged action is recorded for compliance review.", category: "Audit" },
];

// Role → permission mapping. Use a Set lookup for clarity.
const ALL_PERMS = PERMISSIONS.map((p) => p.code);
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ALL_PERMS,
  ADMIN: ALL_PERMS.filter((p) => p !== "business_rule.manage"),
  ANALYSIS_MANAGER: ["requirement.read", "requirement.create", "requirement.override", "audit.read"],
  DATA_ANALYST: ["requirement.read", "audit.read"],
  DATA_SCIENTIST: ["requirement.read", "forecast.run", "forecast.publish", "audit.read"],
  PLANNING_MANAGER: ["requirement.read", "plan.create", "plan.select", "plan.approve", "plan.replan", "rough.reserve", "audit.read"],
  PLANNER: ["requirement.read", "plan.create", "plan.select", "plan.replan", "rough.reserve"],
  PLANNING_VIEWER: ["requirement.read"],
  MFG_MANAGER: ["requirement.read", "audit.read"],
  MFG_VIEWER: [],
  SALES_MANAGER: ["requirement.read", "audit.read"],
  SALES_VIEWER: [],
  FANTASY_INTEGRATION: ["fantasy.sync", "audit.read"],
  AUDITOR: ["audit.read"],
  VIEWER: [],
};

const roleHas = (roleCode: string, permCode: string): boolean => {
  const perms = ROLE_PERMISSIONS[roleCode] ?? [];
  return perms.includes(permCode);
};

// Count total ✓ assignments across the matrix
const TOTAL_ASSIGNMENTS = ROLES.reduce(
  (sum, r) => sum + (ROLE_PERMISSIONS[r.code]?.length ?? 0),
  0
);

// ---------------------------------------------------------------------------
// Permission matrix table
// ---------------------------------------------------------------------------
interface MatrixRow {
  roleCode: string;
  roleLabel: string;
  perms: Record<string, boolean>;
}

const matrixRows: MatrixRow[] = ROLES.map((r) => ({
  roleCode: r.code,
  roleLabel: r.label,
  perms: Object.fromEntries(PERMISSIONS.map((p) => [p.code, roleHas(r.code, p.code)])) as Record<string, boolean>,
}));

const matrixColumns: Column<MatrixRow>[] = [
  {
    key: "roleLabel",
    header: "Role",
    sticky: "left",
    sortable: true,
    sortValue: (r) => r.roleLabel,
    cell: (r) => (
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        <Shield className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium">{r.roleLabel}</span>
      </div>
    ),
  },
  ...PERMISSIONS.map((p) => ({
    key: p.code,
    header: p.code,
    align: "center" as const,
    width: "92px",
    cell: (r: MatrixRow) =>
      r.perms[p.code] ? (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          title={`${r.roleLabel} → ${p.code}: granted`}
          aria-label={`${r.roleLabel} has permission ${p.code}`}
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground/40"
          title={`${r.roleLabel} → ${p.code}: not granted`}
          aria-label={`${r.roleLabel} does not have permission ${p.code}`}
        >
          <Minus className="h-3 w-3" />
        </span>
      ),
  })),
];

// ---------------------------------------------------------------------------
// Users table (stub — populated from IdP)
// ---------------------------------------------------------------------------
interface StubUserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  lastActive: string | null;
  status: string;
}

const stubUsers: StubUserRow[] = [];

const roleVariant = (code: string): "critical" | "warning" | "info" | "success" | "neutral" | "default" => {
  if (code.includes("ADMIN")) return "critical";
  if (code.includes("MANAGER")) return "warning";
  if (code.includes("VIEWER") || code === "AUDITOR") return "neutral";
  if (code === "FANTASY_INTEGRATION") return "info";
  return "default";
};

const userColumns: Column<StubUserRow>[] = [
  {
    key: "name",
    header: "User",
    sticky: "left",
    cell: (r) => <span className="text-[11px] font-medium">{r.name}</span>,
  },
  {
    key: "email",
    header: "Email",
    cell: (r) => <span className="font-mono text-[10px]">{r.email}</span>,
  },
  {
    key: "role",
    header: "Role",
    cell: (r) => <Badge variant={roleVariant(r.role)}>{r.role}</Badge>,
  },
  {
    key: "lastActive",
    header: "Last Active",
    cell: (r) => (
      <span className="tabular-nums text-[10px]">
        {r.lastActive ? new Date(r.lastActive).toLocaleString() : "—"}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <Badge variant={r.status === "ACTIVE" ? "success" : "neutral"}>{r.status}</Badge>,
  },
];

// Category accent colors for permission cards
const categoryAccent: Record<PermissionDef["category"], string> = {
  Requirements: "text-sky-600 dark:text-sky-400",
  Planning: "text-emerald-600 dark:text-emerald-400",
  Rough: "text-amber-600 dark:text-amber-400",
  Forecast: "text-violet-600 dark:text-violet-400",
  Fantasy: "text-cyan-600 dark:text-cyan-400",
  Admin: "text-rose-600 dark:text-rose-400",
  Audit: "text-slate-600 dark:text-slate-400",
};

export function UsersView() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Users & Roles"
        subtitle="Role-Based Access Control matrix — SSO/OIDC/SAML-ready, enforced backend-side"
        meta={
          <span className="text-[10px] text-muted-foreground">
            NextAuth.js v4 available
          </span>
        }
      />

      <InfoBanner variant="info">
        <strong className="font-semibold">Make architecture SSO/OIDC/SAML-ready.</strong>{" "}
        Enforce permissions backend-side. This matrix is a reference — actual permission
        enforcement requires authentication implementation (NextAuth.js v4 available).
      </InfoBanner>

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Roles"
          value={ROLES.length}
          icon={Users}
          intent="info"
          subtitle="Suggested RBAC roles"
          trendLabel="Mapped to IdP groups"
        />
        <KpiCard
          label="Total Permissions"
          value={PERMISSIONS.length}
          icon={Key}
          intent="default"
          subtitle="Granular permission codes"
          trendLabel="Backend-enforced per request"
        />
        <KpiCard
          label="Permission Assignments"
          value={TOTAL_ASSIGNMENTS}
          icon={ShieldCheck}
          intent="success"
          subtitle="Granted ✓ cells in matrix"
          trendLabel={`${(TOTAL_ASSIGNMENTS / (ROLES.length * PERMISSIONS.length) * 100).toFixed(0)}% fill rate`}
        />
        <KpiCard
          label="SSO-Ready"
          value="Available"
          icon={Lock}
          intent="warning"
          subtitle="NextAuth.js v4"
          trendLabel="Wire IdP to populate users"
        />
      </div>

      {/* Permission matrix */}
      <Section
        title="Role × Permission Matrix"
        description="Rows are the 15 suggested roles; columns are the 13 granular permissions. ✓ = granted, — = denied."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="success">
              <Check className="h-3 w-3" strokeWidth={3} /> Granted
            </Badge>
            <Badge variant="neutral">
              <Minus className="h-3 w-3" /> Denied
            </Badge>
          </div>
        }
      >
        <DataTable
          columns={matrixColumns}
          rows={matrixRows}
          maxHeight="560px"
          searchable={false}
          exportable
          exportFilename="rbac-permission-matrix.csv"
          initialSortKey="roleLabel"
          initialSortDir="asc"
        />
      </Section>

      {/* Permission definitions */}
      <Section
        title="Permission Definitions"
        description="Reference for each granular permission code, grouped by category"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PERMISSIONS.map((p) => (
            <div
              key={p.code}
              className="rounded-md border border-border bg-muted/20 p-3 hover:border-foreground/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <KeySquare className="h-3 w-3 text-muted-foreground shrink-0" />
                  <code className="text-[11px] font-mono font-medium truncate">
                    {p.code}
                  </code>
                </div>
                <Badge variant="neutral" className="shrink-0">
                  {p.category}
                </Badge>
              </div>
              <p className={`mt-1.5 text-[11px] font-semibold ${categoryAccent[p.category]}`}>
                {p.name}
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground leading-snug">
                {p.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Users table — empty state until IdP is wired */}
      <Section
        title="Users"
        description="User directory — populated from your Identity Provider"
        actions={
          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
            <Lock className="h-3 w-3" /> IdP-bound
          </span>
        }
      >
        {stubUsers.length === 0 ? (
          <EmptyState
            title="No users seeded"
            message="Integrate with your IdP (NextAuth.js v4) to populate the user directory. The RBAC matrix above defines the target permission model."
            icon={<Users className="h-8 w-8" />}
          />
        ) : (
          <DataTable
            columns={userColumns}
            rows={stubUsers}
            emptyMessage="No users seeded — integrate with your IdP"
            maxHeight="320px"
            searchable={false}
            exportable
            exportFilename="users.csv"
          />
        )}
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>
            Connect your SSO/OIDC/SAML provider in{" "}
            <code className="font-mono">src/lib/auth*</code> and replace this stub.
            Permissions are enforced backend-side via the codes above.
          </span>
        </div>
      </Section>
    </div>
  );
}
