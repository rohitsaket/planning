"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, InfoBanner } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Globe, Layers, Boxes, AlertTriangle } from "lucide-react";

interface CountryRow {
  country: string;
  physicalShortage: number;
  target: number;
  available: number;
  excess: number;
  wip: number;
  planCov: number;
  transferCandidates: number;
}

interface CountryResponse {
  rows: CountryRow[];
  global: {
    target: number;
    available: number;
    shortage: number;
    excess: number;
    wip: number;
    planCov: number;
  };
}

export function CountryView() {
  const { data, isLoading } = useApi<CountryResponse>("/api/analysis/countries");

  const chartData = (data?.rows ?? []).map((r) => ({
    name: r.country,
    shortage: r.physicalShortage,
    wip: r.wip,
    planCov: r.planCov,
  }));

  const columns: Column<CountryRow>[] = [
    {
      key: "country", header: "Country", sortable: true, sortValue: (r) => r.country,
      cell: (r) => <span className="font-medium">{r.country}</span>, sticky: "left", width: "120px",
    },
    { key: "physicalShortage", header: "Shortage", sortable: true, sortValue: (r) => r.physicalShortage, align: "right",
      cell: (r) => <NumberCell value={r.physicalShortage} intent={r.physicalShortage > 0 ? "critical" : "success"} /> },
    { key: "target", header: "Target", sortable: true, sortValue: (r) => r.target, align: "right",
      cell: (r) => <NumberCell value={r.target} /> },
    { key: "available", header: "Available", sortable: true, sortValue: (r) => r.available, align: "right",
      cell: (r) => <NumberCell value={r.available} /> },
    { key: "excess", header: "Excess", sortable: true, sortValue: (r) => r.excess, align: "right",
      cell: (r) => <NumberCell value={r.excess} intent={r.excess > 0 ? "warning" : undefined} /> },
    { key: "wip", header: "WIP", sortable: true, sortValue: (r) => r.wip, align: "right",
      cell: (r) => <NumberCell value={r.wip} intent={r.wip > 0 ? "info" : undefined} /> },
    { key: "planCov", header: "Plan Cov", sortable: true, sortValue: (r) => r.planCov, align: "right",
      cell: (r) => <NumberCell value={r.planCov} intent="success" /> },
    { key: "transferCandidates", header: "Transfer Candidates", sortable: true, sortValue: (r) => r.transferCandidates, align: "right",
      cell: (r) => <NumberCell value={r.transferCandidates} /> },
  ];

  const g = data?.global;

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Country / Branch Analysis"
        subtitle="Physical shortage vs target by country with WIP and approved plan coverage"
        meta={<span className="text-[10px] text-muted-foreground">Source: latest demand run + open requirements</span>}
      />

      <InfoBanner variant="info">
        <strong>OPEN Rule:</strong> Transfer eligibility between branches is an <strong>OPEN</strong> business rule — values shown here are placeholders pending rule confirmation.
      </InfoBanner>

      {/* Global aggregates */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard label="Global Target" value={g?.target ?? 0} unit="pcs" intent="default" hint="Σ Rounded Target" />
        <KpiCard label="Global Available" value={g?.available ?? 0} unit="pcs" intent="success" hint="Polished stock" />
        <KpiCard label="Global Shortage" value={g?.shortage ?? 0} unit="pcs" intent="critical" hint="MAX(0, Tgt − Avail)" />
        <KpiCard label="Global Excess" value={g?.excess ?? 0} unit="pcs" intent="warning" hint="MAX(0, Avail − Tgt)" />
        <KpiCard label="Global WIP" value={g?.wip ?? 0} unit="pcs" intent="info" hint="Approved plan pieces" />
        <KpiCard label="Global Plan Cov" value={g?.planCov ?? 0} unit="pcs" intent="success" hint="Approved coverage" />
      </div>

      <Section title="Shortage by Country" description="Horizontal breakdown — shortage (red), WIP (amber), plan coverage (green)">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={70} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="shortage" name="Shortage" stackId="a" fill="#ef4444" />
              <Bar dataKey="wip" name="WIP" stackId="a" fill="#f59e0b" />
              <Bar dataKey="planCov" name="Plan Cov" stackId="a" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Country Detail" description="Sortable country breakdown with shortage, target, available, excess, WIP, plan coverage and transfer candidates">
        <DataTable<CountryRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No country data available — ensure a demand run has been generated."
          initialSortKey="physicalShortage"
          initialSortDir="desc"
          exportable
          exportFilename="countries.csv"
          searchable
          searchPlaceholder="Search country..."
          searchFn={(r, q) => r.country.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
