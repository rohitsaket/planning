"use client";

import { useMemo } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import {
  Boxes,
  ClipboardCheck,
  Package,
  CheckCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WipRow {
  dimension: string;
  pieces: number;
}
interface EligibilityFlag {
  flag: string;
  value: string;
  default: boolean;
}
interface WipData {
  totalWipPieces: number;
  byStatus: WipRow[];
  byDept: WipRow[];
  byShape: WipRow[];
  byCategory: WipRow[];
  eligibilityFlags: EligibilityFlag[];
  openRuleNote: string;
}

interface PlanningPiece {
  id: string;
  pieceCode: string;
  caseCode: string;
  caseStatus: string;
  optionCode: string;
  expectedShape: string | null;
  expectedWeight: number;
  expectedColor: string | null;
  expectedClarity: string | null;
  expectedCategory: string | null;
  certificationIntent: string | null;
  fantasyChildId: string | null;
  actualPolishedLotId: string | null;
  actualShape: string | null;
  actualWeight: number | null;
  actualCategory: string | null;
  fulfilled: boolean;
}

interface PlanningPiecesResponse {
  rows: PlanningPiece[];
}

const wipColumns: Column<WipRow>[] = [
  { key: "dimension", header: "Dimension", cell: (r) => <span className="font-medium">{r.dimension}</span>, sortable: true, sortValue: (r) => r.dimension },
  { key: "pieces", header: "Pieces", cell: (r) => <NumberCell value={r.pieces} intent="info" />, align: "right", sortable: true, sortValue: (r) => r.pieces },
];

const eligibilityColumns: Column<EligibilityFlag>[] = [
  { key: "flag", header: "Eligibility Flag", cell: (r) => <span className="font-medium">{r.flag}</span> },
  { key: "value", header: "Current Setting", cell: (r) => <Badge variant="warning">{r.value}</Badge> },
  { key: "default", header: "Default", cell: (r) => <Badge variant={r.default ? "success" : "neutral"}>{r.default ? "ON" : "OFF"}</Badge> },
];

// WIP Pipeline stages — emerald → sky → amber → emerald (final)
const STAGES = [
  {
    key: "approved",
    name: "Approved Plans",
    icon: ClipboardCheck,
    color: "#10b981", // emerald
    bgClass: "bg-emerald-100 dark:bg-emerald-950/40",
    borderClass: "border-emerald-300 dark:border-emerald-900",
    textClass: "text-emerald-700 dark:text-emerald-300",
    barClass: "bg-emerald-500 dark:bg-emerald-400",
    hint: "Pieces in APPROVED / RELEASED plan options",
  },
  {
    key: "wip",
    name: "Pieces in WIP",
    icon: Boxes,
    color: "#0ea5e9", // sky
    bgClass: "bg-sky-100 dark:bg-sky-950/40",
    borderClass: "border-sky-300 dark:border-sky-900",
    textClass: "text-sky-700 dark:text-sky-300",
    barClass: "bg-sky-500 dark:bg-sky-400",
    hint: "Current WIP pieces from approved plans",
  },
  {
    key: "expected",
    name: "Expected Output",
    icon: Package,
    color: "#f59e0b", // amber
    bgClass: "bg-amber-100 dark:bg-amber-950/40",
    borderClass: "border-amber-300 dark:border-amber-900",
    textClass: "text-amber-700 dark:text-amber-300",
    barClass: "bg-amber-500 dark:bg-amber-400",
    hint: "Expected polished output (assumed 1:1 with WIP)",
  },
  {
    key: "actual",
    name: "Actual Output",
    icon: CheckCircle,
    color: "#10b981", // emerald (final)
    bgClass: "bg-emerald-100 dark:bg-emerald-950/40",
    borderClass: "border-emerald-300 dark:border-emerald-900",
    textClass: "text-emerald-700 dark:text-emerald-300",
    barClass: "bg-emerald-500 dark:bg-emerald-400",
    hint: "Pieces where fulfilled = true",
  },
] as const;

export function WipView() {
  const { data, isLoading } = useApi<WipData>("/api/analysis/wip");
  // Fetch pieces separately so we can compute approved / expected / actual counts client-side
  const { data: piecesData, isLoading: piecesLoading } = useApi<PlanningPiecesResponse>("/api/planning/pieces");

  const piecesSpark = useMemo(() => {
    const slice = (data?.byStatus ?? []).slice(0, 7).map((r) => r.pieces);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 1);
    return slice;
  }, [data?.byStatus]);

  // Compute pipeline counts from pieces data
  const pipelineCounts = useMemo(() => {
    const allPieces = piecesData?.rows ?? [];
    // Approved / released plan pieces = pieces whose option is approved/released.
    // The pieces endpoint doesn't filter by approval status — we approximate using
    // totalWipPieces from /api/analysis/wip (which already filters by APPROVED/RELEASED)
    // as the "Approved Plans" count, since the WIP API pieces query is the same.
    const approvedCount = data?.totalWipPieces ?? 0;
    const wipCount = data?.totalWipPieces ?? 0;
    const expectedCount = wipCount; // 1:1 assumption (OPEN rule)
    const actualCount = allPieces.filter((p) => p.fulfilled).length;
    return {
      approved: approvedCount,
      wip: wipCount,
      expected: expectedCount,
      actual: actualCount,
    };
  }, [data?.totalWipPieces, piecesData?.rows]);

  const maxCount = Math.max(
    pipelineCounts.approved,
    pipelineCounts.wip,
    pipelineCounts.expected,
    pipelineCounts.actual,
    1
  );

  const stageValues: Record<string, number> = {
    approved: pipelineCounts.approved,
    wip: pipelineCounts.wip,
    expected: pipelineCounts.expected,
    actual: pipelineCounts.actual,
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="WIP Analysis"
        subtitle="Work-in-progress pieces from approved plans — eligibility flags remain an OPEN rule"
        meta={<span className="text-[10px] text-muted-foreground">BR-WIP-001 · OPEN</span>}
      />

      {data?.openRuleNote && (
        <InfoBanner variant="warning">{data.openRuleNote}</InfoBanner>
      )}

      {isLoading && !data ? (
        <KpiGridSkeleton count={4} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <KpiCard label="Total WIP Pieces" value={data?.totalWipPieces ?? 0} unit="pcs" intent="info" hint="Approved plan pieces in manufacturing" icon={Boxes} sparkline={piecesSpark} />
          </div>

          {/* WIP Pipeline Visualization — 4 stages with chevron arrows */}
          <Section
            title="WIP Pipeline"
            description="Approved Plans → Pieces in WIP → Expected Output → Actual Output · counts shown but not auto-applied"
            bodyClassName="p-3"
          >
            <div className="flex flex-col gap-3">
              {/* Pipeline stages */}
              <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
                {STAGES.map((stage, i) => {
                  const Icon = stage.icon;
                  const value = stageValues[stage.key] ?? 0;
                  const widthPct = Math.max(8, Math.round((value / maxCount) * 100));
                  return (
                    <div key={stage.key} className="flex items-stretch gap-1 flex-1 min-w-[140px]">
                      <div
                        className={cn(
                          "flex-1 rounded-md border bg-card p-3 flex flex-col gap-2",
                          stage.borderClass
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <div
                            className={cn(
                              "h-6 w-6 rounded-md flex items-center justify-center border",
                              stage.bgClass,
                              stage.borderClass
                            )}
                          >
                            <Icon className={cn("h-3.5 w-3.5", stage.textClass)} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[11px] font-semibold text-foreground truncate">
                              {stage.name}
                            </div>
                            <div className="text-[9px] text-muted-foreground truncate">
                              {stage.hint}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-semibold tabular-nums text-foreground">
                            {value.toLocaleString()}
                          </span>
                          <span className="text-[10px] text-muted-foreground">pcs</span>
                          {piecesLoading && (
                            <span className="text-[9px] text-muted-foreground/70 italic ml-1">
                              …
                            </span>
                          )}
                        </div>
                        {/* Proportional bar */}
                        <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              stage.barClass
                            )}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                      {i < STAGES.length - 1 && (
                        <div className="flex items-center justify-center px-0.5 text-muted-foreground/60">
                          <ChevronRight className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Legend / open-rule note */}
              <div className="flex items-start gap-2 rounded-md border border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/10 px-2.5 py-1.5">
                <span className="text-[10px] text-amber-900 dark:text-amber-200 leading-relaxed">
                  <strong className="font-medium">WIP contribution to shortage is an OPEN rule (BR-WIP-001)</strong> — counts shown but not auto-applied to shortage calculations.
                  Eligibility flags (counts toward requirement, expected attributes reliability, completion timing) remain configurable; defaults are OFF until an approved business rule confirms each flag.
                </span>
              </div>
            </div>
          </Section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="WIP by Status" description="Plan approval / manufacturing status buckets">
              <DataTable columns={wipColumns} rows={data?.byStatus ?? []} loading={isLoading} emptyMessage="No WIP status data" maxHeight="320px" />
            </Section>
            <Section title="WIP by Department (sourceFile)" description="Pieces grouped by Fantasy source file / department">
              <DataTable columns={wipColumns} rows={data?.byDept ?? []} loading={isLoading} emptyMessage="No department data" maxHeight="320px" />
            </Section>
            <Section title="WIP by Expected Shape" description="Pieces grouped by expected polished shape">
              <DataTable columns={wipColumns} rows={data?.byShape ?? []} loading={isLoading} emptyMessage="No shape data" maxHeight="320px" />
            </Section>
            <Section title="WIP by Expected Category" description="Pieces grouped by expected planning category">
              <DataTable columns={wipColumns} rows={data?.byCategory ?? []} loading={isLoading} emptyMessage="No category data" maxHeight="320px" />
            </Section>
          </div>

          <Section title="WIP Eligibility Flags (OPEN Rule)" description="These flags decide whether WIP counts toward shortage and which expected attributes are trusted">
            <DataTable columns={eligibilityColumns} rows={data?.eligibilityFlags ?? []} loading={isLoading} emptyMessage="No flags defined" maxHeight="400px" />
            <div className="mt-2 text-[10px] text-muted-foreground">
              <StatusBadge status="OPEN" /> All flags are <span className="font-medium">Configurable (OPEN)</span> — defaults are OFF until an approved business rule confirms each flag.
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
