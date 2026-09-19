"use client";

import { create } from "zustand";

export type ViewId =
  | "dashboard"
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
  | "requirements-matrix"
  | "requirements-priority-queue"
  | "requirements-orders"
  | "requirements-replenishment"
  | "requirements-backorders"
  | "requirements-special"
  | "requirements-forecast-signals"
  | "requirements-allocation"
  | "planning-rough-availability"
  | "planning-cases"
  | "planning-workbook-import"
  | "planning-workbench"
  | "planning-approval-queue"
  | "planning-planned-pieces"
  | "planning-reservations"
  | "manufacturing-tracking"
  | "manufacturing-departments"
  | "manufacturing-locations"
  | "manufacturing-wip"
  | "manufacturing-traceability"
  | "manufacturing-plan-vs-actual"
  | "fantasy-sync"
  | "fantasy-rough"
  | "fantasy-polished"
  | "fantasy-departments"
  | "fantasy-locations"
  | "fantasy-status-mapping"
  | "fantasy-reconciliation"
  | "data-quality-issues"
  | "data-quality-unmapped-labs"
  | "data-quality-unmapped-shapes"
  | "data-science-forecast"
  | "data-science-models"
  | "data-science-prediction-monitoring"
  | "data-science-forecast-accuracy"
  | "reports"
  | "admin-business-rules"
  | "admin-weight-bands"
  | "admin-lab-mappings"
  | "admin-shape-mappings"
  | "admin-feature-flags"
  | "admin-audit-log"
  | "admin-users";

interface NavState {
  view: ViewId;
  detailId: string | null;
  setView: (view: ViewId) => void;
  openDetail: (view: ViewId, id: string) => void;
  closeDetail: () => void;
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (groupId: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export const useNavStore = create<NavState>((set) => ({
  view: "dashboard",
  detailId: null,
  setView: (view) => {
    set({ view, detailId: null });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${view}`);
    }
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
  const hash = window.location.hash.slice(1);
  if (hash) {
    useNavStore.setState({ view: hash as ViewId });
  }
}
