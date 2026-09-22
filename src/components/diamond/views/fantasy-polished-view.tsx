"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Diamond, Filter } from "lucide-react";

interface PolishedRow {
  id: string;
  fantasyLotId: string;
  fantasyDepartmentId: string | null;
  fantasyLocationId: string | null;
  country: string;
  branch: string;
  fantasyStatus: string;
  labRaw: string | null;
  labNormalized: string | null;
  shape: string;
  shapeNormalized: string | null;
  weight: number;
  weightBand: string | null;
  color: string | null;
  clarity: string | null;
  certificate: string | null;
  treatment: string | null;
  planningClass: string;
  lastUpdated: string;
}

interface Payload {
  total: number;
  rows: PolishedRow[];
}

const PLANNING_CLASS_OPTIONS = ["PHYSICAL", "PLANNING_AVAILABLE", "RESERVED", "HOLD", "TRANSFER", "MEMO", "OTHER"];
const LAB_OPTIONS = ["GIA", "Non-Cert"];
const SHAPE_OPTIONS = ["ROUND", "OVAL", "PEAR", "EMERALD", "CUSHION", "PRINCESS", "MARQUISE", "RADIANT", "HEART", "ASSCHER", "TRILLION"];
const COUNTRY_OPTIONS = ["India", "Belgium", "Hong Kong", "UAE", "USA", "Israel"];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso;
  }
}

export function FantasyPolishedView() {
  const [planningClass, setPlanningClass] = useState<string>("ALL");
  const [lab, setLab] = useState<string>("ALL");
  const [shape, setShape] = useState<string>("ALL");
  const [country, setCountry] = useState<string>("ALL");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (planningClass !== "ALL") params.set("planningClass", planningClass);
    if (lab !== "ALL") params.set("lab", lab);
    if (shape !== "ALL") params.set("shape", shape);
    if (country !== "ALL") params.set("country", country);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [planningClass, lab, shape, country]);

  const { data, isLoading } = useApi<Payload>(`/api/fantasy/polished${queryString}`);

  const rows = data?.rows ?? [];
  const totalWeight = rows.reduce((acc, r) => acc + (r.weight ?? 0), 0);
  const giaCount = rows.filter((r) => r.labNormalized === "GIA").length;
  const certCount = rows.filter((r) => !!r.certificate).length;

  const columns: Column<PolishedRow>[] = [
    { key: "fantasyLotId", header: "Lot ID", sticky: "left", sortable: true, sortValue: (r) => r.fantasyLotId, cell: (r) => <span className="font-medium">{r.fantasyLotId}</span> },
    { key: "fantasyDepartmentId", header: "Dept ID", cell: (r) => <span className="text-muted-foreground">{r.fantasyDepartmentId ?? "—"}</span> },
    { key: "fantasyLocationId", header: "Loc ID", cell: (r) => <span className="text-muted-foreground">{r.fantasyLocationId ?? "—"}</span> },
    { key: "country", header: "Country", cell: (r) => <span>{r.country}</span> },
    { key: "branch", header: "Branch", cell: (r) => <span>{r.branch}</span> },
    {
      key: "fantasyStatus", header: "Fantasy Status", align: "center",
      cell: (r) => <StatusBadge status={r.fantasyStatus} />,
    },
    { key: "labRaw", header: "Lab (raw)", cell: (r) => <span className="text-muted-foreground">{r.labRaw ?? "—"}</span> },
    {
      key: "labNormalized", header: "Lab (norm)", align: "center",
      cell: (r) => <Badge variant={r.labNormalized === "GIA" ? "info" : "neutral"}>{r.labNormalized ?? "Non-Cert"}</Badge>,
    },
    { key: "shape", header: "Shape", cell: (r) => <span>{r.shape}</span> },
    { key: "shapeNormalized", header: "Shape (norm)", cell: (r) => <span className="text-muted-foreground">{r.shapeNormalized ?? "—"}</span> },
    {
      key: "weight", header: "Weight (ct)", align: "right", sortable: true, sortValue: (r) => r.weight,
      cell: (r) => <NumberCell value={r.weight} intent="info" />,
    },
    { key: "weightBand", header: "Weight Band", cell: (r) => <span className="text-muted-foreground">{r.weightBand ?? "—"}</span> },
    { key: "color", header: "Color", cell: (r) => <span>{r.color ?? "—"}</span> },
    { key: "clarity", header: "Clarity", cell: (r) => <span>{r.clarity ?? "—"}</span> },
    { key: "certificate", header: "Certificate", cell: (r) => <span className="text-muted-foreground text-[10px]">{r.certificate ?? "—"}</span> },
    { key: "treatment", header: "Treatment", cell: (r) => <span className="text-muted-foreground">{r.treatment ?? "—"}</span> },
    {
      key: "planningClass", header: "Plan Class", align: "center",
      cell: (r) => <StatusBadge status={r.planningClass} />,
    },
    { key: "lastUpdated", header: "Last Updated", sortable: true, sortValue: (r) => r.lastUpdated, cell: (r) => <span className="text-muted-foreground">{fmtDate(r.lastUpdated)}</span> },
  ];

  return (
    <div className="flex flex-col gap-2.5 p-3 h-full min-h-0 flex-1 overflow-hidden">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">
        <KpiCard label="Total Polished Lots" value={data?.total ?? 0} unit="lots" intent="success" hint="After filters applied" />
        <KpiCard label="Total Weight" value={totalWeight.toFixed(2)} unit="ct" intent="default" hint="Sum of selected rows" />
        <KpiCard label="GIA Certified" value={giaCount} unit="lots" intent="info" hint="labNormalized = GIA" />
        <KpiCard label="With Certificate #" value={certCount} unit="lots" intent="default" hint="Lots with certificate number populated" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <FilterSelect label="Plan Class" value={planningClass} onChange={setPlanningClass} options={PLANNING_CLASS_OPTIONS} placeholder="All classes" width="140px" />
        <FilterSelect label="Lab" value={lab} onChange={setLab} options={LAB_OPTIONS} placeholder="All labs" width="120px" />
        <FilterSelect label="Shape" value={shape} onChange={setShape} options={SHAPE_OPTIONS} placeholder="All shapes" width="140px" />
        <FilterSelect label="Country" value={country} onChange={setCountry} options={COUNTRY_OPTIONS} placeholder="All countries" width="140px" />
      </div>

      <DataTable
        title="Polished Lots"
        description="Click column headers to sort · Use search to filter live"
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No polished lots match the current filters."
        initialSortKey="lastUpdated"
        initialSortDir="desc"
        exportable
        exportFilename="fantasy-polished-stock.csv"
        searchable
        searchPlaceholder="Search lot ID, certificate, color, clarity..."
        searchFn={(r, q) => {
          const lq = q.toLowerCase();
          return (
            r.fantasyLotId.toLowerCase().includes(lq) ||
            (r.certificate ?? "").toLowerCase().includes(lq) ||
            (r.color ?? "").toLowerCase().includes(lq) ||
            (r.clarity ?? "").toLowerCase().includes(lq) ||
            r.shape.toLowerCase().includes(lq)
          );
        }}
      />
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, placeholder, width }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
  width: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        <Filter className="h-3 w-3" /> {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={`h-8 text-xs ${width}`} size="sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">All</SelectItem>
          {options.map((s) => (
            <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
