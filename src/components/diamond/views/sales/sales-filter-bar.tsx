"use client";

import { FilterX, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/stores/auth-store";
import { useGlobalFilter } from "@/stores/global-filter";
import { DATA_STATE_FILTER_OPTIONS, TREND_FILTER_OPTIONS, useSalesFilters } from "@/stores/sales-analysis-filters";
import { SALES_DATA_STATE_LABELS, type SalesDataState, type SalesTrendDirection } from "@/lib/analytics/sales-history-contract";

const ANY = "__any__";

/**
 * Page-level filters. Every one of them is applied on the server, by the same filter set
 * the totals and the paging counts are computed from — so narrowing the table narrows
 * the totals with it, and the row count shown is always the real number of matches.
 *
 * Customer narrowing appears only for a principal holding customers.read; the server
 * refuses the parameter without it rather than quietly ignoring it.
 */
export function SalesFilterBar() {
  const { filters, set, reset } = useSalesFilters();
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canReadCustomers = permissions.includes("customers.read");
  const global = useGlobalFilter();

  const text = (key: "search" | "shape" | "weightBand" | "branch" | "customerCode", placeholder: string) => (
    <Input
      value={filters[key] ?? ""}
      onChange={(e) => set({ [key]: e.target.value.trim() === "" ? null : e.target.value })}
      placeholder={placeholder}
      className="h-8 w-[140px] text-xs"
      aria-label={placeholder}
    />
  );

  const active =
    Object.entries(filters).filter(([, v]) => v).length +
    (global.country ? 1 : 0) +
    (global.branch ? 1 : 0) +
    (global.lab ? 1 : 0);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {text("search", "Search category")}
      {text("shape", "Shape")}
      {text("weightBand", "Weight band")}
      {text("branch", "Branch")}
      {canReadCustomers && text("customerCode", "Customer code")}

      <Select
        value={filters.trend ?? ANY}
        onValueChange={(v) => set({ trend: v === ANY ? null : (v as SalesTrendDirection) })}
      >
        <SelectTrigger size="sm" className="h-8 w-[140px] text-xs" aria-label="Filter by trend direction">
          <SelectValue placeholder="Trend" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY} className="text-xs">Any trend</SelectItem>
          {TREND_FILTER_OPTIONS.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.dataState ?? ANY}
        onValueChange={(v) => set({ dataState: v === ANY ? null : (v as SalesDataState) })}
      >
        <SelectTrigger size="sm" className="h-8 w-[150px] text-xs" aria-label="Filter by data state">
          <SelectValue placeholder="Data state" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY} className="text-xs">Any data state</SelectItem>
          {DATA_STATE_FILTER_OPTIONS.map((s) => (
            <SelectItem key={s} value={s} className="text-xs">{SALES_DATA_STATE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {filters.categoryId && (
        <button
          type="button"
          onClick={() => set({ categoryId: null })}
          className="inline-flex items-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
        >
          Category: {filters.categoryId}
          <X className="h-3 w-3" aria-hidden />
          <span className="sr-only">Clear the category filter</span>
        </button>
      )}

      {active > 0 && (
        <Button variant="outline" size="sm" className="h-8 px-2 text-[11px] gap-1" onClick={reset}>
          <FilterX className="h-3 w-3" /> Clear page filters
        </Button>
      )}
    </div>
  );
}
