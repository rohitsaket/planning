"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Boxes } from "lucide-react";

interface WipRow {
  dimension: string;
  pieces: number;
}
interface EligibilityFlag {
  flag: string;
  value: string;
  default: boolean;
}
interface WipData {
  totalWipPieces: number;
  byStatus: WipRow[];
  byDept: WipRow[];
  byShape: WipRow[];
  byCategory: WipRow[];
  eligibilityFlags: EligibilityFlag[];
  openRuleNote: string;
}

const wipColumns: Column<WipRow>[] = [
  { key: "dimension", header: "Dimension", cell: (r) => <span className="font-medium">{r.dimension}</span>, sortable: true, sortValue: (r) => r.dimension },
  { key: "pieces", header: "Pieces", cell: (r) => <NumberCell value={r.pieces} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.pieces },
];

const eligibilityColumns: Column<EligibilityFlag>[] = [
  { key: "flag", header: "Eligibility Flag", cell: (r) => <span className="font-medium">{r.flag}</span> },
  { key: "value", header: "Current Setting", cell: (r) => <Badge variant="warning">{r.value}</Badge> },
  { key: "default", header: "Default", cell: (r) => <Badge variant={r.default ? "success" : "neutral"}>{r.default ? "ON" : "OFF"}</Badge> },
];

export function WipView() {
  const { data, isLoading } = useApi<WipData>("/api/analysis/wip");

  const piecesSpark = useMemo(() => {
    const slice = (data?.byStatus ?? []).slice(0, 7).map((r) => r.pieces);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [data?.byStatus]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="WIP Analysis"
        subtitle="Work-in-progress pieces from approved plans — eligibility flags remain an OPEN rule"
        meta={<span className="text-[10px] text-muted-foreground">BR-WIP-001 · OPEN</span>}
      />

      {data?.openRuleNote && (
        <InfoBanner variant="warning">{data.openRuleNote}</InfoBanner>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Total WIP Pieces" value={data?.totalWipPieces ?? 0} unit="pcs" intent="info" hint="Approved plan pieces in manufacturing" icon={Boxes} sparkline={piecesSpark} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="WIP by Status" description="Plan approval / manufacturing status buckets">
          <DataTable columns={wipColumns} rows={data?.byStatus ?? []} loading={isLoading} emptyMessage="No WIP status data" maxHeight="320px" />
        </Section>
        <Section title="WIP by Department (sourceFile)" description="Pieces grouped by Fantasy source file / department">
          <DataTable columns={wipColumns} rows={data?.byDept ?? []} loading={isLoading} emptyMessage="No department data" maxHeight="320px" />
        </Section>
        <Section title="WIP by Expected Shape" description="Pieces grouped by expected polished shape">
          <DataTable columns={wipColumns} rows={data?.byShape ?? []} loading={isLoading} emptyMessage="No shape data" maxHeight="320px" />
        </Section>
        <Section title="WIP by Expected Category" description="Pieces grouped by expected planning category">
          <DataTable columns={wipColumns} rows={data?.byCategory ?? []} loading={isLoading} emptyMessage="No category data" maxHeight="320px" />
        </Section>
      </div>

      <Section title="WIP Eligibility Flags (OPEN Rule)" description="These flags decide whether WIP counts toward shortage and which expected attributes are trusted">
        <DataTable columns={eligibilityColumns} rows={data?.eligibilityFlags ?? []} loading={isLoading} emptyMessage="No flags defined" maxHeight="400px" />
        <div className="mt-2 text-[10px] text-muted-foreground">
          <StatusBadge status="OPEN" /> All flags are <span className="font-medium">Configurable (OPEN)</span> — defaults are OFF until an approved business rule confirms each flag.
        </div>
      </Section>
    </div>
  );
}
