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
      key: "stoneType", header: "Stone Type",
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
      key: "fantasyStatus", header: "Fantasy Status",
      cell: (r) => <StatusBadge status={r.fantasyStatus} />,
    },
    {
      key: "planningEligible", header: "Plan Eligible",
      cell: (r) => <Badge variant={r.planningEligible ? "success" : "neutral"}>{r.planningEligible ? "Yes" : "No"}</Badge>,
    },
    {
      key: "planningStatus", header: "Plan Status",
      cell: (r) => <StatusBadge status={r.planningStatus} />,
    },
    { key: "parentRoughId", header: "Parent Rough", cell: (r) => <span className="text-muted-foreground">{r.parentRoughId ?? "—"}</span> },
    { key: "lastMovement", header: "Last Movement", cell: (r) => <span className="text-muted-foreground">{fmtDate(r.lastMovement)}</span> },
    { key: "lastUpdated", header: "Last Updated", sortable: true, sortValue: (r) => r.lastUpdated, cell: (r) => <span className="text-muted-foreground">{fmtDate(r.lastUpdated)}</span> },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Fantasy Rough Stock"
        subtitle="Authoritative Fantasy-sourced rough inventory · Kapan / Packet / Stone Name · Plan eligibility & status"
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Rough Stones" value={data?.total ?? 0} unit="stones" intent="info" hint="After filters applied" />
        <KpiCard label="Total Weight" value={totalWeight.toFixed(2)} unit="ct" intent="default" hint="Sum of selected rows" />
        <KpiCard label="Planning Eligible" value={eligibleCount} unit="stones" intent="success" hint="Available for planning" />
        <KpiCard label="Blue Stones" value={blueCount} unit="stones" intent="info" hint="Fancy blue stone type" />
      </div>

      <InfoBanner variant="info">
        <div className="flex items-center gap-2">
          <Gem className="h-3.5 w-3.5" />
          <span className="font-medium">Fantasy is the authoritative source.</span>
          <span className="text-muted-foreground">All rough IDs, kapan/packet, status, and movement are mirrored from Fantasy sync runs.</span>
        </div>
      </InfoBanner>

      {/* Filters */}
      <Section title="Filters" description="Filter by planning status, stone type, and country">
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <Filter className="h-3 w-3" /> Planning Status
            </label>
            <Select value={planningStatus} onValueChange={setPlanningStatus}>
              <SelectTrigger className="h-8 text-xs w-[180px]" size="sm">
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
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Stone Type</label>
            <Select value={stoneType} onValueChange={setStoneType}>
              <SelectTrigger className="h-8 text-xs w-[140px]" size="sm">
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
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Country</label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-8 text-xs w-[160px]" size="sm">
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
      </Section>

      <Section title="Rough Stock" description="Click column headers to sort · Use search to filter live">
        <DataTable
          columns={columns}
          rows={rows}
          loading={isLoading}
          emptyMessage="No rough stones match the current filters."
          maxHeight="600px"
          initialSortKey="lastUpdated"
          initialSortDir="desc"
          exportable
          exportFilename="fantasy-rough-stock.csv"
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
      </Section>
    </div>
  );
}
