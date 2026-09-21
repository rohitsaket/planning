"use client";

import { useMemo, useState, useEffect } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { Badge, StatusBadge } from "@/components/diamond/shared/badges";
import { EmptyState, InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { KpiGridSkeleton } from "@/components/diamond/shared/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Calculator, Layers, AlertTriangle, Package, Boxes, Target,
  ShieldCheck, GitBranch, Wrench, FileWarning, Sparkles,
  ChevronDown, ChevronUp, FileText, CheckCircle2, XCircle, Info,
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
  tone?: "shortage" | "coverage" | "advisory" | "neutral";
  contributingLotsCount?: number;
}

interface ContributingSalesLot {
  lotId: string;
  sourceRecordId?: string | null;
  docDate: string;
  saleTotalUsd?: number | null;
  customerName?: string | null;
  shape: string;
  weight: number;
  lab: string;
}

interface PhysicalStockLot {
  lotId: string;
  sourceRecordId?: string | null;
  shape: string;
  weight: number;
  color?: string | null;
  clarity?: string | null;
  locationName?: string | null;
}

interface MemoLot {
  lotId: string;
  customerName?: string | null;
  weight: number;
  docDate: string;
}

interface EligibleWipLot {
  lotId: string;
  wipStage?: string | null;
  weight: number;
  kapan?: string | null;
}

interface ExcludedLot {
  lotId: string;
  reason: string;
}

interface TraceCategory {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  sales90d: number;
  monthlyAverage: number;
  unroundedTarget: number;
  roundedTarget: number;
  availableStock: number;
  memoQty: number;
  reservedQty: number;
  blockedQty: number;
  physicalShortage: number;
  excessStock: number;
  wipCoverage: number;
  unallocatedWip: number;
  pipelineNeed: number;
  approvedPlanCoverage: number;
  remainingUnplanned: number;
  forecastSignal: number;
  steps: TraceStep[];
  traceDetails?: {
    contributingSalesLots: ContributingSalesLot[];
    physicalStockLots: PhysicalStockLot[];
    memoLots: MemoLot[];
    eligibleWipLots: EligibleWipLot[];
    excludedLots: ExcludedLot[];
  };
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
  totalTarget: number;
  totalPhysicalStock: number;
  totalMemo: number;
  totalWipCoverage: number;
  totalPipelineNeed: number;
  totalApprovedPlanCoverage: number;
  totalRemainingUnplanned: number;
  categoriesWithShortage: number;
  categoriesWithExcess: number;
}

interface DemandTraceResponse {
  hasEverRun: boolean;
  sourceMode: string;
  isSimulated: boolean;
  ruleVersion: string;
  runId: string | null;
  runDate: string | null;
  runDateIST: string | null;
  businessDateIst: string | null;
  lookbackStart: string | null;
  lookbackEnd: string | null;
  windowDays: number;
  checkpoint: number;
  lastBatchId: string | null;
  salesCount: number;
  inventoryCount: number;
  wipCount: number;
  excludedCount: number;
  forecastRunVersion: string | null;
  categories: TraceCategory[];
  summary: TraceSummary;
}

// ---------------------------------------------------------------------------
// Per-step styling palette
// ---------------------------------------------------------------------------
const TONE_STYLES: Record<
  string,
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
  neutral: {
    border: "border-border",
    dot: "bg-muted-foreground/70 text-white",
    bg: "bg-card",
    value: "text-foreground",
    label: "Input",
  },
};

const DEFAULT_TONE = TONE_STYLES.neutral;

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
  const tone = (step.tone && TONE_STYLES[step.tone]) ? TONE_STYLES[step.tone] : DEFAULT_TONE;
  return (
    <div className="relative pl-9">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[14px] top-7 bottom-0 w-px bg-border"
        />
      )}
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
              {step.tone && step.tone !== "neutral" && (
                <Badge variant={step.tone === "shortage" ? "critical" : step.tone === "coverage" ? "success" : "warning"}>
                  {tone.label}
                </Badge>
              )}
              {step.contributingLotsCount !== undefined && (
                <Badge variant="neutral" className="text-[10px]">
                  {step.contributingLotsCount} {step.contributingLotsCount === 1 ? "lot" : "lots"}
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
  const runDate = data?.runDateIST ?? fmtRunDate(data?.runDate ?? null);
  const windowDays = data?.windowDays ?? 90;
  const forecastVersion = data?.forecastRunVersion ?? null;

  const defaultCatId = useMemo(() => {
    const withShortage = categories.find((c) => c.fourNumbers.physicalShortage > 0);
    return withShortage?.category ?? categories[0]?.category ?? null;
  }, [categories]);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lotsTab, setLotsTab] = useState<"sales" | "stock" | "memo" | "wip" | "excluded">("sales");

  const [showFullRule, setShowFullRule] = useState(false);
  const [showAllSteps, setShowAllSteps] = useState(false);

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const fullRuleText = `90-day rolling invoice window (IST boundaries). Monthly Average = 90D/3. Target = Monthly Avg × 2 (round-half-up). Shortage = MAX(0, Target − Physical Stock). Memo excluded per BR-MEMO-001. WIP contribution is OPEN (BR-WIP-001). Forecast signal is advisory only — NOT confirmed demand.`;
  const shortRuleText = `${fullRuleText.split(".")[0]}.`;

  const activeCat =
    categories.find((c) => c.category === (selectedCat ?? defaultCatId)) ?? null;

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
          message="Trigger a demand calculation from the Demand Overview or Executive Dashboard to populate the trace."
          icon={<Calculator className="h-8 w-8" />}
        />
      </div>
    );
  }

  const contributingSales = activeCat?.traceDetails?.contributingSalesLots ?? [];
  const physicalStock = activeCat?.traceDetails?.physicalStockLots ?? [];
  const memoStock = activeCat?.traceDetails?.memoLots ?? [];
  const wipStock = activeCat?.traceDetails?.eligibleWipLots ?? [];
  const excludedLots = activeCat?.traceDetails?.excludedLots ?? [];

  return (
    <div className="flex flex-col gap-3 p-3">
      {/* Simulation Watermark & Snapshot Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border bg-card text-xs flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={data.isSimulated ? "warning" : "success"}>
            {data.isSimulated ? "Simulated Mode" : "Live Mode"}
          </Badge>
          <span className="font-semibold text-foreground">Checkpoint #{data.checkpoint}</span>
          {data.businessDateIst && (
            <span className="text-muted-foreground text-[11px]">
              IST Business Date: <strong className="text-foreground">{data.businessDateIst}</strong>
            </span>
          )}
          {data.lastBatchId && (
            <span className="text-muted-foreground text-[11px] font-mono">
              Batch: {data.lastBatchId}
            </span>
          )}
          {data.runId && (
            <span className="text-muted-foreground text-[11px] font-mono">
              Run: {data.runId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="info">Rule {ruleVersion}</Badge>
          <Badge variant="neutral">{windowDays}d IST Window</Badge>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {runDate}
          </span>
        </div>
      </div>

      <PageHeader
        title="Demand Calculation Trace"
        subtitle="Full provenance & step-by-step breakdown: confirmed sales, finished stock, memo, WIP, formulas & lot reconciliations"
      />

      {/* Confirmed-rule banner */}
      <InfoBanner variant="info">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">CONFIRMED rule {ruleVersion}.</span>
          <span className="md:hidden">
            {showFullRule ? fullRuleText : shortRuleText}{" "}
            <button
              type="button"
              onClick={() => setShowFullRule(!showFullRule)}
              className="text-sky-600 dark:text-sky-400 underline underline-offset-2 ml-1 text-[10px] font-medium hover:text-sky-700 dark:hover:text-sky-300"
            >
              {showFullRule ? "Show less" : "Show more"}
            </button>
          </span>
          <span className="hidden md:inline">{fullRuleText}</span>
        </div>
      </InfoBanner>

      {/* Summary KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
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
          <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter categories…"
              className="h-8 w-full sm:w-[160px] text-xs"
            />
            <Select
              value={activeCat?.category ?? ""}
              onValueChange={setSelectedCat}
            >
              <SelectTrigger size="sm" className="h-8 w-full sm:w-[280px] text-xs">
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
              {(isDesktop || showAllSteps ? activeCat.steps : activeCat.steps.slice(0, 4)).map((s, i, arr) => (
                <StepCard
                  key={s.step}
                  step={s}
                  isLast={i === arr.length - 1 && (isDesktop || showAllSteps)}
                />
              ))}
            </div>

            {!isDesktop && activeCat.steps.length > 4 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAllSteps(!showAllSteps)}
                className="self-start mt-1 h-8 text-xs"
              >
                {showAllSteps ? (
                  <>
                    Show less <ChevronUp className="h-3 w-3 ml-1" />
                  </>
                ) : (
                  <>
                    Show all {activeCat.steps.length} steps <ChevronDown className="h-3 w-3 ml-1" />
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </Section>

      {/* Four requirement numbers */}
      {activeCat && (
        <Section
          title="Four Requirement Numbers"
          description="The four headline numbers required by spec section 4 — never collapsed into one. Physical Shortage is the only one that triggers procurement; the others describe different adjustment layers."
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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

      {/* Category Contributing Lots Drawer / Section */}
      {activeCat && (
        <Section
          title={`Contributing Inventory & Sales Lots (${activeCat.lab} · ${activeCat.shape} · ${activeCat.weightBand})`}
          description="Direct provenance and lot-level reconciliation for this category's demand, stock, memo, WIP, and exclusions."
          actions={
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                size="sm"
                variant={lotsTab === "sales" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setLotsTab("sales")}
              >
                Sales Lots ({contributingSales.length})
              </Button>
              <Button
                size="sm"
                variant={lotsTab === "stock" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setLotsTab("stock")}
              >
                Stock Lots ({physicalStock.length})
              </Button>
              <Button
                size="sm"
                variant={lotsTab === "memo" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setLotsTab("memo")}
              >
                Memo Lots ({memoStock.length})
              </Button>
              <Button
                size="sm"
                variant={lotsTab === "wip" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setLotsTab("wip")}
              >
                WIP Lots ({wipStock.length})
              </Button>
              <Button
                size="sm"
                variant={lotsTab === "excluded" ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setLotsTab("excluded")}
              >
                Excluded ({excludedLots.length})
              </Button>
            </div>
          }
        >
          {lotsTab === "sales" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Confirmed sale events in the 90-day IST window that contribute to <strong>Sales90d = {activeCat.sales90d}</strong>.
              </div>
              {contributingSales.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No confirmed sales in this 90-day window.</div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-[11px] uppercase border-b sticky top-0">
                      <tr>
                        <th className="p-2">Lot ID</th>
                        <th className="p-2">Doc Date</th>
                        <th className="p-2">Customer</th>
                        <th className="p-2 text-right">Carats</th>
                        <th className="p-2 text-right">USD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {contributingSales.map((s, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2 font-mono font-medium">{s.lotId}</td>
                          <td className="p-2">{s.docDate ? new Date(s.docDate).toLocaleDateString() : "—"}</td>
                          <td className="p-2">{s.customerName || "—"}</td>
                          <td className="p-2 text-right">{s.weight.toFixed(2)}</td>
                          <td className="p-2 text-right">{s.saleTotalUsd ? `$${s.saleTotalUsd.toLocaleString()}` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {lotsTab === "stock" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Current finished polished stock contributing to <strong>PhysicalAvailable = {activeCat.availableStock}</strong>.
              </div>
              {physicalStock.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No physical stock currently available in this category.</div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-[11px] uppercase border-b sticky top-0">
                      <tr>
                        <th className="p-2">Lot ID</th>
                        <th className="p-2">Color / Clarity</th>
                        <th className="p-2">Location</th>
                        <th className="p-2 text-right">Carats</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {physicalStock.map((s, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2 font-mono font-medium">{s.lotId}</td>
                          <td className="p-2">{s.color || "—"} / {s.clarity || "—"}</td>
                          <td className="p-2">{s.locationName || "Main Vault"}</td>
                          <td className="p-2 text-right">{s.weight.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {lotsTab === "memo" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Active memo consignments: <strong>{activeCat.memoQty} pcs</strong>. <span className="text-amber-600 dark:text-amber-400 font-medium">Notice: Memo stock is NOT deducted from physical shortage.</span>
              </div>
              {memoStock.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No active memo consignments in this category.</div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-[11px] uppercase border-b sticky top-0">
                      <tr>
                        <th className="p-2">Lot ID</th>
                        <th className="p-2">Customer</th>
                        <th className="p-2">Memo Date</th>
                        <th className="p-2 text-right">Carats</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {memoStock.map((m, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2 font-mono font-medium">{m.lotId}</td>
                          <td className="p-2">{m.customerName || "—"}</td>
                          <td className="p-2">{m.docDate ? new Date(m.docDate).toLocaleDateString() : "—"}</td>
                          <td className="p-2 text-right">{m.weight.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {lotsTab === "wip" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Manufacturing WIP lots matching this planning category: <strong>{activeCat.wipCoverage} pcs</strong>.
              </div>
              {wipStock.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No manufacturing WIP currently active for this category.</div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-[11px] uppercase border-b sticky top-0">
                      <tr>
                        <th className="p-2">Lot ID</th>
                        <th className="p-2">Stage</th>
                        <th className="p-2">Kapan</th>
                        <th className="p-2 text-right">Carats</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {wipStock.map((w, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2 font-mono font-medium">{w.lotId}</td>
                          <td className="p-2">{w.wipStage || "POLISHING"}</td>
                          <td className="p-2">{w.kapan || "—"}</td>
                          <td className="p-2 text-right">{w.weight.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {lotsTab === "excluded" && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Records excluded from automated calculation due to missing mappings, unknown disappearance, or data quality flags.
              </div>
              {excludedLots.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">No excluded lots for this category.</div>
              ) : (
                <div className="max-h-60 overflow-y-auto rounded border">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 text-[11px] uppercase border-b sticky top-0">
                      <tr>
                        <th className="p-2">Lot ID</th>
                        <th className="p-2">Exclusion Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {excludedLots.map((e, idx) => (
                        <tr key={idx} className="hover:bg-muted/30">
                          <td className="p-2 font-mono font-medium">{e.lotId}</td>
                          <td className="p-2 text-rose-600 dark:text-rose-400 font-medium">{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
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
