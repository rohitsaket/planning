"use client";

import { create } from "zustand";

export type ViewId =
  // Consolidated Workflow View IDs
  | "dashboard"
  | "fantasy-live"
  | "fantasy-sync"
  | "overall-data"
  | "data-quality-issues"
  | "demand-overview"
  | "inventory-position"
  | "customers-orders"
  | "demand-trace"
  | "stock-strategy"
  | "requirements-matrix"
  | "requirements-priority-queue"
  | "orders-exceptions"
  | "replenishment-allocation"
  | "planning-rough-availability"
  | "planning-workbook-import"
  | "planning-workbench"
  | "planning-comparison"
  | "planning-approval-queue"
  | "manufacturing-overview"
  | "manufacturing-traceability"
  | "plan-vs-actual"
  | "data-science-forecasting"
  | "data-science-predictive-models"
  | "data-science-prediction-monitoring"
  | "reports"
  | "admin-users-access"
  | "admin-rules-mappings"
  | "admin-system-settings"
  | "admin-audit-log"
  // Legacy / Embedded View IDs for Backward Compatibility & Direct Links
  | "analysis-executive"
  | "analysis-sales"
  | "analysis-sales-trends"
  | "analysis-customers-orders"
  | "analysis-inventory-position"
  | "analysis-customers"
  | "analysis-orders"
  | "analysis-country"
  | "analysis-polished"
  | "analysis-memo"
  | "analysis-wip"
  | "analysis-forecast"
  | "analysis-stockout"
  | "analysis-excess"
  | "analysis-aging"
  | "analysis-reorder-signals"
  | "demand-history"
  | "analysis-demand-trace"
  | "transfer-analyzer"
  | "aging-dashboard"
  | "requirements-orders"
  | "requirements-replenishment"
  | "requirements-backorders"
  | "requirements-special"
  | "requirements-forecast-signals"
  | "requirements-allocation"
  | "planning-cases"
  | "planning-planned-pieces"
  | "planning-reservations"
  | "manufacturing-tracking"
  | "manufacturing-departments"
  | "manufacturing-locations"
  | "manufacturing-wip"
  | "manufacturing-plan-vs-actual"
  | "fantasy-rough"
  | "fantasy-polished"
  | "fantasy-departments"
  | "fantasy-locations"
  | "fantasy-status-mapping"
  | "fantasy-reconciliation"
  | "data-quality-unmapped-labs"
  | "data-quality-unmapped-shapes"
  | "data-science-anomaly-detection"
  | "data-science-yield-prediction"
  | "data-science-forecast"
  | "data-science-models"
  | "data-science-forecast-accuracy"
  | "admin-business-rules"
  | "admin-weight-bands"
  | "admin-lab-mappings"
  | "admin-shape-mappings"
  | "admin-feature-flags"
  | "admin-users"
  | "admin-access-requests";

// Merged modules. A legacy view id resolves to the host view that now owns it plus the tab
// that holds the old page, so old bookmarks, deep links and setView() callers keep working.
export const LEGACY_VIEW_ALIASES: Partial<Record<ViewId, { view: ViewId; tab: string }>> = {
  // "Sales Analysis" + "Sales Trends" → one sidebar module "Sales Analysis & Trends"
  "analysis-sales-trends": { view: "analysis-sales", tab: "trends" },
};

export function resolveViewAlias(view: ViewId, tab: string | null = null): { view: ViewId; tab: string | null } {
  const alias = LEGACY_VIEW_ALIASES[view];
  return alias ? { view: alias.view, tab: alias.tab } : { view, tab };
}

export function navHash(view: ViewId, tab: string | null): string {
  return tab ? `#${view}?tab=${encodeURIComponent(tab)}` : `#${view}`;
}

/** Parses "#view" or "#view?tab=x" (with or without the leading "#"); legacy ids are resolved. */
export function parseNavHash(rawHash: string): { view: ViewId; tab: string | null; aliased: boolean } | null {
  const h = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  if (!h) return null;
  const [viewPart, queryPart] = h.split("?");
  const params = new URLSearchParams(queryPart || "");
  const resolved = resolveViewAlias(viewPart as ViewId, params.get("tab") || null);
  return { ...resolved, aliased: viewPart !== resolved.view };
}

interface NavState {
  view: ViewId;
  tab: string | null;
  detailId: string | null;
  setView: (view: ViewId, tab?: string | null) => void;
  setTab: (tab: string | null) => void;
  openDetail: (view: ViewId, id: string) => void;
  closeDetail: () => void;
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (groupId: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  view: "dashboard",
  tab: null,
  detailId: null,
  setView: (rawView, rawTab = null) => {
    const { view, tab } = resolveViewAlias(rawView, rawTab);
    set({ view, tab, detailId: null });
    if (typeof window !== "undefined") window.history.replaceState(null, "", navHash(view, tab));
  },
  setTab: (tab) => {
    const s = get();
    if (s.tab === tab) return;
    set({ tab });
    // A tab switch is a history entry, so Back/Forward move between the tabs of a module
    // and the hashchange listener in page.tsx restores the tab from the URL.
    if (typeof window !== "undefined") window.history.pushState(null, "", navHash(s.view, tab));
  },
  openDetail: (view, id) => set({ view, detailId: id }),
  closeDetail: () => set({ detailId: null }),
  collapsedGroups: {},
  toggleGroup: (groupId) =>
    set((s) => ({
      collapsedGroups: {
        ...s.collapsedGroups,
        [groupId]: !s.collapsedGroups[groupId],
      },
    })),
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));

export function initNavFromHash() {
  if (typeof window === "undefined") return;
  const parsed = parseNavHash(window.location.hash);
  if (!parsed) return;
  useNavStore.setState({ view: parsed.view, tab: parsed.tab });
  // A legacy id is rewritten to its canonical hash so refresh/bookmark land on the same URL.
  if (parsed.aliased) window.history.replaceState(null, "", navHash(parsed.view, parsed.tab));
}
