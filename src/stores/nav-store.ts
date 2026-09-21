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

export const useNavStore = create<NavState>((set) => ({
  view: "dashboard",
  tab: null,
  detailId: null,
  setView: (view, tab = null) => {
    set({ view, tab, detailId: null });
    if (typeof window !== "undefined") {
      const hash = tab ? `${view}?tab=${encodeURIComponent(tab)}` : view;
      window.history.replaceState(null, "", `#${hash}`);
    }
  },
  setTab: (tab) => {
    set((s) => {
      if (typeof window !== "undefined") {
        const hash = tab ? `${s.view}?tab=${encodeURIComponent(tab)}` : s.view;
        window.history.replaceState(null, "", `#${hash}`);
      }
      return { tab };
    });
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
  const rawHash = window.location.hash.slice(1);
  if (rawHash) {
    const [viewPart, queryPart] = rawHash.split("?");
    const params = new URLSearchParams(queryPart || "");
    const tab = params.get("tab");
    useNavStore.setState({ view: viewPart as ViewId, tab: tab || null });
  }
}
