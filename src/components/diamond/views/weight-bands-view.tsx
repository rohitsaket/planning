"use client";

import { useApi } from "@/lib/api-client";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";

interface WeightBandRow {
  id: string;
  code: string;
  label: string;
  minCt: number;
  maxCt: number;
  sortOrder: number;
  active: boolean;
}
interface WeightBandsData {
  rows: WeightBandRow[];
}

const columns: Column<WeightBandRow>[] = [
  { key: "sortOrder", header: "#", cell: (r) => <NumberCell value={r.sortOrder} />, align: "right", sortable: true, sortValue: (r) => r.sortOrder, width: "48px" },
  { key: "code", header: "Code", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.code}</span>, sortable: true, sortValue: (r) => r.code, sticky: "left" },
  { key: "label", header: "Label", cell: (r) => <span className="text-[10px]">{r.label}</span>, sortable: true, sortValue: (r) => r.label },
  { key: "minCt", header: "Min (ct)", cell: (r) => <NumberCell value={r.minCt} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.minCt },
  { key: "maxCt", header: "Max (ct)", cell: (r) => <NumberCell value={r.maxCt} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.maxCt },
  {
    key: "range",
    header: "Range",
    align: "center",
    cell: (r) => (
      <div className="relative w-[140px] h-1.5 bg-muted rounded-full overflow-hidden mx-auto">
        <div className="absolute h-full bg-emerald-500/70" style={{ width: "100%" }} />
        <span className="absolute -top-3 right-0 text-[9px] text-muted-foreground">{r.maxCt.toFixed(2)}</span>
        <span className="absolute -top-3 left-0 text-[9px] text-muted-foreground">{r.minCt.toFixed(2)}</span>
      </div>
    ),
  },
  { key: "active", header: "Active", align: "center", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge> },
];

export function WeightBandsView() {
  const { data, isLoading } = useApi<WeightBandsData>("/api/admin/weight-bands");

  return (
    <div data-page-body className="flex flex-col gap-section px-page-x py-page-y">
      <PageHeader
        title="Weight Bands"
        subtitle="Weight bands from 1.00 ct and above"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} bands</span>}
      />

      <InfoBanner variant="warning">
        Bands start at 1.00 ct. Stones below 1.00 ct are not included.
      </InfoBanner>

      <Section title="Confirmed Weight Bands" description="Weight bands used to group stones">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No weight bands configured"
          exportable
          exportPermission="config.export"
          exportFilename="weight-bands.csv"
          searchable
          searchPlaceholder="Search code or label..."
          searchFn={(r, q) => [r.code, r.label].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
          pagination
          pageSize={25}
        />
      </Section>
    </div>
  );
}
