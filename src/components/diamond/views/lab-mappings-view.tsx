"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";

interface LabMappingRow {
  id: string;
  rawLab: string;
  normalizedLab: string;
  active: boolean;
}
interface LabMappingsData {
  rows: LabMappingRow[];
}

const columns: Column<LabMappingRow>[] = [
  { key: "rawLab", header: "Raw Lab", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.rawLab || "(blank)"}</span>, sortable: true, sortValue: (r) => r.rawLab, sticky: "left" },
  { key: "normalizedLab", header: "Normalized Lab", align: "center", cell: (r) => <Badge variant="info">{r.normalizedLab}</Badge> },
  {
    key: "mapping",
    header: "Mapping",
    cell: (r) => (
      <span className="text-[10px] inline-flex items-center gap-1">
        <span className="font-mono">{r.rawLab || "(blank)"}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium">{r.normalizedLab}</span>
      </span>
    ),
  },
  { key: "active", header: "Active", align: "center", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge> },
];

export function LabMappingsView() {
  const { data, isLoading } = useApi<LabMappingsData>("/api/admin/lab-mappings");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Lab Mapping"
        subtitle="How lab names are standardized"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} mappings</span>}
      />

      <InfoBanner variant="info">
        Unknown lab names are kept as entered and flagged for review.
      </InfoBanner>

      <Section title="Lab Mapping Table" description="Lab name as received and its standard name">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No lab mappings configured"
          maxHeight="640px"
          exportable
          exportPermission="config.export"
          exportFilename="lab-mappings.csv"
          searchable
          searchPlaceholder="Search raw or normalized lab..."
          searchFn={(r, q) => [r.rawLab, r.normalizedLab].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
          pagination
          pageSize={25}
        />
      </Section>
    </div>
  );
}
