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
  { key: "active", header: "Active", align: "center", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "ACTIVE" : "INACTIVE"}</Badge> },
];

export function WeightBandsView() {
  const { data, isLoading } = useApi<WeightBandsData>("/api/admin/weight-bands");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Weight Bands (Admin)"
        subtitle="Confirmed analytical scope — 24 bands covering 1.00 ct and above"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} bands</span>}
      />

      <InfoBanner variant="warning">
        <strong className="font-semibold">Confirmed analytical scope starts at 1.00 ct.</strong> 0.90–0.99 is <strong>NOT</strong> part of the current confirmed scope. Inclusive boundaries, no overlap, no gaps for in-scope values, decimal-safe comparison.
      </InfoBanner>

      <Section title="Confirmed Weight Bands" description="Master weight band definitions used for analytical grouping">
        <DataTable
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No weight bands configured"
          maxHeight="640px"
          exportable
          exportPermission="config.export"
          exportFilename="weight-bands.csv"
          searchable
          searchPlaceholder="Search code or label..."
          searchFn={(r, q) => [r.code, r.label].some((f) => f.toLowerCase().includes(q.toLowerCase()))}
        />
      </Section>
    </div>
  );
}
