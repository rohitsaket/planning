"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gem, Filter } from "lucide-react";

interface RoughRow {
  id: string;
  fantasyRoughId: string;
  kapan: string;
  packet: string;
  stoneName: string;
  signer: string | null;
  stoneType: string;
  roughWeight: number;
  country: string;
  branch: string;
  fantasyDepartmentId: string | null;
  fantasyLocationId: string | null;
  fantasyStatus: string;
  planningEligible: boolean;
  planningStatus: string;
  parentRoughId: string | null;
  lastMovement: string | null;
  lastUpdated: string;
}

interface Payload {
  total: number;
  rows: RoughRow[];
}

const PLANNING_STATUS_OPTIONS = ["AVAILABLE", "SOFT_RESERVED", "UNDER_PLANNING", "PLAN_APPROVED", "RESERVED", "RELEASED", "CANCELLED"];
const STONE_TYPE_OPTIONS = ["WHITE", "BLUE"];
const COUNTRY_OPTIONS = ["India", "Belgium", "Hong Kong", "UAE", "USA", "Israel"];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso;
  }
}

export function FantasyRoughView() {
  const [planningStatus, setPlanningStatus] = useState<string>("ALL");
  const [stoneType, setStoneType] = useState<string>("ALL");
  const [country, setCountry] = useState<string>("ALL");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (planningStatus !== "ALL") params.set("planningStatus", planningStatus);
    if (stoneType !== "ALL") params.set("stoneType", stoneType);
    if (country !== "ALL") params.set("country", country);
    const s = params.toString();
    return s ? `?${s}` : "";
  }, [planningStatus, stoneType, country]);

  const { data, isLoading } = useApi<Payload>(`/api/fantasy/rough${queryString}`);

  const rows = data?.rows ?? [];
  const totalWeight = rows.reduce((acc, r) => acc + (r.roughWeight ?? 0), 0);
  const eligibleCount = rows.filter((r) => r.planningEligible).length;
  const blueCount = rows.filter((r) => r.stoneType === "BLUE").length;

  const columns: Column<RoughRow>[] = [
    { key: "fantasyRoughId", header: "Rough ID", sticky: "left", sortable: true, sortValue: (r) => r.fantasyRoughId, cell: (r) => <span className="font-medium">{r.fantasyRoughId}</span> },
    { key: "kapan", header: "Kapan", sortable: true, sortValue: (r) => r.kapan, cell: (r) => <span>{r.kapan}</span> },
    { key: "packet", header: "Packet", cell: (r) => <span>{r.packet}</span> },
    { key: "stoneName", header: "Stone Name", sortable: true, sortValue: (r) => r.stoneName, cell: (r) => <span className="font-medium">{r.stoneName}</span> },
    { key: "signer", header: "Signer", cell: (r) => <span className="text-muted-foreground">{r.signer ?? "—"}</span> },
    {
      key: "stoneType", header: "Stone Type", align: "center",
      cell: (r) => <Badge variant={r.stoneType === "BLUE" ? "info" : "neutral"}>{r.stoneType}</Badge>,
    },
    {
      key: "roughWeight", header: "Weight (ct)", align: "right", sortable: true, sortValue: (r) => r.roughWeight,
      cell: (r) => <NumberCell value={r.roughWeight} intent={r.roughWeight >= 10 ? "info" : "default"} />,
    },
    { key: "country", header: "Country", cell: (r) => <span>{r.country}</span> },
    { key: "branch", header: "Branch", cell: (r) => <span>{r.branch}</span> },
    { key: "fantasyDepartmentId", header: "Dept ID", cell: (r) => <span className="text-muted-foreground">{r.fantasyDepartmentId ?? "—"}</span> },
    { key: "fantasyLocationId", header: "Loc ID", cell: (r) => <span className="text-muted-foreground">{r.fantasyLocationId ?? "—"}</span> },
    {
      key: "fantasyStatus", header: "Fantasy Status", align: "center",
      cell: (r) => <StatusBadge status={r.fantasyStatus} />,
    },
    {
      key: "planningEligible", header: "Plan Eligible", align: "center",
      cell: (r) => <Badge variant={r.planningEligible ? "success" : "neutral"}>{r.planningEligible ? "Yes" : "No"}</Badge>,
    },
    {
      key: "planningStatus", header: "Plan Status", align: "center",
      cell: (r) => <StatusBadge status={r.planningStatus} />,
    },
    { key: "parentRoughId", header: "Parent Rough", cell: (r) => <span className="text-muted-foreground">{r.parentRoughId ?? "—"}</span> },
    { key: "lastMovement", header: "Last Movement", cell: (r) => <span className="text-muted-foreground">{fmtDate(r.lastMovement)}</span> },
    { key: "lastUpdated", header: "Last Updated", sortable: true, sortValue: (r) => r.lastUpdated, cell: (r) => <span className="text-muted-foreground">{fmtDate(r.lastUpdated)}</span> },
  ];

  return (
    <div className="flex flex-col gap-2.5 p-3 h-full min-h-0 overflow-hidden">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">
        <KpiCard label="Total Rough Stones" value={data?.total ?? 0} unit="stones" intent="info" hint="After filters applied" />
        <KpiCard label="Total Weight" value={totalWeight.toFixed(2)} unit="ct" intent="default" hint="Sum of selected rows" />
        <KpiCard label="Planning Eligible" value={eligibleCount} unit="stones" intent="success" hint="Available for planning" />
        <KpiCard label="Blue Stones" value={blueCount} unit="stones" intent="info" hint="Fancy blue stone type" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
            <Filter className="h-3 w-3" /> Status:
          </label>
          <Select value={planningStatus} onValueChange={setPlanningStatus}>
            <SelectTrigger className="h-7.5 text-xs w-[150px] bg-card shadow-xs" size="sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {PLANNING_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Stone Type:</label>
          <Select value={stoneType} onValueChange={setStoneType}>
            <SelectTrigger className="h-7.5 text-xs w-[120px] bg-card shadow-xs" size="sm">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {STONE_TYPE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] font-medium text-muted-foreground">Country:</label>
          <Select value={country} onValueChange={setCountry}>
            <SelectTrigger className="h-7.5 text-xs w-[130px] bg-card shadow-xs" size="sm">
              <SelectValue placeholder="All countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All countries</SelectItem>
              {COUNTRY_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        title="Rough Stock"
        description="Click column headers to sort · Use search to filter live"
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No rough stones match the current filters."
        initialSortKey="lastUpdated"
        initialSortDir="desc"
        exportable
        exportFilename="fantasy-rough-stock.csv"
        excelExportable
        excelExportFilename="fantasy-rough-stock.xlsx"
        searchable
        searchPlaceholder="Search rough ID, kapan, packet, stone name..."
        searchFn={(r, q) => {
          const lq = q.toLowerCase();
          return (
            r.fantasyRoughId.toLowerCase().includes(lq) ||
            r.kapan.toLowerCase().includes(lq) ||
            r.packet.toLowerCase().includes(lq) ||
            r.stoneName.toLowerCase().includes(lq) ||
            (r.signer ?? "").toLowerCase().includes(lq)
          );
        }}
      />
    </div>
  );
}
