"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNavStore } from "@/stores/nav-store";
import { Filter, Gem, Activity, X } from "lucide-react";

interface RoughRow {
  id: string;
  fantasyRoughId: string | null;
  kapan: string | null;
  packet: string | null;
  stoneName: string | null;
  signer: string | null;
  stoneType: string | null;
  roughWeight: number;
  country: string | null;
  branch: string | null;
  fantasyDepartmentId: string | null;
  fantasyLocationId: string | null;
  fantasyStatus: string | null;
  planningEligible: boolean;
  planningStatus: string;
  lastMovement: string | null;
  lastUpdated: string;
}

interface ApiResponse {
  rows: RoughRow[];
}

const PLANNING_STATUSES = [
  "AVAILABLE",
  "SOFT_RESERVED",
  "UNDER_PLANNING",
  "RESERVED",
  "RELEASED_TO_MANUFACTURING",
];
const STONE_TYPES = ["WHITE", "BLUE"];
const COUNTRIES = ["USA", "India", "Belgium", "Israel", "HongKong", "UAE", "Botswana"];

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

export function RoughAvailabilityView() {
  const setView = useNavStore((s) => s.setView);
  const [planningStatus, setPlanningStatus] = useState("");
  const [stoneType, setStoneType] = useState("");
  const [country, setCountry] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(true);

  const qs = useMemo(() => {
    const parts: string[] = [];
    if (planningStatus) parts.push(`planningStatus=${encodeURIComponent(planningStatus)}`);
    if (stoneType) parts.push(`stoneType=${encodeURIComponent(stoneType)}`);
    if (country) parts.push(`country=${encodeURIComponent(country)}`);
    if (eligibleOnly) parts.push(`eligibleOnly=true`);
    return parts.length ? `?${parts.join("&")}` : "";
  }, [planningStatus, stoneType, country, eligibleOnly]);

  const { data, isLoading } = useApi<ApiResponse>(`/api/planning/rough${qs}`);
  const rows = data?.rows ?? [];

  const available = rows.filter((r) => r.planningStatus === "AVAILABLE").length;
  const reserved = rows.filter((r) => r.planningStatus === "RESERVED").length;
  const underPlan = rows.filter((r) => r.planningStatus === "UNDER_PLANNING").length;
  const totalWeight = rows.reduce((s, r) => s + r.roughWeight, 0);

  const activeFilters =
    (planningStatus ? 1 : 0) + (stoneType ? 1 : 0) + (country ? 1 : 0) + (eligibleOnly ? 1 : 0);

  const clearFilters = () => {
    setPlanningStatus("");
    setStoneType("");
    setCountry("");
    setEligibleOnly(false);
  };

  const columns: Column<RoughRow>[] = [
    {
      key: "fantasyRoughId",
      header: "Fantasy ID",
      width: "130px",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.fantasyRoughId ?? "",
      cell: (r) => (
        <span className="font-medium">{r.fantasyRoughId ?? "—"}</span>
      ),
    },
    {
      key: "kapan",
      header: "Kapan",
      width: "90px",
      cell: (r) => r.kapan ?? "—",
    },
    {
      key: "packet",
      header: "Packet",
      width: "80px",
      cell: (r) => r.packet ?? "—",
    },
    {
      key: "stoneName",
      header: "Stone Name",
      width: "150px",
      cell: (r) => r.stoneName ?? "—",
    },
    {
      key: "signer",
      header: "Signer",
      width: "70px",
      cell: (r) => r.signer ?? "—",
    },
    {
      key: "stoneType",
      header: "Type",
      width: "80px",
      cell: (r) => (
        <Badge variant={r.stoneType === "BLUE" ? "info" : "default"}>
          {r.stoneType ?? "—"}
        </Badge>
      ),
    },
    {
      key: "roughWeight",
      header: "Weight (ct)",
      width: "90px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.roughWeight,
      cell: (r) => <span className="tabular-nums">{r.roughWeight.toFixed(3)}</span>,
    },
    {
      key: "country",
      header: "Country",
      width: "80px",
      cell: (r) => r.country ?? "—",
    },
    {
      key: "branch",
      header: "Branch",
      width: "80px",
      cell: (r) => r.branch ?? "—",
    },
    {
      key: "fantasyStatus",
      header: "Fantasy Status",
      width: "110px",
      cell: (r) => (
        <Badge variant="neutral">{r.fantasyStatus ?? "—"}</Badge>
      ),
    },
    {
      key: "planningEligible",
      header: "Eligible",
      width: "80px",
      align: "center",
      cell: (r) =>
        r.planningEligible ? (
          <Badge variant="success">YES</Badge>
        ) : (
          <Badge variant="critical">NO</Badge>
        ),
    },
    {
      key: "planningStatus",
      header: "Plan Status",
      width: "130px",
      cell: (r) => <StatusBadge status={r.planningStatus} />,
    },
    {
      key: "lastMovement",
      header: "Last Move",
      width: "90px",
      sortable: true,
      sortValue: (r) => r.lastMovement ?? "",
      cell: (r) => fmtDate(r.lastMovement),
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Rough Availability"
        subtitle="Fantasy-authoritative rough stock filtered to planning-eligible inventory · choose a rough to plan"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {rows.length} rough stones · {totalWeight.toFixed(3)} ct total
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total Rows" value={rows.length} unit="stones" intent="default" onClick={() => setView("planning-rough-availability")} />
        <KpiCard label="Available" value={available} unit="stones" intent="success" hint="planningStatus = AVAILABLE" onClick={() => setView("planning-workbench")} />
        <KpiCard label="Under Planning" value={underPlan} unit="stones" intent="info" />
        <KpiCard label="Reserved" value={reserved} unit="stones" intent="warning" onClick={() => setView("planning-reservations")} />
      </div>

      <Section
        title="Filters"
        description="planningStatus · stoneType · country · eligibleOnly toggle"
        bodyClassName="p-2"
        actions={
          activeFilters > 0 ? (
            <button onClick={clearFilters} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" /> Clear ({activeFilters})
            </button>
          ) : null
        }
      >
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select
            value={planningStatus || "ALL"}
            onValueChange={(v) => setPlanningStatus(v === "ALL" ? "" : v)}
          >
            <SelectTrigger size="sm" className="h-8 w-[180px] text-xs">
              <SelectValue placeholder="All Plan Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Plan Statuses</SelectItem>
              {PLANNING_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={stoneType || "ALL"} onValueChange={(v) => setStoneType(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Stone Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Stone Types</SelectItem>
              {STONE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={country || "ALL"} onValueChange={(v) => setCountry(v === "ALL" ? "" : v)}>
            <SelectTrigger size="sm" className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="All Countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Countries</SelectItem>
              {COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Switch
              id="eligible-only"
              checked={eligibleOnly}
              onCheckedChange={setEligibleOnly}
            />
            <Label htmlFor="eligible-only" className="text-[11px] flex items-center gap-1 cursor-pointer">
              <Gem className="h-3 w-3" /> Eligible Only
            </Label>
          </div>
        </div>
      </Section>

      <DataTable<RoughRow>
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No rough stones match the current filters."
        maxHeight="600px"
        searchable
        searchPlaceholder="Search by stone name, kapan, packet…"
        searchFn={(r, q) => {
          const s = q.toLowerCase();
          return (
            (r.stoneName ?? "").toLowerCase().includes(s) ||
            (r.kapan ?? "").toLowerCase().includes(s) ||
            (r.packet ?? "").toLowerCase().includes(s) ||
            (r.fantasyRoughId ?? "").toLowerCase().includes(s)
          );
        }}
        exportable
        exportFilename="rough-availability.csv"
        onRowClick={() => setView("planning-workbench")}
        rowClassName={(r) =>
          r.planningStatus === "AVAILABLE"
            ? "bg-emerald-50/40 dark:bg-emerald-950/10"
            : ""
        }
      />

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Activity className="h-3 w-3" />
        Click any row to open the planning workbench. Available roughs are highlighted.
      </div>
    </div>
  );
}
