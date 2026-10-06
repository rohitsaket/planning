"use client";

import { useApi } from "@/lib/api-client";
import { Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";

interface StatusMappingRow {
  id: string;
  fantasyStatus: string;
  planningClass: string;
  countsAvailable: boolean;
  updatedAt: string;
}

const PLANNING_CLASS_LABEL: Record<string, string> = {
  PHYSICAL: "Physical stock",
  PLANNING_AVAILABLE: "Available for planning",
  RESERVED: "Reserved",
  HOLD: "On hold",
  TRANSFER: "In transfer",
  MEMO: "Memo",
  OTHER: "Other",
};
const planningClassLabel = (c: string) => PLANNING_CLASS_LABEL[c] ?? c;

const columns: Column<StatusMappingRow>[] = [
  { key: "fantasyStatus", header: "Fantasy status", cell: (r) => <span className="font-mono text-[11px]">{r.fantasyStatus}</span>, sortable: true, sortValue: (r) => r.fantasyStatus, sticky: "left" },
  { key: "planningClass", header: "Planning class", cell: (r) => <Badge variant="info">{planningClassLabel(r.planningClass)}</Badge>, exportValue: (r) => planningClassLabel(r.planningClass), sortable: true, sortValue: (r) => planningClassLabel(r.planningClass) },
  { key: "countsAvailable", header: "Counts as available", align: "center", cell: (r) => <Badge variant={r.countsAvailable ? "success" : "neutral"}>{r.countsAvailable ? "Yes" : "No"}</Badge>, exportValue: (r) => (r.countsAvailable ? "Yes" : "No") },
];

export function StatusMappingsView() {
  const { data, isLoading } = useApi<{ rows: StatusMappingRow[] }>("/api/admin/status-mappings");
  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <Section title="Status Mapping" description="How each Fantasy status is classified for planning">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No status mappings configured"
          exportable
          exportPermission="config.export"
          exportFilename="status-mappings.csv"
          searchable
          searchPlaceholder="Search statuses..."
          searchFn={(r, q) => [r.fantasyStatus, planningClassLabel(r.planningClass)].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
          pagination
          pageSize={25}
        />
      </Section>
    </div>
  );
}
