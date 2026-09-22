"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge, Pill } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Scale,
  AlertTriangle,
  TrendingUp,
  Target,
  Layers,
  GitBranch,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  Boxes,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TableSkeleton, ChartSkeleton } from "@/components/diamond/shared/skeleton";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CaseListItem {
  id: string;
  caseCode: string;
  stoneName: string | null;
  stoneType: string;
  status: string;
  currentVersion: number;
  optionCount: number;
  planningDate: string;
  updatedAt?: string;
}

interface PieceRow {
  id: string;
  pieceCode: string;
  sequence: number;
  expectedShape: string | null;
  expectedWeight: number;
  expectedColor: string | null;
  expectedClarity: string | null;
  expectedCategory: string | null;
  certificationIntent: string | null;
  fulfilled: boolean;
  actualPolishedLotId: string | null;
  fantasyChildId: string | null;
}

interface OptionRow {
  id: string;
  optionCode: string;
  optionNumber: number;
  versionNumber: number;
  versionStatus: string;
  versionReason: string | null;
  expectedPieces: number;
  expectedTotalWeight: number;
  yieldPct: number;
  matchingRequiredPieces: number;
  requirementCoverage: number;
  coveragePct: number;
  nonRequiredPieces: number;
  expectedColor: string | null;
  expectedClarity: string | null;
  certificationIntent: string | null;
  potentialExcess: number;
  validationWarnings: string | null;
  selected: boolean;
  selectedBy: string | null;
  selectedAt: string | null;
  approvalStatus: string;
  approvedBy: string | null;
  approvedAt: string | null;
  pieces: PieceRow[];
}

interface VersionInfo {
  id: string;
  versionNumber: number;
  status: string;
  reason: string | null;
  createdBy: string;
  createdAt: string;
  supersededAt: string | null;
  optionCount: number;
}

interface CompareResponse {
  caseId: string;
  caseCode: string;
  stoneName: string | null;
  kapan: string | null;
  packet: string | null;
  stoneType: string;
  roughWeight: number;
  planner: string;
  planningDate: string;
  status: string;
  currentVersion: number;
  selectedOptionId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  versions: VersionInfo[];
  options: OptionRow[];
  summary: {
    totalOptions: number;
    totalVersions: number;
    bestYield: number;
    bestCoverage: number;
    avgYield: number;
    avgCoverage: number;
    totalExpectedPieces: number;
    totalExcessPieces: number;
    withWarnings: number;
    selectedOptionCode: string | null;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function yieldIntent(y: number): "default" | "warning" | "success" | "info" | "critical" {
  if (y >= 12) return "success";
  if (y >= 8) return "info";
  if (y >= 4) return "warning";
  return "critical";
}

function coverageIntent(c: number): "default" | "warning" | "success" | "info" | "critical" {
  if (c >= 80) return "success";
  if (c >= 50) return "info";
  if (c >= 25) return "warning";
  return "critical";
}

function parseWarnings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map((s) => String(s));
    if (typeof j === "string") return [j];
    return [JSON.stringify(j)];
  } catch {
    return [raw];
  }
}

// ---------------------------------------------------------------------------
// Warnings cell (shared between table and cards)
// ---------------------------------------------------------------------------
function WarningsCell({ value }: { value: string | null }) {
  const parsed = parseWarnings(value);
  if (parsed.length === 0) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {parsed.slice(0, 2).map((w, i) => (
        <Badge key={i} variant="warning">{w}</Badge>
      ))}
      {parsed.length > 2 && (
        <Badge variant="neutral">+{parsed.length - 2}</Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-3 detail card
// ---------------------------------------------------------------------------
function OptionDetailCard({ option, roughWeight, rank }: { option: OptionRow; roughWeight: number; rank: number }) {
  const yieldI = yieldIntent(option.yieldPct);
  const covI = coverageIntent(option.coveragePct);
  const yieldColor =
    yieldI === "success" ? "#10b981" :
    yieldI === "info" ? "#0ea5e9" :
    yieldI === "warning" ? "#f59e0b" :
    "#ef4444";
  const covColor =
    covI === "success" ? "#10b981" :
    covI === "info" ? "#0ea5e9" :
    covI === "warning" ? "#f59e0b" :
    "#ef4444";

  const rankColors = ["#f59e0b", "#94a3b8", "#cd7f32"]; // gold/silver/bronze
  const rankBadge = rank <= 3 ? rankColors[rank - 1] : "#94a3b8";

  const barData = [
    { name: "Yield", value: Number(option.yieldPct.toFixed(2)), fill: yieldColor },
    { name: "Coverage", value: Number(option.coveragePct.toFixed(2)), fill: covColor },
  ];

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 flex flex-col gap-2 relative overflow-hidden",
        option.selected
          ? "border-sky-300 dark:border-sky-900 ring-1 ring-sky-200 dark:ring-sky-900"
          : "border-border"
      )}
    >
      {option.selected && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-sky-500" />
      )}
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="inline-flex items-center justify-center h-4 w-4 rounded text-[9px] font-bold text-white tabular-nums"
              style={{ background: rankBadge }}
            >
              {rank}
            </span>
            <span className="font-mono text-xs font-semibold truncate">{option.optionCode}</span>
            <Pill className="text-[9px]">v{option.versionNumber} · #{option.optionNumber}</Pill>
            {option.selected && (
              <Badge variant="info">
                <CheckCircle2 className="h-2.5 w-2.5" /> Selected
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {option.expectedPieces} pcs · {option.expectedTotalWeight.toFixed(3)} ct
          </p>
        </div>
        <StatusBadge status={option.approvalStatus} />
      </div>

      {/* Bar comparison */}
      <div className="h-24 pl-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={barData} layout="vertical" margin={{ top: 2, right: 12, bottom: 2, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9 }} domain={[0, 100]} unit="%" />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={56} />
            <Tooltip contentStyle={{ fontSize: 10, borderRadius: 8 }} formatter={(v: number) => `${Number(v).toFixed(2)}%`} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {barData.map((d, i) => <Cell key={i} fill={d.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Attribute grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] pl-1">
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Yield %</span>
          <span className={cn("tabular-nums font-semibold",
            yieldI === "success" ? "text-emerald-600 dark:text-emerald-400" :
            yieldI === "info" ? "text-sky-600 dark:text-sky-400" :
            yieldI === "warning" ? "text-amber-600 dark:text-amber-400" :
            "text-rose-600 dark:text-rose-400"
          )}>{option.yieldPct.toFixed(2)}%</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Coverage %</span>
          <span className={cn("tabular-nums font-semibold",
            covI === "success" ? "text-emerald-600 dark:text-emerald-400" :
            covI === "info" ? "text-sky-600 dark:text-sky-400" :
            covI === "warning" ? "text-amber-600 dark:text-amber-400" :
            "text-rose-600 dark:text-rose-400"
          )}>{option.coveragePct.toFixed(2)}%</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Match Req</span>
          <span className="tabular-nums">{option.matchingRequiredPieces}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Coverage</span>
          <span className="tabular-nums">{option.requirementCoverage} pcs</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Non-Req</span>
          <span className="tabular-nums">{option.nonRequiredPieces}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Excess</span>
          <span className={cn("tabular-nums", option.potentialExcess > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "")}>{option.potentialExcess}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Color</span>
          <span className="font-mono">{option.expectedColor ?? "—"}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Clarity</span>
          <span className="font-mono">{option.expectedClarity ?? "—"}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Cert</span>
          <span className="font-mono">{option.certificationIntent ?? "—"}</span>
        </div>
        <div className="flex justify-between border-b border-border/40 pb-0.5">
          <span className="text-muted-foreground uppercase tracking-wide">Rough Wt</span>
          <span className="tabular-nums">{roughWeight.toFixed(3)} ct</span>
        </div>
      </div>

      {/* Validation warnings */}
      {option.validationWarnings && (
        <div className="pl-1">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">Validation Warnings</p>
          <WarningsCell value={option.validationWarnings} />
        </div>
      )}

      {/* Pieces preview */}
      {option.pieces.length > 0 && (
        <div className="pl-1">
          <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
            Pieces ({option.pieces.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {option.pieces.slice(0, 8).map((p) => (
              <Pill key={p.id} className="text-[9px] font-mono">
                {p.expectedShape ?? "?"} {p.expectedWeight.toFixed(2)}ct
              </Pill>
            ))}
            {option.pieces.length > 8 && (
              <Pill className="text-[9px]">+{option.pieces.length - 8} more</Pill>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable pieces breakdown row
// ---------------------------------------------------------------------------
function OptionPiecesSection({ option }: { option: OptionRow }) {
  const [open, setOpen] = useState(false);
  const pieces = option.pieces;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="border-b border-border/40 last:border-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-muted/40 transition-colors"
            aria-expanded={open}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
            <span className="font-mono font-medium">{option.optionCode}</span>
            <Pill className="text-[9px]">v{option.versionNumber} · #{option.optionNumber}</Pill>
            <span className="text-muted-foreground">
              {pieces.length} piece{pieces.length === 1 ? "" : "s"}
              {option.selected && <Badge variant="info" className="ml-1">Selected</Badge>}
            </span>
            <span className="ml-auto text-muted-foreground tabular-nums">
              Yield {option.yieldPct.toFixed(2)}% · Cov {option.coveragePct.toFixed(2)}%
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1">
            {pieces.length === 0 ? (
              <EmptyState title="No planned pieces" message="This option has no piece-level breakdown." />
            ) : (
              <div className="overflow-x-auto rounded border border-border/60">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      {["#", "Piece Code", "Shape", "Weight (ct)", "Color", "Clarity", "Category", "Cert Intent", "Fulfilled"].map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pieces.map((p, i) => (
                      <tr key={p.id} className={cn("border-b border-border/40 last:border-0", i % 2 === 1 && "bg-muted/20")}>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{p.sequence}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{p.pieceCode}</td>
                        <td className="px-2 py-1.5">{p.expectedShape ?? "—"}</td>
                        <td className="px-2 py-1.5 tabular-nums">{p.expectedWeight.toFixed(3)}</td>
                        <td className="px-2 py-1.5 font-mono">{p.expectedColor ?? "—"}</td>
                        <td className="px-2 py-1.5 font-mono">{p.expectedClarity ?? "—"}</td>
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">{p.expectedCategory ?? "—"}</td>
                        <td className="px-2 py-1.5">{p.certificationIntent ?? "—"}</td>
                        <td className="px-2 py-1.5">
                          {p.fulfilled ? (
                            <Badge variant="success">Fulfilled</Badge>
                          ) : (
                            <Badge variant="neutral">Open</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function PlanComparisonView() {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  // Fetch the case list (for the dropdown)
  const { data: caseListData, isLoading: caseListLoading } = useApi<{ rows: CaseListItem[] }>(
    "/api/planning/cases"
  );
  const caseList = caseListData?.rows ?? [];

  // Auto-select the most recently updated case on first load.
  // Sorts client-side by planningDate (or updatedAt if available) descending,
  // falling back to the first case if no dates are present.
  const latestCase = useMemo(() => {
    if (!caseList || caseList.length === 0) return null;
    const sorted = [...caseList].sort((a, b) => {
      const dateA = new Date(a.planningDate || a.updatedAt || 0).getTime();
      const dateB = new Date(b.planningDate || b.updatedAt || 0).getTime();
      return dateB - dateA;
    });
    return sorted[0];
  }, [caseList]);

  const effectiveCaseId = selectedCaseId ?? latestCase?.id ?? null;

  const { data, isLoading } = useApi<CompareResponse | null>(
    effectiveCaseId ? `/api/planning/compare/${effectiveCaseId}` : null
  );

  const options = data?.options ?? [];
  const summary = data?.summary;

  // Top 3 by yield
  const top3ByYield = useMemo(
    () => [...options].sort((a, b) => b.yieldPct - a.yieldPct).slice(0, 3),
    [options]
  );

  // Scatter plot data — yieldPct (x) vs coveragePct (y), point labeled with optionCode
  const scatterData = useMemo(
    () =>
      options.map((o) => ({
        x: Number(o.yieldPct.toFixed(2)),
        y: Number(o.coveragePct.toFixed(2)),
        label: o.optionCode,
        selected: o.selected,
        z: 100,
      })),
    [options]
  );

  // Sparklines
  const yieldSpark = useMemo(() => {
    const slice = options.slice(0, 7).map((o) => o.yieldPct);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [options]);
  const coverageSpark = useMemo(() => {
    const slice = options.slice(0, 7).map((o) => o.coveragePct);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [options]);
  const excessSpark = useMemo(() => {
    const slice = options.slice(0, 7).map((o) => o.potentialExcess);
    while (slice.length < 7) slice.push(slice.length ? slice[slice.length - 1] : 0);
    return slice;
  }, [options]);
  const optionsCountSpark = useMemo(() => {
    const base = options.length || 1;
    return [base * 0.8, base * 0.85, base * 0.9, base * 0.95, base, base, base];
  }, [options.length]);

  // Comparison table columns
  const columns: Column<OptionRow>[] = [
    {
      key: "optionCode",
      header: "Option Code",
      sticky: "left",
      sortable: true,
      sortValue: (r) => r.optionCode,
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono font-medium text-xs">{r.optionCode}</span>
          <span className="text-[9px] text-muted-foreground">
            v{r.versionNumber} · #{r.optionNumber}
          </span>
        </div>
      ),
    },
    {
      key: "expectedPieces",
      header: "Exp Pieces",
      align: "right",
      sortable: true,
      sortValue: (r) => r.expectedPieces,
      cell: (r) => <NumberCell value={r.expectedPieces} />,
    },
    {
      key: "expectedTotalWeight",
      header: "Total Wt",
      align: "right",
      sortable: true,
      sortValue: (r) => r.expectedTotalWeight,
      cell: (r) => <span className="tabular-nums">{r.expectedTotalWeight.toFixed(3)}</span>,
    },
    {
      key: "yieldPct",
      header: "Yield %",
      align: "right",
      sortable: true,
      sortValue: (r) => r.yieldPct,
      cell: (r) => (
        <span className={cn("tabular-nums font-medium",
          yieldIntent(r.yieldPct) === "success" ? "text-emerald-600 dark:text-emerald-400" :
          yieldIntent(r.yieldPct) === "info" ? "text-sky-600 dark:text-sky-400" :
          yieldIntent(r.yieldPct) === "warning" ? "text-amber-600 dark:text-amber-400" :
          "text-rose-600 dark:text-rose-400"
        )}>
          {r.yieldPct.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "matchingRequiredPieces",
      header: "Match Req",
      align: "right",
      sortable: true,
      sortValue: (r) => r.matchingRequiredPieces,
      cell: (r) => <NumberCell value={r.matchingRequiredPieces} />,
    },
    {
      key: "requirementCoverage",
      header: "Coverage",
      align: "right",
      sortable: true,
      sortValue: (r) => r.requirementCoverage,
      cell: (r) => <NumberCell value={r.requirementCoverage} />,
    },
    {
      key: "coveragePct",
      header: "Cov %",
      align: "right",
      sortable: true,
      sortValue: (r) => r.coveragePct,
      cell: (r) => (
        <span className={cn("tabular-nums font-medium",
          coverageIntent(r.coveragePct) === "success" ? "text-emerald-600 dark:text-emerald-400" :
          coverageIntent(r.coveragePct) === "info" ? "text-sky-600 dark:text-sky-400" :
          coverageIntent(r.coveragePct) === "warning" ? "text-amber-600 dark:text-amber-400" :
          "text-rose-600 dark:text-rose-400"
        )}>
          {r.coveragePct.toFixed(2)}%
        </span>
      ),
    },
    {
      key: "nonRequiredPieces",
      header: "Non-Req",
      align: "right",
      sortable: true,
      sortValue: (r) => r.nonRequiredPieces,
      cell: (r) => <NumberCell value={r.nonRequiredPieces} />,
    },
    {
      key: "potentialExcess",
      header: "Excess",
      align: "right",
      sortable: true,
      sortValue: (r) => r.potentialExcess,
      cell: (r) => (
        <NumberCell
          value={r.potentialExcess}
          intent={r.potentialExcess > 0 ? "warning" : "default"}
        />
      ),
    },
    {
      key: "expectedColor",
      header: "Color",
      cell: (r) => <span className="font-mono">{r.expectedColor ?? "—"}</span>,
    },
    {
      key: "expectedClarity",
      header: "Clarity",
      cell: (r) => <span className="font-mono">{r.expectedClarity ?? "—"}</span>,
    },
    {
      key: "certificationIntent",
      header: "Cert Intent",
      cell: (r) => <span className="font-mono text-[10px]">{r.certificationIntent ?? "—"}</span>,
    },
    {
      key: "validationWarnings",
      header: "Warnings",
      cell: (r) => <WarningsCell value={r.validationWarnings} />,
    },
    {
      key: "selected",
      header: "Selected",
      align: "center",
      cell: (r) =>
        r.selected ? (
          <Badge variant="info">
            <CheckCircle2 className="h-2.5 w-2.5" /> Yes
          </Badge>
        ) : (
          <span className="text-muted-foreground/50 text-[10px]">—</span>
        ),
    },
    {
      key: "approvalStatus",
      header: "Approval",
      align: "center",
      cell: (r) => <StatusBadge status={r.approvalStatus} />,
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Plan Comparison"
        subtitle="Compare all plan options side-by-side — yield vs requirement coverage trade-off"
        meta={
          data ? (
            <span className="text-[10px] text-muted-foreground">
              {data.options.length} options across {data.versions.length} version{data.versions.length === 1 ? "" : "s"}
            </span>
          ) : null
        }
      />

      {/* Case selector */}
      <Section
        title="Select Planning Case"
        description="Pick a planning case to compare its options side-by-side"
        bodyClassName="p-3"
      >
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1 min-w-[280px] flex-1">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
              Planning Case
            </label>
            <Select
              value={effectiveCaseId ?? ""}
              onValueChange={(v) => setSelectedCaseId(v)}
              disabled={caseListLoading || caseList.length === 0}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue
                  placeholder={caseListLoading ? "Loading cases..." : caseList.length === 0 ? "No planning cases found" : "Select a case..."}
                />
              </SelectTrigger>
              <SelectContent>
                {caseList.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    <span className="font-mono">{c.caseCode}</span>
                    <span className="text-muted-foreground ml-1">
                      · {c.stoneName ?? "—"}
                    </span>
                    <span className="ml-1">
                      <StatusBadge status={c.status} />
                    </span>
                    {latestCase && c.id === latestCase.id && (
                      <Badge variant="info" className="ml-1 gap-0.5">
                        <Clock className="h-2.5 w-2.5" />
                        Latest
                      </Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {data && (
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <Pill><Boxes className="h-2.5 w-2.5" /> {data.stoneType}</Pill>
              <Pill>Rough {data.roughWeight.toFixed(3)} ct</Pill>
              {data.kapan && <Pill>Kapan {data.kapan}</Pill>}
              {data.packet && <Pill>Packet {data.packet}</Pill>}
              <StatusBadge status={data.status} />
            </div>
          )}
        </div>
      </Section>

      {/* Info banner — OPEN rule */}
      <InfoBanner variant="info">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <div>
            <strong>OPEN rule BR-PLAN-SEL-001</strong> — Plan selection logic is OPEN. High Yield ≠ automatically best commercial plan. Yield vs requirement coverage trade-off is a business decision.
          </div>
        </div>
      </InfoBanner>

      {!data && !isLoading && (
        <EmptyState
          title="No case selected"
          message="Select a planning case above to compare its options side-by-side."
          icon={<Scale className="h-8 w-8" />}
        />
      )}

      {isLoading && !data && effectiveCaseId ? (
        <div className="flex flex-col gap-3">
          <TableSkeleton rows={6} cols={8} />
          <ChartSkeleton />
        </div>
      ) : null}

      {data && (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
            <KpiCard
              label="Total Options"
              value={summary?.totalOptions ?? 0}
              unit="opts"
              intent="info"
              icon={Layers}
              hint={`Across ${summary?.totalVersions ?? 0} version(s)`}
              sparkline={optionsCountSpark}
            />
            <KpiCard
              label="Best Yield"
              value={`${(summary?.bestYield ?? 0).toFixed(2)}%`}
              intent="success"
              icon={TrendingUp}
              hint={`Avg ${(summary?.avgYield ?? 0).toFixed(2)}%`}
              sparkline={yieldSpark}
            />
            <KpiCard
              label="Best Coverage"
              value={`${(summary?.bestCoverage ?? 0).toFixed(2)}%`}
              intent="info"
              icon={Target}
              hint={`Avg ${(summary?.avgCoverage ?? 0).toFixed(2)}%`}
              sparkline={coverageSpark}
            />
            <KpiCard
              label="Expected Pieces"
              value={summary?.totalExpectedPieces ?? 0}
              unit="pcs"
              intent="default"
              icon={Boxes}
              hint="Σ across all options"
            />
            <KpiCard
              label="Excess Pieces"
              value={summary?.totalExcessPieces ?? 0}
              unit="pcs"
              intent={(summary?.totalExcessPieces ?? 0) > 0 ? "warning" : "success"}
              icon={AlertTriangle}
              hint={`${summary?.withWarnings ?? 0} opts with warnings`}
              sparkline={excessSpark}
            />
          </div>

          {/* Comparison table */}
          <Section
            title="All Options Comparison"
            description="One row per option across all versions — sortable. Selected option highlighted."
          >
            <DataTable<OptionRow>
              columns={columns}
              rows={options}
              loading={isLoading}
              emptyMessage="No options found for this case."
              initialSortKey="yieldPct"
              initialSortDir="desc"
              searchable
              searchPlaceholder="Search option code, color, clarity..."
              searchFn={(r, q) => {
                const lq = q.toLowerCase();
                return (
                  r.optionCode.toLowerCase().includes(lq) ||
                  (r.expectedColor ?? "").toLowerCase().includes(lq) ||
                  (r.expectedClarity ?? "").toLowerCase().includes(lq) ||
                  (r.certificationIntent ?? "").toLowerCase().includes(lq) ||
                  r.approvalStatus.toLowerCase().includes(lq)
                );
              }}
              exportable
              exportPermission="plan.export"
              exportFilename={`plan-comparison-${data.caseCode}.csv`}
              rowClassName={(r) =>
                r.selected ? "bg-sky-50/50 dark:bg-sky-950/30" : ""
              }
              maxHeight="500px"
            />
          </Section>

          {/* Top-3 detail cards */}
          <Section
            title="Top 3 Options by Yield"
            description="Detailed side-by-side comparison of the three highest-yield options, with yield vs coverage bar chart"
          >
            {top3ByYield.length === 0 ? (
              <EmptyState title="No options to display" message="This case has no options yet." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {top3ByYield.map((opt, i) => (
                  <OptionDetailCard
                    key={opt.id}
                    option={opt}
                    roughWeight={data.roughWeight}
                    rank={i + 1}
                  />
                ))}
              </div>
            )}
          </Section>

          {/* Yield vs Coverage scatter plot */}
          <Section
            title="Yield vs Coverage Trade-off"
            description="Each point = one option (label = option code). Top-right = high yield AND high coverage (ideal). Top-left = high coverage, low yield. Bottom-right = high yield, low coverage."
            actions={
              <Badge variant="info" className="gap-1">
                <GitBranch className="h-2.5 w-2.5" /> {scatterData.length} points
              </Badge>
            }
          >
            <div className="h-72">
              {scatterData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  No data to plot.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 12, right: 24, bottom: 24, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Yield %"
                      tick={{ fontSize: 10 }}
                      unit="%"
                      domain={[0, "auto"]}
                      label={{ value: "Yield %", position: "insideBottom", offset: -12, fontSize: 10 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Coverage %"
                      tick={{ fontSize: 10 }}
                      unit="%"
                      domain={[0, 100]}
                      label={{ value: "Coverage %", angle: -90, position: "insideLeft", fontSize: 10 }}
                    />
                    <ZAxis type="number" dataKey="z" range={[120, 120]} />
                    <Tooltip
                      contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                      formatter={(v: number, name: string) =>
                        name === "Yield %" || name === "Coverage %" ? `${Number(v).toFixed(2)}%` : v
                      }
                      labelFormatter={(_, payload) => {
                        const p = payload?.[0]?.payload as { label?: string; selected?: boolean } | undefined;
                        return p?.label ? `${p.label}${p.selected ? " (selected)" : ""}` : "";
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine
                      segment={[{ x: 0, y: 0 }, { x: summary?.bestYield ?? 100, y: 100 }]}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                    <Scatter
                      name="Options"
                      data={scatterData}
                      fill="#0ea5e9"
                    >
                      {scatterData.map((p, i) => (
                        <Cell
                          key={i}
                          fill={p.selected ? "#10b981" : "#0ea5e9"}
                          stroke={p.selected ? "#065f46" : "#0369a1"}
                          strokeWidth={p.selected ? 2 : 1}
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Selected option
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-500" /> Other options
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0 w-4 border-t-2 border-dashed border-slate-400" /> Reference (ideal = high yield + high coverage)
              </span>
            </div>
          </Section>

          {/* Pieces breakdown — collapsible per option */}
          <Section
            title="Planned Pieces Breakdown"
            description="Expand an option to see its planned pieces — shape, weight, color, clarity, category, fulfillment"
            actions={
              <Badge variant="neutral" className="gap-1">
                <ShieldCheck className="h-2.5 w-2.5" /> {options.reduce((s, o) => s + o.pieces.length, 0)} pieces total
              </Badge>
            }
          >
            <div className="rounded border border-border/60 overflow-hidden bg-card">
              {options.length === 0 ? (
                <EmptyState title="No options" message="No planned pieces to display." />
              ) : (
                options.map((opt) => (
                  <OptionPiecesSection key={opt.id} option={opt} />
                ))
              )}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
