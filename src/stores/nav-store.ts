"use client";

import { create } from "zustand";
import { isInventoryBucket, type InventoryBucket } from "@/lib/analysis/bucket-vocabulary";

export type ViewId =
  | "dashboard"
  | "analysis-sales"
  | "analysis-customers-orders"
  | "analysis-inventory-position"
  | "fantasy-data"
  | "data-quality-issues"
  | "planning-workbook-import"
  | "out-of-scope"
  | "admin-users-access"
  | "admin-mappings"
  | "admin-audit-log"
  | "analysis-customers"
  | "analysis-country"
  | "analysis-polished"
  | "analysis-memo"
  | LegacyViewId;

type LegacyViewId =
  | "analysis-executive"
  | "analysis-sales-trends"
  | "customers-orders"
  | "inventory-position"
  | "analysis-stockout"
  | "analysis-excess"
  | "analysis-aging"
  | "aging-dashboard"
  | "fantasy-live"
  | "fantasy-sync"
  | "overall-data"
  | "fantasy-rough"
  | "fantasy-polished"
  | "fantasy-departments"
  | "fantasy-locations"
  | "analysis-wip"
  | "manufacturing-overview"
  | "manufacturing-traceability"
  | "manufacturing-tracking"
  | "manufacturing-departments"
  | "manufacturing-locations"
  | "manufacturing-wip"
  | "manufacturing"
  | "plan-vs-actual"
  | "manufacturing-plan-vs-actual"
  | "stock-strategy"
  | "analysis-reorder-signals"
  | "transfer-analyzer"
  | "data-science-forecasting"
  | "data-science-predictive-models"
  | "data-science-prediction-monitoring"
  | "data-science-anomaly-detection"
  | "data-science-yield-prediction"
  | "data-science-forecast"
  | "data-science-models"
  | "data-science-forecast-accuracy"
  | "analysis-forecast"
  | "planning-workbench"
  | "planning-approval-queue"
  | "planning-rough-availability"
  | "requirements-matrix"
  | "requirements-priority-queue"
  | "orders-exceptions"
  | "replenishment-allocation"
  | "requirements-orders"
  | "requirements-replenishment"
  | "requirements-backorders"
  | "requirements-special"
  | "requirements-forecast-signals"
  | "requirements-allocation"
  | "analysis-orders"
  | "reports"
  | "admin-system-settings"
  | "admin-feature-flags"
  | "data-quality-unmapped-labs"
  | "data-quality-unmapped-shapes"
  | "planning-comparison"
  | "planning-cases"
  | "planning-planned-pieces"
  | "planning-reservations"
  | "admin-rules-mappings"
  | "admin-business-rules"
  | "admin-sarin-shape-mappings"
  | "admin-weight-bands"
  | "admin-lab-mappings"
  | "admin-shape-mappings"
  | "fantasy-status-mapping"
  | "admin-users"
  | "admin-access-requests";

interface ViewTarget {
  view: ViewId;
  tab: string | null;
}

interface ViewAlias extends ViewTarget {
  tabs?: Record<string, ViewTarget>;
  keepTab?: boolean;
}

const OUT_OF_SCOPE: ViewTarget = { view: "out-of-scope", tab: null };
const ROUGH_NOT_CONFIGURED: ViewTarget = { view: "out-of-scope", tab: "rough-stock" };
const REQUIREMENTS_NOT_CONFIGURED: ViewTarget = { view: "out-of-scope", tab: "requirements" };

export const LEGACY_VIEW_ALIASES: Record<LegacyViewId, ViewAlias> = {
  "analysis-executive": { view: "dashboard", tab: "analysis" },
  "analysis-sales-trends": { view: "analysis-sales", tab: "trends" },
  "customers-orders": { view: "analysis-customers-orders", tab: null, keepTab: true },
  "inventory-position": { view: "analysis-inventory-position", tab: null, keepTab: true },
  "analysis-stockout": { view: "analysis-inventory-position", tab: "stockout" },
  "analysis-excess": { view: "analysis-inventory-position", tab: "excess" },
  "analysis-aging": { view: "analysis-inventory-position", tab: "aging" },
  "aging-dashboard": { view: "analysis-inventory-position", tab: "aging" },
  "fantasy-live": {
    ...ROUGH_NOT_CONFIGURED,
    tabs: { polished: { view: "fantasy-data", tab: "current" }, departments: OUT_OF_SCOPE, locations: OUT_OF_SCOPE },
  },
  "fantasy-rough": ROUGH_NOT_CONFIGURED,
  "fantasy-polished": { view: "fantasy-data", tab: "current" },
  "fantasy-sync": { view: "fantasy-data", tab: "integration" },
  "overall-data": { view: "fantasy-data", tab: "history" },
  "manufacturing-tracking": { view: "fantasy-data", tab: "integration" },
  manufacturing: OUT_OF_SCOPE,
  "manufacturing-overview": { ...OUT_OF_SCOPE, tabs: { tracking: { view: "fantasy-data", tab: "integration" } } },
  "manufacturing-traceability": OUT_OF_SCOPE,
  "manufacturing-departments": OUT_OF_SCOPE,
  "manufacturing-locations": OUT_OF_SCOPE,
  "manufacturing-wip": OUT_OF_SCOPE,
  "fantasy-departments": OUT_OF_SCOPE,
  "fantasy-locations": OUT_OF_SCOPE,
  "analysis-wip": OUT_OF_SCOPE,
  "plan-vs-actual": OUT_OF_SCOPE,
  "manufacturing-plan-vs-actual": OUT_OF_SCOPE,
  "stock-strategy": OUT_OF_SCOPE,
  "analysis-reorder-signals": OUT_OF_SCOPE,
  "transfer-analyzer": OUT_OF_SCOPE,
  "data-science-forecasting": OUT_OF_SCOPE,
  "data-science-predictive-models": OUT_OF_SCOPE,
  "data-science-prediction-monitoring": OUT_OF_SCOPE,
  "data-science-anomaly-detection": OUT_OF_SCOPE,
  "data-science-yield-prediction": OUT_OF_SCOPE,
  "data-science-forecast": OUT_OF_SCOPE,
  "data-science-models": OUT_OF_SCOPE,
  "data-science-forecast-accuracy": OUT_OF_SCOPE,
  "analysis-forecast": OUT_OF_SCOPE,
  reports: OUT_OF_SCOPE,
  "admin-system-settings": OUT_OF_SCOPE,
  "admin-feature-flags": OUT_OF_SCOPE,
  "data-quality-unmapped-labs": { view: "admin-mappings", tab: "lab-mappings" },
  "data-quality-unmapped-shapes": { view: "admin-mappings", tab: "shape-mappings" },
  "planning-workbench": OUT_OF_SCOPE,
  "planning-comparison": OUT_OF_SCOPE,
  "planning-cases": OUT_OF_SCOPE,
  "planning-planned-pieces": OUT_OF_SCOPE,
  "planning-reservations": OUT_OF_SCOPE,
  "planning-approval-queue": OUT_OF_SCOPE,
  "planning-rough-availability": ROUGH_NOT_CONFIGURED,
  "requirements-matrix": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-priority-queue": REQUIREMENTS_NOT_CONFIGURED,
  "orders-exceptions": REQUIREMENTS_NOT_CONFIGURED,
  "replenishment-allocation": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-orders": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-replenishment": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-backorders": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-special": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-forecast-signals": REQUIREMENTS_NOT_CONFIGURED,
  "requirements-allocation": REQUIREMENTS_NOT_CONFIGURED,
  "analysis-orders": REQUIREMENTS_NOT_CONFIGURED,
  "admin-rules-mappings": { view: "admin-mappings", tab: null },
  "admin-business-rules": { view: "admin-mappings", tab: null },
  "admin-sarin-shape-mappings": { view: "admin-mappings", tab: "sarin-shape-mapping" },
  "admin-weight-bands": { view: "admin-mappings", tab: "weight-bands" },
  "admin-lab-mappings": { view: "admin-mappings", tab: "lab-mappings" },
  "admin-shape-mappings": { view: "admin-mappings", tab: "shape-mappings" },
  "fantasy-status-mapping": { view: "admin-mappings", tab: "status-mappings" },
  "admin-users": { view: "admin-users-access", tab: "users" },
  "admin-access-requests": { view: "admin-users-access", tab: "users" },
};

export function resolveViewAlias(view: ViewId, tab: string | null = null): ViewTarget {
  const alias = Object.prototype.hasOwnProperty.call(LEGACY_VIEW_ALIASES, view) ? LEGACY_VIEW_ALIASES[view as LegacyViewId] : undefined;
  if (!alias) return { view, tab };
  const specific = tab ? alias.tabs?.[tab] : undefined;
  if (specific) return { view: specific.view, tab: specific.tab };
  return { view: alias.view, tab: alias.keepTab && tab ? tab : alias.tab };
}

export interface DemandTraceContext {
  runId: string | null;
  category: string | null;
  bucket: InventoryBucket | null;
  malformed: boolean;
}

const MAX_RUN_ID_LENGTH = 64;
const MAX_CATEGORY_LENGTH = 200;
const MAX_BUCKET_LENGTH = 40;

function readParam(
  params: URLSearchParams,
  name: string,
  maxLength: number,
): { value: string | null; malformed: boolean } {
  const raw = params.get(name);
  if (raw === null) return { value: null, malformed: false };
  if (raw === "" || raw.length > maxLength) return { value: null, malformed: true };
  return { value: raw, malformed: false };
}

function readTraceContext(params: URLSearchParams): DemandTraceContext | null {
  const runId = readParam(params, "runId", MAX_RUN_ID_LENGTH);
  const category = readParam(params, "category", MAX_CATEGORY_LENGTH);
  const rawBucket = readParam(params, "bucket", MAX_BUCKET_LENGTH);
  const bucket = rawBucket.value !== null && isInventoryBucket(rawBucket.value) ? rawBucket.value : null;
  const bucketMalformed = rawBucket.malformed || (rawBucket.value !== null && bucket === null);
  const malformed = runId.malformed || category.malformed || bucketMalformed;
  if (!runId.value && !category.value && !bucket && !malformed) return null;
  return { runId: runId.value, category: category.value, bucket, malformed };
}

export function navHash(view: ViewId, tab: string | null, trace?: DemandTraceContext | null): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (trace?.runId) params.set("runId", trace.runId);
  if (trace?.category) params.set("category", trace.category);
  if (trace?.bucket) params.set("bucket", trace.bucket);
  const query = params.toString();
  return query ? `#${view}?${query}` : `#${view}`;
}

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
  trace: DemandTraceContext | null;
  setView: (view: ViewId, tab?: string | null) => void;
  setTab: (tab: string | null) => void;
  openCategoryView: (
    view: ViewId,
    context: { runId?: string | null; category?: string | null; bucket?: InventoryBucket | null },
  ) => void;
  setTraceCategory: (category: string) => void;
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
    set({ view, tab, detailId: null, trace: null });
    if (typeof window !== "undefined") window.history.replaceState(null, "", navHash(view, tab, null));
  },
  setTab: (tab) => {
    const s = get();
    if (s.tab === tab) return;
    set({ tab });
    if (typeof window !== "undefined") window.history.pushState(null, "", navHash(s.view, tab, s.trace));
  },
  openCategoryView: (rawView, context) => {
    const { view, tab } = resolveViewAlias(rawView, null);
    const trace: DemandTraceContext = {
      runId: context.runId ?? null,
      category: context.category ?? null,
      bucket: context.bucket ?? null,
      malformed: false,
    };
    set({ view, tab, detailId: null, trace });
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", navHash(view, tab, trace));
    }
  },
  setTraceCategory: (category) => {
    const s = get();
    if (s.trace?.category === category && !s.trace.malformed) return;
    const trace: DemandTraceContext = {
      runId: s.trace?.runId ?? null,
      category,
      bucket: s.trace?.bucket ?? null,
      malformed: false,
    };
    set({ trace });
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", navHash(s.view, s.tab, trace));
    }
  },
  clearTraceCategory: () => {
    const s = get();
    const runId = s.trace?.runId ?? null;
    const bucket = s.trace?.bucket ?? null;
    const trace: DemandTraceContext | null =
      runId || bucket ? { runId, category: null, bucket, malformed: false } : null;
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
  useNavStore.setState({ view: parsed.view, tab: parsed.tab, trace: parsed.trace });
  if (parsed.aliased) window.history.replaceState(null, "", navHash(parsed.view, parsed.tab, parsed.trace));
}
