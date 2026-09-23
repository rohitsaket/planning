"use client";

import { useMemo } from "react";
import { useGlobalFilter } from "@/stores/global-filter";
import { useSalesFilters } from "@/stores/sales-analysis-filters";
import { filterQuery, type SalesHistoryFilterValues } from "@/lib/analytics/sales-history-contract";

/**
 * The single query the whole page filters by: the global country / branch / lab bar
 * combined with the page-level filters.
 *
 * Every table on the page builds its URL from this, so the summary, the trend, the
 * movement table, the contribution tables, the drill-down and the export can never be
 * showing different selections of the same data.
 *
 * The global window selector is deliberately absent: the sales window is the one the
 * authoritative snapshot was calculated with, and a browser control must not appear to
 * change it.
 */
export function useSalesQuery(): { params: URLSearchParams; filters: SalesHistoryFilterValues } {
  const country = useGlobalFilter((s) => s.country);
  const branch = useGlobalFilter((s) => s.branch);
  const lab = useGlobalFilter((s) => s.lab);
  const pageFilters = useSalesFilters((s) => s.filters);

  return useMemo(() => {
    const filters: SalesHistoryFilterValues = {
      ...pageFilters,
      country: pageFilters.country ?? country,
      branch: pageFilters.branch ?? branch,
      lab: pageFilters.lab ?? lab,
    };
    return { params: filterQuery(filters), filters };
  }, [pageFilters, country, branch, lab]);
}

/** Appends the shared filters to a route path, preserving any route-specific params. */
export function salesUrl(path: string, params: URLSearchParams, extra: Record<string, string | number>): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return `${path}?${q.toString()}`;
}
