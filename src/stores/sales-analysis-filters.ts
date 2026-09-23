"use client";

import { create } from "zustand";
import {
  EMPTY_FILTERS,
  type SalesDataState,
  type SalesHistoryFilterValues,
  type SalesTrendDirection,
} from "@/lib/analytics/sales-history-contract";

/**
 * Page-level filters for Sales Analysis & Trends.
 *
 * Held outside the two tab components so drilling into the supporting records of a
 * category, switching to the trends tab and coming back all keep the same selection.
 * The country / branch / lab / window filters stay in the global filter bar; these are
 * the filters that only mean something on this page.
 */
interface SalesFilterState {
  filters: SalesHistoryFilterValues;
  set: (patch: Partial<SalesHistoryFilterValues>) => void;
  /** Focus the page on one category — used by the summary drill-down. */
  selectCategory: (categoryId: string | null) => void;
  reset: () => void;
  activeCount: () => number;
}

export const useSalesFilters = create<SalesFilterState>((set, get) => ({
  filters: { ...EMPTY_FILTERS },
  set: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  selectCategory: (categoryId) => set((s) => ({ filters: { ...s.filters, categoryId } })),
  reset: () => set({ filters: { ...EMPTY_FILTERS } }),
  activeCount: () => Object.values(get().filters).filter(Boolean).length,
}));

export const TREND_FILTER_OPTIONS: SalesTrendDirection[] = [
  "Strong Growth",
  "Growth",
  "Stable",
  "Declining",
  "Strong Decline",
  "New Demand",
  "Volatile",
  "Dormant",
];

export const DATA_STATE_FILTER_OPTIONS: SalesDataState[] = ["CONFIRMED", "REVIEW_REQUIRED", "INSUFFICIENT_HISTORY"];
