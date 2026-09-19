"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Calculator, Layers, AlertTriangle, Package, Boxes, Target,
  ShieldCheck, GitBranch, Wrench, FileWarning, Sparkles,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// API response types (mirror the route.ts output)
// ---------------------------------------------------------------------------
interface TraceStep {
  step: number;
  label: string;
  value: number;
  formula: string;
  source: string;
  tone?: "shortage" | "coverage" | "advisory";
}

interface TraceCategory {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  steps: TraceStep[];
  fourNumbers: {
    physicalShortage: number;
    pipelineAdjusted: number;
    planningAdjusted: number;
    forecastRequirement: number;
  };
}

interface TraceSummary {
  totalCategories: number;
  totalShortage: number;
  totalExcess: number;
  categoriesWithShortage: number;
  categoriesWithExcess: number;
}

interface DemandTraceResponse {
  ruleVersion: string;
  runDate: string | null;
  windowDays: number;
  forecastRunVersion: string | null;
  categories: TraceCategory[];
  summary: TraceSummary;
}

// ---------------------------------------------------------------------------
// Per-step styling palette
// ---------------------------------------------------------------------------
const TONE_STYLES: Record<
  NonNullable<TraceStep["tone"]>,
  { border: string; dot: string; bg: string; value: string; label: string }
> = {
  shortage: {
    border: "border-rose-200/70 dark:border-rose-900/60",
    dot: "bg-rose-500 text-white",
    bg: "bg-rose-50/60 dark:bg-rose-950/30",
    value: "text-rose-700 dark:text-rose-300",
    label: "Shortage",
  },
  coverage: {
    border: "border-emerald-200/70 dark:border-emerald-900/60",
    dot: "bg-emerald-500 text-white",
    bg: "bg-emerald-50/60 dark:bg-emerald-950/30",
    value: "text-emerald-700 dark:text-emerald-300",
    label: "Coverage",
  },
  advisory: {
    border: "border-amber-200/70 dark:border-amber-900/60",
    dot: "bg-amber-500 text-white",
    bg: "bg-amber-50/60 dark:bg-amber-950/30",
    value: "text-amber-700 dark:text-amber-300",
    label: "Advisory",
  },
};

const DEFAULT_TONE = {
  border: "border-border",
  dot: "bg-muted-foreground/70 text-white",
  bg: "bg-card",
  value: "text-foreground",
  label: "Input",
};

function fmtRunDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return "0";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// Single step card in the vertical timeline
// ---------------------------------------------------------------------------
function StepCard({ step, isLast }: { step: TraceStep; isLast: boolean }) {
  const tone = step.tone ? TONE_STYLES[step.tone] : DEFAULT_TONE;
  return (
    <div className="relative pl-9">
      {/* Vertical connector */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[14px] top-7 bottom-0 w-px bg-border"
        />
      )}
      {/* Step number badge */}
      <span
        className={cn(
          "absolute left-0 top-1.5 h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold shadow-sm ring-2 ring-background",
          tone.dot,
        )}
      >
        {step.step}
      </span>

      <div
        className={cn(
          "rounded-md border px-3 py-2 transition-colors",
          tone.border,
          tone.bg,
        )}
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-foreground">
                {step.label}
              </span>
              {step.tone && (
                <Badge variant={step.tone === "shortage" ? "critical" : step.tone === "coverage" ? "success" : "warning"}>
                  {TONE_STYLES[step.tone].label}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-[10px] font-mono text-muted-foreground leading-snug break-words">
              {step.formula}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground/80 leading-snug">
              <span className="font-semibold">Source:</span> {step.source}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className={cn("text-2xl font-bold tabular-nums leading-none", tone.value)}>
              {formatNum(step.value)}
            </div>
            <div className="text-[9px] uppercase tracking-wide text-muted-foreground/80 mt-1">
              output
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Four Requirement Numbers card
// ---------------------------------------------------------------------------
function FourNumberCard({
  label, value, formula, icon: Icon, intent,
}: {
  label: string;
  value: number;
  formula: string;
  icon: LucideIcon;
  intent: "critical" | "warning" | "info" | "success";
}) {
  const styles: Record<string, { ring: string; text: string; chip: string }> = {
    critical: { ring: "border-rose-300 dark:border-rose-900", text: "text-rose-700 dark:text-rose-300", chip: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
    warning: { ring: "border-amber-300 dark:border-amber-900", text: "text-amber-700 dark:text-amber-300", chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
    info: { ring: "border-sky-300 dark:border-sky-900", text: "text-sky-700 dark:text-sky-300", chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
    success: { ring: "border-emerald-300 dark:border-emerald-900", text: "text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  };
  const s = styles[intent];
  return (
    <div className={cn("rounded-md border p-3 bg-card flex flex-col gap-1.5", s.ring)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          {label}
        </span>
        <span className={cn("p-1 rounded-md", s.chip)}>
          <Icon className="h-3 w-3" />
        </span>
      </div>
      <div className={cn("text-3xl font-bold tabular-nums leading-none", s.text)}>
        {value}
      </div>
      <div className="text-[10px] font-mono text-muted-foreground leading-snug">
        {formula}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------
export function DemandTraceView() {
  const { data, isLoading } = useApi<DemandTraceResponse>("/api/analysis/demand-trace");

  const categories = data?.categories ?? [];
  const summary = data?.summary;
  const ruleVersion = data?.ruleVersion ?? "DEMAND-V1";
  const runDate = fmtRunDate(data?.runDate ?? null);
  const windowDays = data?.windowDays ?? 90;
  const forecastVersion = data?.forecastRunVersion ?? null;

  // Selected category — default to first category with shortage > 0
  const defaultCatId = useMemo(() => {
    const withShortage = categories.find((c) => c.fourNumbers.physicalShortage > 0);
    return withShortage?.category ?? categories[0]?.category ?? null;
  }, [categories]);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const activeCat =
    categories.find((c) => c.category === (selectedCat ?? defaultCatId)) ?? null;

  // ---------------------------------------------------------------------------
  // All-categories table rows (one per planning category)
  // ---------------------------------------------------------------------------
  interface RowShape {
    category: string;
    lab: string;
    shape: string;
    weightBand: string;
    sales90d: number;
    monthlyAverage: number;
    roundedTarget: number;
    availableStock: number;
    physicalShortage: number;
    wipCoverage: number;
    approvedPlanCoverage: number;
    remainingUnplanned: number;
    forecastSignal: number;
    excessStock: number;
  }

  const rows: RowShape[] = useMemo(() => {
    return categories.map((c) => {
      const findVal = (n: number) => c.steps.find((s) => s.step === n)?.value ?? 0;
      return {
        category: c.category,
        lab: c.lab,
        shape: c.shape,
        weightBand: c.weightBand,
        sales90d: findVal(1),
        monthlyAverage: findVal(2),
        roundedTarget: findVal(4),
        availableStock: findVal(5),
        physicalShortage: findVal(6),
        wipCoverage: findVal(8),
        approvedPlanCoverage: findVal(10),
        remainingUnplanned: findVal(11),
        forecastSignal: findVal(13),
        excessStock: findVal(12),
      };
    });
  }, [categories]);

  // Filter categories for the Select dropdown (search-filtered)
  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    const q = search.toLowerCase();
    return categories.filter((c) =>
      `${c.lab} ${c.shape} ${c.weightBand} ${c.category}`.toLowerCase().includes(q),
    );
  }, [categories, search]);

  const columns: Column<RowShape>[] = [
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (r) => r.category,
      sticky: "left",
      width: "240px",
      cell: (r) => (
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-xs font-medium text-foreground truncate">
            {r.lab} <span className="text-muted-foreground">|</span> {r.shape} <span className="text-muted-foreground">|</span> {r.weightBand}
          </span>
          <span className="text-[9px] text-muted-foreground/70 truncate font-mono">
            {r.category}
          </span>
        </div>
      ),
    },
    { key: "sales90d", header: "90D Sales", sortable: true, sortValue: (r) => r.sales90d, align: "right", width: "90px", cell: (r) => <NumberCell value={r.sales90d} /> },
    { key: "monthlyAverage", header: "Monthly Avg", sortable: true, sortValue: (r) => r.monthlyAverage, align: "right", width: "95px", cell: (r) => <NumberCell value={r.monthlyAverage} decimals={2} /> },
    { key: "roundedTarget", header: "Target", sortable: true, sortValue: (r) => r.roundedTarget, align: "right", width: "75px", cell: (r) => <NumberCell value={r.roundedTarget} /> },
    { key: "availableStock", header: "Available", sortable: true, sortValue: (r) => r.availableStock, align: "right", width: "85px", cell: (r) => <NumberCell value={r.availableStock} /> },
    {
      key: "physicalShortage",
      header: "Shortage",
      sortable: true,
      sortValue: (r) => r.physicalShortage,
      align: "right",
      width: "85px",
      cell: (r) => <NumberCell value={r.physicalShortage} intent={r.physicalShortage > 0 ? "critical" : undefined} />,
    },
    { key: "wipCoverage", header: "WIP Cov", sortable: true, sortValue: (r) => r.wipCoverage, align: "right", width: "75px", cell: (r) => <NumberCell value={r.wipCoverage} intent={r.wipCoverage > 0 ? "info" : undefined} /> },
    { key: "approvedPlanCoverage", header: "Plan Cov", sortable: true, sortValue: (r) => r.approvedPlanCoverage, align: "right", width: "80px", cell: (r) => <NumberCell value={r.approvedPlanCoverage} intent={r.approvedPlanCoverage > 0 ? "success" : undefined} /> },
    {
      key: "remainingUnplanned",
      header: "Remaining",
      sortable: true,
      sortValue: (r) => r.remainingUnplanned,
      align: "right",
      width: "90px",
      cell: (r) => <NumberCell value={r.remainingUnplanned} intent={r.remainingUnplanned > 0 ? "critical" : "success"} />,
    },
    {
      key: "forecastSignal",
      header: "Forecast",
      sortable: true,
      sortValue: (r) => r.forecastSignal,
      align: "right",
      width: "85px",
      cell: (r) => (
        <span className="inline-flex items-center gap-1">
          <NumberCell value={r.forecastSignal} intent={r.forecastSignal > 0 ? "warning" : undefined} />
          {r.forecastSignal > 0 && (
            <span className="text-[8px] text-amber-600 dark:text-amber-400 font-semibold uppercase">adv</span>
          )}
        </span>
      ),
    },
  ];

  // ---------------------------------------------------------------------------
  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <PageHeader
          title="Demand Calculation Trace"
          subtitle="Step-by-step breakdown of the confirmed 90-day demand rule — source, input, calculation, output"
        />
        <KpiGridSkeleton count={5} />
      </div>
    );
  }

  if (!data || categories.length === 0) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <PageHeader
          title="Demand Calculation Trace"
          subtitle="Step-by-step breakdown of the confirmed 90-day demand rule — source, input, calculation, output"
        />
        <EmptyState
          title="No demand run found"
          message="Trigger a demand calculation from the Executive Dashboard to populate the trace."
          icon={<Calculator className="h-8 w-8" />}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Demand Calculation Trace"
        subtitle="Step-by-step breakdown of the confirmed 90-day demand rule — source, input, calculation, output"
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="info" className="gap-1">
              <Calculator className="h-2.5 w-2.5" />
              {ruleVersion}
            </Badge>
            <Badge variant="neutral" className="gap-1">
              <span className="text-muted-foreground">Window</span>
              <span className="font-semibold">{windowDays}d</span>
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              Run: <span className="tabular-nums">{runDate}</span>
            </span>
          </div>
        }
      />

      {/* Confirmed-rule banner */}
      <InfoBanner variant="info">
        <span className="font-semibold">CONFIRMED rule {ruleVersion}.</span>{" "}
        90-day rolling invoice window. <span className="font-mono">Monthly Average = 90D/3</span>.
        <span className="font-mono"> Target = Monthly Avg × 2 (round-half-up)</span>.
        <span className="font-mono"> Shortage = MAX(0, Target − Available)</span>.
        Memo excluded per <span className="font-semibold">BR-MEMO-001</span>.
        WIP contribution is <span className="font-semibold">OPEN (BR-WIP-001)</span>.
        Forecast signal is <span className="font-semibold">advisory only — NOT confirmed demand</span>.
        {forecastVersion && (
          <>
            {" "}Forecast model: <span className="font-mono">{forecastVersion}</span>.
          </>
        )}
      </InfoBanner>

      {/* Summary KPI grid (5 cards) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiCard
          label="Total Categories"
          value={summary?.totalCategories ?? 0}
          unit="cats"
          intent="info"
          icon={Layers}
          hint="Planning categories processed"
        />
        <KpiCard
          label="Total Shortage"
          value={summary?.totalShortage ?? 0}
          unit="pcs"
          intent="critical"
          icon={AlertTriangle}
          hint="Σ physicalShortage across all categories"
        />
        <KpiCard
          label="Total Excess"
          value={summary?.totalExcess ?? 0}
          unit="pcs"
          intent="warning"
          icon={Package}
          hint="Advisory — does NOT change shortage"
        />
        <KpiCard
          label="Cats w/ Shortage"
          value={summary?.categoriesWithShortage ?? 0}
          unit="cats"
          intent="critical"
          icon={Boxes}
          hint="physicalShortage > 0"
        />
        <KpiCard
          label="Cats w/ Excess"
          value={summary?.categoriesWithExcess ?? 0}
          unit="cats"
          intent="warning"
          icon={Target}
          hint="excessStock > 0 (advisory)"
        />
      </div>

      {/* Selected category step-by-step trace */}
      <Section
        title="Calculation Steps"
        description="Pick a planning category to drill into its 13-step demand calculation. Each step exposes its source table, formula, and output."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter categories…"
              className="h-8 w-[160px] text-xs"
            />
            <Select
              value={activeCat?.category ?? ""}
              onValueChange={setSelectedCat}
            >
              <SelectTrigger size="sm" className="h-8 w-[280px] text-xs">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {filteredCategories.map((c) => (
                  <SelectItem key={c.category} value={c.category} className="text-xs">
                    <span className="font-mono">
                      {c.lab} | {c.shape} | {c.weightBand}
                    </span>
                    {c.fourNumbers.physicalShortage > 0 && (
                      <span className="ml-2 text-[9px] text-rose-600 dark:text-rose-400 font-semibold">
                        ▲{c.fourNumbers.physicalShortage}
                      </span>
                    )}
                  </SelectItem>
                ))}
                {filteredCategories.length === 0 && (
                  <div className="px-3 py-2 text-[10px] text-muted-foreground">
                    No categories match filter
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {!activeCat ? (
          <EmptyState
            title="Select a category"
            message="Choose a planning category above to see its 13-step demand trace."
            icon={<Calculator className="h-6 w-6" />}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {/* Category header line */}
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground">
                  {activeCat.lab} <span className="text-muted-foreground">|</span> {activeCat.shape} <span className="text-muted-foreground">|</span> {activeCat.weightBand}
                </span>
                <StatusBadge status="OPEN" className="opacity-70" />
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {activeCat.category}
              </span>
            </div>

            {/* Vertical timeline */}
            <div className="flex flex-col gap-2.5 mt-1">
              {activeCat.steps.map((s, i) => (
                <StepCard
                  key={s.step}
                  step={s}
                  isLast={i === activeCat.steps.length - 1}
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* Four requirement numbers */}
      {activeCat && (
        <Section
          title="Four Requirement Numbers"
          description="The four headline numbers required by spec section 4 — never collapsed into one. Physical Shortage is the only one that triggers procurement; the others describe different adjustment layers."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <FourNumberCard
              label="Physical Shortage"
              value={activeCat.fourNumbers.physicalShortage}
              formula="MAX(0, Target − Available)"
              icon={AlertTriangle}
              intent="critical"
            />
            <FourNumberCard
              label="Pipeline-Adjusted"
              value={activeCat.fourNumbers.pipelineAdjusted}
              formula="MAX(0, Physical Shortage − Eligible WIP)"
              icon={GitBranch}
              intent="warning"
            />
            <FourNumberCard
              label="Planning-Adjusted"
              value={activeCat.fourNumbers.planningAdjusted}
              formula="MAX(0, Pipeline − Approved Plan Coverage)"
              icon={ShieldCheck}
              intent="success"
            />
            <FourNumberCard
              label="Forecast Requirement"
              value={activeCat.fourNumbers.forecastRequirement}
              formula="PREDICTION — advisory only"
              icon={Sparkles}
              intent="info"
            />
          </div>
        </Section>
      )}

      {/* All categories table */}
      <Section
        title="All Categories"
        description="Every planning category in the latest demand run. Click a row to drill into its 13-step trace above."
        actions={
          <Badge variant="neutral" className="gap-1">
            <Layers className="h-2.5 w-2.5" />
            {rows.length} categories
          </Badge>
        }
      >
        <DataTable<RowShape>
          columns={columns}
          rows={rows}
          initialSortKey="physicalShortage"
          initialSortDir="desc"
          searchable
          searchPlaceholder="Search lab / shape / band…"
          searchFn={(r, q) =>
            `${r.lab} ${r.shape} ${r.weightBand} ${r.category}`.toLowerCase().includes(q.toLowerCase())
          }
          exportable
          exportFilename="demand-trace.csv"
          maxHeight="560px"
          onRowClick={(r) => setSelectedCat(r.category)}
          rowClassName={(r) =>
            r.category === (selectedCat ?? defaultCatId)
              ? "bg-primary/10"
              : r.physicalShortage > 0
                ? "bg-rose-50/40 dark:bg-rose-950/20"
                : ""
          }
        />
      </Section>

      {/* Methodology footnote */}
      <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-[10px] text-muted-foreground leading-relaxed">
        <div className="flex items-start gap-2">
          <Wrench className="h-3 w-3 mt-0.5 shrink-0" />
          <div>
            <span className="font-semibold">Methodology:</span>{" "}
            All values come from the <span className="font-mono">DemandMetric</span> rows of the latest{" "}
            <span className="font-mono">DemandRun</span> (rule <span className="font-mono">{ruleVersion}</span>).
            The 13 steps rebuild the calculation in the same order the backend engine persisted it —
            so the trace you see here is <span className="font-semibold">deterministic and reproducible</span>,
            not recomputed in the browser. Step 13 forecast signal is read from the live{" "}
            <span className="font-mono">ForecastPrediction</span> table where available; otherwise the stored{" "}
            <span className="font-mono">DemandMetric.forecastSignal</span> value is shown with a flagged source.
            <span className="ml-2 inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <FileWarning className="h-2.5 w-2.5" />
              OPEN rules (BR-WIP-001, BR-MEMO-001) are surfaced but never auto-applied.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
