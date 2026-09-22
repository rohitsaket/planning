"use client";

import { useApi, apiPost } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import { Save } from "lucide-react";

interface RuleRow {
  id: string;
  ruleId: string;
  domain: string;
  name: string;
  version: string;
  effectiveDate: string;
  status: string;
  configuration: Record<string, unknown> | null;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
}
interface RulesData {
  rows: RuleRow[];
}

function formatConfig(cfg: Record<string, unknown> | null): string {
  if (!cfg) return "—";
  try {
    return Object.entries(cfg)
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
      .join("\n");
  } catch {
    return JSON.stringify(cfg);
  }
}

const RULE_STATUSES = ["CONFIRMED", "PROPOSED", "OPEN", "DEPRECATED"];

const domainVariant = (d: string): "info" | "warning" | "success" | "critical" | "neutral" | "default" => {
  const map: Record<string, "info" | "warning" | "success" | "critical" | "neutral" | "default"> = {
    DEMAND: "warning",
    WEIGHT: "info",
    LAB: "success",
    SHAPE: "info",
    PLANNING: "success",
    YIELD: "info",
    FORECAST: "info",
    AUDIT: "neutral",
    WIP: "warning",
  };
  return map[d] ?? "default";
};

function StatusChangeForm({ row }: { row: RuleRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(row.status);
  const [approver] = useState(row.approvedBy ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");

  const mutation = useMutation({
    mutationFn: () => apiPost("/api/admin/business-rules", { id: row.id, status, notes }),
    onSuccess: () => {
      toast.success(`Rule ${row.ruleId} status updated to ${status}`);
      qc.invalidateQueries({ queryKey: ["/api/admin/business-rules"] });
      setOpen(false);
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)}>
        Status Change
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2 rounded border border-border bg-muted/30 min-w-[220px]">
      <div className="flex items-center gap-1">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" className="h-7 w-[120px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input value={approver} readOnly disabled title="Recorded by the server from your sign-in" placeholder="Approver (you)" className="h-7 text-xs" />
      <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes" className="h-7 text-xs" />
      <div className="flex items-center gap-1">
        <Button size="sm" className="h-7 text-xs" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          <Save className="h-3 w-3 mr-1" /> {mutation.isPending ? "Saving..." : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function BusinessRulesView() {
  const { data, isLoading } = useApi<RulesData>("/api/admin/business-rules");

  const rows = data?.rows ?? [];
  const counts = {
    CONFIRMED: rows.filter((r) => r.status === "CONFIRMED").length,
    PROPOSED: rows.filter((r) => r.status === "PROPOSED").length,
    OPEN: rows.filter((r) => r.status === "OPEN").length,
    DEPRECATED: rows.filter((r) => r.status === "DEPRECATED").length,
  };

  const columns: Column<RuleRow>[] = [
    { key: "ruleId", header: "Rule ID", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.ruleId}</span>, sortable: true, sortValue: (r) => r.ruleId, sticky: "left" },
    { key: "domain", header: "Domain", align: "center", cell: (r) => <Badge variant={domainVariant(r.domain)}>{r.domain}</Badge> },
    { key: "name", header: "Name", cell: (r) => <span className="text-[10px] font-medium">{r.name}</span> },
    { key: "version", header: "Version", cell: (r) => <span className="font-mono text-[10px]">{r.version}</span> },
    { key: "effectiveDate", header: "Effective", cell: (r) => <span className="tabular-nums text-[10px]">{new Date(r.effectiveDate).toLocaleDateString()}</span> },
    { key: "status", header: "Status", align: "center", cell: (r) => <StatusBadge status={r.status} />, sortable: true, sortValue: (r) => r.status },
    { key: "configuration", header: "Configuration", cell: (r) => <pre className="text-[9px] font-mono whitespace-pre-wrap max-w-[280px] max-h-[80px] overflow-auto rounded bg-muted/40 p-1.5">{formatConfig(r.configuration)}</pre> },
    { key: "approvedBy", header: "Approved By", cell: (r) => <span className="text-[10px]">{r.approvedBy ?? "—"}</span> },
    { key: "approvedAt", header: "Approved At", cell: (r) => <span className="tabular-nums text-[10px]">{r.approvedAt ? new Date(r.approvedAt).toLocaleString() : "—"}</span> },
    { key: "notes", header: "Notes", cell: (r) => <span className="text-[10px]">{r.notes ?? "—"}</span> },
    { key: "action", header: "Status Change", align: "center", cell: (r) => <StatusChangeForm row={r} /> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Business Rules"
        subtitle="Governance of confirmed, proposed, open, and deprecated business rules"
        meta={<span className="text-[10px] text-muted-foreground">{rows.length} rules</span>}
      />

      <InfoBanner variant="warning">
        <strong className="font-semibold">OPEN RULES MUST NOT BE INVENTED.</strong> Never convert an open item into a hardcoded production rule. OPEN rules must be reviewed, validated, and approved before promotion to CONFIRMED.
      </InfoBanner>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Confirmed" value={counts.CONFIRMED} intent="success" />
        <KpiCard label="Proposed" value={counts.PROPOSED} intent="info" />
        <KpiCard label="Open" value={counts.OPEN} intent="warning" hint="Must not auto-apply" />
        <KpiCard label="Deprecated" value={counts.DEPRECATED} intent="default" />
      </div>

      <Section title="All Business Rules" description="Inline status-change form per row — requires approver and notes">
        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No business rules defined"
          maxHeight="640px"
          exportable
          exportPermission="config.export"
          exportFilename="business-rules.csv"
          searchable
          searchPlaceholder="Search rules..."
          searchFn={(r, q) => [r.ruleId, r.name, r.domain, r.notes ?? ""].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
        />
      </Section>
    </div>
  );
}
