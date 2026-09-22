"use client";

import { useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { Badge, Pill } from "@/components/diamond/shared/badges";
import { EmptyState } from "@/components/diamond/shared/empty-state";
import {
  Collapsible, CollapsibleTrigger, CollapsibleContent,
} from "@/components/ui/collapsible";
import { ChevronRight, ChevronDown, Building2, MapPin, Layers, RefreshCw, Database } from "lucide-react";

interface LocationRow {
  id: string;
  fantasyLocId: string;
  name: string;
  country: string;
  branch: string;
}

interface DepartmentRow {
  id: string;
  fantasyDeptId: string;
  name: string;
  country: string;
  branch: string;
  type: string | null;
  locations: LocationRow[];
}

interface Payload {
  rows: DepartmentRow[];
}

export function FantasyDepartmentsView() {
  const { data, isLoading } = useApi<Payload>("/api/fantasy/departments");
  const rows = data?.rows ?? [];

  const totalLocations = rows.reduce((acc, d) => acc + (d.locations?.length ?? 0), 0);
  const countries = new Set(rows.map((d) => d.country));
  const branches = new Set(rows.map((d) => d.branch));
  const deptTypes = new Set(rows.map((d) => d.type).filter(Boolean) as string[]);

  return (
    <div className="flex flex-col gap-3 p-3">

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Departments" value={rows.length} unit="depts" intent="info" hint="Fantasy entity count" />
        <KpiCard label="Total Locations" value={totalLocations} unit="locs" intent="success" hint="Nested under departments" />
        <KpiCard label="Countries" value={countries.size} intent="default" hint="Distinct countries covered" />
        <KpiCard label="Branches" value={branches.size} intent="default" hint="Distinct branches covered" />
      </div>

      <Section
        title="Department Registry"
        description="Each department is expandable to reveal its nested Fantasy locations. Department type is shown when available."
        actions={
          <Pill>
            <Layers className="h-3 w-3" /> {deptTypes.size} type{deptTypes.size === 1 ? "" : "s"}
          </Pill>
        }
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-xs">
            <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Loading departments...
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No departments found" message="Fantasy sync has not loaded any departments yet." icon={<Building2 className="h-6 w-6" />} />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((d) => (
              <DepartmentCard key={d.id} dept={d} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function DepartmentCard({ dept }: { dept: DepartmentRow }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border border-border bg-card">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold truncate">{dept.name}</span>
            <span className="text-[10px] text-muted-foreground">{dept.fantasyDeptId}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {dept.type && <Badge variant="neutral">{dept.type}</Badge>}
            <Badge variant="default">{dept.country}</Badge>
            <Badge variant="default">{dept.branch}</Badge>
            <Pill>
              <MapPin className="h-3 w-3" /> {dept.locations.length} loc{dept.locations.length === 1 ? "" : "s"}
            </Pill>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-border bg-muted/20 p-3">
          {dept.locations.length === 0 ? (
            <p className="text-xs text-muted-foreground">No locations defined under this department.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {dept.locations.map((l) => (
                <div key={l.id} className="rounded border border-border bg-card p-2.5 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">{l.name}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    <div><span className="text-muted-foreground">Loc ID:</span> <span className="font-medium tabular-nums">{l.fantasyLocId}</span></div>
                    <div><span className="text-muted-foreground">Country:</span> <span className="font-medium">{l.country}</span></div>
                    <div><span className="text-muted-foreground">Branch:</span> <span className="font-medium">{l.branch}</span></div>
                    <div><span className="text-muted-foreground">ID:</span> <span className="font-medium text-[9px] truncate">{l.id}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
