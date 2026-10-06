"use client";

import { useMemo } from "react";
import { useGlobalFilter } from "@/stores/global-filter";
import { useSalesFilters } from "@/stores/sales-analysis-filters";
import { filterQuery, type SalesHistoryFilterValues } from "@/lib/analytics/sales-history-contract";

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

export function salesUrl(path: string, params: URLSearchParams, extra: Record<string, string | number>): string {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(extra)) q.set(k, String(v));
  return `${path}?${q.toString()}`;
}
