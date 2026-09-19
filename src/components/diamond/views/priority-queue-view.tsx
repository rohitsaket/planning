"use client";

import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { NumberCell, EmptyState } from "@/components/diamond/shared/empty-state";
import { useNavStore } from "@/stores/nav-store";
import { useMemo } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface ReqRow {
  id: string;
  requirementCode: string;
  type: string;
  status: string;
  customerName: string | null;
  country: string | null;
  branch: string | null;
  lab: string | null;
  shape: string | null;
  weightBand: string | null;
  requiredQty: number;
  remainingUnplanned: number;
  requiredBy: string | null;
  requirementPriority: string | null;
  priorityReason: string | null;
  daysOverdue: number;
}

interface ApiResponse {
  data: ReqRow[];
  total: number;
  page: number;
  pageSize: number;
}

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
};

function buildCols(priorityLabel: string): Column<ReqRow>[] {
  return [
    {
      key: "requirementCode",
      header: "Req. Code",
      width: "150px",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.requirementCode,
      cell: (r) => <span className="font-medium">{r.requirementCode}</span>,
    },
    {
      key: "type",
      header: "Type",
      width: "120px",
      cell: (r) => <Badge variant="info">{r.type.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "customerName",
      header: "Customer",
      width: "140px",
      cell: (r) => <span className="truncate">{r.customerName ?? "—"}</span>,
    },
    {
      key: "country",
      header: "Country",
      width: "80px",
      cell: (r) => r.country ?? "—",
    },
    {
      key: "shape",
      header: "Shape",
      width: "90px",
      cell: (r) => r.shape ?? "—",
    },
    {
      key: "weightBand",
      header: "Wt Band",
      width: "110px",
      cell: (r) => r.weightBand ?? "—",
    },
    {
      key: "requiredQty",
      header: "Req",
      width: "60px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.requiredQty,
      cell: (r) => <NumberCell value={r.requiredQty} intent="info" />,
    },
    {
      key: "remainingUnplanned",
      header: "Rem Unpl",
      width: "80px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.remainingUnplanned,
      cell: (r) => (
        <NumberCell
          value={r.remainingUnplanned}
          intent={r.remainingUnplanned > 0 ? "critical" : "success"}
        />
      ),
    },
    {
      key: "daysOverdue",
      header: "Overdue",
      width: "70px",
      align: "right",
      sortable: true,
      sortValue: (r) => r.daysOverdue,
      cell: (r) => (
        <NumberCell
          value={r.daysOverdue}
          intent={r.daysOverdue > 0 ? "critical" : "default"}
        />
      ),
    },
    {
      key: "requiredBy",
      header: "Req By",
      width: "90px",
      cell: (r) => fmtDate(r.requiredBy),
    },
    {
      key: "priorityReason",
      header: "Reason",
      width: "240px",
      cell: (r) => (
        <span
          className="text-muted-foreground truncate block max-w-[220px]"
          title={r.priorityReason ?? ""}
        >
          {r.priorityReason ?? "—"}
        </span>
      ),
    },
  ];
}

function PrioritySection({
  title,
  intent,
  rows,
  loading,
  columns,
  onOpenMatrix,
}: {
  title: string;
  intent: "critical" | "warning" | "default";
  rows: ReqRow[];
  loading: boolean;
  columns: Column<ReqRow>[];
  onOpenMatrix: () => void;
}) {
  const totalRemaining = rows.reduce((s, r) => s + r.remainingUnplanned, 0);
  const overdueCount = rows.filter((r) => r.daysOverdue > 0).length;

  return (
    <Section
      title={`${title} Requirements (${rows.length})`}
      description={`Top open requirement rows · ${totalRemaining} pcs remaining unplanned · ${overdueCount} overdue`}
      actions={
        <button
          type="button"
          onClick={onOpenMatrix}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          Open in Matrix <ArrowRight className="h-3 w-3" />
        </button>
      }
    >
      <DataTable<ReqRow>
        columns={columns}
        rows={rows}
        loading={loading}
        emptyMessage={`No ${title.toLowerCase()} requirements with remaining unplanned pieces.`}
        maxHeight="320px"
        pagination
        pageSize={15}
        onRowClick={() => onOpenMatrix()}
        rowClassName={(r) =>
          r.daysOverdue > 0 ? "bg-rose-50/40 dark:bg-rose-950/10" : ""
        }
      />
    </Section>
  );
}

export function PriorityQueueView() {
  const setView = useNavStore((s) => s.setView);

  // Three priority bands, each fetching requirements with priority filter & remainingUnplanned > 0
  // The API does not directly filter remainingUnplanned > 0, so we filter client-side
  const { data: criticalData, isLoading: cLoading } = useApi<ApiResponse>(
    `/api/requirements?pageSize=500&priority=CRITICAL`
  );
  const { data: highData, isLoading: hLoading } = useApi<ApiResponse>(
    `/api/requirements?pageSize=500&priority=HIGH`
  );
  const { data: normalData, isLoading: nLoading } = useApi<ApiResponse>(
    `/api/requirements?pageSize=500&priority=NORMAL`
  );

  const critical = useMemo(
    () => (criticalData?.data ?? []).filter((r) => r.remainingUnplanned > 0),
    [criticalData]
  );
  const high = useMemo(
    () => (highData?.data ?? []).filter((r) => r.remainingUnplanned > 0),
    [highData]
  );
  const normal = useMemo(
    () => (normalData?.data ?? []).filter((r) => r.remainingUnplanned > 0),
    [normalData]
  );

  const totalCritical = critical.reduce((s, r) => s + r.remainingUnplanned, 0);
  const totalHigh = high.reduce((s, r) => s + r.remainingUnplanned, 0);
  const totalNormal = normal.reduce((s, r) => s + r.remainingUnplanned, 0);
  const totalAll = totalCritical + totalHigh + totalNormal;

  const openMatrix = () => setView("requirements-matrix");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Priority Queue"
        subtitle="Open requirements (remainingUnplanned > 0) grouped by priority class · CRITICAL → HIGH → NORMAL · plan from the top"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {totalAll.toLocaleString()} pcs total unplanned across {critical.length + high.length + normal.length} requirement rows
          </span>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiCard
          label="CRITICAL Rows"
          value={critical.length}
          unit="reqs"
          intent="critical"
          hint={`${totalCritical} pcs unplanned`}
          onClick={openMatrix}
        />
        <KpiCard
          label="HIGH Rows"
          value={high.length}
          unit="reqs"
          intent="warning"
          hint={`${totalHigh} pcs unplanned`}
          onClick={openMatrix}
        />
        <KpiCard
          label="NORMAL Rows"
          value={normal.length}
          unit="reqs"
          intent="default"
          hint={`${totalNormal} pcs unplanned`}
          onClick={openMatrix}
        />
        <KpiCard
          label="Total Open"
          value={critical.length + high.length + normal.length}
          unit="reqs"
          intent="info"
          hint="Sum of all open requirements"
          onClick={openMatrix}
        />
        <KpiCard
          label="Total Unplanned"
          value={totalAll}
          unit="pcs"
          intent="critical"
          hint="Pipeline-Adjusted minus Approved Plan Coverage"
          onClick={openMatrix}
        />
        <KpiCard
          label="Plan Now"
          value="Open Workbench"
          intent="success"
          hint="Three-panel planning workbench"
          onClick={() => setView("planning-workbench")}
        />
      </div>

      {totalAll === 0 && !cLoading && !hLoading && !nLoading && (
        <EmptyState
          title="No open requirements"
          message="All requirement rows are fully planned or fully covered."
          icon={<AlertTriangle className="h-6 w-6" />}
        />
      )}

      <PrioritySection
        title="CRITICAL"
        intent="critical"
        rows={critical}
        loading={cLoading}
        columns={buildCols("CRITICAL")}
        onOpenMatrix={openMatrix}
      />
      <PrioritySection
        title="HIGH"
        intent="warning"
        rows={high}
        loading={hLoading}
        columns={buildCols("HIGH")}
        onOpenMatrix={openMatrix}
      />
      <PrioritySection
        title="NORMAL"
        intent="default"
        rows={normal}
        loading={nLoading}
        columns={buildCols("NORMAL")}
        onOpenMatrix={openMatrix}
      />
    </div>
  );
}
