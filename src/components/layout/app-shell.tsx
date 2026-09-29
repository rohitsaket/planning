"use client";

import { UserMenu } from "@/components/auth/auth-gate";
import { useAuthStore } from "@/stores/auth-store";
import { isViewAuthorized } from "@/lib/auth/view-permissions";
import { useNavStore, ViewId } from "@/stores/nav-store";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, BarChart3, TrendingUp, Users, Gem, FileText, Package, Boxes, AlertTriangle, Settings, ChevronDown, ChevronRight, Search, Bell, Database, Activity, Workflow, Hash, BookCheck, ClipboardList, Diamond, Moon, Sun, X, Shapes,
} from "lucide-react";
import { ReactNode, useState, useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";
import { apiFetch } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { CommandPalette } from "@/components/diamond/command-palette";
import { GlobalFilterBar } from "@/components/diamond/global-filter-bar";
import { DiamondMark } from "@/components/brand/diamond-mark";

export interface NavItem {
  id: ViewId;
  label: string;
  icon: ReactNode;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: ReactNode;
  items: NavItem[];
}

// The planning utility's sidebar. Manufacturing execution, production tracking, quality
// assurance and plan-versus-actual are outside its scope, and advisory or unconfirmed pages
// (reorder signals, transfer analysis, data science, reports, system settings) are not
// listed either — not shown locked. Former page ids resolve through LEGACY_VIEW_ALIASES in
// the nav store.
export const NAV: NavGroup[] = [
  {
    id: "dashboard-group",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
    items: [
      { id: "dashboard", label: "Overview", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "analysis-group",
    label: "Analysis",
    icon: <BarChart3 className="h-4 w-4" />,
    items: [
      { id: "analysis-sales", label: "Sales & Trends", icon: <TrendingUp className="h-3.5 w-3.5" /> },
      { id: "analysis-customers-orders", label: "Customers & Orders", icon: <Users className="h-3.5 w-3.5" /> },
      { id: "analysis-inventory-position", label: "Inventory", icon: <Package className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "data-group",
    label: "Data",
    icon: <Database className="h-4 w-4" />,
    items: [
      { id: "fantasy-data", label: "Fantasy Data", icon: <Boxes className="h-3.5 w-3.5" /> },
      { id: "data-quality-issues", label: "Import Issues", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "requirements-group",
    label: "Requirements",
    icon: <ClipboardList className="h-4 w-4" />,
    items: [
      { id: "requirements-matrix", label: "Requirement Matrix", icon: <Hash className="h-3.5 w-3.5" /> },
      { id: "requirements-priority-queue", label: "Priority Queue", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
      { id: "orders-exceptions", label: "Order Exceptions", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "replenishment-allocation", label: "Replenishment & Allocation", icon: <Workflow className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "planning-group",
    label: "Planning",
    icon: <Diamond className="h-4 w-4" />,
    items: [
      { id: "planning-rough-availability", label: "Rough Availability", icon: <Gem className="h-3.5 w-3.5" /> },
      { id: "planning-workbook-import", label: "Workbook Import", icon: <FileText className="h-3.5 w-3.5" /> },
      { id: "planning-workbench", label: "Planning Workbench", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
      { id: "planning-approval-queue", label: "Approval Queue", icon: <BookCheck className="h-3.5 w-3.5" /> },
    ],
  },
  {
    id: "admin-group",
    label: "Administration",
    icon: <Settings className="h-4 w-4" />,
    items: [
      { id: "admin-users-access", label: "Users & Access", icon: <Users className="h-3.5 w-3.5" /> },
      { id: "admin-mappings", label: "Mappings", icon: <Shapes className="h-3.5 w-3.5" /> },
      { id: "admin-audit-log", label: "Audit Log", icon: <ClipboardList className="h-3.5 w-3.5" /> },
    ],
  },
];

/** The pages of a group this reader may open. Nothing else in the group is rendered. */
export function authorizedItems(group: NavGroup, perms: readonly string[] | undefined): NavItem[] {
  return group.items.filter((i) => isViewAuthorized(perms ? [...perms] : undefined, i.id));
}

/**
 * One sidebar group. Every group expands and collapses — a group with a single page, or
 * with a single page this reader may open, is still a group and never turns into a direct
 * link. Pages the reader cannot open are not rendered, and a group with none is hidden.
 */
function NavGroupItem({ group }: { group: NavGroup }) {
  const perms = useAuthStore((s) => s.user?.permissions);
  const collapsed = useNavStore((s) => !!s.collapsedGroups[group.id]);
  const toggleGroup = useNavStore((s) => s.toggleGroup);
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);

  const items = authorizedItems(group, perms);
  const hasActive = items.some((i) => i.id === view);

  // The group of the page being opened (from a link, a bookmark or the palette) opens with
  // it. Otherwise the reader's choice stands: a group closed while its page is open stays
  // closed until another navigation.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hasActive) {
      // Leaving the group: the next arrival at one of its pages opens it again.
      openedFor.current = null;
      return;
    }
    if (openedFor.current !== view) {
      openedFor.current = view;
      if (collapsed) toggleGroup(group.id);
    }
  }, [hasActive, view, collapsed, toggleGroup, group.id]);

  if (items.length === 0) return null;

  const expanded = !collapsed;
  const listId = `nav-group-${group.id}`;

  const handleItemClick = (id: ViewId) => {
    setView(id);
    // On a phone, opening a page closes the drawer; expanding a group does not.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <div className="border-b border-sidebar-border/40 py-0.5 last:border-0">
      <button
        type="button"
        onClick={() => toggleGroup(group.id)}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${group.label}`}
        className={cn(
          "mx-auto flex h-7 w-full items-center gap-2 rounded-md px-3 text-left text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          hasActive
            ? "text-[#C2410C] dark:text-[#FFEDD5]"
            : "text-[#9A3412]/80 hover:text-[#7C2D12] hover:bg-white/25 dark:text-sidebar-foreground/65 dark:hover:text-sidebar-foreground"
        )}
      >
        <span className="text-[#9A3412]/70 dark:text-sidebar-foreground/60" aria-hidden>{group.icon}</span>
        <span className="flex-1 truncate">{group.label}</span>
        <span className="ml-1 text-[#9A3412]/60 dark:text-sidebar-foreground/50" aria-hidden>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <ul id={listId} className="space-y-px py-0.5">
          {items.map((item) => {
            const active = view === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleItemClick(item.id)}
                  aria-current={active ? "page" : undefined}
                  title={item.label}
                  className={cn(
                    "relative mx-1.5 flex h-nav-row w-[calc(100%-12px)] items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition-all cursor-pointer",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active
                      ? "bg-white/60 border border-white/90 backdrop-blur-md font-bold text-[#EA580C] shadow-[0_2px_8px_rgba(234,88,12,0.12),inset_0_1px_1px_rgba(255,255,255,0.9)] dark:bg-white/15 dark:border-white/20 dark:text-[#FFEDD5]"
                      : "text-[#7C2D12] hover:bg-white/35 hover:text-[#431407] font-medium border border-transparent dark:text-sidebar-foreground/80 dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground",
                  )}
                >
                  {active && (
                    <span className="absolute right-1.5 top-1.5 bottom-1.5 w-1 rounded-full bg-[#EA580C] shadow-[0_0_6px_rgba(234,88,12,0.5)] dark:bg-[#F9733E]" />
                  )}
                  <span className={cn("shrink-0", active ? "text-[#EA580C] dark:text-[#F9733E]" : "text-[#9A3412]/70 dark:text-sidebar-foreground/60")}>{item.icon}</span>
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Collapsed state on desktop: a narrow rail of group icons. Choosing a group opens the
// sidebar with that group expanded, so even a single-page group shows its page rather than
// navigating silently.
function NavRail() {
  const perms = useAuthStore((s) => s.user?.permissions);
  const view = useNavStore((s) => s.view);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);
  const toggleGroup = useNavStore((s) => s.toggleGroup);
  const collapsedGroups = useNavStore((s) => s.collapsedGroups);

  const openGroup = (groupId: string) => {
    if (collapsedGroups[groupId]) toggleGroup(groupId);
    setSidebarOpen(true);
  };

  return (
    <aside className="hidden md:flex md:static md:w-14 md:flex-shrink-0 md:my-2 md:ml-2 md:h-[calc(100vh-16px)] md:flex-col md:rounded-xl border border-sidebar-border bg-sidebar shadow-xs overflow-hidden z-20">
      {/* Brand Logo in collapsed rail */}
      <div className="p-2 flex-shrink-0 flex items-center justify-center border-b border-sidebar-border/50">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="group flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 dark:bg-[#221C18] border border-white/90 dark:border-[#3D322C] hover:bg-white/90 transition-all cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          aria-label="Expand sidebar"
          title="Expand sidebar — Diamond Planning"
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#EA580C] text-white dark:bg-[#18181B] dark:text-white shadow-xs group-hover:scale-105 transition-transform">
            <DiamondMark className="h-3.5 w-3.5" />
          </div>
        </button>
      </div>
      <nav aria-label="Sections" className="flex-1 overflow-y-auto flex flex-col items-center gap-0.5 py-2">
        {NAV.map((g) => {
          if (authorizedItems(g, perms).length === 0) return null;
          const active = g.items.some((i) => i.id === view);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => openGroup(g.id)}
              title={g.label}
              aria-label={`Show ${g.label}`}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-lg transition-all cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                active
                  ? "bg-white/60 border border-white/90 backdrop-blur-md text-[#EA580C] font-bold shadow-[0_2px_8px_rgba(234,88,12,0.12),inset_0_1px_1px_rgba(255,255,255,0.9)] dark:bg-white/15 dark:border-white/20 dark:text-[#FFEDD5]"
                  : "text-[#7C2D12]/75 hover:bg-white/35 hover:text-[#431407] border border-transparent dark:text-sidebar-foreground/70 dark:hover:bg-sidebar-accent dark:hover:text-sidebar-foreground",
              )}
            >
              {active && <span className="absolute left-0 h-5 w-1 rounded-r bg-[#EA580C] shadow-[0_0_6px_rgba(234,88,12,0.5)] dark:bg-[#F9733E]" />}
              {g.icon}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const setView = useNavStore((s) => s.setView);

  const { data: searchResults, isFetching } = useQuery({
    queryKey: ["global-search", query],
    queryFn: async () => {
      if (!query || query.trim().length < 2) return null;
      try {
        const q = encodeURIComponent(query.trim());
        const [roughRes, polishedRes, reqRes] = await Promise.all([
          apiFetch<{ rows: Array<{ id: string; fantasyRoughId: string; stoneName: string; kapan: string; country: string }> }>(`/api/fantasy/rough?q=${q}&take=5`).catch(() => null),
          apiFetch<{ rows: Array<{ id: string; fantasyLotId: string; shape: string; weight: number; country: string }> }>(`/api/fantasy/polished?q=${q}&take=5`).catch(() => null),
          apiFetch<{ data: Array<{ id: string; requirementCode: string; customerName: string | null }> }>(`/api/requirements?q=${q}&pageSize=5`).catch(() => null),
        ]);
        return {
          rough: roughRes?.rows?.slice(0, 5) ?? [],
          polished: polishedRes?.rows?.slice(0, 5) ?? [],
          requirements: reqRes?.data?.slice(0, 5) ?? [],
        };
      } catch {
        return null;
      }
    },
    enabled: query.trim().length >= 2,
    staleTime: 5_000,
  });

  const hasResults =
    searchResults &&
    (searchResults.rough.length > 0 || searchResults.polished.length > 0 || searchResults.requirements.length > 0);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hasResults) {
      if (searchResults.rough.length > 0) {
        setView("fantasy-live", "rough");
        setOpen(false);
      } else if (searchResults.polished.length > 0) {
        setView("fantasy-live", "polished");
        setOpen(false);
      } else if (searchResults.requirements.length > 0) {
        setView("requirements-matrix");
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <Input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Search Lot ID, Rough ID, Kapan..."
        className="h-8 pl-8 pr-7 text-xs bg-muted/40 hover:bg-muted/60 focus:bg-card border-border/70 focus:border-[#F9733E]/60 rounded-xl transition-all shadow-2xs"
      />
      {query && (
        <button
          type="button"
          onClick={() => { setQuery(""); setOpen(false); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
          title="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && query.trim().length >= 2 && (
        <div
          className="absolute top-full mt-1.5 left-0 right-0 z-50 rounded-xl border border-border/80 bg-popover/90 backdrop-blur-xl shadow-2xl overflow-hidden max-h-80 overflow-y-auto animate-in fade-in-50 zoom-in-95"
          onMouseDown={(e) => e.preventDefault()} // Prevent input blur when clicking items
        >
          {isFetching && !searchResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Searching...</div>
          )}
          {hasResults && (
            <>
              {searchResults.rough.length > 0 && (
                <div className="p-1.5">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Rough Stones</p>
                  {searchResults.rough.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setView("fantasy-live", "rough"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Gem className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="font-semibold">{r.fantasyRoughId}</span>
                        <span className="text-muted-foreground truncate">{r.stoneName} (Kapan: {r.kapan})</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono ml-2 shrink-0">{r.country}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.polished.length > 0 && (
                <div className="p-1.5 border-t border-border">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Polished Lots</p>
                  {searchResults.polished.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setView("fantasy-live", "polished"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Diamond className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                        <span className="font-semibold">{p.fantasyLotId}</span>
                        <span className="text-muted-foreground">{p.shape} {p.weight}ct</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase font-mono ml-2 shrink-0">{p.country}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchResults.requirements.length > 0 && (
                <div className="p-1.5 border-t border-border">
                  <p className="text-[10px] uppercase font-semibold tracking-wide text-muted-foreground px-2 py-0.5">Requirements</p>
                  {searchResults.requirements.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => { setView("requirements-matrix"); setOpen(false); }}
                      className="w-full flex items-center justify-between px-2 py-1 text-xs hover:bg-muted rounded text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ClipboardList className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="font-semibold">{r.requirementCode}</span>
                        <span className="text-muted-foreground truncate">{r.customerName ?? "Stock Requirement"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {!isFetching && searchResults && !hasResults && (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const emptySubscribe = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  if (!mounted) return <div className="h-8 w-8" />;
  return (
    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

function NotificationsBell() {
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<{ rows: Array<{ id: string; title: string; message: string; severity: string; read: boolean; createdAt?: string }> }>("/api/notifications"),
    staleTime: 60_000,
  });
  const unread = data?.rows.filter((n) => !n.read).length ?? 0;
  const [open, setOpen] = useState(false);
  const totalUnread = unread;

  const handleToggle = () => setOpen((o) => !o);

  const formatRelTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 relative text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded-lg"
        onClick={handleToggle}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-[0_1px_4px_rgba(239,68,68,0.45)] ring-2 ring-card">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute top-full mt-2 right-0 w-84 z-50 rounded-xl border border-border/80 bg-popover/90 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95">
          <div className="px-3.5 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-foreground">Action Inbox</p>
              {totalUnread > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
                  {totalUnread} new
                </span>
              )}
            </div>
          </div>

          <div className="max-h-88 overflow-y-auto divide-y divide-border/40">
            {data && data.rows.length > 0 && (
              <>
                <div className="px-3 py-1 bg-muted/20 border-b border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent System Alerts ({data.rows.length})</p>
                </div>
                {data.rows.map((n) => (
                  <div key={n.id} className={cn("px-3.5 py-2.5 hover:bg-muted/40 transition-colors", !n.read && "bg-primary/[0.02]")}>
                    <div className="flex items-start gap-2.5">
                      <span className={cn("h-2 w-2 rounded-full mt-1 shrink-0",
                        n.severity === "CRITICAL" ? "bg-rose-500" :
                        n.severity === "ERROR" ? "bg-rose-400" :
                        n.severity === "WARNING" ? "bg-amber-500" :
                        "bg-primary")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-xs font-semibold text-foreground truncate">{n.title}</p>
                          {n.createdAt && (
                            <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">{formatRelTime(n.createdAt)}</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5 leading-relaxed">{n.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}

            {(!data || data.rows.length === 0) && (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                <p className="font-medium text-foreground">No alerts</p>
                <p className="text-[11px] mt-0.5">Your action inbox is up to date.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const sidebarOpen = useNavStore((s) => s.sidebarOpen);
  const setSidebarOpen = useNavStore((s) => s.setSidebarOpen);
  const view = useNavStore((s) => s.view);

  // Close mobile sidebar on view change (via hash change)
  useEffect(() => {
    const closeOnMobile = () => {
      if (typeof window !== "undefined" && window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("hashchange", closeOnMobile);
    return () => window.removeEventListener("hashchange", closeOnMobile);
  }, [setSidebarOpen]);

  // Auto-close sidebar on mobile initial load
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [setSidebarOpen]);

  // Auto-close sidebar when viewport shrinks below md (768px)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  return (
    <div data-app-shell className="h-screen max-h-screen w-full flex text-foreground overflow-hidden">
      {/* Mobile backdrop when sidebar open */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40 backdrop-blur-xs"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — overlay on mobile, static rounded panel on desktop */}
      {sidebarOpen && (
        <aside
          className={cn(
            "bg-sidebar flex flex-col border border-sidebar-border shadow-xs overflow-hidden transition-all",
            // Mobile: fixed drawer overlay
            "fixed inset-y-2 left-2 w-72 max-w-[85vw] rounded-2xl shadow-2xl z-50",
            // Desktop: static side-by-side rounded panel with subtle margin
            "md:static md:my-2 md:ml-2 md:h-[calc(100vh-16px)] md:w-sidebar md:max-w-none md:flex-shrink-0 md:rounded-xl md:z-20 md:shadow-xs"
          )}
        >
          {/* Differentiated Project Header Capsule */}
          <div className="p-2 flex-shrink-0 border-b border-sidebar-border/50">
            <div className="flex items-center justify-between gap-2 rounded-xl bg-white/70 dark:bg-[#221C18] border border-white/90 dark:border-[#3D322C] p-2 shadow-2xs backdrop-blur-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#EA580C] text-white dark:bg-[#18181B] dark:text-white shadow-xs">
                  <DiamondMark className="h-4 w-4" />
                </div>
                <div className="flex flex-col min-w-0 leading-tight">
                  <span className="truncate text-xs font-bold tracking-tight text-[#431407] dark:text-[#FFEDD5] select-none">
                    Diamond Planning
                  </span>
                  <span className="truncate text-[9px] font-semibold text-[#9A3412]/80 dark:text-[#A8988E] select-none">
                    ERP Platform
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 rounded-lg text-[#7C2D12]/70 hover:bg-white/80 hover:text-[#431407] dark:text-muted-foreground dark:hover:text-foreground cursor-pointer"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
              </Button>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 overflow-y-auto px-1 py-1">
            {NAV.map((g) => (
              <NavGroupItem key={g.id} group={g} />
            ))}
          </nav>

        </aside>
      )}

      {/* Collapsed: icon rail on desktop */}
      {!sidebarOpen && <NavRail />}

      {/* Right Content Area: Top Bar + Main View + Bottom Footer */}
      <div className="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
        {/* Pinned Top Bar with Frosted Glass & Warm Background Shade */}
        <header className="sticky top-0 z-50 flex h-bar flex-shrink-0 items-center gap-1.5 border-b border-border/80 bg-[#FFF3EB]/95 dark:bg-[#131720]/95 px-2 backdrop-blur-md sm:gap-2 sm:px-page-x shadow-2xs">
          {/* Mobile hamburger toggle (only when sidebar is closed) */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 md:hidden flex-shrink-0"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Search */}
          <div className="hidden sm:block w-48 xl:w-56 2xl:w-64 flex-shrink-0">
            <GlobalSearch />
          </div>

          {/* Global Filter Bar inside top bar */}
          <div className="hidden md:flex items-center flex-shrink-0">
            <GlobalFilterBar />
          </div>

          {/* Spacer to push actions right */}
          <div className="flex-1" />

          {/* Right actions */}
          <div className="flex items-center gap-1 sm:gap-1.5 ml-auto flex-shrink-0">
            <ThemeToggle />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>

        {/* Center Main Workspace */}
        <main className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden flex flex-col">
          {children}
        </main>

      </div>

      {/* Command palette (Cmd+K / Ctrl+K) */}
      <CommandPalette />
    </div>
  );
}
