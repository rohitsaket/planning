"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";

interface ShapeMappingRow {
  id: string;
  rawShape: string;
  normalizedShape: string;
  category: string;
  active: boolean;
}
interface ShapeMappingsData {
  rows: ShapeMappingRow[];
}

const categoryVariant = (c: string): "info" | "warning" | "success" | "neutral" | "default" => {
  if (!c) return "neutral";
  if (c.toLowerCase().includes("step")) return "warning";
  if (c.toLowerCase().includes("round")) return "success";
  if (c.toLowerCase().includes("fancy")) return "info";
  return "default";
};

const columns: Column<ShapeMappingRow>[] = [
  { key: "rawShape", header: "Raw Shape", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.rawShape}</span>, sortable: true, sortValue: (r) => r.rawShape, sticky: "left" },
  { key: "normalizedShape", header: "Normalized Shape", align: "center", cell: (r) => <Badge variant="info">{r.normalizedShape}</Badge> },
  { key: "category", header: "Category", align: "center", cell: (r) => <Badge variant={categoryVariant(r.category)}>{r.category || "—"}</Badge> },
  {
    key: "mapping",
    header: "Mapping",
    cell: (r) => (
      <span className="text-[10px] inline-flex items-center gap-1">
        <span className="font-mono">{r.rawShape}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium">{r.normalizedShape}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{r.category}</span>
      </span>
    ),
  },
  { key: "active", header: "Active", align: "center", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "ACTIVE" : "INACTIVE"}</Badge> },
];

export function ShapeMappingsView() {
  const { data, isLoading } = useApi<ShapeMappingsData>("/api/admin/shape-mappings");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Shape Mappings (Admin)"
        subtitle="Master mapping table for raw Shape → normalized Shape with category"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} mappings</span>}
      />

      <InfoBanner variant="info">
        <strong className="font-semibold">Confirmed Rule:</strong> Compare trimmed raw shape case-insensitively. Unknown shape: preserve original, create validation warning.
      </InfoBanner>

      <Section title="Shape Mapping Table" description="Each row maps a raw shape string to a normalized shape and shape category">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No shape mappings configured"
          maxHeight="640px"
          exportable
          exportPermission="config.export"
          exportFilename="shape-mappings.csv"
          searchable
          searchPlaceholder="Search raw, normalized, or category..."
          searchFn={(r, q) => [r.rawShape, r.normalizedShape, r.category].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
        />
      </Section>
    </div>
  );
}
