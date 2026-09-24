"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { useGlobalFilter } from "@/stores/global-filter";
import { useAuthStore } from "@/stores/auth-store";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { Boxes, ClipboardCheck, Package, AlertTriangle, Lock } from "lucide-react";

interface WipDimensionRow {
  dimension: string;
  pieces: number;
}

interface WipPolicy {

  status: "CONFIGURED" | "NOT_CONFIGURED";
  reason: string;
  message: string;
  ruleStatus: string | null;
  eligibleStages: string[];
  appliesCoverage: boolean;
}

interface WipSummary {
  totalRecords: number;
  totalPieces: number;
  eligiblePieces: number;
  ineligibleStagePieces: number;
  ambiguousPieces: number;
  completedPieces: number;
  alreadyPolishedPieces: number;
  policyBlockedPieces: number;
  unallocatedPieces: number;
}

interface WipDetailRow {
  lotId: string;
  stage: string;
  stageRaw: string | null;
  outcome: string;
  reason: string;
  category: string | null;
  lab: string;
  shape: string;
  weightBand: string | null;
  quantity: number;
  weight: number;
  country: string;
  branch: string;
  kapan: string | null;
  countsAsCoverage: boolean;
  countsAsUnallocated: boolean;
}

interface WipData {
  policy: WipPolicy;
  summary: WipSummary;
  totalWipPieces: number;
  eligibleWipPieces: number;
  unallocatedWipPieces: number;
  byStage: WipDimensionRow[];
  byOutcome: WipDimensionRow[];
  byCategory: WipDimensionRow[];
  byShape: WipDimensionRow[];
  byCountry: WipDimensionRow[];
  detailAccessRestricted: boolean;
  rows: WipDetailRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

const OUTCOME_LABEL: Record<string, string> = {
  ELIGIBLE: "Eligible WIP",
  INELIGIBLE_STAGE: "Ineligible stage",
  AMBIGUOUS: "Ambiguous (quarantined)",
  COMPLETED: "Completed",
  ALREADY_POLISHED: "Already polished output",
  POLICY_NOT_CONFIGURED: "Blocked — policy not configured",
};

const OUTCOME_VARIANT: Record<string, "success" | "warning" | "critical" | "neutral" | "info"> = {
  ELIGIBLE: "success",
  INELIGIBLE_STAGE: "warning",
  AMBIGUOUS: "critical",
  COMPLETED: "neutral",
  ALREADY_POLISHED: "neutral",
  POLICY_NOT_CONFIGURED: "warning",
};

const dimensionColumns: Column<WipDimensionRow>[] = [
  { key: "dimension", header: "Dimension", cell: (r) => <span className="font-medium">{r.dimension}</span>, sortable: true, sortValue: (r) => r.dimension },
  { key: "pieces", header: "Pieces", cell: (r) => <NumberCell value={r.pieces} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.pieces },
];

const outcomeColumns: Column<WipDimensionRow>[] = [
  {
    key: "dimension",
    header: "Classification",
    align: "center",
    cell: (r) => <Badge variant={OUTCOME_VARIANT[r.dimension] ?? "neutral"}>{OUTCOME_LABEL[r.dimension] ?? r.dimension}</Badge>,
    sortable: true,
    sortValue: (r) => r.dimension,
  },
  { key: "pieces", header: "Pieces", cell: (r) => <NumberCell value={r.pieces} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.pieces },
];

const detailColumns: Column<WipDetailRow>[] = [
  { key: "lotId", header: "Lot ID", cell: (r) => <span className="font-mono text-[11px]">{r.lotId}</span>, sortable: true, sortValue: (r) => r.lotId },
  { key: "stage", header: "Stage", align: "center", cell: (r) => <span className="font-mono text-[11px]">{r.stage}</span>, sortable: true, sortValue: (r) => r.stage },
  {
    key: "outcome",
    header: "Classification",
    align: "center",
    cell: (r) => <Badge variant={OUTCOME_VARIANT[r.outcome] ?? "neutral"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge>,
    sortable: true,
    sortValue: (r) => r.outcome,
  },
  { key: "category", header: "Planning Category", align: "center", cell: (r) => <span className="text-[11px]">{r.category ?? "—"}</span> },
  { key: "shape", header: "Shape", align: "center", cell: (r) => <span className="text-[11px]">{r.shape}</span> },
  { key: "weightBand", header: "Weight Band", align: "center", cell: (r) => <span className="text-[11px]">{r.weightBand ?? "—"}</span> },
  { key: "quantity", header: "Qty", cell: (r) => <NumberCell value={r.quantity} />, align: "right", sortable: true, sortValue: (r) => r.quantity },
  { key: "country", header: "Location", align: "center", cell: (r) => <span className="text-[11px]">{r.country} / {r.branch}</span> },
  { key: "reason", header: "Reason", cell: (r) => <span className="text-[10px] text-muted-foreground">{r.reason}</span> },
];

export function WipView() {
  const { country, branch, lab } = useGlobalFilter();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState<string | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (country) params.set("country", country);
    if (branch) params.set("branch", branch);
    if (lab) params.set("lab", lab);
    if (outcome) params.set("outcome", outcome);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return params.toString();
  }, [country, branch, lab, outcome, page]);

  const { data, isLoading } = useApi<WipData>(`/api/analysis/wip?${query}`);

  // Filters change the result set: go back to the first page rather than showing
  // an out-of-range page of a different dataset.
  const filterKey = `${country ?? ""}|${branch ?? ""}|${lab ?? ""}|${outcome ?? ""}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const policy = data?.policy;
  const notConfigured = policy?.status === "NOT_CONFIGURED";
  const canSeeLots = permissions.includes("demand.trace");

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="WIP Inventory"
        subtitle="Manufacturing work in progress, classified by the same engine the demand calculation uses"
        meta={
          <span
            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
              notConfigured
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
                : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
            }`}
          >
            {notConfigured
              ? "WIP coverage policy is not configured"
              : `WIP coverage policy: ${policy?.status === "CONFIGURED" ? "Active" : (policy?.status ?? "…")}`}
          </span>
        }
      />

      {/*
        The WIP coverage policy, stated wherever WIP quantities are shown. Without it the
        pieces below read as coverage: they are reported for visibility and, while no
        approved policy exists, are deducted from nothing.
      */}
      {policy && (
        <InfoBanner variant={notConfigured ? "warning" : "info"}>
          {policy.message}
          {notConfigured && " Pieces below are reported for visibility only and are excluded from pipeline coverage."}
        </InfoBanner>
      )}

      {isLoading && !data ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <KpiCard
              label="Total WIP Pieces"
              value={data?.summary.totalPieces ?? 0}
              unit="pcs"
              intent="default"
              hint="Current canonical manufacturing WIP records"
              icon={Boxes}
            />
            <KpiCard
              label="Eligible WIP Coverage"
              value={notConfigured ? "UNAVAILABLE" : data?.summary.eligiblePieces ?? 0}
              unit={notConfigured ? undefined : "pcs"}
              intent={notConfigured ? "warning" : "success"}
              hint={notConfigured ? "No confirmed WIP rule — nothing is deducted" : "Reduces pipeline requirement only"}
              icon={ClipboardCheck}
            />
            <KpiCard
              label="Unallocated WIP"
              value={data?.summary.unallocatedPieces ?? 0}
              unit="pcs"
              intent="warning"
              hint="Real WIP that does not reduce shortage"
              icon={Package}
            />
            <KpiCard
              label="Ambiguous / Quarantined"
              value={data?.summary.ambiguousPieces ?? 0}
              unit="pcs"
              intent={(data?.summary.ambiguousPieces ?? 0) > 0 ? "critical" : "default"}
              hint="Unmapped lab, shape or weight band — never assigned to a category"
              icon={AlertTriangle}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Classification Breakdown" description="How every current WIP record was classified">
              <DataTable
                columns={outcomeColumns}
                rows={data?.byOutcome ?? []}
                loading={isLoading}
                emptyMessage="No WIP records"
                maxHeight="320px"
                onRowClick={(r) => {
                  setOutcome(outcome === r.dimension ? null : r.dimension);
                }}
                rowClassName={(r) => (outcome === r.dimension ? "bg-sky-500/10" : "")}
              />
              <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                Completed and already-polished pieces are excluded from both coverage and unallocated WIP so no piece is counted twice.
                {outcome && " Click the highlighted row again to clear the detail filter."}
              </div>
            </Section>
            <Section title="WIP by Stage" description="Normalized manufacturing stage">
              <DataTable columns={dimensionColumns} rows={data?.byStage ?? []} loading={isLoading} emptyMessage="No stage data" maxHeight="320px" />
            </Section>
            <Section title="WIP by Planning Category" description="Lab + Shape + Weight Band, with unmapped records quarantined">
              <DataTable columns={dimensionColumns} rows={data?.byCategory ?? []} loading={isLoading} emptyMessage="No category data" maxHeight="320px" />
            </Section>
            <Section title="WIP by Country / Branch" description="Where the work in progress physically sits">
              <DataTable columns={dimensionColumns} rows={data?.byCountry ?? []} loading={isLoading} emptyMessage="No location data" maxHeight="320px" />
            </Section>
          </div>

          <Section
            title="WIP Records"
            description={
              canSeeLots
                ? "Lot-level classification with the exact inclusion or exclusion reason"
                : "Lot-level WIP records are demand trace data"
            }
          >
            {data?.detailAccessRestricted ? (
              <div className="flex items-center gap-2 px-3 py-6 text-[11px] text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                Lot-level WIP records require the <span className="font-mono">demand.trace</span> permission. Aggregate figures above remain available.
              </div>
            ) : (
              <>
                <DataTable
                  columns={detailColumns}
                  rows={data?.rows ?? []}
                  loading={isLoading}
                  emptyMessage="No WIP records for the current filters"
                  maxHeight="420px"
                  exportable
                  exportPermission="demand.export"
                  exportFilename="wip-records.csv"
                  exportScope="current-page"
                />
                <ServerPagination
                  page={data?.page ?? 1}
                  pageSize={data?.pageSize ?? 50}
                  total={data?.total ?? 0}
                  hasMore={data?.hasMore ?? false}
                  onPageChange={setPage}
                  loading={isLoading}
                  label="WIP records"
                />
              </>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
