"use client";

import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Shield, KeySquare, Lock } from "lucide-react";

interface RoleRow { code: string; label: string; }
interface PermissionRow { code: string; description: string; }

const ROLES: RoleRow[] = [
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

const PERMISSIONS: PermissionRow[] = [
  { code: "requirement.read", description: "View requirements" },
  { code: "requirement.create", description: "Create new requirements" },
  { code: "requirement.override", description: "Override computed requirement values" },
  { code: "requirement.priority.manage", description: "Set / change priority" },
  { code: "plan.create", description: "Create planning cases and options" },
  { code: "plan.select", description: "Select a plan option" },
  { code: "plan.approve", description: "Approve a plan option" },
  { code: "plan.replan", description: "Trigger replan" },
  { code: "rough.reserve", description: "Reserve rough stones" },
  { code: "rough.release", description: "Release rough reservations" },
  { code: "forecast.run", description: "Execute forecast runs" },
  { code: "forecast.publish", description: "Publish forecast models" },
  { code: "fantasy.sync", description: "Trigger Fantasy sync" },
  { code: "fantasy.mapping.manage", description: "Manage Fantasy lab/shape mappings" },
  { code: "business_rule.manage", description: "Manage business rules and feature flags" },
  { code: "audit.read", description: "Read audit log" },
];

interface StubUserRow {
  id: string;
  name: string;
  email: string;
  roles: string[];
  lastActive: string | null;
}

const stubUsers: StubUserRow[] = [];

const userColumns: Column<StubUserRow>[] = [
  { key: "name", header: "Name", cell: (r) => <span className="text-[10px] font-medium">{r.name}</span>, sticky: "left" },
  { key: "email", header: "Email", cell: (r) => <span className="font-mono text-[10px]">{r.email}</span> },
  { key: "roles", header: "Roles", cell: (r) => <div className="flex flex-wrap gap-1">{r.roles.map((r2) => <Badge key={r2} variant="info">{r2}</Badge>)}</div> },
  { key: "lastActive", header: "Last Active", cell: (r) => <span className="tabular-nums text-[10px]">{r.lastActive ? new Date(r.lastActive).toLocaleString() : "—"}</span> },
];

const roleVariant = (code: string): "critical" | "warning" | "info" | "success" | "neutral" | "default" => {
  if (code.includes("ADMIN")) return "critical";
  if (code.includes("MANAGER")) return "warning";
  if (code.includes("VIEWER") || code === "AUDITOR") return "neutral";
  if (code === "FANTASY_INTEGRATION") return "info";
  return "default";
};

export function UsersView() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Users & Roles"
        subtitle="Role-Based Access Control structure — to be wired to your Identity Provider"
        meta={<span className="text-[10px] text-muted-foreground">SSO/OIDC/SAML-ready</span>}
      />

      <InfoBanner variant="info">
        <strong className="font-semibold">Make architecture SSO/OIDC/SAML-ready.</strong> Enforce permissions backend-side. The UI never authorizes — it only renders based on backend-supplied permissions. Do not trust client-side role claims for privileged operations.
      </InfoBanner>

      <Section title="Suggested Roles" description="Suggested RBAC roles — to be mapped to your IdP groups">
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <Badge key={r.code} variant={roleVariant(r.code)} className="px-2 py-1">
              <Shield className="h-3 w-3 mr-1" />
              {r.label}
            </Badge>
          ))}
        </div>
      </Section>

      <Section title="Granular Permissions" description="Suggested permission codes — backend enforces these per request">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {PERMISSIONS.map((p) => (
            <div key={p.code} className="rounded-md border border-border bg-muted/20 p-2.5">
              <div className="flex items-center gap-2">
                <KeySquare className="h-3 w-3 text-muted-foreground" />
                <code className="text-[10px] font-mono font-medium">{p.code}</code>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">{p.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Users" description="Placeholder users table — seed from your Identity Provider">
        <DataTable
          columns={userColumns}
          rows={stubUsers}
          emptyMessage="No users seeded — integrate with your IdP"
          maxHeight="320px"
          searchable={false}
          exportable
          exportFilename="users.csv"
        />
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>Connect your SSO/OIDC/SAML provider in <code className="font-mono">src/lib/auth*</code> and replace this stub.</span>
        </div>
      </Section>
    </div>
  );
}
