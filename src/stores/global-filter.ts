"use client";

import { create } from "zustand";

export interface GlobalFilter {
  country: string | null; // null = all countries
  branch: string | null; // null = all branches
  lab: string | null; // null = all labs
  windowDays: number; // default 90
}

interface GlobalFilterState extends GlobalFilter {
  setCountry: (country: string | null) => void;
  setBranch: (branch: string | null) => void;
  setLab: (lab: string | null) => void;
  setWindowDays: (days: number) => void;
  reset: () => void;
  // Build a query string suffix for APIs that accept these filters
  toQueryString: () => string;
  // Whether any filter is active
  hasActiveFilters: () => boolean;
}

const DEFAULTS = {
  country: null as string | null,
  branch: null as string | null,
  lab: null as string | null,
  windowDays: 90,
};

export const useGlobalFilter = create<GlobalFilterState>((set, get) => ({
  ...DEFAULTS,
  setCountry: (country) => set({ country, branch: null }), // reset branch when country changes
  setBranch: (branch) => set({ branch }),
  setLab: (lab) => set({ lab }),
  setWindowDays: (windowDays) => set({ windowDays }),
  reset: () => set({ ...DEFAULTS }),
  toQueryString: () => {
    const s = get();
    const params = new URLSearchParams();
    if (s.country) params.set("country", s.country);
    if (s.branch) params.set("branch", s.branch);
    if (s.lab) params.set("lab", s.lab);
    if (s.windowDays !== 90) params.set("windowDays", String(s.windowDays));
    const qs = params.toString();
    return qs ? `&${qs}` : "";
  },
  hasActiveFilters: () => {
    const s = get();
    return s.country !== null || s.branch !== null || s.lab !== null || s.windowDays !== 90;
  },
}));

// Available filter options (static — could be fetched from API)
export const COUNTRY_OPTIONS = [
  { value: "US", label: "🇺🇸 United States" },
  { value: "HK", label: "🇭🇰 Hong Kong" },
  { value: "CA", label: "🇨🇦 Canada" },
  { value: "IN", label: "🇮🇳 India" },
  { value: "BE", label: "🇧🇪 Belgium" },
  { value: "AE", label: "🇦🇪 UAE" },
];

export const LAB_OPTIONS = [
  { value: "GIA", label: "GIA" },
  { value: "Non-Cert", label: "Non-Cert" },
  { value: "Other", label: "Other" },
];

export const WINDOW_OPTIONS = [
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 60, label: "60D" },
  { value: 90, label: "90D" },
  { value: 180, label: "180D" },
  { value: 365, label: "365D" },
];
