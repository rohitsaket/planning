"use client";

import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { EmptyState, NumberCell, Money, InfoBanner } from "@/components/diamond/shared/empty-state";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileText, BarChart3, AlertTriangle, TrendingDown, Scale, Eye,
} from "lucide-react";

type ReportType = "summary" | "sales-by-category" | "critical-requirements" | "yield-variance" | "weight-bands-config";

interface ReportTypeMeta {
  type: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
}

const REPORT_TYPES: ReportTypeMeta[] = [
  { type: "summary", title: "Executive Summary", description: "Counts across sales, polished, rough, requirements, planning", icon: FileText },
  { type: "sales-by-category", title: "Sales by Category", description: "Invoice sales aggregated by Lab|Shape|Weight Band", icon: BarChart3 },
  { type: "critical-requirements", title: "Critical Requirements", description: "Open requirements with CRITICAL priority", icon: AlertTriangle },
  { type: "yield-variance", title: "Yield Variance", description: "Plan vs actual reconciliation rows", icon: TrendingDown },
  { type: "weight-bands-config", title: "Weight Bands Config", description: "24 confirmed analytical weight bands", icon: Scale },
];

interface SummaryReport {
  type: "summary";
  summary: {
    totalSalesInvoices: number;
    totalPolishedLots: number;
    totalRoughStones: number;
    totalRequirements: number;
    totalPlanningCases: number;
    approvedPlanningCases: number;
    approvalRate: number;
  };
}
interface SalesRow { category: string; pieces: number; value: number; }
interface CriticalReqRow {
  requirementCode: string;
  type: string;
  country: string;
  lab: string | null;
  shape: string;
  weightBand: string | null;
  remainingUnplanned: number;
  requiredBy: string | null;
  priorityReason: string | null;
}
interface YieldRow {
  planOptionCode: string | null;
  expectedPieces: number;
  actualPieces: number;
  plannedYield: number;
  actualYield: number;
  variance: number;
  expectedCoverage: number;
  actualCoverage: number;
  status: string;
}
interface WeightBandRow {
  code: string;
  label: string;
  minCt: number;
  maxCt: number;
  sortOrder: number;
  active: boolean;
}

const salesColumns: Column<SalesRow>[] = [
  { key: "category", header: "Category", cell: (r) => <span className="font-medium">{r.category}</span>, sticky: "left", sortable: true, sortValue: (r) => r.category },
  { key: "pieces", header: "Pieces", cell: (r) => <NumberCell value={r.pieces} />, align: "right", sortable: true, sortValue: (r) => r.pieces },
  { key: "value", header: "Value", cell: (r) => <Money value={r.value} />, align: "right", sortable: true, sortValue: (r) => r.value },
];

const criticalReqColumns: Column<CriticalReqRow>[] = [
  { key: "requirementCode", header: "Requirement", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.requirementCode}</span>, sticky: "left", sortable: true, sortValue: (r) => r.requirementCode },
  { key: "type", header: "Type", cell: (r) => <Badge>{r.type}</Badge> },
  { key: "country", header: "Country", cell: (r) => <span className="text-[10px]">{r.country}</span> },
  { key: "lab", header: "Lab", cell: (r) => <span className="text-[10px]">{r.lab ?? "—"}</span> },
  { key: "shape", header: "Shape", cell: (r) => <span className="text-[10px]">{r.shape}</span> },
  { key: "weightBand", header: "Weight Band", cell: (r) => <span className="text-[10px]">{r.weightBand ?? "—"}</span> },
  { key: "remainingUnplanned", header: "Remaining", cell: (r) => <NumberCell value={r.remainingUnplanned} intent="critical" />, align: "right", sortable: true, sortValue: (r) => r.remainingUnplanned },
  { key: "requiredBy", header: "Required By", cell: (r) => <span className="tabular-nums text-[10px]">{r.requiredBy ? new Date(r.requiredBy).toLocaleDateString() : "—"}</span> },
  { key: "priorityReason", header: "Priority Reason", cell: (r) => <span className="text-[10px]">{r.priorityReason ?? "—"}</span> },
];

const yieldColumns: Column<YieldRow>[] = [
  { key: "planOptionCode", header: "Plan Option", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.planOptionCode ?? "—"}</span>, sticky: "left", sortable: true, sortValue: (r) => r.planOptionCode ?? "" },
  { key: "expectedPieces", header: "Expected", cell: (r) => <NumberCell value={r.expectedPieces} />, align: "right" },
  { key: "actualPieces", header: "Actual", cell: (r) => <NumberCell value={r.actualPieces} />, align: "right" },
  { key: "plannedYield", header: "Planned Yield", cell: (r) => <span className="tabular-nums">{r.plannedYield.toFixed(2)}%</span>, align: "right" },
  { key: "actualYield", header: "Actual Yield", cell: (r) => <span className="tabular-nums">{r.actualYield.toFixed(2)}%</span>, align: "right" },
  { key: "variance", header: "Variance", cell: (r) => <NumberCell value={r.variance} intent={r.variance < 0 ? "critical" : r.variance > 0 ? "success" : "default"} />, align: "right", sortable: true, sortValue: (r) => r.variance },
  { key: "expectedCoverage", header: "Expected Cov", cell: (r) => <NumberCell value={r.expectedCoverage} />, align: "right" },
  { key: "actualCoverage", header: "Actual Cov", cell: (r) => <NumberCell value={r.actualCoverage} />, align: "right" },
  { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
];

const weightBandColumns: Column<WeightBandRow>[] = [
  { key: "code", header: "Code", cell: (r) => <span className="font-mono text-[10px] font-medium">{r.code}</span>, sticky: "left", sortable: true, sortValue: (r) => r.code },
  { key: "label", header: "Label", cell: (r) => <span className="text-[10px]">{r.label}</span>, sortable: true, sortValue: (r) => r.label },
  { key: "minCt", header: "Min (ct)", cell: (r) => <NumberCell value={r.minCt} />, align: "right", sortable: true, sortValue: (r) => r.minCt },
  { key: "maxCt", header: "Max (ct)", cell: (r) => <NumberCell value={r.maxCt} />, align: "right", sortable: true, sortValue: (r) => r.maxCt },
  { key: "sortOrder", header: "Sort", cell: (r) => <NumberCell value={r.sortOrder} />, align: "right", sortable: true, sortValue: (r) => r.sortOrder },
  { key: "active", header: "Active", cell: (r) => <Badge variant={r.active ? "success" : "neutral"}>{r.active ? "ACTIVE" : "INACTIVE"}</Badge> },
];

export function ReportsView() {
  const [activeType, setActiveType] = useState<ReportType>("summary");
  const qc = useQueryClient();
  const { data, isLoading } = useApi<unknown>(`/api/reports?type=${activeType}`);

  const renderReport = () => {
    if (isLoading) {
      return <EmptyState title="Loading report..." message="Fetching report data" />;
    }
    if (!data) {
      return <EmptyState title="No data" message="Report returned no data" />;
    }
    if (activeType === "summary") {
      const s = (data as SummaryReport).summary;
      return (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiCard label="Sales Invoices" value={s.totalSalesInvoices} intent="default" />
          <KpiCard label="Polished Lots" value={s.totalPolishedLots} intent="info" />
          <KpiCard label="Rough Stones" value={s.totalRoughStones} intent="default" />
          <KpiCard label="Requirements" value={s.totalRequirements} intent="warning" />
          <KpiCard label="Planning Cases" value={s.totalPlanningCases} intent="info" />
          <KpiCard label="Approval Rate" value={`${s.approvalRate.toFixed(1)}%`} intent={s.approvalRate >= 50 ? "success" : "warning"} hint={`${s.approvedPlanningCases} approved`} />
        </div>
      );
    }
    if (activeType === "sales-by-category") {
      const rows = (data as { rows: SalesRow[] }).rows;
      return <DataTable columns={salesColumns} rows={rows} emptyMessage="No sales records" maxHeight="520px" exportable exportFilename="sales-by-category.csv" searchable searchPlaceholder="Search category..." searchFn={(r, q) => r.category.toLowerCase().includes(q.toLowerCase())} />;
    }
    if (activeType === "critical-requirements") {
      const rows = (data as { rows: CriticalReqRow[] }).rows;
      return <DataTable columns={criticalReqColumns} rows={rows} emptyMessage="No critical requirements" maxHeight="520px" exportable exportFilename="critical-requirements.csv" />;
    }
    if (activeType === "yield-variance") {
      const rows = (data as { rows: YieldRow[] }).rows;
      return <DataTable columns={yieldColumns} rows={rows} emptyMessage="No reconciliation rows" maxHeight="520px" exportable exportFilename="yield-variance.csv" />;
    }
    if (activeType === "weight-bands-config") {
      const rows = (data as { rows: WeightBandRow[] }).rows;
      return <DataTable columns={weightBandColumns} rows={rows} emptyMessage="No weight bands" maxHeight="520px" exportable exportFilename="weight-bands-config.csv" />;
    }
    return <EmptyState title="Unknown report type" />;
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Reports Library"
        subtitle="Pre-built analytical report bundles — switch type to view"
        meta={<span className="text-[10px] text-muted-foreground">Type: {activeType}</span>}
      />

      <InfoBanner variant="info">
        Reports aggregate across the full dataset. Filters and parameters are added incrementally per report. Always pair the figures with the underlying source rows when sharing externally.
      </InfoBanner>

      <Section title="Available Reports" description="Select a report type to load its data below">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
          {REPORT_TYPES.map((rt) => {
            const Icon = rt.icon;
            const isActive = rt.type === activeType;
            return (
              <button
                key={rt.type}
                type="button"
                onClick={() => {
                  setActiveType(rt.type);
                  qc.invalidateQueries({ queryKey: [`/api/reports?type=${rt.type}`] });
                }}
                className={`text-left p-3 rounded-md border transition-all ${isActive ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-card hover:bg-muted/40"}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-semibold">{rt.title}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground leading-snug">{rt.description}</p>
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title={`${REPORT_TYPES.find((r) => r.type === activeType)?.title ?? ""} Report`}
        description="Fetched live from the data layer"
        actions={
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => qc.invalidateQueries({ queryKey: [`/api/reports?type=${activeType}`] })}>
            <Eye className="h-3 w-3 mr-1" /> Refresh
          </Button>
        }
      >
        {renderReport()}
      </Section>
    </div>
  );
}
