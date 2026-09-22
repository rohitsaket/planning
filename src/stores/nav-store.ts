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

/** The single view id that renders Demand Result Details. */
export const DEMAND_TRACE_VIEW: ViewId = "analysis-demand-trace";

// Merged modules. A legacy view id resolves to the host view that now owns it plus the tab
// that holds the old page, so old bookmarks, deep links and setView() callers keep working.
export const LEGACY_VIEW_ALIASES: Partial<Record<ViewId, { view: ViewId; tab: string | null }>> = {
  // "Sales Analysis" + "Sales Trends" → one sidebar module "Sales Analysis & Trends"
  "analysis-sales-trends": { view: "analysis-sales", tab: "trends" },
  // Demand Trace used to have a second id in the Demand and Inventory section. One page now
  // has one id; old hashes and old setView() callers resolve to the canonical Analysis id.
  "demand-trace": { view: DEMAND_TRACE_VIEW, tab: null },
};

export function resolveViewAlias(view: ViewId, tab: string | null = null): { view: ViewId; tab: string | null } {
  const alias = LEGACY_VIEW_ALIASES[view];
  return alias ? { view: alias.view, tab: alias.tab } : { view, tab };
}

/**
 * Row-specific drill-down context for Demand Result Details.
 *
 * `category` is the canonical key the backend returns (for example "GIA|HEART|1.70-1.99").
 * It is carried verbatim and never rebuilt from the lab, shape and weight-band labels shown
 * on screen, because those are display text and may be formatted differently.
 */
export interface DemandTraceContext {
  runId: string | null;
  category: string | null;
  /** A runId/category parameter was present but unusable, so the page reports it instead of guessing. */
  malformed: boolean;
}

const MAX_RUN_ID_LENGTH = 64;
// Matches the length the API accepts, so a hash the API would reject never reaches it.
const MAX_CATEGORY_LENGTH = 200;

function readParam(
  params: URLSearchParams,
  name: string,
  maxLength: number,
): { value: string | null; malformed: boolean } {
  const raw = params.get(name);
  if (raw === null) return { value: null, malformed: false };
  // Taken verbatim. Trimming or re-casing a canonical key would silently select a different
  // category than the URL asked for, so an unusable value is reported rather than repaired.
  if (raw === "" || raw.length > maxLength) return { value: null, malformed: true };
  return { value: raw, malformed: false };
}

function readTraceContext(params: URLSearchParams): DemandTraceContext | null {
  const runId = readParam(params, "runId", MAX_RUN_ID_LENGTH);
  const category = readParam(params, "category", MAX_CATEGORY_LENGTH);
  const malformed = runId.malformed || category.malformed;
  if (!runId.value && !category.value && !malformed) return null;
  return { runId: runId.value, category: category.value, malformed };
}

/** Builds "#view", "#view?tab=x" or "#view?runId=…&category=…". Every value is escaped. */
export function navHash(view: ViewId, tab: string | null, trace?: DemandTraceContext | null): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (trace?.runId) params.set("runId", trace.runId);
  if (trace?.category) params.set("category", trace.category);
  const query = params.toString();
  return query ? `#${view}?${query}` : `#${view}`;
}

/**
 * Parses "#view" or "#view?a=1&b=2" (with or without the leading "#"); legacy ids are resolved
 * and unrecognised parameters are ignored.
 */
export function parseNavHash(
  rawHash: string,
): { view: ViewId; tab: string | null; trace: DemandTraceContext | null; aliased: boolean } | null {
  const h = rawHash.startsWith("#") ? rawHash.slice(1) : rawHash;
  if (!h) return null;
  const queryStart = h.indexOf("?");
  const viewPart = queryStart === -1 ? h : h.slice(0, queryStart);
  if (!viewPart) return null;
  const params = new URLSearchParams(queryStart === -1 ? "" : h.slice(queryStart + 1));
  const resolved = resolveViewAlias(viewPart as ViewId, params.get("tab") || null);
  return { ...resolved, trace: readTraceContext(params), aliased: viewPart !== resolved.view };
}

interface NavState {
  view: ViewId;
  tab: string | null;
  detailId: string | null;
  /** Row context for Demand Result Details; null for every generic navigation. */
  trace: DemandTraceContext | null;
  setView: (view: ViewId, tab?: string | null) => void;
  setTab: (tab: string | null) => void;
  /** Drill-down from a Demand Overview row into that exact category. */
  openDemandTrace: (context: { runId?: string | null; category: string }) => void;
  /** Category change made inside Demand Result Details, keeping the current run. */
  setTraceCategory: (category: string) => void;
  /** Drops an unavailable category and returns to the neutral state, keeping the current run. */
  clearTraceCategory: () => void;
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
  trace: null,
  setView: (rawView, rawTab = null) => {
    const { view, tab } = resolveViewAlias(rawView, rawTab);
    // Generic navigation always drops row context, so a sidebar entry, the command palette
    // or a dashboard link never reopens a category the user drilled into earlier.
    set({ view, tab, detailId: null, trace: null });
    if (typeof window !== "undefined") window.history.replaceState(null, "", navHash(view, tab, null));
  },
  setTab: (tab) => {
    const s = get();
    if (s.tab === tab) return;
    set({ tab });
    // A tab switch is a history entry, so Back/Forward move between the tabs of a module
    // and the hashchange listener in page.tsx restores the tab from the URL.
    if (typeof window !== "undefined") window.history.pushState(null, "", navHash(s.view, tab, s.trace));
  },
  openDemandTrace: (context) => {
    // The view and its context move in one update, so the state change that switches the
    // page can never clear the category it was asked to open.
    const trace: DemandTraceContext = {
      runId: context.runId ?? null,
      category: context.category,
      malformed: false,
    };
    set({ view: DEMAND_TRACE_VIEW, tab: null, detailId: null, trace });
    // A drill-down from a row is a real navigation step: pushState keeps the source view in
    // history so Back returns to Demand Overview instead of skipping past it.
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", navHash(DEMAND_TRACE_VIEW, null, trace));
    }
  },
  setTraceCategory: (category) => {
    const s = get();
    if (s.trace?.category === category && !s.trace.malformed) return;
    // Picking another category inside the page replaces the current entry, so Back still
    // returns to where the drill-down started rather than stepping through categories.
    const trace: DemandTraceContext = { runId: s.trace?.runId ?? null, category, malformed: false };
    set({ trace });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", navHash(s.view, s.tab, trace));
    }
  },
  clearTraceCategory: () => {
    const s = get();
    const runId = s.trace?.runId ?? null;
    const trace: DemandTraceContext | null = runId ? { runId, category: null, malformed: false } : null;
    set({ trace });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", navHash(s.view, s.tab, trace));
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
  const parsed = parseNavHash(window.location.hash);
  if (!parsed) return;
  // The URL is the source of truth on load, refresh, remount and Back/Forward, so the row
  // context is restored from it rather than from whatever the store held before.
  useNavStore.setState({ view: parsed.view, tab: parsed.tab, trace: parsed.trace });
  // A legacy id is rewritten to its canonical hash so refresh/bookmark land on the same URL.
  if (parsed.aliased) window.history.replaceState(null, "", navHash(parsed.view, parsed.tab, parsed.trace));
}
