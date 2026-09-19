"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { NumberCell, Money, InfoBanner } from "@/components/diamond/shared/empty-state";
import { StatusBadge } from "@/components/diamond/shared/badges";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";

interface MemoAggRow {
  dimension: string;
  qty: number;
  value: number;
  avgAge: number;
}

interface MemoRow {
  id: string;
  lotId: string;
  memoDate: string;
  customerName: string;
  country: string;
  branch: string;
  shape: string;
  weight: number;
  lab: string | null;
  color: string | null;
  clarity: string | null;
  treatment: string | null;
  memoValueUsd: number;
  status: string;
  memoAgeDays: number | null;
}

interface MemoAgeBuckets { "0-30": number; "31-60": number; "61-90": number; "91-180": number; "180+": number; }

interface MemoResponse {
  totalQty: number;
  totalValue: number;
  byCountry: MemoAggRow[];
  byCustomer: MemoAggRow[];
  ageBuckets: MemoAgeBuckets;
  rows: MemoRow[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

export function MemoView() {
  const { data, isLoading } = useApi<MemoResponse>("/api/analysis/memo");

  const ageChartData = data
    ? ([
        { name: "0-30", qty: data.ageBuckets["0-30"] },
        { name: "31-60", qty: data.ageBuckets["31-60"] },
        { name: "61-90", qty: data.ageBuckets["61-90"] },
        { name: "91-180", qty: data.ageBuckets["91-180"] },
        { name: "180+", qty: data.ageBuckets["180+"] },
      ])
    : [];

  const aggColumns: Column<MemoAggRow>[] = [
    {
      key: "dimension", header: "Group", sortable: true, sortValue: (r) => r.dimension,
      cell: (r) => <span className="font-medium">{r.dimension}</span>, sticky: "left",
    },
    { key: "qty", header: "Qty", sortable: true, sortValue: (r) => r.qty, align: "right",
      cell: (r) => <NumberCell value={r.qty} /> },
    { key: "value", header: "Value", sortable: true, sortValue: (r) => r.value, align: "right",
      cell: (r) => <Money value={r.value} /> },
    { key: "avgAge", header: "Avg Age (days)", sortable: true, sortValue: (r) => r.avgAge, align: "right",
      cell: (r) => <NumberCell value={r.avgAge} intent={r.avgAge > 90 ? "warning" : undefined} /> },
  ];

  const detailColumns: Column<MemoRow>[] = [
    { key: "lotId", header: "Lot ID", sortable: true, sortValue: (r) => r.lotId,
      cell: (r) => <span className="font-mono text-[11px]">{r.lotId}</span>, sticky: "left", width: "130px" },
    { key: "memoDate", header: "Memo Date", sortable: true, sortValue: (r) => r.memoDate, align: "right", width: "100px",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{formatDate(r.memoDate)}</span> },
    { key: "customerName", header: "Customer", sortable: true, sortValue: (r) => r.customerName,
      cell: (r) => <span className="font-medium">{r.customerName}</span> },
    { key: "country", header: "Country", sortable: true, sortValue: (r) => r.country, cell: (r) => r.country, width: "80px" },
    { key: "branch", header: "Branch", sortable: true, sortValue: (r) => r.branch, cell: (r) => r.branch, width: "80px" },
    { key: "shape", header: "Shape", sortable: true, sortValue: (r) => r.shape, cell: (r) => r.shape, width: "80px" },
    { key: "weight", header: "Weight", sortable: true, sortValue: (r) => r.weight, align: "right", width: "80px",
      cell: (r) => <NumberCell value={r.weight} /> },
    { key: "lab", header: "Lab", sortable: true, sortValue: (r) => r.lab ?? "", width: "80px",
      cell: (r) => <span className="text-muted-foreground">{r.lab ?? "Non-Cert"}</span> },
    { key: "color", header: "Color", sortable: true, sortValue: (r) => r.color ?? "", width: "70px",
      cell: (r) => r.color ?? <span className="text-muted-foreground">—</span> },
    { key: "clarity", header: "Clarity", sortable: true, sortValue: (r) => r.clarity ?? "", width: "80px",
      cell: (r) => r.clarity ?? <span className="text-muted-foreground">—</span> },
    { key: "treatment", header: "Treatment", sortable: true, sortValue: (r) => r.treatment ?? "", width: "90px",
      cell: (r) => r.treatment ?? <span className="text-muted-foreground">—</span> },
    { key: "memoValueUsd", header: "Memo Value", sortable: true, sortValue: (r) => r.memoValueUsd, align: "right", width: "100px",
      cell: (r) => <Money value={r.memoValueUsd} /> },
    { key: "status", header: "Status", sortable: true, sortValue: (r) => r.status, align: "center", width: "90px",
      cell: (r) => <StatusBadge status={r.status} /> },
    { key: "memoAgeDays", header: "Age (days)", sortable: true, sortValue: (r) => r.memoAgeDays ?? 0, align: "right", width: "90px",
      cell: (r) => {
        const a = r.memoAgeDays ?? 0;
        return <NumberCell value={a} intent={a > 90 ? "critical" : a > 30 ? "warning" : undefined} />;
      } },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Memo Analysis"
        subtitle="Stock on consignment — pieces, value and age by country and customer"
        meta={<span className="text-[10px] text-muted-foreground">{data?.rows.length ?? 0} memo lots across {data?.byCountry.length ?? 0} countries</span>}
      />

      <InfoBanner variant="warning">
        <strong>Memo does NOT reduce shortage.</strong> Memo is a <strong>separate decision context</strong> — memo stones remain physically in the customer's possession but are still owned by the company until invoiced. Shortage = MAX(0, Target − Available).
      </InfoBanner>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <KpiCard label="Total Qty" value={data?.totalQty ?? 0} unit="pcs" intent="default" hint="All memo lots" />
        <KpiCard label="Total Value" value={`$${((data?.totalValue ?? 0) / 1000).toFixed(1)}K`} intent="warning" hint="Memo exposure at cost" />
        <KpiCard label="Avg Age" value={
          data && data.rows.length > 0
            ? Math.round(data.rows.reduce((s, r) => s + (r.memoAgeDays ?? 0), 0) / data.rows.length)
            : 0
        } unit="days" intent="info" hint="Mean across all open memos" />
        <KpiCard label="Aged > 90D" value={
          data ? (data.ageBuckets["91-180"] + data.ageBuckets["180+"]) : 0
        } unit="pcs" intent="critical" hint="Memos needing follow-up" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Section title="By Country" description="Memo qty, value and avg age per country">
          <DataTable<MemoAggRow>
            columns={aggColumns}
            rows={data?.byCountry ?? []}
            loading={isLoading}
            emptyMessage="No memo data by country."
            initialSortKey="value"
            initialSortDir="desc"
            maxHeight="280px"
          />
        </Section>
        <Section title="By Customer" description="Memo qty, value and avg age per customer">
          <DataTable<MemoAggRow>
            columns={aggColumns}
            rows={data?.byCustomer ?? []}
            loading={isLoading}
            emptyMessage="No memo data by customer."
            initialSortKey="value"
            initialSortDir="desc"
            maxHeight="280px"
          />
        </Section>
      </div>

      <Section title="Age Buckets" description="Memo count by age bucket — 91-180D and 180+ are slow conversion">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ageChartData} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="qty" name="Qty" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Memo Detail" description="All memo lots with full stone characteristics and aging">
        <DataTable<MemoRow>
          columns={detailColumns}
          rows={data?.rows ?? []}
          loading={isLoading}
          emptyMessage="No memo lots found."
          initialSortKey="memoAgeDays"
          initialSortDir="desc"
          exportable
          exportFilename="memos.csv"
          searchable
          searchPlaceholder="Search lotId, customer, country, shape..."
          searchFn={(r, q) => `${r.lotId} ${r.customerName} ${r.country} ${r.branch} ${r.shape} ${r.lab ?? ""}`.toLowerCase().includes(q.toLowerCase())}
          maxHeight="560px"
          pagination
          pageSize={50}
        />
      </Section>
    </div>
  );
}
