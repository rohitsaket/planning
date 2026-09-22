"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner } from "@/components/diamond/shared/empty-state";
import { MapPin, Building2 } from "lucide-react";

interface LocationRow {
  id: string;
  fantasyLocId: string;
  name: string;
  department: { id: string; fantasyDeptId: string; name: string } | null;
  country: string;
  branch: string;
}

import { useGlobalFilter } from "@/stores/global-filter";

interface Payload {
  rows: LocationRow[];
}

export function FantasyLocationsView() {
  const globalFilter = useGlobalFilter();
  const { data, isLoading } = useApi<Payload>("/api/fantasy/locations");
  const rawRows = data?.rows ?? [];

  const rows = rawRows.filter((r) => {
    if (globalFilter.country && r.country !== globalFilter.country) return false;
    if (globalFilter.branch && r.branch !== globalFilter.branch) return false;
    return true;
  });

  const countries = new Set(rows.map((r) => r.country));
  const branches = new Set(rows.map((r) => r.branch));
  const unmapped = rows.filter((r) => !r.department).length;

  const columns: Column<LocationRow>[] = [
    { key: "fantasyLocId", header: "Location ID", sticky: "left", sortable: true, sortValue: (r) => r.fantasyLocId, cell: (r) => <span className="font-medium">{r.fantasyLocId}</span> },
    { key: "name", header: "Name", sortable: true, sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: "department", header: "Department",
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          {r.department ? (
            <>
              <div className="flex items-center gap-1">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">{r.department.name}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{r.department.fantasyDeptId}</span>
            </>
          ) : (
            <Badge variant="warning">Unmapped</Badge>
          )}
        </div>
      ),
    },
    { key: "country", header: "Country", sortable: true, sortValue: (r) => r.country, cell: (r) => <span>{r.country}</span> },
    { key: "branch", header: "Branch", sortable: true, sortValue: (r) => r.branch, cell: (r) => <span>{r.branch}</span> },
  ];

  return (
    <div className="flex flex-col gap-2.5 p-3 h-full min-h-0 flex-1 overflow-y-auto">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-shrink-0">
        <KpiCard label="Total Locations" value={rows.length} unit="locs" intent="info" hint="Fantasy entity count" />
        <KpiCard label="Countries" value={countries.size} intent="default" hint="Distinct countries covered" />
        <KpiCard label="Branches" value={branches.size} intent="default" hint="Distinct branches covered" />
        <KpiCard
          label="Unmapped to Dept"
          value={unmapped}
          intent={unmapped > 0 ? "warning" : "success"}
          hint="Locations without a parent department"
        />
      </div>

      <DataTable
        title="Location Registry"
        description="Click column headers to sort · Use search to filter live"
        columns={columns}
        rows={rows}
        loading={isLoading}
        emptyMessage="No Fantasy locations have been synced yet."
        initialSortKey="name"
        initialSortDir="asc"
        exportable
        exportPermission="fantasy.export"
        exportFilename="fantasy-locations.csv"
        searchable
        searchPlaceholder="Search location ID, name, country, branch, department..."
        searchFn={(r, q) => {
          const lq = q.toLowerCase();
          return (
            r.fantasyLocId.toLowerCase().includes(lq) ||
            r.name.toLowerCase().includes(lq) ||
            r.country.toLowerCase().includes(lq) ||
            r.branch.toLowerCase().includes(lq) ||
            (r.department?.name ?? "").toLowerCase().includes(lq) ||
            (r.department?.fantasyDeptId ?? "").toLowerCase().includes(lq)
          );
        }}
      />
    </div>
  );
}
