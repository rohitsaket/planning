"use client";

import { useState, useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Compass, AlertTriangle, CheckCircle2, Package, Clock, ShieldAlert,
  Boxes, Layers, Info, Filter, ArrowRight,
} from "lucide-react";

interface CategoryMetric {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  sales90d: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  excessStock: number;
  /** null when the result was produced without manufacturing coverage available. */
  wipCoverage: number | null;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  status: string;
}

type StrategyClassification =
  | "SHORTAGE"
  | "BALANCED"
  | "EXCESS"
  | "NO_RECENT_DEMAND"
  | "DEMAND_NO_SUPPLY"
  | "SUPPLY_NO_DEMAND"
  | "WIP_COVERED_SHORTAGE"
  | "UNMAPPED_BLOCKED";

interface ClassifiedCategory extends CategoryMetric {
  classification: StrategyClassification;
  classificationLabel: string;
  intent: "critical" | "warning" | "success" | "info" | "neutral";
  reason: string;
}

const CLASSIFICATION_META: Record<
  StrategyClassification,
  { label: string; intent: "critical" | "warning" | "success" | "info" | "neutral"; desc: string }
> = {
  SHORTAGE: {
    label: "Shortage",
    intent: "critical",
    desc: "Target exceeds physical stock; manufacturing need required",
  },
  WIP_COVERED_SHORTAGE: {
    label: "WIP-Covered Shortage",
    intent: "info",
    desc: "Physical shortage exists, but active WIP pipeline covers the gap",
  },
  DEMAND_NO_SUPPLY: {
    label: "Demand / No Supply",
    intent: "critical",
    desc: "Active sales demand (Sales90d > 0) with zero available physical stock",
  },
  BALANCED: {
    label: "Balanced",
    intent: "success",
    desc: "Available stock precisely meets or satisfies target demand",
  },
  EXCESS: {
    label: "Excess Stock",
    intent: "warning",
    desc: "Physical stock exceeds 2-month target quantity",
  },
  SUPPLY_NO_DEMAND: {
    label: "Supply / No Demand",
    intent: "warning",
    desc: "Finished stock present, but zero sales in the 90-day IST window",
  },
  NO_RECENT_DEMAND: {
    label: "No Recent Demand",
    intent: "neutral",
    desc: "Zero sales in lookback window and zero finished inventory",
  },
  UNMAPPED_BLOCKED: {
    label: "Unmapped / Blocked",
    intent: "neutral",
    desc: "Blocked by data quality issues or unmapped attributes",
  },
};

export function StrategyClassificationsView() {
  const globalFilter = useGlobalFilter();
  const { data, isLoading } = useApi<{ categories: CategoryMetric[]; summary: any }>("/api/analysis/demand-trace");
  const [selectedClass, setSelectedClass] = useState<string>("ALL");

  const rawCategories = data?.categories;
  const categories = useMemo(() => {
    if (!rawCategories) return [];
    if (!globalFilter.lab) return rawCategories;
    return rawCategories.filter((c) => {
      if (globalFilter.lab === "Non-Cert") return c.lab === "Non-Cert" || !c.lab;
      if (globalFilter.lab === "Other") return c.lab !== "GIA" && c.lab !== "Non-Cert";
      return c.lab.toUpperCase() === (globalFilter.lab as string).toUpperCase();
    });
  }, [rawCategories, globalFilter.lab]);

  const classifiedRows: ClassifiedCategory[] = useMemo(() => {
    if (!categories) return [];

    return categories.map((c) => {
      let classification: StrategyClassification = "BALANCED";
      let reason = "Stock matches demand target";

      if (c.status === "BLOCKED_BY_DATA_QUALITY" || c.blockedQty > 0) {
        classification = "UNMAPPED_BLOCKED";
        reason = "Mapping or data quality issue flags this record";
      } else if (c.sales90d > 0 && c.availableStock === 0) {
        classification = "DEMAND_NO_SUPPLY";
        reason = `Sales of ${c.sales90d} pcs in 90D with 0 available stock`;
      } else if (c.physicalShortage > 0 && (c.wipCoverage ?? 0) >= c.physicalShortage) {
        classification = "WIP_COVERED_SHORTAGE";
        reason = `Shortage of ${c.physicalShortage} pcs covered by ${c.wipCoverage ?? 0} pieces in manufacturing`;
      } else if (c.physicalShortage > 0) {
        classification = "SHORTAGE";
        reason = `Shortage of ${c.physicalShortage} pcs (Target ${c.roundedTarget} vs Stock ${c.availableStock})`;
      } else if (c.availableStock > 0 && c.sales90d === 0) {
        classification = "SUPPLY_NO_DEMAND";
        reason = `${c.availableStock} pcs on hand with 0 sales in 90 days`;
      } else if (c.excessStock > 0) {
        classification = "EXCESS";
        reason = `Excess stock of ${c.excessStock} pcs over target`;
      } else if (c.sales90d === 0 && c.availableStock === 0) {
        classification = "NO_RECENT_DEMAND";
        reason = "No sales and no inventory recorded";
      } else {
        classification = "BALANCED";
        reason = "Available stock matches target";
      }

      const meta = CLASSIFICATION_META[classification];
      return {
        ...c,
        classification,
        classificationLabel: meta.label,
        intent: meta.intent,
        reason,
      };
    });
  }, [categories]);

  const filteredRows = useMemo(() => {
    if (selectedClass === "ALL") return classifiedRows;
    return classifiedRows.filter((r) => r.classification === selectedClass);
  }, [classifiedRows, selectedClass]);

  const countByClass = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of classifiedRows) {
      counts[r.classification] = (counts[r.classification] || 0) + 1;
    }
    return counts;
  }, [classifiedRows]);

  const columns: Column<ClassifiedCategory>[] = [
    {
      key: "classification",
      header: "Strategic Posture",
      align: "center",
      sortable: true,
      sortValue: (r) => r.classification,
      width: "180px",
      cell: (r) => (
        <Badge variant={r.intent}>{r.classificationLabel}</Badge>
      ),
    },
    {
      key: "category",
      header: "Category (Lab | Shape | Band)",
      sortable: true,
      sortValue: (r) => r.category,
      width: "220px",
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-semibold text-xs text-foreground">
            {r.lab} · {r.shape} · {r.weightBand}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">{r.category}</span>
        </div>
      ),
    },
    {
      key: "sales90d",
      header: "90D Sales",
      sortable: true,
      sortValue: (r) => r.sales90d,
      align: "right",
      width: "90px",
      cell: (r) => <NumberCell value={r.sales90d} />,
    },
    {
      key: "roundedTarget",
      header: "Target",
      sortable: true,
      sortValue: (r) => r.roundedTarget,
      align: "right",
      width: "80px",
      cell: (r) => <NumberCell value={r.roundedTarget} />,
    },
    {
      key: "availableStock",
      header: "Physical Stock",
      sortable: true,
      sortValue: (r) => r.availableStock,
      align: "right",
      width: "100px",
      cell: (r) => <NumberCell value={r.availableStock} />,
    },
    {
      key: "wipCoverage",
      header: "WIP Cov",
      sortable: true,
      sortValue: (r) => r.wipCoverage ?? -1,
      align: "right",
      width: "85px",
      cell: (r) => (r.wipCoverage === null ? <span className="text-[10px] font-mono text-muted-foreground">—</span> : <NumberCell value={r.wipCoverage} />),
    },
    {
      key: "physicalShortage",
      header: "Shortage",
      sortable: true,
      sortValue: (r) => r.physicalShortage,
      align: "right",
      width: "85px",
      cell: (r) => <NumberCell value={r.physicalShortage} intent={r.physicalShortage > 0 ? "critical" : undefined} />,
    },
    {
      key: "excessStock",
      header: "Excess",
      sortable: true,
      sortValue: (r) => r.excessStock,
      align: "right",
      width: "80px",
      cell: (r) => <NumberCell value={r.excessStock} intent={r.excessStock > 0 ? "warning" : undefined} />,
    },
    {
      key: "reason",
      header: "Deterministic Rationale",
      width: "240px",
      cell: (r) => <span className="text-[11px] text-muted-foreground">{r.reason}</span>,
    },
  ];

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <PageHeader
          title="Stock Strategy Classifications"
          subtitle="Deterministic categorization of finished diamond inventory across shortage, balance, and excess postures"
        />
        <KpiGridSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Stock Strategy Classifications"
        subtitle="Deterministic inventory posture categorization — strictly analytical and advisory"
      />

      <InfoBanner variant="info">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
          <span>
            <strong>Advisory Notice:</strong> Classifications are deterministic views computed from confirmed sales history and current inventory. No automated transfers, reservations, or approvals occur from this phase.
          </span>
        </div>
      </InfoBanner>

      {/* KPI Classification Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiCard
          label="Shortage Need"
          value={countByClass["SHORTAGE"] ?? 0}
          unit="cats"
          intent="critical"
          icon={AlertTriangle}
          hint="Uncovered physical shortage"
        />
        <KpiCard
          label="Demand / No Supply"
          value={countByClass["DEMAND_NO_SUPPLY"] ?? 0}
          unit="cats"
          intent="critical"
          icon={AlertTriangle}
          hint="90D sales with 0 stock"
        />
        <KpiCard
          label="WIP-Covered"
          value={countByClass["WIP_COVERED_SHORTAGE"] ?? 0}
          unit="cats"
          intent="info"
          icon={Boxes}
          hint="Shortage offset by WIP"
        />
        <KpiCard
          label="Balanced"
          value={countByClass["BALANCED"] ?? 0}
          unit="cats"
          intent="success"
          icon={CheckCircle2}
          hint="Stock meets target"
        />
        <KpiCard
          label="Excess Stock"
          value={countByClass["EXCESS"] ?? 0}
          unit="cats"
          intent="warning"
          icon={Package}
          hint="Stock exceeds target"
        />
        <KpiCard
          label="Supply / No Demand"
          value={countByClass["SUPPLY_NO_DEMAND"] ?? 0}
          unit="cats"
          intent="warning"
          icon={Clock}
          hint="Stock on hand, 0 90D sales"
        />
      </div>

      {/* Classifications Table */}
      <Section
        title="Classified Planning Categories"
        description="Filter by strategic classification to inspect supply and demand alignment."
        actions={
          <div className="flex items-center gap-2">
            <Select value={selectedClass} onValueChange={setSelectedClass}>
              <SelectTrigger size="sm" className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="All Classifications" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Classifications ({classifiedRows.length})</SelectItem>
                <SelectItem value="SHORTAGE">Shortage ({countByClass["SHORTAGE"] ?? 0})</SelectItem>
                <SelectItem value="DEMAND_NO_SUPPLY">Demand / No Supply ({countByClass["DEMAND_NO_SUPPLY"] ?? 0})</SelectItem>
                <SelectItem value="WIP_COVERED_SHORTAGE">WIP-Covered ({countByClass["WIP_COVERED_SHORTAGE"] ?? 0})</SelectItem>
                <SelectItem value="BALANCED">Balanced ({countByClass["BALANCED"] ?? 0})</SelectItem>
                <SelectItem value="EXCESS">Excess ({countByClass["EXCESS"] ?? 0})</SelectItem>
                <SelectItem value="SUPPLY_NO_DEMAND">Supply / No Demand ({countByClass["SUPPLY_NO_DEMAND"] ?? 0})</SelectItem>
                <SelectItem value="NO_RECENT_DEMAND">No Recent Demand ({countByClass["NO_RECENT_DEMAND"] ?? 0})</SelectItem>
                <SelectItem value="UNMAPPED_BLOCKED">Unmapped / Blocked ({countByClass["UNMAPPED_BLOCKED"] ?? 0})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        <DataTable<ClassifiedCategory>
          columns={columns}
          rows={filteredRows}
          searchable
          searchPlaceholder="Search category..."
          searchFn={(r, q) =>
            `${r.lab} ${r.shape} ${r.weightBand} ${r.classificationLabel} ${r.reason}`.toLowerCase().includes(q.toLowerCase())
          }
          exportable
          exportPermission="analysis.export"
          exportFilename="strategy-classifications.csv"
          pagination
          pageSize={25}
          maxHeight="540px"
        />
      </Section>
    </div>
  );
}
