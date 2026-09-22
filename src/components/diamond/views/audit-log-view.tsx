"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

interface AuditRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  // Nullable in the schema: LOGIN_FAILED for an unknown username has no entity to
  // point at, so the API returns null here.
  entityId: string | null;
  reason: string | null;
  timestamp: string;
  correlationId: string | null;
}
interface AuditData {
  rows: AuditRow[];
}

const columns: Column<AuditRow>[] = [
  { key: "timestamp", header: "Timestamp", cell: (r) => <span className="tabular-nums text-[10px]">{new Date(r.timestamp).toLocaleString()}</span>, sortable: true, sortValue: (r) => r.timestamp, sticky: "left" },
  { key: "actor", header: "Actor", cell: (r) => <span className="text-[10px] font-medium">{r.actor}</span>, sortable: true, sortValue: (r) => r.actor },
  { key: "action", header: "Action", cell: (r) => <span className="font-mono text-[10px]">{r.action}</span>, sortable: true, sortValue: (r) => r.action },
  { key: "entity", header: "Entity", cell: (r) => <span className="text-[10px]">{r.entity}</span>, sortable: true, sortValue: (r) => r.entity },
  { key: "entityId", header: "Entity ID", cell: (r) => <span className="font-mono text-[10px]">{r.entityId ? r.entityId.slice(0, 8) : "—"}</span> },
  { key: "reason", header: "Reason", cell: (r) => <span className="text-[10px]">{r.reason ?? "—"}</span> },
  { key: "correlationId", header: "Correlation ID", cell: (r) => <span className="font-mono text-[10px]">{r.correlationId ? r.correlationId.slice(0, 8) : "—"}</span> },
];

export function AuditLogView() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (entity) params.set("entity", entity);
  if (action) params.set("action", action);
  if (actor) params.set("actor", actor);
  const url = `/api/admin/audit${params.toString() ? `?${params.toString()}` : ""}`;
  const { data, isLoading } = useApi<AuditData>(url);

  const filteredRows = useMemo(() => {
    return (data?.rows ?? []).filter((r) => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [r.actor, r.action, r.entity, r.entityId ?? "", r.reason ?? "", r.correlationId ?? ""].some((f) => f.toLowerCase().includes(q));
    });
  }, [data, search]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Audit Log"
        subtitle="Append-only record of all system mutations"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} entries</span>}
      />

      <InfoBanner variant="info">
        <strong className="font-semibold">Append-only audit trail.</strong> Store: Actor, Action, Entity, Entity ID, Before, After, Reason, Timestamp, Correlation ID, Session/IP.
      </InfoBanner>

      <Section
        title="Filters"
        description="Filter by entity, action, or actor"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={entity || "__all"} onValueChange={(v) => setEntity(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="All Entities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Entities</SelectItem>
                <SelectItem value="BusinessRule">BusinessRule</SelectItem>
                <SelectItem value="FeatureFlag">FeatureFlag</SelectItem>
                <SelectItem value="Requirement">Requirement</SelectItem>
                <SelectItem value="PlanningCase">PlanningCase</SelectItem>
                <SelectItem value="RoughStone">RoughStone</SelectItem>
                <SelectItem value="ForecastRun">ForecastRun</SelectItem>
                <SelectItem value="LabMapping">LabMapping</SelectItem>
                <SelectItem value="ShapeMapping">ShapeMapping</SelectItem>
                <SelectItem value="WeightBand">WeightBand</SelectItem>
              </SelectContent>
            </Select>
            <Select value={action || "__all"} onValueChange={(v) => setAction(v === "__all" ? "" : v)}>
              <SelectTrigger size="sm" className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="All Actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All Actions</SelectItem>
                <SelectItem value="CREATE">CREATE</SelectItem>
                <SelectItem value="UPDATE">UPDATE</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
                <SelectItem value="RULE_CHANGE">RULE_CHANGE</SelectItem>
                <SelectItem value="FEATURE_FLAG_TOGGLE">FEATURE_FLAG_TOGGLE</SelectItem>
                <SelectItem value="APPROVE">APPROVE</SelectItem>
                <SelectItem value="REJECT">REJECT</SelectItem>
              </SelectContent>
            </Select>
            <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Actor (exact)" className="h-8 w-[160px] text-xs" />
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search entries..." className="h-8 pl-7 text-xs" />
            </div>
          </div>
        }
      >
        <div />
      </Section>

      <Section title="Audit Entries" description="Most recent 200 entries">
        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={isLoading}
          emptyMessage="No audit entries match the current filters"
          maxHeight="640px"
          exportable
          exportPermission="audit.export"
          exportFilename="audit-log.csv"
        />
      </Section>
    </div>
  );
}
