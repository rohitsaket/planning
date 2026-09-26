"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, BarChart3, Globe, TrendingUp } from "lucide-react";
import { useApi } from "@/lib/api-client";
import { PageHeader, Section } from "@/components/diamond/shared/page-header";
import { DataTable, Column, DATA_TABLE_VIEWPORT_MAX_HEIGHT } from "@/components/diamond/shared/data-table";
import { ServerPagination } from "@/components/diamond/shared/server-pagination";
import { InfoBanner, NumberCell } from "@/components/diamond/shared/empty-state";
import { Badge } from "@/components/diamond/shared/badges";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/stores/auth-store";
import { useNavStore } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import {
  CONTRIBUTION_LABELS,
  MOVEMENT_SORT_KEYS,
  NOT_COMPARABLE_LABEL,
  SALES_DATA_STATE_LABELS,
  TREND_INTERVALS,
  TREND_INTERVAL_LABELS,
  contributionsAllowed,
  type ContributionDimension,
  type ContributionRow,
  type MovementRow,
  type MovementSortKey,
  type PagingMeta,
  type SalesDataState,
  type SortDirection,
  type TrendInterval,
  type TrendPeriodRow,
} from "@/lib/analytics/sales-history-contract";
import { SalesFilterBar } from "@/components/diamond/views/sales/sales-filter-bar";
import { SortControls } from "@/components/diamond/views/sales/sort-controls";
import { salesUrl, useSalesQuery } from "@/components/diamond/views/sales/use-sales-query";
import { useServerPage } from "@/components/diamond/views/sales/use-server-page";

interface TrendResponse {
  interval: TrendInterval;
  rows: TrendPeriodRow[];
  available: boolean;
  snapshotId: string | null;
}

interface MovementResponse {
  rows: MovementRow[];
  paging: PagingMeta;
  available: boolean;
}

interface ContributionResponse {
  dimension: ContributionDimension;
  rows: ContributionRow[];
  paging: PagingMeta;
}

const MOVEMENT_SORT_LABELS: Record<MovementSortKey, string> = {
  category: "Category",
  absoluteChange: "Absolute change",
  latest30: "Latest 30D quantity",
  previous30: "Previous 30D quantity",
  total90: "Confirmed quantity",
};

const DATA_STATE_VARIANT: Record<SalesDataState, React.ComponentProps<typeof Badge>["variant"]> = {
  CONFIRMED: "success",
  REVIEW_REQUIRED: "warning",
  INSUFFICIENT_HISTORY: "neutral",
};

const PAGE_SIZE = 25;

function PeriodTooltip({ active, payload }: { active?: boolean; payload?: { payload: TrendPeriodRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="font-medium">{d.periodStart} → {d.periodEnd}</p>
      <p className="tabular-nums">Confirmed quantity: {d.confirmedQuantity}</p>
      <p className="tabular-nums text-muted-foreground">Weight: {d.confirmedWeight.toFixed(2)} ct · Records: {d.recordCount}</p>
    </div>
  );
}

/**
 * Sales Trends — how confirmed sales activity changed, described factually.
 *
 * Every figure is a count of something that already happened. There is no forecast, no
 * predicted demand, no reorder quantity and no manufacturing priority anywhere on this
 * tab, and a percentage change is shown only where the earlier window gives a valid
 * denominator.
 */
export function SalesTrendsView() {
  const { params } = useSalesQuery();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const setView = useNavStore((s) => s.setView);
  const allowedContributions = useMemo(() => contributionsAllowed(permissions), [permissions]);

  const [activeTab, setActiveTab] = useState<"period" | "movement" | "contribution">("period");
  const [interval, setInterval] = useState<TrendInterval>("window30");
  const [movementSort, setMovementSort] = useState<{ key: MovementSortKey; dir: SortDirection }>({ key: "absoluteChange", dir: "desc" });
  const [chosenDimension, setDimension] = useState<ContributionDimension>("country");
  // A role change can remove customers.read while Customer is selected. The effective
  // dimension falls back rather than keep issuing a request the server will refuse.
  const dimension = allowedContributions.includes(chosenDimension) ? chosenDimension : "country";

  const query = params.toString();
  const [movementPage, setMovementPage] = useServerPage(`${query}|${movementSort.key}|${movementSort.dir}`);
  const [contributionPage, setContributionPage] = useServerPage(`${query}|${dimension}`);

  const trend = useApi<TrendResponse>(useMemo(() => salesUrl("/api/analysis/sales/trend", params, { interval }), [params, interval]));
  const movement = useApi<MovementResponse>(
    useMemo(
      () => salesUrl("/api/analysis/sales/movement", params, { sortKey: movementSort.key, sortDir: movementSort.dir, page: movementPage, pageSize: PAGE_SIZE }),
      [params, movementSort.key, movementSort.dir, movementPage],
    ),
  );
  const contribution = useApi<ContributionResponse>(
    useMemo(
      () => salesUrl("/api/analysis/sales/contribution", params, { dimension, page: contributionPage, pageSize: PAGE_SIZE }),
      [params, dimension, contributionPage],
    ),
  );

  const trendRows = trend.data?.rows ?? [];

  const trendColumns: Column<TrendPeriodRow>[] = [
    { key: "periodStart", header: "Period (IST)", sticky: "left", cell: (r) => <span className="font-medium">{r.periodStart} → {r.periodEnd}</span> },
    { key: "confirmedQuantity", header: "Confirmed Qty", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} intent="success" /> },
    { key: "confirmedWeight", header: "Confirmed Weight (ct)", align: "right", cell: (r) => <NumberCell value={r.confirmedWeight} decimals={2} /> },
    { key: "recordCount", header: "Qualifying Records", align: "right", cell: (r) => <NumberCell value={r.recordCount} /> },
    { key: "distinctCategories", header: "Categories", align: "right", cell: (r) => <NumberCell value={r.distinctCategories} /> },
  ];

  const movementColumns: Column<MovementRow>[] = [
    { key: "categoryId", header: "Category", sticky: "left", cell: (r) => <span className="font-medium">{r.categoryId}</span> },
    { key: "previous30Quantity", header: "Prev 30D", align: "right", cell: (r) => <NumberCell value={r.previous30Quantity} /> },
    { key: "middle30Quantity", header: "Mid 30D", align: "right", cell: (r) => <NumberCell value={r.middle30Quantity} /> },
    { key: "latest30Quantity", header: "Latest 30D", align: "right", cell: (r) => <NumberCell value={r.latest30Quantity} intent="info" /> },
    {
      key: "absoluteChange", header: "Absolute Change", align: "right",
      cell: (r) => (
        <span className={r.absoluteChange > 0 ? "tabular-nums text-emerald-600 dark:text-emerald-400" : r.absoluteChange < 0 ? "tabular-nums text-rose-600 dark:text-rose-400" : "tabular-nums text-muted-foreground"}>
          {r.absoluteChange > 0 ? "+" : ""}{r.absoluteChange}
        </span>
      ),
    },
    {
      key: "percentChange", header: "% Change", align: "right",
      // A zero earlier window has no denominator. The cell says so rather than showing a
      // number that would read as a real rate of change.
      cell: (r) =>
        r.percentChange === null
          ? <span className="text-[10px] text-muted-foreground">{NOT_COMPARABLE_LABEL}</span>
          : <span className="tabular-nums">{r.percentChange > 0 ? "+" : ""}{r.percentChange.toFixed(1)}%</span>,
      exportValue: (r) => (r.percentChange === null ? NOT_COMPARABLE_LABEL : r.percentChange),
    },
    { key: "trend", header: "Trend", align: "center", cell: (r) => <Badge variant="default">{r.trend}</Badge> },
    {
      key: "dataState", header: "Data State", align: "center",
      cell: (r) => <Badge variant={DATA_STATE_VARIANT[r.dataState]}>{SALES_DATA_STATE_LABELS[r.dataState]}</Badge>,
    },
  ];

  const contributionColumns: Column<ContributionRow>[] = [
    { key: "label", header: CONTRIBUTION_LABELS[dimension], sticky: "left", cell: (r) => <span className="font-medium">{r.label}</span> },
    { key: "confirmedQuantity", header: "Confirmed Qty", align: "right", cell: (r) => <NumberCell value={r.confirmedQuantity} intent="success" /> },
    { key: "confirmedWeight", header: "Confirmed Weight (ct)", align: "right", cell: (r) => <NumberCell value={r.confirmedWeight} decimals={2} /> },
    { key: "recordCount", header: "Qualifying Records", align: "right", cell: (r) => <NumberCell value={r.recordCount} /> },
    { key: "latestSaleDate", header: "Latest Sale (IST)", cell: (r) => r.latestSaleDate ?? "—" },
  ];

  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader
        title="Sales Trends"
        subtitle="Factual movement of confirmed sales between periods — a description of the past, never a forecast"
        meta={<SalesFilterBar />}
      />

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border bg-card/80 p-1 rounded-xl shadow-2xs">
        <button
          type="button"
          onClick={() => setActiveTab("period")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
            activeTab === "period"
              ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
          )}
        >
          <BarChart3 className={cn("h-3.5 w-3.5", activeTab === "period" ? "text-[#F9733E]" : "text-muted-foreground")} />
          <span>Period Trend</span>
          {trendRows.length > 0 && (
            <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", activeTab === "period" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
              {trendRows.length}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("movement")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
            activeTab === "movement"
              ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
          )}
        >
          <TrendingUp className={cn("h-3.5 w-3.5", activeTab === "movement" ? "text-[#F9733E]" : "text-muted-foreground")} />
          <span>Shape & Category Movement</span>
          {movement.data?.paging.total !== undefined && (
            <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", activeTab === "movement" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
              {movement.data.paging.total}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("contribution")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
            activeTab === "contribution"
              ? "bg-[#FFE2D1] text-[#18181B] dark:bg-[#272322] dark:text-[#FFEDD5] font-bold shadow-2xs border border-[#F5DCD0]/70 dark:border-[#3A302A]"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
          )}
        >
          <Globe className={cn("h-3.5 w-3.5", activeTab === "contribution" ? "text-[#F9733E]" : "text-muted-foreground")} />
          <span>Contribution Breakdown</span>
          {contribution.data?.paging.total !== undefined && (
            <span className={cn("px-1.5 py-0.2 rounded-full text-[10px]", activeTab === "contribution" ? "bg-[#18181B]/15 text-[#18181B] dark:bg-white/20 dark:text-white" : "bg-muted text-muted-foreground")}>
              {contribution.data.paging.total}
            </span>
          )}
        </button>
      </div>

      {activeTab === "period" && (
        <Section
          title="Period Trend"
          description="Confirmed sales per period. The chart plots exactly the rows in the table below; no second series is computed."
          actions={
            <Select value={interval} onValueChange={(v) => setInterval(v as TrendInterval)}>
              <SelectTrigger size="sm" className="h-8 w-[150px] text-xs" aria-label="Trend interval">
                <SelectValue placeholder="Interval" />
              </SelectTrigger>
              <SelectContent>
                {TREND_INTERVALS.map((i) => (
                  <SelectItem key={i} value={i} className="text-xs">{TREND_INTERVAL_LABELS[i]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          bodyClassName="p-0"
        >
          {trend.error && <div className="p-3"><InfoBanner variant="critical">The period trend could not be loaded. {trend.error.message}</InfoBanner></div>}
          {trend.data && !trend.data.available && (
            <div className="p-3">
              <InfoBanner variant="warning">
                {trend.data.snapshotId
                  ? "The 30-day interval needs a snapshot calculated over the approved 90-day window. Choose Day or Week, or run the demand calculation over 90 days."
                  : "No authoritative sales snapshot has completed, so there is no period trend to show."}
              </InfoBanner>
            </div>
          )}
          {trendRows.length > 0 && (
            <div className="h-56 px-3 pt-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendRows} margin={{ top: 4, right: 8, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis dataKey="periodEnd" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<PeriodTooltip />} />
                  <Bar dataKey="confirmedQuantity" name="Confirmed quantity" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <DataTable<TrendPeriodRow>
            columns={trendColumns}
            rows={trendRows}
            loading={trend.isLoading}
            emptyMessage="No confirmed sales in this snapshot for the selected filters."
            maxHeight={DATA_TABLE_VIEWPORT_MAX_HEIGHT}
            enableColumnValueFilter={false}
          />
        </Section>
      )}

      {activeTab === "movement" && (
        <Section
          title="Shape and Category Movement"
          description="Change between the three approved 30-day windows. Movement is a factual comparison, not a manufacturing priority."
          actions={<SortControls keys={MOVEMENT_SORT_KEYS} labels={MOVEMENT_SORT_LABELS} value={movementSort} onChange={setMovementSort} label="Sort the movement table" />}
          bodyClassName="p-0"
        >
          {movement.error && <div className="p-3"><InfoBanner variant="critical">Movement could not be loaded. {movement.error.message}</InfoBanner></div>}
          {movement.data && !movement.data.available && (
            <div className="p-3">
              <InfoBanner variant="warning">
                The three 30-day windows are defined only for a snapshot calculated over the approved 90-day window, so no
                movement can be reported for the current snapshot.
              </InfoBanner>
            </div>
          )}
          <DataTable<MovementRow>
            columns={movementColumns}
            rows={movement.data?.rows ?? []}
            loading={movement.isLoading}
            emptyMessage="No confirmed sales match these filters."
            maxHeight={DATA_TABLE_VIEWPORT_MAX_HEIGHT}
            enableColumnValueFilter={false}
          />
          <ServerPagination
            page={movement.data?.paging.page ?? 1}
            pageSize={movement.data?.paging.pageSize ?? PAGE_SIZE}
            total={movement.data?.paging.total ?? 0}
            hasMore={movement.data?.paging.hasMore ?? false}
            onPageChange={setMovementPage}
            loading={movement.isLoading}
            label="categories"
          />
        </Section>
      )}

      {activeTab === "contribution" && (
        <Section
          title="Customer and Location Contribution"
          description="Who and where the confirmed sales came from. Per-customer detail lives on Customers & Orders and is not duplicated here."
          actions={
            <div className="flex items-center gap-2">
              <Select value={dimension} onValueChange={(v) => setDimension(v as ContributionDimension)}>
                <SelectTrigger size="sm" className="h-8 w-[130px] text-xs" aria-label="Contribution dimension">
                  <SelectValue placeholder="Group by" />
                </SelectTrigger>
                <SelectContent>
                  {allowedContributions.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">{CONTRIBUTION_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8 px-2 text-[11px] gap-1" onClick={() => setView("analysis-customers-orders")}>
                Customers & Orders <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          }
          bodyClassName="p-0"
        >
          {contribution.error && <div className="p-3"><InfoBanner variant="critical">Contribution could not be loaded. {contribution.error.message}</InfoBanner></div>}
          <DataTable<ContributionRow>
            columns={contributionColumns}
            rows={contribution.data?.rows ?? []}
            loading={contribution.isLoading}
            emptyMessage="No confirmed sales match these filters."
            maxHeight={DATA_TABLE_VIEWPORT_MAX_HEIGHT}
            enableColumnValueFilter={false}
          />
          <ServerPagination
            page={contribution.data?.paging.page ?? 1}
            pageSize={contribution.data?.paging.pageSize ?? PAGE_SIZE}
            total={contribution.data?.paging.total ?? 0}
            hasMore={contribution.data?.paging.hasMore ?? false}
            onPageChange={setContributionPage}
            loading={contribution.isLoading}
            label={dimension === "customer" ? "customers" : dimension === "country" ? "countries" : "branches"}
          />
        </Section>
      )}
    </div>
  );
}
