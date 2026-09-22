"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

interface IssueRow {
  id: string;
  issueCode: string;
  source: string;
  entity: string;
  // Nullable in the schema: an issue can describe a whole feed rather than one record.
  recordId: string | null;
  rule: string;
  message: string;
  severity: string;
  status: string;
  assignedTo: string | null;
  detectedAt: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}
interface DqData {
  rows: IssueRow[];
  severityCounts: { INFO: number; WARNING: number; ERROR: number; BLOCKING: number };
}

export function DataQualityView() {
  const [entity, setEntity] = useState("");
  const [severity, setSeverity] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (entity) params.set("entity", entity);
  if (severity) params.set("severity", severity);
  if (status) params.set("status", status);
  const url = `/api/data-quality${params.toString() ? `?${params.toString()}` : ""}`;
  const { data, isLoading } = useApi<DqData>(url);

  const columns: Column<IssueRow>[] = useMemo(() => [
    { key: "issueCode", header: "Issue Code", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.issueCode}</span>, sortable: true, sortValue: (r) => r.issueCode, sticky: "left" },
    { key: "source", header: "Source", cell: (r) => <span className="text-[10px]">{r.source}</span> },
    { key: "entity", header: "Entity", cell: (r) => <span className="text-[10px]">{r.entity}</span> },
    { key: "recordId", header: "Record ID", cell: (r) => <span className="font-mono text-[10px]">{r.recordId ? r.recordId.slice(0, 8) : "—"}</span> },
    { key: "rule", header: "Rule", cell: (r) => <span className="text-[10px]">{r.rule}</span> },
    { key: "message", header: "Message", cell: (r) => <span className="text-[10px]">{r.message}</span> },
    { key: "severity", header: "Severity", align: "center", cell: (r) => <StatusBadge status={r.severity} />, sortable: true, sortValue: (r) => r.severity },
    { key: "status", header: "Status", align: "center", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "assignedTo", header: "Assigned To", cell: (r) => <span className="text-[10px]">{r.assignedTo ?? "—"}</span> },
    { key: "detectedAt", header: "Detected", cell: (r) => <span className="tabular-nums text-[10px]">{new Date(r.detectedAt).toLocaleString()}</span>, sortable: true, sortValue: (r) => r.detectedAt },
    { key: "resolution", header: "Resolution", cell: (r) => <span className="text-[10px]">{r.resolution ?? "—"}</span> },
    { key: "resolvedBy", header: "Resolved By", cell: (r) => <span className="text-[10px]">{r.resolvedBy ?? "—"}</span> },
    { key: "resolvedAt", header: "Resolved At", cell: (r) => <span className="tabular-nums text-[10px]">{r.resolvedAt ? new Date(r.resolvedAt).toLocaleString() : "—"}</span> },
  ], []);

  const filteredRows = (data?.rows ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.issueCode, r.source, r.entity, r.recordId ?? "", r.rule, r.message, r.assignedTo ?? ""].some((f) => f.toLowerCase().includes(q));
  });

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Data Quality Issues"
        subtitle="Validation results across all entities — blocking issues MUST prevent the relevant operation"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} issues</span>}
      />

      <InfoBanner variant="critical">
        <strong className="font-semibold">Blocking issues must prevent the relevant operation.</strong> Records with BLOCKING severity cannot proceed downstream until resolved or explicitly waived.
      </InfoBanner>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Info" value={data?.severityCounts.INFO ?? 0} intent="info" />
        <KpiCard label="Warning" value={data?.severityCounts.WARNING ?? 0} intent="warning" />
        <KpiCard label="Error" value={data?.severityCounts.ERROR ?? 0} intent="critical" />
        <KpiCard label="Blocking" value={data?.severityCounts.BLOCKING ?? 0} intent="critical" hint="Blocks downstream operations" />
      </div>

      <Section
        title="Filters"
        description="Filter by entity, severity, or status"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={entity || "__all"} onValueChange={(v) => setEntity(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="All Entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Entities</SelectItem>
                <SelectItem value="SalesRecord">SalesRecord</SelectItem>
                <SelectItem value="PolishedStone">PolishedStone</SelectItem>
                <SelectItem value="RoughStone">RoughStone</SelectItem>
                <SelectItem value="Requirement">Requirement</SelectItem>
                <SelectItem value="PlanningCase">PlanningCase</SelectItem>
                <SelectItem value="ForecastRun">ForecastRun</SelectItem>
                <SelectItem value="BusinessRule">BusinessRule</SelectItem>
              </SelectContent>
            </Select>
            <Select value={severity || "__all"} onValueChange={(v) => setSeverity(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Severities</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
                <SelectItem value="WARNING">WARNING</SelectItem>
                <SelectItem value="ERROR">ERROR</SelectItem>
                <SelectItem value="BLOCKING">BLOCKING</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status || "__all"} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Statuses</SelectItem>
                <SelectItem value="OPEN">OPEN</SelectItem>
                <SelectItem value="IN_REVIEW">IN_REVIEW</SelectItem>
                <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                <SelectItem value="IGNORED">IGNORED</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search issues..." className="h-8 pl-7 text-xs" />
            </div>
          </div>
        }
      >
        <div />
      </Section>

      <Section title="Issues" description="All detected issues across the pipeline">
        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={isLoading}
          emptyMessage="No issues match the current filters"
          maxHeight="560px"
          exportable
          exportPermission="data_quality.export"
          exportFilename="data-quality-issues.csv"
        />
      </Section>
    </div>
  );
}
