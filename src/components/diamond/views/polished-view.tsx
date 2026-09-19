"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, Money } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import { Package, Gem } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface PolishedRow {
  dimension: string;
  pieces: number;
  carats: number;
  value: number;
}

interface AgingBucket { "0-30": number; "31-60": number; "61-90": number; "91-180": number; "181-365": number; "365+": number; }

interface PolishedResponse {
  totalPieces: number;
  totalCarats: number;
  dimension: string;
  rows: PolishedRow[];
  aging: AgingBucket;
}

const DIMENSIONS = [
  { value: "planningClass", label: "Planning Class" },
  { value: "lab", label: "Lab" },
  { value: "shape", label: "Shape" },
  { value: "weightBand", label: "Weight Band" },
  { value: "country", label: "Country" },
  { value: "branch", label: "Branch" },
  { value: "treatment", label: "Treatment" },
  { value: "fantasyStatus", label: "Fantasy Status" },
];

export function PolishedView() {
  const [dimension, setDimension] = useState("planningClass");
  const url = `/api/analysis/polished?dimension=${dimension}`;
  const { data, isLoading } = useApi<PolishedResponse>(url);

  const agingData = data
    ? ([
        { name: "0-30", pieces: data.aging["0-30"] },
        { name: "31-60", pieces: data.aging["31-60"] },
        { name: "61-90", pieces: data.aging["61-90"] },
        { name: "91-180", pieces: data.aging["91-180"] },
        { name: "181-365", pieces: data.aging["181-365"] },
        { name: "365+", pieces: data.aging["365+"] },
      ])
    : [];

  const columns: Column<PolishedRow>[] = [
    {
      key: "dimension", header: "Dimension", sortable: true, sortValue: (r) => r.dimension,
      cell: (r) => <span className="font-medium">{r.dimension}</span>, sticky: "left",
    },
    { key: "pieces", header: "Pieces", sortable: true, sortValue: (r) => r.pieces, align: "right",
      cell: (r) => <NumberCell value={r.pieces} /> },
    { key: "carats", header: "Carats", sortable: true, sortValue: (r) => r.carats, align: "right",
      cell: (r) => <NumberCell value={r.carats} /> },
    { key: "value", header: "Value (USD)", sortable: true, sortValue: (r) => r.value, align: "right",
      cell: (r) => <Money value={r.value} /> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Polished Stock Analysis"
        subtitle="Physical polished inventory by dimension with aging buckets — Fantasy is the authoritative source"
        actions={
          <Select value={dimension} onValueChange={setDimension}>
            <SelectTrigger size="sm" className="h-8 w-[170px] text-xs">
              <SelectValue placeholder="Dimension" />
            </SelectTrigger>
            <SelectContent>
              {DIMENSIONS.map((d) => (
                <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        meta={<span className="text-[10px] text-muted-foreground">Dimension: {DIMENSIONS.find((d) => d.value === dimension)?.label}</span>}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiCard label="Total Pieces" value={data?.totalPieces ?? 0} unit="pcs" intent="default" hint="Polished lots (all dimensions)" />
        <KpiCard label="Total Carats" value={(data?.totalCarats ?? 0).toFixed(2)} unit="ct" intent="info" hint="Σ weight" />
        <KpiCard label="Dimensions Distinct" value={(data?.rows.length ?? 0)} intent="success" hint={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label}`} />
      </div>

      <Section title="Aging Buckets" description="Polished lot count by days since last update">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={agingData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="pieces" name="Pieces" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title={`By ${DIMENSIONS.find((d) => d.value === dimension)?.label}`} description="Sortable breakdown with pieces, carats and estimated value">
        <DataTable<PolishedRow>
          columns={columns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No polished stock data available."
          initialSortKey="pieces"
          initialSortDir="desc"
          exportable
          exportFilename={`polished-${dimension}.csv`}
          searchable
          searchPlaceholder="Search dimension..."
          searchFn={(r, q) => r.dimension.toLowerCase().includes(q.toLowerCase())}
          maxHeight="500px"
        />
      </Section>
    </div>
  );
}
