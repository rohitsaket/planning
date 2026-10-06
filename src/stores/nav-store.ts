"use client";

import { create } from "zustand";
import { isInventoryBucket, type InventoryBucket } from "@/lib/analysis/bucket-vocabulary";

export type ViewId =
  // Pages in the sidebar
  | "dashboard"
  | "analysis-sales"
  | "analysis-customers-orders"
  | "analysis-inventory-position"
  | "fantasy-data"
  | "data-quality-issues"
  | "planning-workbook-import"
  // Where links to retired pages land (manufacturing, traceability, plan versus actual,
  // forecasting, reports, stock strategy, the legacy planning workbench and approvals, rough
  // availability): a plain "not available" state, never old data.
  | "out-of-scope"
  | "admin-users-access"
  | "admin-mappings"
  | "admin-audit-log"
  // Direct views still opened from dashboard and page links
  | "analysis-customers"
  | "analysis-country"
  | "analysis-polished"
  | "analysis-memo"
  // Former ids, kept only as keys of LEGACY_VIEW_ALIASES so old links keep working
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
  /** Tab to open; null opens the host's default (or first permitted) tab. */
  tab: string | null;
}

interface ViewAlias extends ViewTarget {
  /** Tabs of the former page that land somewhere more specific than `tab`. */
  tabs?: Record<string, ViewTarget>;
  /** The id was only renamed: a tab already in the link is kept. */
  keepTab?: boolean;
}

/**
 * THE alias table: every former page id and where it lives now. Old bookmarks, deep links,
 * notifications and setView() callers all resolve through here, in one hop — no alias
 * points at another alias. Row context (runId, category, bucket) is carried separately
 * by the caller and is never touched by resolution.
 */
const OUT_OF_SCOPE: ViewTarget = { view: "out-of-scope", tab: null };
/** Not available because no authoritative rough-stock source is configured (the tab names the reason). */
const ROUGH_NOT_CONFIGURED: ViewTarget = { view: "out-of-scope", tab: "rough-stock" };
/** Not available because requirement and order workflows are outside the planning utility. */
const REQUIREMENTS_NOT_CONFIGURED: ViewTarget = { view: "out-of-scope", tab: "requirements" };

export const LEGACY_VIEW_ALIASES: Record<LegacyViewId, ViewAlias> = {
  // Dashboard → Overview
  "analysis-executive": { view: "dashboard", tab: "analysis" },
  // Analysis
  "analysis-sales-trends": { view: "analysis-sales", tab: "trends" },
  "customers-orders": { view: "analysis-customers-orders", tab: null, keepTab: true },
  "inventory-position": { view: "analysis-inventory-position", tab: null, keepTab: true },
  "analysis-stockout": { view: "analysis-inventory-position", tab: "stockout" },
  "analysis-excess": { view: "analysis-inventory-position", tab: "excess" },
  "analysis-aging": { view: "analysis-inventory-position", tab: "aging" },
  "aging-dashboard": { view: "analysis-inventory-position", tab: "aging" },
  // Fantasy ERP and Overall Data → Fantasy Data. The old live page and its rough stock were
  // seeded records with no authoritative source; only its polished stock carries over.
  "fantasy-live": {
    ...ROUGH_NOT_CONFIGURED,
    tabs: { polished: { view: "fantasy-data", tab: "current" }, departments: OUT_OF_SCOPE, locations: OUT_OF_SCOPE },
  },
  "fantasy-rough": ROUGH_NOT_CONFIGURED,
  "fantasy-polished": { view: "fantasy-data", tab: "current" },
  "fantasy-sync": { view: "fantasy-data", tab: "integration" },
  "overall-data": { view: "fantasy-data", tab: "history" },
  "manufacturing-tracking": { view: "fantasy-data", tab: "integration" },
  // Manufacturing execution, production tracking and plan versus actual are outside the
  // planning utility.
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
  // Retired features: stock strategy, reorder signals, transfer analysis, forecasting and
  // predictive models, and the generic reports library are not part of the planning utility.
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
  // The generic settings page is retired, and so is the plan approval policy it once held.
  "admin-system-settings": OUT_OF_SCOPE,
  "admin-feature-flags": OUT_OF_SCOPE,
  // Unmapped values are fixed where the mappings live.
  "data-quality-unmapped-labs": { view: "admin-mappings", tab: "lab-mappings" },
  "data-quality-unmapped-shapes": { view: "admin-mappings", tab: "shape-mappings" },
  // The legacy Planning Workbench, its tabs and the Approval Queue ran on seed data only and
  // are retired. Plan selection will be built on stored Sarin output.
  "planning-workbench": OUT_OF_SCOPE,
  "planning-comparison": OUT_OF_SCOPE,
  "planning-cases": OUT_OF_SCOPE,
  "planning-planned-pieces": OUT_OF_SCOPE,
  "planning-reservations": OUT_OF_SCOPE,
  "planning-approval-queue": OUT_OF_SCOPE,
  // Hidden until an authoritative rough-stock source exists; the only rough records were seeded.
  "planning-rough-availability": ROUGH_NOT_CONFIGURED,
  // The Requirements section and its order views ran on seeded requirement and order records
  // with no authoritative source; requirement and order workflows are out of scope.
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
  // Mappings
  "admin-rules-mappings": { view: "admin-mappings", tab: null },
  "admin-business-rules": { view: "admin-mappings", tab: null },
  "admin-sarin-shape-mappings": { view: "admin-mappings", tab: "sarin-shape-mapping" },
  "admin-weight-bands": { view: "admin-mappings", tab: "weight-bands" },
  "admin-lab-mappings": { view: "admin-mappings", tab: "lab-mappings" },
  "admin-shape-mappings": { view: "admin-mappings", tab: "shape-mappings" },
  "fantasy-status-mapping": { view: "admin-mappings", tab: "status-mappings" },
  // Users & Access: the review queue is on the Users tab.
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

/**
 * Row-specific drill-down context for Demand Result Details.
 *
 * `category` is the canonical key the backend returns (for example "GIA|HEART|1.70-1.99").
 * It is carried verbatim and never rebuilt from the lab, shape and weight-band labels shown
 * on screen, because those are display text and may be formatted differently.
 *
 * `bucket` is the second, typed dimension a drill-down can carry: one of the seven derived
 * inventory buckets. It exists because the Aging Dashboard groups stock by bucket, and
 * `category` could not express that — the dashboard used to pass a bucket in the category
 * field, which the Stock Aging page had no way to read and the API refused. The two fields
 * are independent, and a navigation may carry either, both or neither.
 */
export interface DemandTraceContext {
  runId: string | null;
  category: string | null;
  /** A derived inventory bucket, validated against the closed vocabulary before it is carried. */
  bucket: InventoryBucket | null;
  /** A runId/category/bucket parameter was present but unusable, so the page reports it instead of guessing. */
  malformed: boolean;
}

const MAX_RUN_ID_LENGTH = 64;
// Matches the length the API accepts, so a hash the API would reject never reaches it.
const MAX_CATEGORY_LENGTH = 200;
// Matches the length the aging API accepts for its `bucket` parameter.
const MAX_BUCKET_LENGTH = 40;

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
  const rawBucket = readParam(params, "bucket", MAX_BUCKET_LENGTH);
  // A bucket that is not in the closed vocabulary is reported as malformed rather than
  // forwarded: the API refuses an unknown bucket, so guessing would only turn a bad link
  // into a failed request the page could not explain.
  const bucket = rawBucket.value !== null && isInventoryBucket(rawBucket.value) ? rawBucket.value : null;
  const bucketMalformed = rawBucket.malformed || (rawBucket.value !== null && bucket === null);
  const malformed = runId.malformed || category.malformed || bucketMalformed;
  if (!runId.value && !category.value && !bucket && !malformed) return null;
  return { runId: runId.value, category: category.value, bucket, malformed };
}

/** Builds "#view", "#view?tab=x" or "#view?runId=…&category=…". Every value is escaped. */
export function navHash(view: ViewId, tab: string | null, trace?: DemandTraceContext | null): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (trace?.runId) params.set("runId", trace.runId);
  if (trace?.category) params.set("category", trace.category);
  if (trace?.bucket) params.set("bucket", trace.bucket);
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
  /**
   * Drill-down into any category-aware page, carrying the exact canonical key.
   *
   * `setView` deliberately drops row context, so a link that used it lost the category
   * it was asked to open — which is how clicking a category in Inventory opened Stockout
   * Risk with nothing selected.
   */
  openCategoryView: (
    view: ViewId,
    context: { runId?: string | null; category?: string | null; bucket?: InventoryBucket | null },
  ) => void;
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
  openCategoryView: (rawView, context) => {
    const { view, tab } = resolveViewAlias(rawView, null);
    // The view and its context move in one update, so the state change that switches the
    // page can never clear the category it was asked to open.
    const trace: DemandTraceContext = {
      runId: context.runId ?? null,
      category: context.category ?? null,
      bucket: context.bucket ?? null,
      malformed: false,
    };
    set({ view, tab, detailId: null, trace });
    // A drill-down from a row is a real navigation step: pushState keeps the source view in
    // history so Back returns to where the drill-down started instead of skipping past it.
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", navHash(view, tab, trace));
    }
  },
  // One mechanism, not two: the Demand Trace drill-down is the general one aimed at a
  // fixed page.
  setTraceCategory: (category) => {
    const s = get();
    if (s.trace?.category === category && !s.trace.malformed) return;
    // Picking another category inside the page replaces the current entry, so Back still
    // returns to where the drill-down started rather than stepping through categories.
    // Only the category changes: a bucket the drill-down arrived with is preserved.
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
  // The URL is the source of truth on load, refresh, remount and Back/Forward, so the row
  // context is restored from it rather than from whatever the store held before.
  useNavStore.setState({ view: parsed.view, tab: parsed.tab, trace: parsed.trace });
  // A legacy id is rewritten to its canonical hash so refresh/bookmark land on the same URL.
  if (parsed.aliased) window.history.replaceState(null, "", navHash(parsed.view, parsed.tab, parsed.trace));
}
