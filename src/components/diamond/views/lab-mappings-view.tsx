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
  { key: "normalizedLab", header: "Normalized Lab", cell: (r) => <Badge variant="info">{r.normalizedLab}</Badge> },
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
  { key: "active", header: "Active", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "ACTIVE" : "INACTIVE"}</Badge> },
];

export function LabMappingsView() {
  const { data, isLoading } = useApi<LabMappingsData>("/api/admin/lab-mappings");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Lab Mappings (Admin)"
        subtitle="Master mapping table for raw Lab → normalized Lab"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} mappings</span>}
      />

      <InfoBanner variant="info">
        <strong className="font-semibold">Confirmed Rule:</strong> GIA → GIA, GIA-Premium → GIA, GIA-Standard → GIA, Blank/NULL → Non-Cert. Unknown Labs: retain raw value, flag validation warning/error, allow admin mapping through controlled master data. <strong className="font-semibold">Do NOT silently normalize unknown Lab values.</strong>
      </InfoBanner>

      <Section title="Lab Mapping Table" description="Each row maps a raw lab string to a normalized lab classification">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No lab mappings configured"
          maxHeight="640px"
          exportable
          exportFilename="lab-mappings.csv"
          searchable
          searchPlaceholder="Search raw or normalized lab..."
          searchFn={(r, q) => [r.rawLab, r.normalizedLab].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
        />
      </Section>
    </div>
  );
}
