"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api-client";
import { KpiCard } from "@/components/diamond/shared/kpi-card";
import { Section, PageHeader } from "@/components/diamond/shared/page-header";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { StatusBadge, Badge } from "@/components/diamond/shared/badges";
import { NumberCell, InfoBanner, EmptyState } from "@/components/diamond/shared/empty-state";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend,
} from "recharts";
import {
  ArrowLeftRight, ArrowRight, Package, AlertTriangle, Layers, Scale, Boxes, Sparkles,
} from "lucide-react";

interface Candidate {
  category: string;
  lab: string;
  shape: string;
  weightBand: string;
  fromCountry: string;
  sourceExcess: number;
  toCountry: string;
  destinationShortage: number;
  transferQty: number;
  potentialCoveragePct: number;
}

interface Summary {
  /** null when the analysis could not run — never rendered as zero. */
  candidateCount: number | null;
  totalTransferQty: number;
  countriesWithExcess: number;
  countriesWithShortage: number;
  categoriesAnalyzed: number;
}

interface CountryBalanceRow {
  country: string;
  totalExcess: number;
  totalShortage: number;
  netBalance: number;
  categories: number;
}

interface TransferCandidatesResponse {
  status: 'ADVISORY_UNCONFIRMED' | 'ADVISORY_CONFIRMED_RULE' | 'UNAVAILABLE';
  ruleId: string;
  ruleStatus: string | null;
  advisoryNotice: string;
  autoExecuted: boolean;
  summary: Summary;
  wipPolicy: { status: string; message: string };
  wipCoverageUnavailable: boolean;
  countryBalance: CountryBalanceRow[];
  rows: Candidate[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

function coverageIntent(pct: number): "critical" | "warning" | "success" {
  if (pct >= 80) return "success";
  if (pct >= 40) return "warning";
  return "critical";
}

function coverageBadge(pct: number) {
  if (pct >= 80) return <Badge variant="success">HIGH COVERAGE</Badge>;
  if (pct >= 40) return <Badge variant="warning">MEDIUM COVERAGE</Badge>;
  return <Badge variant="critical">LOW COVERAGE</Badge>;
}

export function TransferAnalyzerView() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useApi<TransferCandidatesResponse>(
    `/api/analysis/transfer-candidates?page=${page}&pageSize=50`,
  );

  const candidates = data?.rows ?? [];
  const summary = data?.summary;
  const countryBalance = data?.countryBalance ?? [];

  // Mobile advisory banner — Show more / Show less toggle (mirrors demand-trace-view pattern)
  const [showFullAdvisory, setShowFullAdvisory] = useState(false);
  const fullAdvisoryText =
    data?.advisoryNotice ??
    "Cross-country transfer eligibility is not client-confirmed. Candidates are advisory and no transfer is created or executed.";
  const shortAdvisoryText = `${fullAdvisoryText.split(".")[0]}.`;

  // Chart data: top 12 categories by transferQty, with from/to split
  const chartData = useMemo(() => {
    return candidates
      .slice(0, 12)
      .map((c) => ({
        name: `${c.fromCountry}→${c.toCountry}`,
        label: `${c.shape} ${c.weightBand}`.slice(0, 22),
        excess: c.sourceExcess,
        shortage: c.destinationShortage,
        transfer: c.transferQty,
      }));
  }, [candidates]);

  const columns: Column<Candidate>[] = [
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (r) => r.category,
      sticky: "left",
      width: "220px",
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-xs">{r.shape}</span>
          <span className="text-[10px] text-muted-foreground">
            {r.lab} · {r.weightBand}
          </span>
        </div>
      ),
    },
    {
      key: "fromCountry",
      header: "From",
      sortable: true,
      sortValue: (r) => r.fromCountry,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{r.fromCountry}</span>
          <span className="text-[10px] text-muted-foreground">excess {r.sourceExcess}</span>
        </div>
      ),
    },
    {
      key: "sourceExcess",
      header: "Excess",
      sortable: true,
      sortValue: (r) => r.sourceExcess,
      align: "right",
      cell: (r) => <NumberCell value={r.sourceExcess} intent="success" />,
    },
    {
      key: "toCountry",
      header: "To",
      sortable: true,
      sortValue: (r) => r.toCountry,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-rose-700 dark:text-rose-400">{r.toCountry}</span>
          <span className="text-[10px] text-muted-foreground">shortage {r.destinationShortage}</span>
        </div>
      ),
    },
    {
      key: "destinationShortage",
      header: "Shortage",
      sortable: true,
      sortValue: (r) => r.destinationShortage,
      align: "right",
      cell: (r) => <NumberCell value={r.destinationShortage} intent="critical" />,
    },
    {
      key: "transferQty",
      header: "Transfer Qty",
      sortable: true,
      sortValue: (r) => r.transferQty,
      align: "right",
      cell: (r) => (
        <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          {r.transferQty}
        </span>
      ),
    },
    {
      key: "potentialCoveragePct",
      header: "Coverage %",
      sortable: true,
      sortValue: (r) => r.potentialCoveragePct,
      align: "right",
      cell: (r) => (
        <div className="inline-flex flex-col items-end gap-1">
          <NumberCell
            value={r.potentialCoveragePct}
            intent={coverageIntent(r.potentialCoveragePct)}
            decimals={1}
          />
          <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={
                "h-full rounded-full " +
                (r.potentialCoveragePct >= 80
                  ? "bg-emerald-500"
                  : r.potentialCoveragePct >= 40
                  ? "bg-amber-500"
                  : "bg-rose-500")
              }
              style={{ width: `${Math.min(100, r.potentialCoveragePct)}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => coverageBadge(r.potentialCoveragePct),
      align: "center",
    },
  ];

  const balanceColumns: Column<CountryBalanceRow>[] = [
    {
      key: "country",
      header: "Country",
      sortable: true,
      sortValue: (r) => r.country,
      sticky: "left",
      cell: (r) => <span className="font-medium">{r.country}</span>,
    },
    {
      key: "totalExcess",
      header: "Total Excess",
      sortable: true,
      sortValue: (r) => r.totalExcess,
      align: "right",
      cell: (r) => <NumberCell value={r.totalExcess} intent="success" />,
    },
    {
      key: "totalShortage",
      header: "Total Shortage",
      sortable: true,
      sortValue: (r) => r.totalShortage,
      align: "right",
      cell: (r) => <NumberCell value={r.totalShortage} intent="critical" />,
    },
    {
      key: "netBalance",
      header: "Net Balance",
      sortable: true,
      sortValue: (r) => r.netBalance,
      align: "right",
      cell: (r) => (
        <NumberCell
          value={r.netBalance}
          intent={
            r.netBalance > 0
              ? "success"
              : r.netBalance < 0
              ? "critical"
              : "default"
          }
        />
      ),
    },
    {
      key: "position",
      header: "Position",
      cell: (r) => {
        if (r.netBalance > 0)
          return (
            <Badge variant="success">
              <ArrowRight className="h-2.5 w-2.5" /> Donor
            </Badge>
          );
        if (r.netBalance < 0)
          return (
            <Badge variant="critical">
              <ArrowRight className="h-2.5 w-2.5" /> Receiver
            </Badge>
          );
        return <Badge variant="neutral">Balanced</Badge>;
      },
      align: "center",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Transfer Candidate Analyzer"
        subtitle="Advisory cross-country transfer candidates matched inside one exact category (Lab + Shape + Weight Band)"
        meta={
          <span className="text-[10px] text-muted-foreground">
            {data?.ruleId ?? "BR-TRANSFER-001"} · Source: shared country position service (requirements, polished stock, classified WIP, approved plans)
          </span>
        }
      />

      {/* Advisory banner — collapsible on mobile, full text on desktop */}
      <InfoBanner variant="warning">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">
            Advisory transfer candidates — {data?.ruleId ?? "BR-TRANSFER-001"} is {data?.ruleStatus ?? "not defined"}. No transfer is executed.
          </span>
          {/* Mobile: short text + Show more/less toggle */}
          <span className="md:hidden">
            {showFullAdvisory ? fullAdvisoryText : shortAdvisoryText}{" "}
            <button
              type="button"
              onClick={() => setShowFullAdvisory(!showFullAdvisory)}
              className="text-sky-600 dark:text-sky-400 underline underline-offset-2 ml-1 text-[10px] font-medium hover:text-sky-700 dark:hover:text-sky-300"
            >
              {showFullAdvisory ? "Show less" : "Show more"}
            </button>
          </span>
          {/* Desktop: always show full text */}
          <span className="hidden md:inline">{fullAdvisoryText}</span>
        </div>
      </InfoBanner>

      {/* Summary KPI grid — single column on phones */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2">
        <KpiCard
          label="Total Candidates"
          value={summary?.candidateCount === null || summary?.candidateCount === undefined ? "UNAVAILABLE" : summary.candidateCount}
          unit={summary?.candidateCount === null || summary?.candidateCount === undefined ? undefined : "pairs"}
          intent={summary?.candidateCount === null ? "warning" : "info"}
          hint="Real From→To matches inside one exact category"
          icon={ArrowLeftRight}
        />
        <KpiCard
          label="Transfer Qty"
          value={summary?.totalTransferQty ?? 0}
          unit="pcs"
          intent="success"
          hint="Σ min(excess, shortage)"
          icon={Package}
        />
        <KpiCard
          label="Categories Analyzed"
          value={summary?.categoriesAnalyzed ?? 0}
          unit="cats"
          intent="info"
          hint="Country + Lab + Shape + Weight Band positions compared"
          icon={Sparkles}
        />
        <KpiCard
          label="Countries w/ Excess"
          value={summary?.countriesWithExcess ?? 0}
          unit="donors"
          intent="success"
          hint="Distinct source countries"
          icon={Layers}
        />
        <KpiCard
          label="Countries w/ Shortage"
          value={summary?.countriesWithShortage ?? 0}
          unit="receivers"
          intent="critical"
          hint="Distinct destination countries"
          icon={AlertTriangle}
        />
      </div>

      {/* Transfer flow chart — excess vs shortage per candidate pair */}
      <Section
        title="Transfer Flow — Excess vs Shortage"
        description="Top 12 candidate pairs. Emerald = donor excess, rose = receiver shortage. Bars are grouped per pair."
      >
        {chartData.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="h-8 w-8" />}
            title="No transfer candidates"
            message="No category currently has both an excess country and a shortage country."
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="h-80 min-w-[600px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 16, bottom: 4, left: 0 }}
                >
                <defs>
                  <linearGradient id="excessGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.45} />
                  </linearGradient>
                  <linearGradient id="shortageGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 10 }}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                  formatter={(value: number, name: string) => [value, name]}
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload as { label?: string } | undefined;
                    return p?.label ? `${label} (${p.label})` : label;
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar
                  dataKey="excess"
                  name="Donor Excess"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  dataKey="shortage"
                  name="Receiver Shortage"
                  fill="#f43f5e"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        )}
      </Section>

      {/* Candidates table */}
      <Section
        title="Transfer Candidates"
        description="Sortable list of potential from→to transfers. Coverage color: ≥80% emerald, ≥40% amber, <40% rose."
      >
        <DataTable<Candidate>
          columns={columns}
          rows={candidates}
          loading={isLoading}
          emptyMessage="No transfer candidates — either no cross-country imbalance, or excess/shortage overlap is zero."
          initialSortKey="potentialCoveragePct"
          initialSortDir="desc"
          exportable
          exportPermission="analysis.export"
          exportFilename="transfer-candidates.csv"
          excelExportable
          excelExportFilename="transfer-candidates.xlsx"
          searchable
          searchPlaceholder="Search category, country, lab..."
          searchFn={(r, q) => {
            const lq = q.toLowerCase();
            return (
              r.category.toLowerCase().includes(lq) ||
              r.fromCountry.toLowerCase().includes(lq) ||
              r.toCountry.toLowerCase().includes(lq) ||
              r.lab.toLowerCase().includes(lq) ||
              r.shape.toLowerCase().includes(lq) ||
              r.weightBand.toLowerCase().includes(lq)
            );
          }}
          exportScope="current-page"
          maxHeight="560px"
        />
        <ServerPagination
          page={data?.page ?? 1}
          pageSize={data?.pageSize ?? 50}
          total={data?.total ?? 0}
          hasMore={data?.hasMore ?? false}
          onPageChange={setPage}
          loading={isLoading}
          label="candidate pairs"
        />
      </Section>

      {/* Country balance */}
      <Section
        title="Country Balance"
        description="Per-country total excess, shortage, and net position. Positive net = net donor, negative = net receiver."
        actions={
          <StatusBadge status="TRANSFER" className="text-[10px]" />
        }
      >
        <DataTable<CountryBalanceRow>
          columns={balanceColumns}
          rows={countryBalance}
          loading={isLoading}
          emptyMessage="No country balance to display."
          initialSortKey="netBalance"
          initialSortDir="desc"
          exportable
          exportPermission="analysis.export"
          exportFilename="country-balance.csv"
          excelExportable
          excelExportFilename="country-balance.xlsx"
          maxHeight="360px"
        />
      </Section>

      <InfoBanner variant="info">
        <div className="flex items-start gap-2">
          <Scale className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Methodology: positions are computed per exact category (Country + Lab +
            Shape + Weight Band) by the shared stock-position service. <strong>Excess</strong> =
            max(0, available − target); <strong>shortage</strong> = remaining unplanned
            requirement after eligible WIP and approved plan coverage. Within one category a
            receiver is matched against donors largest-first and{" "}
            <strong>transferQty = min(source excess, destination shortage)</strong>, with each
            donor's excess consumed only once. Polished counts are restricted to{" "}
            <code>PHYSICAL</code> and <code>PLANNING_AVAILABLE</code>; same-country pairs and
            unbanded stock are excluded.
          </span>
        </div>
      </InfoBanner>

      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Boxes className="h-3 w-3" />
        Displayed separately from confirmed manufacturing requirement. Rule{" "}
        {data?.ruleId ?? "BR-TRANSFER-001"} is {data?.ruleStatus ?? "not defined"}; candidates stay advisory
        and never create a transfer, requirement or reservation.
      </div>
    </div>
  );
}
